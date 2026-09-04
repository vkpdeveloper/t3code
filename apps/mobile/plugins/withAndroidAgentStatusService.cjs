const { withAndroidManifest } = require("expo/config-plugins");

const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
  "android.permission.POST_NOTIFICATIONS",
  // Android 16 QPR1 Live Updates (promoted ongoing notifications).
  "android.permission.POST_PROMOTED_NOTIFICATIONS",
];

/**
 * Declares the permissions the agent status foreground service needs in the
 * app manifest. The service itself is declared by the local t3-agent-status
 * module's manifest and merged in by Gradle; permissions are repeated here
 * because the app manifest is what Android reads at install time.
 */
module.exports = function withAndroidAgentStatusService(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const manifest = nextConfig.modResults.manifest;
    manifest["uses-permission"] ??= [];
    for (const name of PERMISSIONS) {
      const exists = manifest["uses-permission"].some(
        (entry) => entry.$?.["android:name"] === name,
      );
      if (!exists) {
        manifest["uses-permission"].push({ $: { "android:name": name } });
      }
    }
    return nextConfig;
  });
};
