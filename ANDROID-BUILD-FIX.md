# Android Build Fix Guide

## Problem
Error: "No matching variant of project :react-native-… was found (No variants exist)"

This typically occurs when:
1. The `android/` folder was generated at a different project location
2. Gradle cache contains stale paths
3. Module autolinking fails due to path resolution issues

## Root Cause Analysis

After inspecting your `android/settings.gradle`, I found:
- ✅ **No hardcoded absolute paths** - All paths use dynamic resolution
- ✅ **Correct Expo autolinking setup** - Uses `expoAutolinking.useExpoModules()`
- ✅ **Proper React Native plugin configuration**

However, the issue is likely:
- **Stale Gradle cache** from the previous project location
- **Android folder generated at old location** (`C:\src\staveto-app_v2\mobile` vs current `C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile`)

## Solution: Regenerate Android Folder

### Option 1: Automated Script (Recommended)

Run from the `mobile` directory:
```powershell
.\fix-android-build.ps1
```

This script will:
1. Backup the current `android` folder
2. Backup `google-services.json` (Firebase config)
3. Clean Gradle caches
4. Regenerate `android/` with `npx expo prebuild --platform android --clean`
5. Restore `google-services.json`

### Option 2: Manual Steps

1. **Backup important files:**
   ```powershell
   cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
   Copy-Item "android\app\google-services.json" "google-services.json.backup"
   ```

2. **Backup entire android folder:**
   ```powershell
   $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
   Copy-Item "android" "android.bak.$timestamp" -Recurse
   ```

3. **Clean Gradle caches:**
   ```powershell
   Remove-Item "android\.gradle" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "android\app\build" -Recurse -Force -ErrorAction SilentlyContinue
   ```

4. **Regenerate Android folder:**
   ```powershell
   npx expo prebuild --platform android --clean
   ```

5. **Restore Firebase config:**
   ```powershell
   Copy-Item "google-services.json.backup" "android\app\google-services.json" -Force
   ```

6. **Verify:**
   ```powershell
   Test-Path "android\app\google-services.json"  # Should return True
   ```

7. **Reinstall dependencies and build:**
   ```powershell
   npm install
   npx expo run:android
   ```

## Why This Fixes the Issue

The error "No matching variant of project :react-native-… was found" occurs when:

1. **Gradle can't resolve module paths**: Even though `settings.gradle` uses dynamic resolution (`providers.exec` with Node.js), if the `android/` folder was generated at a different location, the relative paths might be cached incorrectly.

2. **Autolinking fails**: Expo's autolinking scans `node_modules` and creates project includes. If the `android/` folder was generated elsewhere, these includes might reference non-existent or wrong paths.

3. **Gradle cache corruption**: Gradle caches resolved paths. After moving the project, these cached paths become invalid.

**Regenerating with `expo prebuild --clean`**:
- Removes all cached paths
- Regenerates `settings.gradle` with correct relative paths for the current location
- Re-runs autolinking to correctly include all React Native modules
- Ensures all module `projectDir` paths are relative to the current project location

## Files Changed

After regeneration, these files will be updated:
- `android/settings.gradle` - Regenerated with correct paths
- `android/build.gradle` - Updated if needed
- `android/app/build.gradle` - Updated if needed
- `android/gradle.properties` - Preserved (should remain the same)

## Files Preserved

The fix script preserves:
- `android/app/google-services.json` - Firebase configuration (critical!)
- Any custom `proguard-rules.pro` (if you have one)
- Debug keystore (if exists)

## Verification Steps

After running the fix:

1. **Check settings.gradle has no absolute paths:**
   ```powershell
   Select-String -Path "android\settings.gradle" -Pattern "C:\\" -CaseSensitive
   ```
   Should return nothing.

2. **Verify google-services.json exists:**
   ```powershell
   Test-Path "android\app\google-services.json"
   ```
   Should return `True`.

3. **Try building:**
   ```powershell
   npx expo run:android
   ```

## If Issues Persist

1. **Check Node modules:**
   ```powershell
   Test-Path "node_modules\react-native\android"
   ```
   Should return `True`. If not, run `npm install`.

2. **Clean everything:**
   ```powershell
   Remove-Item "android\.gradle" -Recurse -Force
   Remove-Item "android\app\build" -Recurse -Force
   Remove-Item "node_modules" -Recurse -Force
   npm install
   npx expo prebuild --platform android --clean
   ```

3. **Check Expo version compatibility:**
   ```powershell
   npx expo --version
   ```
   Should match your `package.json` version (~54.0.32).

4. **Restore from backup:**
   ```powershell
   Remove-Item "android" -Recurse -Force
   Copy-Item "android.bak.<timestamp>" "android" -Recurse
   ```

## Expected Output

After successful regeneration, `npx expo run:android` should:
1. Resolve all React Native modules correctly
2. Build the Android app without "No variants exist" errors
3. Launch the app on your connected device/emulator

## Notes

- The `android/` folder is **generated code** - it's safe to delete and regenerate
- Your source code (`src/`, `App.tsx`, etc.) is **not affected** by this fix
- Firebase config (`google-services.json`) is **critical** - make sure it's restored
- This fix only affects Android builds - iOS is unaffected
