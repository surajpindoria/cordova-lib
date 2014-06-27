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
var platforms = require('../../src/cordova/platforms'),
    util = require('../../src/cordova/util'),
    path = require('path'),
    shell = require('shelljs'),
    fs = require('fs'),
    et = require('elementtree'),
    xmlHelpers = require('../../src/util/xml-helpers'),
    Q = require('q'),
    config = require('../../src/cordova/config'),
    ConfigParser = require('../../src/configparser/ConfigParser'),
    cordova = require('../../src/cordova/cordova'),
    helpers = require('../helpers'),
    crypto = require('crypto');

// Create a real config object before mocking out everything.
var cfg = new ConfigParser(path.join(__dirname, '..', 'test-config.xml'));

var STRINGS_XML = '<resources> <string name="app_name">mobilespec</string> </resources>';
var MANIFEST_XML = '<manifest android:versionCode="1" android:versionName="0.0.1" package="org.apache.mobilespec">\n' +
    '<application android:hardwareAccelerated="true" android:icon="@drawable/icon" android:label="@string/app_name">\n' +
    '    <activity android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale" android:label="@string/app_name" android:name="mobilespec" android:screenOrientation="VAL">\n' +
    '        <intent-filter>\n' +
    '            <action android:name="android.intent.action.MAIN" />\n' +
    '            <category android:name="android.intent.category.LAUNCHER" />\n' +
    '        </intent-filter>\n' +
    '    </activity>\n' +
    '</application>\n' +
    '</manifest>\n';
var SPLASH_XML = '<platform name="android">' + 
    '   <splash src="./screen.png" density="land-hdpi"/>' + 
    '</platform>';

