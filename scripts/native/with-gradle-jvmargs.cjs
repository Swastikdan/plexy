const { requiredGradleJvmArgs } = require('./gradle-jvmargs.cjs');
const path = require('node:path');
const { withGradleProperties } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '../../apps/mobile')] }));

// AGP's ExternalNativeJsonGenerator serialises its log model with Gson, and the
// graph can contain a java.lang.ref.Reference. JDK 17 blocks reflective access
// to Reference.referent, which fails every configureCMake* task with:
//   InaccessibleObjectException: module java.base does not "opens java.lang.ref"
// Opening the package to the Gradle daemon is the narrow fix.
const fallback = requiredGradleJvmArgs('-Xmx2048m -XX:MaxMetaspaceSize=512m');

module.exports = config =>
  withGradleProperties(config, mod => {
    const properties = mod.modResults;
    const entry = properties.find(
      item => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (entry) {
      entry.value = requiredGradleJvmArgs(entry.value);
    } else {
      properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: fallback });
    }
    return mod;
  });
