// Resolves `react-native-voice-glow` to the library source one folder up,
// with every dependency taken from this app's node_modules so there is a
// single copy of React, React Native, Reanimated and Skia.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const libraryRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [libraryRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = { 'react-native-voice-glow': libraryRoot };
const escape = (p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
config.resolver.blockList = [new RegExp(`^${escape(path.resolve(libraryRoot, 'node_modules'))}[/\\\\].*`)];

module.exports = config;
