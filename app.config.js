// app.config.js
// Use config from Expo (static app.json) so expo-doctor recognizes we use it
const path = require("path");
const fs = require("fs");

module.exports = ({ config }) => {
  const iosGoogleServices = "./google/GoogleService-Info.plist";
  const resolvedPath = path.resolve(process.cwd(), iosGoogleServices);
  console.log("[EAS/config] ios.googleServicesFile resolved:", resolvedPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`GoogleService-Info.plist not found at: ${resolvedPath}`);
  }

  return {
    ...config,

    // explicit assets (istota)
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#1D376A",
    },

    ios: {
      ...config.ios,
      googleServicesFile: iosGoogleServices,
      infoPlist: {
        ...(config.ios?.infoPlist ?? {}),
        NSMicrophoneUsageDescription: "Staveto needs microphone access for voice features.",
        NSCameraUsageDescription: "Staveto needs camera access to take project photos.",
        NSPhotoLibraryUsageDescription: "Staveto needs photo library access to upload project images.",
        NSLocationWhenInUseUsageDescription: "Staveto potrebuje polohu pre check-in/check-out a evidenciu času na stavenisku.",
      },
    },

    android: {
      ...config.android,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1D376A",
      },
      permissions: [
        ...(config.android?.permissions ?? []),
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
      ].filter((p, i, arr) => arr.indexOf(p) === i),
    },

    plugins: [
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      ["expo-location", { locationWhenInUsePermission: "Staveto potrebuje polohu pre check-in/check-out a evidenciu času na stavenisku." }],
      ["expo-notifications", { sounds: [] }],
      ["expo-image-picker", { photosPermission: "Aplikácia potrebuje prístup k vašim fotkám na pridanie príloh.", cameraPermission: "Aplikácia potrebuje prístup ku kamere na fotografovanie faktúr a dokumentov." }],
      ["expo-av", { microphonePermission: "Aplikácia potrebuje prístup k mikrofónu na nahrávanie hlasových správ a zápisov do denníka." }],
      ["expo-speech-recognition", { speechRecognitionPermission: "This app uses speech recognition for voice notes and diary entries." }],
      ["expo-build-properties", { ios: { useFrameworks: "static", forceStaticLinking: ["RNFBApp", "RNFBAuth", "RNFBFirestore", "RNFBFunctions", "RNFBMessaging", "RNFBStorage", "RNFBAnalytics"], buildReactNativeFromSource: true } }],
      "./plugins/withFirebaseModularHeaders",
      "@react-native-community/datetimepicker",
    ],

    extra: {
      ...config.extra,
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? "",
      EXPO_PUBLIC_ENABLE_AUTH: process.env.EXPO_PUBLIC_ENABLE_AUTH ?? "",
      EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
      EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
      EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? "",
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "",
      EXPO_PUBLIC_SIMULATE_BOOT_FAILURE: process.env.EXPO_PUBLIC_SIMULATE_BOOT_FAILURE ?? "",
      EXPO_PUBLIC_IOS_DIAGNOSTIC: process.env.EXPO_PUBLIC_IOS_DIAGNOSTIC ?? "",
    EXPO_PUBLIC_DISABLE_PUSH: process.env.EXPO_PUBLIC_DISABLE_PUSH ?? "",
    },
  };
};
