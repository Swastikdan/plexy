const path = require('node:path');
const { withAppBuildGradle } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));
const marker = '// Plexy local-library bundle inputs';
const snippet = `\n${marker}
tasks.configureEach { task ->
  if (task.name.startsWith('createBundle') && task.name.endsWith('JsAndAssets')) {
    task.inputs.dir(new File(rootProject.projectDir, '../../../packages/local-library/src'))
    task.inputs.dir(new File(rootProject.projectDir, '../../../packages/api-client/src'))
  }
}
`;
module.exports = config => withAppBuildGradle(config, mod => {
  if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += snippet;
  return mod;
});
module.exports.snippet = snippet;
