const path = require('node:path');
const { withProjectBuildGradle, withAppBuildGradle } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));
const plugin = "classpath('com.google.android.gms:oss-licenses-plugin:0.13.0')";
const dependency = "implementation('com.google.android.gms:play-services-oss-licenses:17.5.3')";
const apply = 'apply plugin: "com.google.android.gms.oss-licenses-plugin"';
function addProject(contents) {
  if (contents.includes(plugin)) return contents;
  if (!/dependencies\s*\{/.test(contents)) throw new Error('Cannot configure Android license plugin: missing buildscript dependencies.');
  return contents.replace(/dependencies\s*\{/, match => `${match}\n    ${plugin}`);
}
function addApp(contents) {
  if (!contents.includes(apply)) contents += `\n${apply}\n`;
  if (!contents.includes(dependency)) contents += `\ndependencies {\n    ${dependency}\n}\n`;
  return contents;
}
module.exports = config => {
  config = withProjectBuildGradle(config, mod => {
    mod.modResults.contents = addProject(mod.modResults.contents);
    return mod;
  });
  return withAppBuildGradle(config, mod => {
    mod.modResults.contents = addApp(mod.modResults.contents);
    return mod;
  });
};
module.exports.addProject = addProject;
module.exports.addApp = addApp;
