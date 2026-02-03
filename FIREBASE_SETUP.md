# Firebase Setup for Expo Go

## Overview

This app uses **Firebase Web SDK** (not React Native Firebase) and works in **Expo Go** without requiring a development build.

## Architecture

- **Firebase Web SDK**: Uses `firebase/app`, `firebase/auth`, `firebase/firestore`, etc.
- **React Native Persistence**: Uses `@react-native-async-storage/async-storage` for auth persistence
- **Expo Go Compatible**: No native modules required

## Critical Files

### 1. `src/firebase-auth-rn.ts`
- **Purpose**: Registers Firebase Auth for React Native platform BEFORE any Firebase code runs
- **Implementation**: Uses `require("@firebase/auth")` for synchronous execution
- **Why**: Ensures `registerAuth("ReactNative")` is called before `initializeAuth()`

### 2. `index.ts`
- **Purpose**: App entry point
- **Critical Order**:
  1. Import `firebase-auth-rn.ts` FIRST (registers Auth)
  2. Import `react-native-gesture-handler` (required by React Navigation)
  3. Register root component

### 3. `src/firebase.ts`
- **Purpose**: Centralized Firebase initialization
- **Exports**: `app`, `auth`, `db`, `storage`, `functions`
- **Assumes**: `firebase-auth-rn.ts` has already been loaded

### 4. `metro.config.js`
- **Purpose**: Metro Bundler configuration
- **Key Features**:
  - Adds `.cjs` file support (required by Firebase SDK)
  - Forces `@firebase/auth` to use RN build (`dist/rn/index.js`)
  - Ensures React Native platform registration

## Running the App

### Expo Go (Recommended)

```bash
# Clear cache and start
npx expo start -c

# Or use npm script
npm start
```

Then scan QR code with Expo Go app on your device.

### Development Build (Optional)

If you need native modules in the future:

```bash
# Build development client
npx expo run:android

# Or use EAS
eas build --profile development --platform android
```

## Environment Variables

Create `.env` file (copy from `.env.example`):

```
EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## Troubleshooting

### "Component auth has not been registered yet"

**Cause**: Firebase Auth registration didn't execute before `initializeAuth()`.

**Fix**:
1. Ensure `index.ts` imports `firebase-auth-rn.ts` FIRST
2. Clear Metro cache: `npx expo start -c`
3. Verify `metro.config.js` has `.cjs` support and RN resolver

### "Runtime not ready"

**Cause**: Module loading order issue or Metro cache.

**Fix**:
1. Clear cache: `npx expo start -c`
2. Restart Metro bundler
3. Reload app in Expo Go

### Import Order Best Practices

When importing Firebase services, always import from `../firebase` BEFORE importing from `firebase/auth`:

```typescript
// ✅ CORRECT
import { auth } from "../firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

// ❌ WRONG
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
```

## Files Modified

- `src/firebase-auth-rn.ts` - Uses `require()` for synchronous registration
- `src/firebase.ts` - Clean initialization, no conditional requires
- `index.ts` - Ensures correct import order
- `metro.config.js` - Added `.cjs` support and RN resolver
- `src/services/auth.ts` - Fixed import order
- `src/context/AuthContext.tsx` - Fixed import order
- `src/screens/RegisterScreen.tsx` - Fixed import order
- `src/screens/OnboardingMvpScreen.tsx` - Fixed import order

## Verification Checklist

- [ ] `npx expo start -c` runs without errors
- [ ] App loads in Expo Go without "Component auth not registered" error
- [ ] Login/Register screens work correctly
- [ ] Firebase Auth state persists across app restarts
- [ ] No runtime errors in console