describe('android project parser', function() {
    var proj = path.join('some', 'path');
    var exists;
    beforeEach(function() {
        exists = spyOn(fs, 'existsSync').andReturn(true);
        spyOn(config, 'has_custom_path').andReturn(false);
    });

    function wrapper(p, done, post) {
        p.then(post, function(err) {
            expect(err).toBeUndefined();
        }).fin(done);
    }

    function errorWrapper(p, done, post) {
        p.then(function() {
            expect('this call').toBe('fail');
        }, post).fin(done);
    }

    describe('constructions', function() {
        it('should throw if provided directory does not contain an AndroidManifest.xml', function() {
            exists.andReturn(false);
            expect(function() {
                new platforms.android.parser(proj);
            }).toThrow();
        });
        it('should create an instance with path, strings, manifest and android_config properties', function() {
            expect(function() {
                var p = new platforms.android.parser(proj);
                expect(p.path).toEqual(proj);
                expect(p.strings).toEqual(path.join(proj, 'res', 'values', 'strings.xml'));
                expect(p.manifest).toEqual(path.join(proj, 'AndroidManifest.xml'));
                expect(p.android_config).toEqual(path.join(proj, 'res', 'xml', 'config.xml'));
            }).not.toThrow();
        });
    });

    describe('instance', function() {
        var p, cp, rm, mkdir, is_cordova, write, read;
        var android_proj = path.join(proj, 'platforms', 'android');
        var stringsRoot;
        var manifestRoot;
        var splashRoot;
        beforeEach(function() {
            stringsRoot = null;
            manifestRoot = null;
            p = new platforms.android.parser(android_proj);
            cp = spyOn(shell, 'cp');
            rm = spyOn(shell, 'rm');
            is_cordova = spyOn(util, 'isCordova').andReturn(proj);
            write = spyOn(fs, 'writeFileSync');
            read = spyOn(fs, 'readFileSync');
            mkdir = spyOn(shell, 'mkdir');
            spyOn(xmlHelpers, 'parseElementtreeSync').andCallFake(function(path) {
                if (/strings/.exec(path)) {
                    return stringsRoot = new et.ElementTree(et.XML(STRINGS_XML));
                } else if (/AndroidManifest/.exec(path)) {
                    return manifestRoot = new et.ElementTree(et.XML(MANIFEST_XML));
                } else if (path === 'splash') {
                    return splashRoot = new et.ElementTree(et.XML(SPLASH_XML));
                }
            });
        });

        describe('update_from_config method', function() {
            beforeEach(function() {
                spyOn(fs, 'readdirSync').andReturn([path.join(proj, 'src', 'android_pkg', 'MyApp.java')]);
                cfg.name = function() { return 'testname' };
                cfg.packageName = function() { return 'testpkg' };
                cfg.version = function() { return 'one point oh' };
                read.andReturn('package org.cordova.somepackage; public class MyApp extends CordovaActivity { }');
            });

            it('should handle no orientation', function() {
                cfg.getPreference = function() { return null; };
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().find('./application/activity').attrib['android:screenOrientation']).toEqual('VAL');
            });
            it('should handle default orientation', function() {
                cfg.getPreference = function() { return 'default'; };
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().find('./application/activity').attrib['android:screenOrientation']).toBeUndefined();
            });
            it('should handle portrait orientation', function() {
                cfg.getPreference = function() { return 'portrait'; };
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().find('./application/activity').attrib['android:screenOrientation']).toEqual('portrait');
            });
            it('should handle invalid orientation', function() {
                cfg.getPreference = function() { return 'prtrait'; };
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().find('./application/activity').attrib['android:screenOrientation']).toEqual('VAL');
            });
            it('should write out the app name to strings.xml', function() {
                p.update_from_config(cfg);
                expect(stringsRoot.getroot().find('string').text).toEqual('testname');
            });
            it('should write out the app id to androidmanifest.xml and update the cordova-android entry Java class', function() {
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().attrib.package).toEqual('testpkg');
            });
            it('should write out the app version to androidmanifest.xml', function() {
                p.update_from_config(cfg);
                expect(manifestRoot.getroot().attrib['android:versionName']).toEqual('one point oh');
            });
            // it('should copy custom splash screens if present in config.xml, without spies', function() {
            //     read.andCallThrough();
            //     xmlHelpers.parseElementtreeSync.andCallThrough();

            //     var parsedConfig = xmlHelpers.parseElementtreeSync(path.join(helpers.tmpDir(), 'platform_test', 'project', 'www', 'config.xml'));
            //     var splashScreens = [];

            //     for (i = 0; i < parsedConfig._root._children.length; i++) {
            //         if (parsedConfig._root._children[i].tag === 'platform' && parsedConfig._root._children[i].attrib.name === 'android') {
            //             for (x = 0; x < parsedConfig._root._children[i]._children.length; x++) {
            //                 if (parsedConfig._root._children[i]._children[x].tag === 'splash') {
            //                     splashScreens.push(parsedConfig._root._children[i]._children[x].attrib);
            //                 }
            //             }
            //         }
            //     }

            //     var testProjPath = path.join(helpers.tmpDir(), 'platform_test', 'project');
            //     var androidResPath = path.join(testProjPath, 'platforms', 'android', 'res');
                
            //     fs.writeFileSync.andCallThrough();
            //     fs.readdirSync.andCallThrough();

            //     fs.mkdir(androidResPath);

            //     for (i = 0; i < splashScreens.length; i++) {
            //         var srcfilePath = path.join(testProjPath, 'www', splashScreens[i].src.slice(1));
            //         var destfilePath = path.join(androidResPath, 'drawable-' + splashScreens[i].density);
                    
            //         fs.mkdir(destfilePath);
            //         fs.writeFileSync(path.join(destfilePath, 'screen.png'), fs.readFileSync(srcfilePath));

            //         var origFileHash = crypto.createHash('md5').update(fs.readFileSync(srcfilePath)).digest('base64');
            //         var copiedFileHash = crypto.createHash('md5').update(fs.readFileSync(path.join(destfilePath, 'screen.png'))).digest('base64');

            //         expect(origFileHash).toEqual(copiedFileHash);
            //     }

            //     if (fs.existsSync(androidResPath)) {
            //         shell.rm.andCallThrough();
            //         shell.rm('-rf',androidResPath);
            //     }
            // });
            it('should copy custom splash screens if present in config.xml, with spies', function() {
                var parsedConfig = xmlHelpers.parseElementtreeSync('splash');
                var splashScreens = [];

                for (i = 0; i < parsedConfig._root._children.length; i++) {
                    if (parsedConfig._root.tag === 'platform' && parsedConfig._root.attrib.name === 'android') {
                        if (parsedConfig._root._children[i].tag === 'splash') {
                            splashScreens.push(parsedConfig._root._children[i].attrib);
                        }
                    }
                }

                var androidResPath = path.join(android_proj, 'res');
                var srcfilePath = splashScreens[0].src;
                var destfilePath = path.join(androidResPath, 'drawable-' + splashScreens[0].density);

                p.update_from_config(cfg);
                expect(cp).toHaveBeenCalled();
            });
        });
        describe('www_dir method', function() {
            it('should return assets/www', function() {
                expect(p.www_dir()).toEqual(path.join(android_proj, 'assets', 'www'));
            });
        });
        describe('config_xml method', function() {
            it('should return the location of the config.xml', function() {
                expect(p.config_xml()).toEqual(p.android_config);
            });
        });
        describe('update_www method', function() {
            it('should rm project-level www and cp in platform agnostic www', function() {
                p.update_www();
                expect(rm).toHaveBeenCalled();
                expect(cp).toHaveBeenCalled();
            });
        });
        describe('update_overrides method', function() {
            it('should do nothing if merges directory does not exist', function() {
                exists.andReturn(false);
                p.update_overrides();
                expect(cp).not.toHaveBeenCalled();
            });
            it('should copy merges path into www', function() {
                p.update_overrides();
                expect(cp).toHaveBeenCalled();
            });
        });
        describe('update_project method', function() {
            var config, www, overrides, svn;
            beforeEach(function() {
                config = spyOn(p, 'update_from_config');
                www = spyOn(p, 'update_www');
                overrides = spyOn(p, 'update_overrides');
                svn = spyOn(util, 'deleteSvnFolders');
            });
            it('should call update_from_config', function() {
                p.update_project();
                expect(config).toHaveBeenCalled();
            });
            it('should throw if update_from_config throws', function(done) {
                var err = new Error('uh oh!');
                config.andCallFake(function() { throw err; });
                errorWrapper(p.update_project({}), done, function(err) {
                    expect(err).toEqual(err);
                });
            });
            it('should not call update_www', function() {
                p.update_project();
                expect(www).not.toHaveBeenCalled();
            });
            it('should call update_overrides', function() {
                p.update_project();
                expect(overrides).toHaveBeenCalled();
            });
            it('should call deleteSvnFolders', function() {
                p.update_project();
                expect(svn).toHaveBeenCalled();
            });
        });
    });
});
