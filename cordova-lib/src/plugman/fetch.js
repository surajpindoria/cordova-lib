/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

/* jshint node:true, bitwise:true, undef:true, trailing:true, quotmark:true,
          indent:4, unused:vars, latedef:nofunc
*/

var shell   = require('shelljs'),
    fs      = require('fs'),
    url     = require('url'),
    PluginInfo    = require('../PluginInfo'),
    plugins = require('./util/plugins'),
    CordovaError  = require('../CordovaError'),
    events = require('../events'),
    metadata = require('./util/metadata'),
    path    = require('path'),
    Q       = require('q'),
    registry = require('./registry/registry');

// Cache of PluginInfo objects for plugins in search path.
var localPlugins = null;

// possible options: link, subdir, git_ref, client, expected_id
// Returns a promise.
module.exports = fetchPlugin;
function fetchPlugin(plugin_src, plugins_dir, options) {
    // Ensure the containing directory exists.
    shell.mkdir('-p', plugins_dir);

    options = options || {};
    options.subdir = options.subdir || '.';
    options.searchpath = options.searchpath || [];
    if ( typeof options.searchpath === 'string' ) {
        options.searchpath = options.searchpath.split(path.delimiter);
    }

    // clone from git repository
    var uri = url.parse(plugin_src);

    // If the hash exists, it has the form from npm: http://foo.com/bar#git-ref[:subdir]
    // NB: No leading or trailing slash on the subdir.
    if (uri.hash) {
        var result = uri.hash.match(/^#([^:]*)(?::\/?(.*?)\/?)?$/);
        if (result) {
            if (result[1])
                options.git_ref = result[1];
            if (result[2])
                options.subdir = result[2];

            // Recurse and exit with the new options and truncated URL.
            var new_dir = plugin_src.substring(0, plugin_src.indexOf('#'));
            return fetchPlugin(new_dir, plugins_dir, options);
        }
    }

    // If it looks like a network URL, git clone it.
    if ( uri.protocol && uri.protocol != 'file:' && uri.protocol != 'c:' && !plugin_src.match(/^\w+:\\/)) {
        events.emit('log', 'Fetching plugin "' + plugin_src + '" via git clone');
        if (options.link) {
            return Q.reject(new CordovaError('--link is not supported for git URLs'));
        } else {
            var data = {
                source: {
                    type: 'git',
                    url:  plugin_src,
                    subdir: options.subdir,
                    ref: options.git_ref
                }
            };

            return plugins.clonePluginGit(plugin_src, plugins_dir, options)
            .then(function(dir) {
                checkID(options.expected_id, dir);
                return dir;
            })
            .then(function(dir) {
                metadata.save_fetch_metadata(dir, data);
                return dir;
            });
        }
    } else {
        // If it's not a network URL, it's either a local path or a plugin ID.

        var p,  // The Q promise to be returned.
            linkable = true,
            plugin_dir = path.join(plugin_src, options.subdir);

        if (fs.existsSync(plugin_dir)) {
            p = Q(plugin_dir);
        } else {
            // If there is no such local path, it's a plugin id.
            // First look for it in the local search path (if provided).
            loadLocalPlugins(options.searchpath);
            var pinfo = localPlugins[plugin_src];
            if (pinfo) {
                p = Q(pinfo.dir);
                events.emit('verbose', 'Found ' + plugin_src + ' at ' + pinfo.dir);
            } else if ( options.noregistry ) {
                p = Q.reject(new CordovaError(
                        'Plugin ' + plugin_src + ' not found locally. ' +
                        'Note, plugin registry was disabled by --noregistry flag.'
                    ));
            } else {
                // If not found in local search path, fetch from the registry.
                linkable = false;
                events.emit('log', 'Fetching plugin "' + plugin_src + '" via plugin registry');
                p = registry.fetch([plugin_src], options.client);
            }
        }

        return p
        .then(function(dir) {
            options.plugin_src_dir = dir;
            return copyPlugin(dir, plugins_dir, options.link && linkable);
        })
        .then(function(dir) {
            checkID(options.expected_id, dir);
            return dir;
        });
    }
}

// Helper function for checking expected plugin IDs against reality.
function checkID(expected_id, dir) {
    if (!expected_id) return;
    var pinfo = new PluginInfo.PluginInfo(dir);
    var id = pinfo.id;
    // if id with specific version provided, append version to id
    if (expected_id.split('@').length > 1) {
        id = id + '@' + pinfo.version;
    }
    if (expected_id != id) {
        throw new Error('Expected fetched plugin to have ID "' + expected_id + '" but got "' + id + '".');
    }
}

// Note, there is no cache invalidation logic for local plugins.
// As of this writing loadLocalPlugins() is never called with different
// search paths and such case would not be handled properly.
function loadLocalPlugins(searchpath) {
    if (localPlugins) return;
    localPlugins = {};
    searchpath.forEach(function(dir) {
        var ps = PluginInfo.loadPluginsDir(dir);
        ps.forEach(function(p) {
            localPlugins[p.id] = p;
        });
    });
}

// Copy or link a plugin from plugin_dir to plugins_dir/plugin_id.
function copyPlugin(plugin_dir, plugins_dir, link) {
    var pinfo = new PluginInfo.PluginInfo(plugin_dir);
    var dest = path.join(plugins_dir, pinfo.id);
    shell.rm('-rf', dest);
    if (link) {
        events.emit('verbose', 'Linking plugin "' + plugin_dir + '" => "' + dest + '"');
        fs.symlinkSync(plugin_dir, dest, 'dir');
    } else {
        shell.mkdir('-p', dest);
        events.emit('verbose', 'Copying plugin "' + plugin_dir + '" => "' + dest + '"');
        shell.cp('-R', path.join(plugin_dir, '*') , dest);
    }

    var data = {
        source: {
            type: 'local',
            path: plugin_dir
        }
    };
    metadata.save_fetch_metadata(dest, data);
    return dest;
}