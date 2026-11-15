// AGP's CMake log serialization reflects on Reference.referent on JDK 17.
// Both gradle.properties and command-line overrides must retain this opening.
const referenceAccess = '--add-opens=java.base/java.lang.ref=ALL-UNNAMED';
function requiredGradleJvmArgs(value) {
  const args = String(value || '').trim();
  return args.split(/\s+/).includes(referenceAccess)
    ? args
    : `${args} ${referenceAccess}`.trim();
}
module.exports = { requiredGradleJvmArgs };
