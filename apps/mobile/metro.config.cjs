const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
// Shared source must resolve the consuming app's React and native runtime.
const runtime = ['react', 'react-native'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = runtime.find(name => moduleName === name || moduleName.startsWith(name + '/'));
  if (name) {
    const root = path.dirname(require.resolve(name + '/package.json', { paths: [projectRoot] }));
    return context.resolveRequest(context, path.join(root, moduleName.slice(name.length)), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
