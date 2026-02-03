# Firebase Cleanup Summary - Expo Go Fix

## Root Cause

The app was using **internal Firebase packages** (`@firebase/app`, `@firebase/auth`) as direct dependencies, which can cause module resolution issues in Expo Go. Expo Go works best with the official `firebase` package only.

## Changes Made

### 1. Dependency Cleanup (`package.json`)

**Removed**:
- `@firebase/app: ^0.10.13`
- `@firebase/auth: ^1.7.9`
- `expo-dev-client: ~6.0.20` (temporarily removed for Expo Go compatibility)

**Kept**:
- `firebase: ^10.14.1` ✅ (official Firebase SDK - includes all needed modules)

### 2. Code Updates

#### `src/firebase-auth-rn.ts`
**Changed**: `require("@firebase/auth")` → `require("firebase/auth")`

```diff
- require("@firebase/auth");
+ require("firebase/auth");
```

**Reason**: Use official `firebase` package instead of internal `@firebase/*` packages.

#### `src/firebase.ts`
**Fixed**:
- ✅ Removed duplicate `initializeAuth()` calls
- ✅ Implemented guard pattern with IIFE
- ✅ Single `initializeApp()` call
- ✅ Correct imports from `firebase/*` (not `@firebase/*`)

**Before**:
```typescript
import { getAuth, initializeAuth, getReactNativePersistence, Auth } from "firebase/auth";
// ... duplicate initializeAuth() calls ...
```

**After**:
```typescript
import { getAuth, initializeAuth } from "firebase/auth";
import { getReactNativePersistence } from "firebase/auth/react-native";

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = (() => {
  try {
    return getAuth(app);
  } catch {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
})();
```

#### `metro.config.js`
**Simplified**: Removed `@firebase/auth` resolver logic (no longer needed)

**Before**: Complex resolver redirecting `@firebase/auth` to RN build

**After**: Simple config with `.cjs` support only

```typescript
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts = [...config.resolver.sourceExts, "cjs"];
module.exports = config;
```

## Verification

### After Changes:

```bash
# Should return 0 results (no @firebase/* in src/)
grep -r "@firebase" src/
# Result: ✅ 0 matches

# Should return exactly 1 result
grep -r "initializeAuth(" src/
# Result: src/firebase.ts (line 48) ✅

# Should return exactly 1 result
grep -r "initializeApp(" src/
# Result: src/firebase.ts (line 40) ✅

# Should return 0 results
grep -r "expo-dev-client" package.json
# Result: ✅ 0 matches

# Should return 0 results
grep -r "@firebase/app\|@firebase/auth" package.json
# Result: ✅ 0 matches
```

## Commands to Run

### Step 1: Uninstall packages (if not already done)
```bash
npm uninstall @firebase/app @firebase/auth expo-dev-client
```

### Step 2: Clean reinstall
```bash
# Delete cached files
rm -rf node_modules
rm -rf package-lock.json
rm -rf .expo

# Reinstall dependencies
npm install
```

### Step 3: Verify dependencies
```bash
# Should show firebase but NOT @firebase/app or @firebase/auth
npm list | grep firebase
# Expected: firebase@10.14.1 ✅

# Should NOT show expo-dev-client
npm list | grep expo-dev-client
# Expected: (empty) ✅
```

### Step 4: Start Expo with cache clear
```bash
npx expo start -c
```

Then scan QR code with Expo Go app.

## Expected Result

✅ **Expo Go opens without crash**  
✅ **No "Component auth has not been registered yet" error**  
✅ **Firebase Auth initializes correctly with React Native persistence**  
✅ **Single source of truth: all Firebase init in `src/firebase.ts` only**  
✅ **No internal Firebase packages in dependencies**

## Files Changed Summary

**Modified**:
1. `package.json`
   - Removed: `@firebase/app`, `@firebase/auth`, `expo-dev-client`
   - Kept: `firebase: ^10.14.1` (official SDK)

2. `src/firebase-auth-rn.ts`
   - Line 18: Changed `require("@firebase/auth")` → `require("firebase/auth")`

3. `src/firebase.ts`
   - Lines 21-22: Fixed imports (separated `getReactNativePersistence` from `firebase/auth/react-native`)
   - Lines 40-57: Removed duplicate `initializeAuth()` calls, implemented guard pattern
   - Single `initializeApp()` call
   - Export both `app` and `auth`

4. `metro.config.js`
   - Removed: `@firebase/auth` resolver logic
   - Kept: `.cjs` file support

## Dependencies Confirmation

**Firebase packages in `package.json` (after cleanup)**:
- ✅ `firebase: ^10.14.1` - Official Firebase SDK (includes all modules)

**Removed packages**:
- ✅ No `@firebase/app`
- ✅ No `@firebase/auth`
- ✅ No `expo-dev-client`

## Constraints Met

✅ No UI changes  
✅ No navigation changes  
✅ No onboarding changes  
✅ No business logic changes  
✅ Minimal patch (only 4 files modified)  
✅ Single source of truth enforced  
✅ Expo Go compatible (official Firebase SDK only)
