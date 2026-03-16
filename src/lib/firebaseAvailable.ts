/**
 * Detects if React Native Firebase native modules are available.
 * Returns false in Expo Go (no native Firebase) – allows app to run with stubs.
 */
let _cached: boolean | null = null;

export function isFirebaseAvailable(): boolean {
  if (_cached !== null) return _cached;
  try {
    require("@react-native-firebase/app").getApp();
    _cached = true;
  } catch {
    _cached = false;
  }
  return _cached;
}
