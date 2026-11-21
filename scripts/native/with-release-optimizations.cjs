const path = require('node:path');
const {
  withGradleProperties,
} = require(require.resolve('expo/config-plugins', {
  paths: [path.join(__dirname, '../../apps/mobile')],
}));

// Release APKs ship R8 (code minification/optimization) and AAPT2 resource
// shrinking. Without these the debug-style build keeps every class and unused
// resource, which is most of Plexy's 59 MB arm64 APK.
//
// Keep rules: react-native, expo-modules-core and each Expo module publish
// consumer ProGuard rules in their AARs, so the default android/app rule file
// plus `proguard-android.txt` is enough for the JS bridge. Plexy's own
// proguard-rules.pro keeps reanimated/worklets (reflection through JNI names).
const RELEASE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  // Store the Hermes bundle deflated. Costs one inflate pass while loading the
  // bundle; saves 3.7 MB in the arm64 APK.
  'android.enableBundleCompression': 'true',
};

function upsertProperty(properties, key, value) {
  const entry = properties.find(
    item => item.type === 'property' && item.key === key,
  );
  if (entry) entry.value = value;
  else properties.push({ type: 'property', key, value });
}

module.exports = config =>
  withGradleProperties(config, mod => {
    for (const [key, value] of Object.entries(RELEASE_PROPERTIES)) {
      upsertProperty(mod.modResults, key, value);
    }
    return mod;
  });

// Exported for unit tests; Expo only consumes the default export above.
module.exports.RELEASE_PROPERTIES = RELEASE_PROPERTIES;
module.exports.upsertProperty = upsertProperty;
