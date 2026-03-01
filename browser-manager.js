/**
 * Browser Lifecycle Manager for WebOS Edge Node
 *
 * Manages a single warm Chromium instance that persists across requests.
 * Function nodes access the browser via Node-RED's global context using
 * global.get('getBrowser'), which returns a Promise<Browser>.
 *
 * Puppeteer is resolved from the Node-RED userDir (installed on first run).
 */

var path = require('path');

var browser = null;
var launching = false;
var pendingCallbacks = [];

function createBrowserManager(userDir) {

    async function getBrowser() {
        // Return existing connected browser
        if (browser && browser.isConnected()) {
            return browser;
        }

        // If already launching, queue this caller
        if (launching) {
            return new Promise(function (resolve, reject) {
                pendingCallbacks.push({ resolve: resolve, reject: reject });
            });
        }

        launching = true;

        try {
            // Resolve puppeteer from the Node-RED user directory
            var puppeteerPath = path.join(userDir, 'node_modules', 'puppeteer');
            var puppeteer = require(puppeteerPath);

            browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    // Fix for Sandpack cross-origin iframe network timeouts
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-web-security',
                    '--disable-site-isolation-trials',
                    // Fix for WebGL / Three.js "Context Lost" crashes
                    '--use-gl=swiftshader',
                    '--ignore-gpu-blocklist',
                    '--disable-gpu'
                ],
                defaultViewport: { width: 1280, height: 800 }
            });

            browser.on('disconnected', function () {
                console.log('Chromium browser disconnected');
                browser = null;
            });

            // Resolve any callers that were waiting
            pendingCallbacks.forEach(function (cb) { cb.resolve(browser); });
            pendingCallbacks = [];

            console.log('Chromium browser launched successfully');
            return browser;
        } catch (err) {
            // Reject any callers that were waiting
            pendingCallbacks.forEach(function (cb) { cb.reject(err); });
            pendingCallbacks = [];
            throw err;
        } finally {
            launching = false;
        }
    }

    async function closeBrowser() {
        if (browser) {
            try {
                await browser.close();
                console.log('Chromium browser closed');
            } catch (e) {
                console.error('Error closing Chromium:', e.message);
            }
            browser = null;
        }
    }

    function isReady() {
        try {
            require.resolve(path.join(userDir, 'node_modules', 'puppeteer'));
            return true;
        } catch (e) {
            return false;
        }
    }

    return {
        getBrowser: getBrowser,
        closeBrowser: closeBrowser,
        isReady: isReady
    };
}

module.exports = createBrowserManager;
