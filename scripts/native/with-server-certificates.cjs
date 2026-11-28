const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require(
  require.resolve("expo/config-plugins", {
    paths: [path.join(__dirname, "../../apps/mobile")],
  }),
);

const CONFIG_NAME = "network_security_config.xml";
const XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Plexy Server uses a generated LAN certificate. Trust the system store and
     certificates the owner explicitly installs; cleartext stays disabled. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

module.exports = function withServerCertificates(config) {
  config = withAndroidManifest(config, (mod) => {
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$["android:networkSecurityConfig"] = `@xml/network_security_config`;
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, CONFIG_NAME), XML);
      return mod;
    },
  ]);
};

module.exports.XML = XML;
