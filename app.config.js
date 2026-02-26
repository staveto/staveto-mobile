/**
 * Expo config with EAS env injection.
 * EAS env vars are available as process.env at build time and injected into extra.
 * Runtime reads from Constants.expoConfig.extra (not process.env).
 */
const base = require("./app.json");
const expo = base.expo;

module.exports = () => ({
  ...expo,
  extra: {
    ...expo.extra,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? "",
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "",
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "",
    EXPO_PUBLIC_SIMULATE_BOOT_FAILURE: process.env.EXPO_PUBLIC_SIMULATE_BOOT_FAILURE ?? "",
  },
});
