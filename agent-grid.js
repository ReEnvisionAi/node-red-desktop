/**
 * Agent Grid Integration
 *
 * Handles detection, download, and installation of the Agent Grid
 * distributed inference server alongside Offline - AgentOS.
 * macOS only - uses pre-built DMG from GitHub releases.
 */

var fs = require('fs');
var path = require('path');
var https = require('https');
var child_process = require('child_process');
var { app, dialog, BrowserWindow, shell } = require('electron');
var log = require('electron-log/main');

var AGENT_GRID_APP_NAME = 'Agent Grid.app';
var AGENT_GRID_INSTALL_PATH = path.join('/Applications', AGENT_GRID_APP_NAME);
var RELEASES_API_URL = 'https://api.github.com/repos/ReEnvision-AI/systray/releases/latest';
var DOWNLOAD_DIR = path.join(app.getPath('temp'), 'agent-grid-installer');

function isInstalled() {
    return fs.existsSync(AGENT_GRID_INSTALL_PATH);
}

function getLatestRelease(callback) {
    var options = {
        hostname: 'api.github.com',
        path: '/repos/ReEnvision-AI/systray/releases/latest',
        headers: { 'User-Agent': 'Offline-AgentOS' }
    };

    https.get(options, function (res) {
        var data = '';
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
            try {
                var release = JSON.parse(data);
                var dmgAsset = null;
                if (release.assets) {
                    for (var i = 0; i < release.assets.length; i++) {
                        if (release.assets[i].name.endsWith('-arm64.dmg')) {
                            dmgAsset = release.assets[i];
                            break;
                        }
                    }
                }
                callback(null, {
                    version: release.tag_name,
                    dmg: dmgAsset ? {
                        name: dmgAsset.name,
                        size: dmgAsset.size,
                        url: dmgAsset.browser_download_url
                    } : null
                });
            } catch (e) {
                callback(e);
            }
        });
    }).on('error', function (e) {
        callback(e);
    });
}

function downloadFile(url, destPath, onProgress, callback) {
    if (!fs.existsSync(path.dirname(destPath))) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
    }

    var file = fs.createWriteStream(destPath);
    var followRedirect = function (downloadUrl) {
        https.get(downloadUrl, { headers: { 'User-Agent': 'Offline-AgentOS' } }, function (res) {
            if (res.statusCode === 302 || res.statusCode === 301) {
                followRedirect(res.headers.location);
                return;
            }
            if (res.statusCode !== 200) {
                callback(new Error('Download failed with status ' + res.statusCode));
                return;
            }

            var totalBytes = parseInt(res.headers['content-length'], 10) || 0;
            var downloadedBytes = 0;

            res.on('data', function (chunk) {
                downloadedBytes += chunk.length;
                if (totalBytes > 0 && onProgress) {
                    onProgress(downloadedBytes, totalBytes);
                }
            });
            res.pipe(file);
            file.on('finish', function () {
                file.close(function () { callback(null, destPath); });
            });
        }).on('error', function (e) {
            fs.unlink(destPath, function () {});
            callback(e);
        });
    };
    followRedirect(url);
}

function mountAndInstall(dmgPath, callback) {
    // Mount the DMG
    child_process.execFile('hdiutil', ['attach', dmgPath, '-nobrowse', '-quiet'], function (err, stdout) {
        if (err) {
            callback(new Error('Failed to mount DMG: ' + err.message));
            return;
        }

        // Find the mount point
        var lines = stdout.trim().split('\n');
        var mountPoint = null;
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split('\t');
            var lastPart = parts[parts.length - 1].trim();
            if (lastPart.startsWith('/Volumes/')) {
                mountPoint = lastPart;
            }
        }

        if (!mountPoint) {
            callback(new Error('Could not find mount point for DMG'));
            return;
        }

        // Find the .app inside the mounted volume
        try {
            var files = fs.readdirSync(mountPoint);
            var appDir = null;
            for (var j = 0; j < files.length; j++) {
                if (files[j].endsWith('.app')) {
                    appDir = files[j];
                    break;
                }
            }

            if (!appDir) {
                child_process.execFile('hdiutil', ['detach', mountPoint, '-quiet'], function () {});
                callback(new Error('No .app found in DMG'));
                return;
            }

            var srcApp = path.join(mountPoint, appDir);
            var destApp = path.join('/Applications', appDir);

            // Remove existing installation if present
            if (fs.existsSync(destApp)) {
                child_process.execFileSync('rm', ['-rf', destApp]);
            }

            // Copy .app to /Applications
            child_process.execFile('cp', ['-R', srcApp, destApp], function (cpErr) {
                // Unmount regardless of copy result
                child_process.execFile('hdiutil', ['detach', mountPoint, '-quiet'], function () {});

                if (cpErr) {
                    callback(new Error('Failed to copy app to /Applications: ' + cpErr.message));
                    return;
                }

                log.info('Agent Grid installed to ' + destApp);
                callback(null, destApp);
            });
        } catch (readErr) {
            child_process.execFile('hdiutil', ['detach', mountPoint, '-quiet'], function () {});
            callback(readErr);
        }
    });
}

