# Firebase Auth Initialization Fix

## Root Cause Summary

**Problem**: App crashes with `[runtime not ready]: Error: Component auth has not been registered yet`

**Root Cause**: `src/firebase.ts` had **TWO calls to `initializeAuth()`**:
- Line 28: `auth = initializeAuth(app, {...})` - when `getApps().length === 0`
- Line 36: `auth = initializeAuth(app, {...})` - in the `else` branch when app exists

**Why it crashed**: The second `initializeAuth()` call executed before Firebase Auth component was properly registered for React Native, causing the "Component auth has not been registered yet" error.

**Files causing crash**:
- `src/firebase.ts` (lines 23-47) - duplicate `initializeAuth()` calls

## Search Results

### `initializeAuth(` matches:
- `src/firebase.ts` - **2 matches** (lines 28, 36) → **FIXED: Now 1 match** (line 48, inside IIFE)

### `getReactNativePersistence` matches:
- `src/firebase.ts` - **2 matches** (lines 29, 37) → **FIXED: Now 1 match** (line 49, inside IIFE)

### `initializeApp(` matches:
- `src/firebase.ts` - **1 match** ✅ (line 40, single init)

### `@react-native-firebase` matches:
- **0 matches** ✅ (not used, Firebase Web SDK only)

### `firebase/auth/react-native` matches:
- `src/firebase.ts` - **1 match** ✅ (line 22, correct import)

## Changes Made

### 1. `src/firebase.ts` - Fixed duplicate initialization

**Before** (lines 23-47):
```typescript
let app: FirebaseApp;
let auth: Auth;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, {...});  // FIRST CALL
} else {
  app = getApp();
  try {
    auth = initializeAuth(app, {...});  // SECOND CALL (DUPLICATE!)
  } catch (error: any) {
    if (error.code === 'auth/already-initialized') {
      auth = getAuth(app);
    }
  }
}
export { auth };
```

**After** (lines 40-57):
```typescript
// Initialize app exactly once
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize auth exactly once with RN persistence
// Guard pattern: try getAuth first, then initializeAuth only if needed
const auth = (() => {
  try {
    return getAuth(app);
  } catch {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
})();

export { app, auth };
```

**Key changes**:
- ✅ Removed duplicate `initializeAuth()` calls
- ✅ Single `initializeApp()` call with ternary guard
- ✅ Single `initializeAuth()` call inside IIFE guard pattern
- ✅ Changed import: `getReactNativePersistence` from `firebase/auth/react-native`
- ✅ Export both `app` and `auth` for consistency

### 2. Import fixes

**Changed** (line 6-7):
```diff
- import { getAuth, initializeAuth, getReactNativePersistence, Auth } from "firebase/auth";
+ import { getAuth, initializeAuth } from "firebase/auth";
+ import { getReactNativePersistence } from "firebase/auth/react-native";
```

## Verification

### After changes, global search results:

```bash
# Should return exactly 1 result
grep -r "initializeAuth(" src/
# Result: src/firebase.ts (line 48, inside IIFE) ✅

# Should return exactly 1 result  
grep -r "initializeApp(" src/
# Result: src/firebase.ts (line 40) ✅
```

## Commands to Run

```bash
# Clear Metro cache and restart Expo
npx expo start -c
```

Then scan QR code with Expo Go app.

## Expected Result

✅ App opens in Expo Go without red screen  
✅ No "Component auth has not been registered yet" error  
✅ Firebase Auth initializes correctly with React Native persistence  
✅ Single source of truth: all Firebase init happens in `src/firebase.ts` only

## Files Changed Summary

**Modified**:
- `src/firebase.ts` (lines 6-7, 40-57)
  - Fixed imports: separated `getReactNativePersistence` from `firebase/auth/react-native`
  - Removed duplicate `initializeAuth()` calls
  - Implemented guard pattern with IIFE
  - Single `initializeApp()` call
  - Export both `app` and `auth`

**No changes needed**:
- `src/firebase-auth-rn.ts` - Already uses `require("@firebase/auth")` ✅
- `index.ts` - Already imports `firebase-auth-rn.ts` first ✅
- `metro.config.js` - Already has `.cjs` support ✅

## Constraints Met

✅ No UI changes  
✅ No navigation changes  
✅ No onboarding changes  
✅ No business logic changes  
✅ Minimal patch (only `src/firebase.ts` modified)  
✅ Single source of truth enforced
