const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// CRITICAL: Add support for .cjs files (required by Firebase SDK internal modules)
// Firebase SDK uses CommonJS modules internally that Metro needs to resolve
config.resolver.sourceExts = [...config.resolver.sourceExts, "cjs"];

module.exports = config;
