# Android Build on Windows - Fixing 260 Character Path Limit

## Problem

Windows has a 260-character path limit. When building Android apps through Cursor's integrated terminal, Gradle uses paths like:
```
C:\Users\Marek\AppData\Local\Temp\cursor-sandbox-cache\...\very-long-path...
```

This causes build failures with:
```
Filename longer than 260 characters
```

## Root Cause

1. **Cursor Sandbox Cache**: Cursor runs commands in a sandboxed environment with long temp paths
2. **Multiple Architectures**: Building for `arm64-v8a` creates even longer paths
3. **Gradle Cache Location**: Default Gradle cache uses long user profile paths

## Solution

### ✅ Configuration Changes Made

1. **`android/gradle.properties`**:
   - Set `reactNativeArchitectures=x86_64` (emulator only, shorter paths)
   - Set `org.gradle.cache.dir=C:\\gradle-cache` (shorter cache path)
   - Set `org.gradle.user.home=C:\\gradle-home` (shorter home path)
   - Note: `android.buildCacheDir` was removed (deprecated in AGP 7.0+)

2. **`android/app/build.gradle`**:
   - Added `ndk { abiFilters "x86_64" }` in `defaultConfig` to force x86_64 at Android level
   - This ensures ONLY x86_64 is built, even if Expo CLI or React Native defaults try to add arm64-v8a

3. **`scripts/build-android-external.ps1`**:
   - Sandbox detection: aborts if path contains `cursor-sandbox-cache`
   - Sets `EXPO_ANDROID_ARCHITECTURES=x86_64` and `REACT_NATIVE_ARCHITECTURES=x86_64`
   - Sets `ORG_GRADLE_PROJECT_reactNativeArchitectures=x86_64` (Gradle project property; NOT via GRADLE_OPTS)
   - Verifies configuration before building
   - Hard fail-fast: aborts if `arm64-v8a` appears in build output
   - Proper exit code handling

### ✅ Build Scripts Added

1. **`scripts/build-android-external.ps1`**: Builds from external PowerShell (avoids Cursor sandbox)
2. **`scripts/clean-android.ps1`**: Cleans build artifacts and caches

## How to Build Successfully

### Option 1: External PowerShell (Recommended)

**Run from external PowerShell (NOT Cursor terminal):**

```powershell
# Navigate to project
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"

# Run build script
npm run dev:android:external
```

**Or run script directly:**
```powershell
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
.\scripts\build-android-external.ps1
```

### Option 2: Manual Build (External PowerShell)

```powershell
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"

# Set environment variables
$env:GRADLE_USER_HOME = "C:\gradle-home"
$env:EXPO_ANDROID_ARCHITECTURES = "x86_64"
$env:REACT_NATIVE_ARCHITECTURES = "x86_64"
$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = "x86_64"

# Create cache directories
if (-not (Test-Path "C:\gradle-home")) { New-Item -ItemType Directory -Path "C:\gradle-home" }
if (-not (Test-Path "C:\gradle-cache")) { New-Item -ItemType Directory -Path "C:\gradle-cache" }

# Build
npx expo run:android
```

### Option 3: Direct Gradle Build (External PowerShell)

```powershell
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile\android"

# Set environment
$env:GRADLE_USER_HOME = "C:\gradle-home"
$env:REACT_NATIVE_ARCHITECTURES = "x86_64"

# Build
.\gradlew.bat app:assembleDebug -PreactNativeArchitectures=x86_64
```

## Clean Build Artifacts

If build fails or you want a fresh start:

```powershell
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
npm run clean:android
```

**Or manually:**
```powershell
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"

# Remove build artifacts
Remove-Item -Recurse -Force android\app\build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\.gradle -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\app\.cxx -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force node_modules\react-native-screens\android\.cxx -ErrorAction SilentlyContinue
```

## Running Outside Cursor (Required)

**Always run the build from external PowerShell.** The script detects sandbox paths and aborts if it finds `cursor-sandbox-cache` in the current path.

**If you see "ERROR: Running in Cursor sandbox!":**
1. Close the Cursor terminal
2. Open Windows PowerShell (external)
3. `cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"`
4. `npm run dev:android:external`

## Why External PowerShell?

**Cursor's integrated terminal** runs commands in a sandbox with paths like:
```
C:\Users\Marek\AppData\Local\Temp\cursor-sandbox-cache\...
```

