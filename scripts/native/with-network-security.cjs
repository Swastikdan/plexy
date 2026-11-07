const { withAndroidManifest, withDangerousMod } = require(require.resolve('expo/config-plugins', { paths: [require('node:path').join(__dirname, '../../apps/mobile')] }));
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = function withNetworkSecurity(config) {
  // Add LAN hostnames/IPs when building: PLEXY_LAN_HOSTS=192.168.1.20,nas.local
  // Keep application-wide cleartext blocked. Local certificate approval is
  // handled by the native trust provider, never by a trust-all XML policy.
  const hosts = (process.env.PLEXY_LAN_HOSTS || 'localhost,10.0.2.2').split(',').map(s => s.trim()).filter(Boolean);
  if (hosts.some(host => !/^[a-zA-Z0-9.:-]+$/.test(host))) throw new Error('Invalid PLEXY_LAN_HOSTS hostname');
  config = withAndroidManifest(config, mod => {
    mod.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/plexy_network_security';
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.mkdir(dir, { recursive: true });
    const domains = hosts.map(host => `<domain includeSubdomains="false">${host}</domain>`).join('');
    await fs.writeFile(path.join(dir, 'plexy_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true">${domains}</domain-config></network-security-config>`);
    return mod;
  }]);
};
