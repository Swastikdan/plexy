const path = require('node:path');
const fs = require('node:fs/promises');
const { withMainApplication, withDangerousMod, withAndroidManifest } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));
module.exports = function withLanNetworking(config) {
  const applicationId = config.android.package;
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] ||= [];
    for (const name of ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE', 'android.permission.CHANGE_WIFI_MULTICAST_STATE']) {
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
    return mod;
  }]);
};
