const path = require('node:path');
const fs = require('node:fs/promises');
const { withMainApplication, withDangerousMod, withAndroidManifest } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));
module.exports = function withLanNetworking(config) {
  const applicationId = config.android.package;
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ||= [];
    for (const name of [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
      'android.permission.REQUEST_INSTALL_PACKAGES',
    ]) {
      if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    return mod;
  });
  config = withMainApplication(config, mod => {
    let source = mod.modResults.contents;
    if (!source.includes('add(PlexyLanPackage())')) source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(PlexyLanPackage())');
    if (!source.includes('PlexyLanTrust.install(this)')) source = source.replace('super.onCreate()', 'super.onCreate()\n    PlexyLanTrust.install(this)');
    if (!source.includes('add(PlexyLanPackage())') || !source.includes('PlexyLanTrust.install(this)')) throw new Error('Could not register Plexy LAN networking in MainApplication');
    mod.modResults.contents = source;
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...applicationId.split('.'));
    await fs.mkdir(directory, { recursive: true });
    const source = (await fs.readFile(path.join(__dirname, 'android/PlexyLanModule.kt'), 'utf8')).replaceAll('__PACKAGE__', applicationId);
    await fs.writeFile(path.join(directory, 'PlexyLanModule.kt'), source);

    // Dark splash screen configuration
    const resDir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    const drawableDir = path.join(resDir, 'drawable');
    await fs.mkdir(drawableDir, { recursive: true });
    const splashXml = `<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n    <item android:drawable="@color/splashscreen_background"/>\n    <item>\n        <bitmap android:gravity="center" android:src="@drawable/splashscreen_logo"/>\n    </item>\n</layer-list>\n`;
    await fs.writeFile(path.join(drawableDir, 'splashscreen.xml'), splashXml);

    const valuesDir = path.join(resDir, 'values');
    const colorsPath = path.join(valuesDir, 'colors.xml');
    try {
      let colors = await fs.readFile(colorsPath, 'utf8');
      colors = colors.replace(/<color name="splashscreen_background">.*?<\/color>/, '<color name="splashscreen_background">#080808</color>');
      colors = colors.replace(/<color name="iconBackground">.*?<\/color>/, '<color name="iconBackground">#080808</color>');
      await fs.writeFile(colorsPath, colors);
    } catch {}

    const stylesPath = path.join(valuesDir, 'styles.xml');
    try {
      let styles = await fs.readFile(stylesPath, 'utf8');
      styles = styles.replace('@drawable/splashscreen_logo', '@drawable/splashscreen');
      await fs.writeFile(stylesPath, styles);
    } catch {}

    return mod;
  }]);
};
