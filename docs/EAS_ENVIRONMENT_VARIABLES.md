# EAS Build – Environment Variables

Production builds (EAS Build) **do not use the local `.env` file**. The `.env` is gitignored and not uploaded to EAS. You must configure environment variables via **EAS Environment Variables** or **EAS Secrets**.

**How it works:** EAS env vars are injected at build time in `app.config.js` and read at runtime via `Constants.expoConfig.extra` (not `process.env`). The app uses `src/lib/env.ts` helpers (`getExtraEnv`, `hasExtraEnv`) as the single source of truth.

## Required variables

These must be set for production builds or the app will show a startup error:

| Variable | Platform | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Android, iOS | Firebase Web API key |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Android, iOS | Google Sign-In Web Client ID |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Android | RevenueCat Android API key |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | iOS | RevenueCat iOS API key |

## Option 1: EAS Dashboard

1. Go to: https://expo.dev/accounts/info.staveto/projects/stavetoapp/environment-variables
2. Add each variable with scope **production** (or "all environments")
3. Rebuild: `npm run build:android` or `eas build --platform ios --profile production`

## Option 2: EAS Secrets (CLI)

```bash
cd mobile

# Android + iOS shared
eas secret:create --name EXPO_PUBLIC_FIREBASE_API_KEY --value "YOUR_FIREBASE_API_KEY" --scope project
eas secret:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com" --scope project

# Platform-specific
eas secret:create --name EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY --value "YOUR_ANDROID_KEY" --scope project
eas secret:create --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value "YOUR_IOS_KEY" --scope project
```

Values come from your local `.env` (Firebase Console, Google Cloud Console, RevenueCat dashboard).

## Local development

For local dev, use `.env` (copy from `.env.example`). Expo loads `.env` automatically when running `npx expo start`.

## Troubleshooting

- **"Missing env: EXPO_PUBLIC_..."** – Variables were not set in EAS for the build. Add them and create a new build.
- **Existing build still fails** – Old builds are baked with whatever env was available at build time. You must create a **new build** after adding variables.
- **Error code ENV_MISSING_ANDROID / ENV_MISSING_IOS** – Same as above. Check `[boot] env presence:` in logs (logcat / Xcode) to see which keys are missing.

## Checklist: Verify you're testing the right build

1. **Confirm installed build matches latest EAS build**
   - Build info is logged at startup: `[boot] BuildInfo: { version, buildNumber, executionEnvironment, easProjectId }`
   - On device: tap 5 times on the Startup Error message to show version/build/env presence (debug overlay)
   - Compare `buildNumber` with the latest EAS build at https://expo.dev/accounts/info.staveto/projects/stavetoapp/builds

2. **Play Internal Testing**
   - Internal Testing track may serve a cached version. Ensure the versionCode in the build matches what you expect.
   - After uploading a new AAB, wait for processing and optionally "Promote" in Play Console to ensure the latest is served.

3. **Test steps**
   - a) Build production → install → verify build number in logs matches → env presence all true in `[boot] env presence:`
   - b) Remove one env var in EAS → rebuild → install → expect ENV_MISSING_* code + missing keys in console.error