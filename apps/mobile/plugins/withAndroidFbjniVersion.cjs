const { withProjectBuildGradle } = require("expo/config-plugins");

// Shiki requests fbjni:+, which can select a newer JNI binary than React
// Native's bundled libc++_shared.so supports. RN 0.86.3 packages fbjni 0.7.0.
const FBJNI_VERSION = "0.7.0";
const PIN_MARKER = 'resolutionStrategy.force("com.facebook.fbjni:fbjni:';
const PIN = `
allprojects {
  configurations.configureEach {
    resolutionStrategy.force("com.facebook.fbjni:fbjni:${FBJNI_VERSION}")
  }
}
`;

module.exports = function withAndroidFbjniVersion(config) {
  return withProjectBuildGradle(config, (nextConfig) => {
    if (!nextConfig.modResults.contents.includes(PIN_MARKER)) {
      nextConfig.modResults.contents += PIN;
    }
    return nextConfig;
  });
};
