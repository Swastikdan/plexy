const path = require('node:path');
const { withGradleProperties } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));

// AGP's ExternalNativeJsonGenerator serialises its log model with Gson, and the
// graph can contain a java.lang.ref.Reference. JDK 17 blocks reflective access
// to Reference.referent, which fails every configureCMake* task with:
//   InaccessibleObjectException: module java.base does not "opens java.lang.ref"
// Opening the package to the Gradle daemon is the narrow fix.
const flag = '--add-opens=java.base/java.lang.ref=ALL-UNNAMED';
const fallback = `-Xmx2048m -XX:MaxMetaspaceSize=512m ${flag}`;

module.exports = config =>
  withGradleProperties(config, mod => {
    const properties = mod.modResults;
    const entry = properties.find(
      item => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (entry) {
      if (!String(entry.value || '').includes(flag)) {
        entry.value = `${String(entry.value || '').trim()} ${flag}`.trim();
      }
    } else {
      properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: fallback });
    }
    return mod;
  });
