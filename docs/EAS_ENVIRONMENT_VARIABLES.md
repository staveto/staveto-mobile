# EAS Build – Environment Variables

Production builds (EAS Build) **do not use the local `.env` file**. The `.env` is gitignored and not uploaded to EAS. You must configure environment variables via **EAS Environment Variables** or **EAS Secrets**.

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
