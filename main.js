/**
 * Copyright OpenJS Foundation and other contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var os = require('os');
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var http = require('http');
var expressApp = require('express')();
var server = http.createServer(expressApp);
var RED = require('node-red');
var { app, Menu, dialog, shell, Tray } = require('electron');
var log = require('electron-log/main');
var createBrowserManager = require('./browser-manager');
Object.assign(console, log.functions);
var tray = null;

// When using asar, unpacked files live under app.asar.unpacked instead of app.asar
var unpackedDir = __dirname.replace('app.asar', 'app.asar.unpacked');

var settings = {
    uiHost: '127.0.0.1',
    uiPort: process.env.PORT || 1880,
    httpAdminRoot: '/red',
    httpNodeRoot: '/',
    userDir: path.join(os.homedir(), '.node-red-standalone'),
    flowFile: 'flows.json',

    // Allow the WebOS (browser) to call local Node-RED HTTP endpoints
    httpNodeCors: {
        origin: '*',
        methods: 'GET,PUT,POST,DELETE,OPTIONS'
    },

    // Allow Function nodes to require() external npm packages
    functionExternalModules: true,

    editorTheme: {
        projects: { enabled: true },
        page: {
            title: 'Offline - AgentOS',
            favicon: path.join(unpackedDir, 'build', 'icon.png'),
            tabicon: {
                icon: path.join(unpackedDir, 'build', 'icon.png'),
                colour: '#6B5CE7'
            }
        },
        header: {
            title: 'Offline - AgentOS',
            image: path.join(unpackedDir, 'build', 'icon.png')
        }
    }
};

// Browser lifecycle manager — provides a warm Chromium instance to flow endpoints
var browserManager = createBrowserManager(settings.userDir);
settings.functionGlobalContext = {
    getBrowser: browserManager.getBrowser
};

var url = 'http://' + settings.uiHost + ':' + settings.uiPort + settings.httpAdminRoot;

process.execPath = 'node';
if (process.platform === 'darwin') {
    process.env.PATH += ':/usr/local/bin';
    app.dock.hide();
}

// Graceful shutdown — kill lingering Chromium processes
function gracefulShutdown(code) {
    browserManager.closeBrowser().finally(function () {
        app.exit(code);
    });
}

process.on('SIGTERM', function () { gracefulShutdown(0); });
process.on('SIGINT', function () { gracefulShutdown(0); });

if (!app.requestSingleInstanceLock()) {
    shell.openExternal(url);
    app.quit();
} else {
    RED.hooks.add("postInstall", function (event, done) {
        var cmd = (process.platform === 'win32') ? 'npm.cmd' : 'npm';
        var args = ['install', '@electron/rebuild'];
        child_process.execFile(cmd, args, { cwd: settings.userDir }, function (error) {
            if (!error) {
                var cmd2 = path.join('node_modules', '.bin',
                    (process.platform === 'win32') ? 'electron-rebuild.cmd' : 'electron-rebuild');
                var args2 = ['-v', process.versions.electron];
                child_process.execFile(cmd2, args2, { cwd: event.dir }, function (error2) {
                    if (!error2) {
                        done();
                    } else {
                        dialog.showErrorBox('Error', error2.toString());
                        app.exit(1);
                    }
                });
            }
        });
    });

    // First-run setup: ensure userDir exists and seed default WebOS flows
    if (!fs.existsSync(settings.userDir)) {
        fs.mkdirSync(settings.userDir, { recursive: true });
    }
    var flowsFile = path.join(settings.userDir, settings.flowFile);
    if (!fs.existsSync(flowsFile)) {
        var defaultFlows = path.join(__dirname, 'default-flows.json');
        if (fs.existsSync(defaultFlows)) {
            fs.copyFileSync(defaultFlows, flowsFile);
            console.log('Default WebOS System Services flows installed');
        }
    }

    RED.init(server, settings);
    expressApp.use(settings.httpAdminRoot, RED.httpAdmin);
    expressApp.use(settings.httpNodeRoot, RED.httpNode);
    server.on('error', function (error) {
        dialog.showErrorBox('Error', error.toString());
        app.exit(1);
    });
    server.listen(settings.uiPort, settings.uiHost, function () {
        RED.start().then(function () {

            // Install Puppeteer in userDir if not already present (downloads Chromium)
            var puppeteerCheck = path.join(settings.userDir, 'node_modules', 'puppeteer');
            if (!fs.existsSync(puppeteerCheck)) {
                console.log('Installing Puppeteer (first-run setup, this downloads Chromium)...');
                var npmCmd = (process.platform === 'win32') ? 'npm.cmd' : 'npm';
                child_process.execFile(npmCmd, ['install', 'puppeteer'], { cwd: settings.userDir }, function (error) {
                    if (error) {
                        console.error('Failed to install Puppeteer:', error.message);
                    } else {
                        console.log('Puppeteer installed successfully — WebOS browser services are ready');
                    }
                });
            }

            app.whenReady().then(function () {
                tray = new Tray(path.join(unpackedDir, 'build', 'icon.png'));
                tray.setToolTip('Offline - AgentOS');
                tray.on('click', function () {
                    shell.openExternal(url);
                });
                tray.setContextMenu(Menu.buildFromTemplate([
                    {
                        label: 'Offline - AgentOS', click: function () {
                            shell.openExternal(url);
                        }
                    },
                    {
                        label: 'Quit', click: function () {
                            gracefulShutdown(0);
                        }
                    }
                ]));
                shell.openExternal(url);
            });
        }).catch(function (error) {
            dialog.showErrorBox('Error', error.toString());
            app.exit(1);
        });
    });
}
