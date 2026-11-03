const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Developer reference artwork must never become an application asset.
config.resolver.blockList = [/[/\\]dev-assets[/\\]/];
config.resolver.assetExts.push('wasm', 'txt', 'p2lrt');
module.exports = config;
