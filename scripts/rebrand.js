#!/usr/bin/env node
/**
 * Replaces Node-RED editor logos with AgentOS branding.
 * Run before electron-builder to ensure the packaged app has custom icons.
 */
var fs = require('fs');
var path = require('path');

var base = path.join(__dirname, '..');
var iconSrc = path.join(base, 'build', 'icon.png');
var editorImages = path.join(base, 'node_modules', '@node-red', 'editor-client', 'public', 'red', 'images');
var editorPublic = path.join(base, 'node_modules', '@node-red', 'editor-client', 'public');
var themeFile = path.join(base, 'node_modules', '@node-red', 'editor-api', 'lib', 'editor', 'theme.js');

// Read the source icon as base64 for embedding in SVGs
var iconBase64 = fs.readFileSync(iconSrc).toString('base64');

function createSvgWrapper(width, height) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"\n' +
        '     width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">\n' +
        '  <image width="' + width + '" height="' + height + '"\n' +
        '         href="data:image/png;base64,' + iconBase64 + '"/>\n' +
        '</svg>';
}

// Replace PNG logo
console.log('Replacing node-red-256.png...');
fs.copyFileSync(iconSrc, path.join(editorImages, 'node-red-256.png'));

// Replace SVG logos with embedded PNG
var svgFiles = [
    { name: 'node-red.svg', w: 100, h: 100 },
    { name: 'node-red-256.svg', w: 256, h: 256 },
    { name: 'node-red-icon.svg', w: 100, h: 100 },
    { name: 'node-red-icon-black.svg', w: 100, h: 100 }
];

svgFiles.forEach(function(f) {
    console.log('Replacing ' + f.name + '...');
    fs.writeFileSync(path.join(editorImages, f.name), createSvgWrapper(f.w, f.h));
});

// Replace favicon.ico with icon.png (browsers handle PNG favicons fine)
console.log('Replacing favicon.ico...');
fs.copyFileSync(iconSrc, path.join(editorPublic, 'favicon.ico'));

// Update default titles in theme.js
console.log('Updating theme defaults...');
var themeContent = fs.readFileSync(themeFile, 'utf8');
themeContent = themeContent.replace(/title: "Node-RED"/g, 'title: "AgentOS"');
fs.writeFileSync(themeFile, themeContent);

console.log('Rebranding complete!');