function launchAgentGrid() {
    if (isInstalled()) {
        child_process.execFile('open', ['-a', AGENT_GRID_INSTALL_PATH], function (err) {
            if (err) {
                log.error('Failed to launch Agent Grid: ' + err.message);
            }
        });
    }
}

function promptInstall() {
    getLatestRelease(function (err, release) {
        if (err) {
            log.error('Failed to check Agent Grid releases: ' + err.message);
            return;
        }

        if (!release.dmg) {
            log.warn('No macOS DMG found in Agent Grid latest release');
            return;
        }

        var sizeMB = Math.round(release.dmg.size / (1024 * 1024));
        var result = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Install Now', 'Later'],
            defaultId: 0,
            title: 'Install Agent Grid',
            message: 'Install Agent Grid Distributed Inference?',
            detail: 'Agent Grid enables distributed AI inference alongside Offline - AgentOS.\n\n' +
                    'Version: ' + release.version + '\n' +
                    'Download size: ~' + sizeMB + ' MB\n\n' +
                    'This will download and install Agent Grid to your Applications folder.'
        });

        if (result !== 0) return;

        var dmgPath = path.join(DOWNLOAD_DIR, release.dmg.name);

        // Create a progress window
        var progressWin = new BrowserWindow({
            width: 400,
            height: 130,
            resizable: false,
            frame: false,
            alwaysOnTop: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });

        progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
            '<html><body style="font-family:-apple-system,sans-serif;padding:20px;background:#1e1e2e;color:#cdd6f4;' +
            'display:flex;flex-direction:column;justify-content:center;-webkit-app-region:drag">' +
            '<div style="margin-bottom:8px;font-size:13px" id="status">Downloading Agent Grid...</div>' +
            '<div style="background:#313244;border-radius:4px;height:8px;overflow:hidden">' +
            '<div id="bar" style="background:#6B5CE7;height:100%;width:0%;transition:width 0.3s"></div></div>' +
            '<div style="margin-top:6px;font-size:11px;color:#a6adc8" id="detail"></div>' +
            '</body></html>'
        ));

        downloadFile(release.dmg.url, dmgPath, function (downloaded, total) {
            var pct = Math.round((downloaded / total) * 100);
            var dlMB = (downloaded / (1024 * 1024)).toFixed(1);
            var totalMB = (total / (1024 * 1024)).toFixed(1);
            try {
                progressWin.webContents.executeJavaScript(
                    'document.getElementById("bar").style.width="' + pct + '%";' +
                    'document.getElementById("detail").textContent="' + dlMB + ' / ' + totalMB + ' MB";'
                );
            } catch (e) {}
        }, function (dlErr, dlPath) {
            if (dlErr) {
                progressWin.close();
                dialog.showErrorBox('Download Failed', 'Could not download Agent Grid: ' + dlErr.message);
                return;
            }

            try {
                progressWin.webContents.executeJavaScript(
                    'document.getElementById("status").textContent="Installing Agent Grid...";' +
                    'document.getElementById("bar").style.width="100%";' +
                    'document.getElementById("detail").textContent="Copying to Applications...";'
                );
            } catch (e) {}

            mountAndInstall(dlPath, function (installErr, installedPath) {
                progressWin.close();

                // Clean up downloaded DMG
                try { fs.unlinkSync(dlPath); } catch (e) {}

                if (installErr) {
                    dialog.showErrorBox('Install Failed', 'Could not install Agent Grid: ' + installErr.message);
                    return;
                }

                var launchResult = dialog.showMessageBoxSync({
                    type: 'info',
                    buttons: ['Launch Now', 'Later'],
                    defaultId: 0,
                    title: 'Installation Complete',
                    message: 'Agent Grid installed successfully!',
                    detail: 'Agent Grid has been installed to your Applications folder.'
                });

                if (launchResult === 0) {
                    launchAgentGrid();
                }
            });
        });
    });
}

module.exports = {
    isInstalled: isInstalled,
    promptInstall: promptInstall,
    launchAgentGrid: launchAgentGrid,
    getLatestRelease: getLatestRelease
};