**External PowerShell** uses the real project path:
```
C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile
```

This avoids the 260-character limit.

## Architecture Selection

**For Emulator (x86_64):**
- ✅ Fastest build
- ✅ Shortest paths
- ✅ Works with Android emulator
- ❌ Won't run on ARM devices

**For Physical Device (arm64-v8a):**
- ❌ Longer paths (may hit limit)
- ✅ Runs on real Android devices
- ⚠️ Requires longer cache paths or different setup

**Current setting:** `x86_64` (emulator only)

To build for physical device, change in `android/gradle.properties`:
```properties
reactNativeArchitectures=arm64-v8a
```

## Windows Long Paths Mitigation (Optional but Recommended)

### Enable Windows Long Paths Support

Windows 10+ supports paths longer than 260 characters, but it must be enabled:

**Via Registry (requires admin):**
```powershell
# Run PowerShell as Administrator
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

**Via Group Policy:**
1. Run `gpedit.msc`
2. Navigate to: Computer Configuration → Administrative Templates → System → Filesystem
3. Enable "Enable Win32 long paths"

**Git Configuration:**
```powershell
git config --global core.longpaths true
```

### Shorten Project Path (Alternative)

If long paths cannot be enabled, consider moving the project to a shorter path:
- Current: `C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile`
- Recommended: `C:\src\staveto\mobile` (much shorter)

**Note:** The primary fix is removing arm64-v8a architecture, which eliminates the need for very long paths.

## Verification

After successful build, verify:
1. ✅ APK created: `android/app/build/outputs/apk/debug/app-debug.apk`
2. ✅ App installed on emulator
3. ✅ No path length errors in build log
4. ✅ Build log shows ONLY `x86_64` architecture (no `arm64-v8a`)
5. ✅ Gradle command contains: `-PreactNativeArchitectures=x86_64` (not `x86_64,arm64-v8a`)

## Troubleshooting

### Build still fails with path errors

1. **Check cache directories exist:**
   ```powershell
   Test-Path "C:\gradle-home"
   Test-Path "C:\gradle-cache"
   ```

2. **Verify environment variables:**
   ```powershell
   $env:GRADLE_USER_HOME
   $env:EXPO_ANDROID_ARCHITECTURES
   $env:ORG_GRADLE_PROJECT_reactNativeArchitectures
   ```

3. **Clean everything and rebuild:**
   ```powershell
   npm run clean:android
   Remove-Item -Recurse -Force "C:\gradle-cache" -ErrorAction SilentlyContinue
   npm run dev:android:external
   ```

### Emulator not found

```powershell
# List available emulators
emulator -list-avds

# Start emulator manually
emulator -avd <avd-name>
```

### Gradle daemon issues

```powershell
cd android
.\gradlew.bat --stop
```

## Final Build Commands

**Run these commands in external PowerShell (NOT Cursor terminal):**

```powershell
# 1. Navigate to project
cd "C:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"

# 2. Clean previous build artifacts
npm run clean:android

# 3. Build Android app (x86_64 only)
npm run dev:android:external
```

**Expected output:**
- ✅ Script detects it's NOT running in sandbox
- ✅ Verifies `reactNativeArchitectures=x86_64` in gradle.properties
- ✅ Verifies `ndk.abiFilters "x86_64"` in app/build.gradle
- ✅ Build log shows: `-PreactNativeArchitectures=x86_64` (NOT `x86_64,arm64-v8a`)
- ✅ No tasks like `:expo-modules-core:buildCMakeDebug[arm64-v8a]`
- ✅ Build succeeds and app installs on emulator

## Summary

**✅ Always build from external PowerShell** (not Cursor terminal)

**✅ Use `npm run dev:android:external`** for easiest build

**✅ Architecture set to `x86_64`** for emulator (avoids path issues)

**✅ Cache directories use short paths** (`C:\gradle-cache`, `C:\gradle-home`)

**✅ Multiple layers enforce x86_64:**
1. `gradle.properties`: `reactNativeArchitectures=x86_64`
2. `app/build.gradle`: `ndk { abiFilters "x86_64" }` (inside `defaultConfig`, applies to debug)
3. `ORG_GRADLE_PROJECT_reactNativeArchitectures=x86_64` (Gradle project property)
4. `EXPO_ANDROID_ARCHITECTURES=x86_64` (Expo CLI)
