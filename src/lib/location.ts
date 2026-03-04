/**
 * Location helper for time tracking check-in/check-out.
 * Does not block if permission denied; returns null coords.
 * Gracefully degrades when expo-location native module is unavailable (e.g. Expo Go).
 */

export type GpsPoint = {
  lat: number;
  lng: number;
  accuracyM: number;
  timestamp: string;
  source: "gps" | "network";
};

function getLocationModule(): typeof import("expo-location") | null {
  try {
    return require("expo-location");
  } catch {
    return null;
  }
}

/**
 * Request foreground location permission (When In Use).
 * Returns true if granted, false if denied or module unavailable.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const Location = getLocationModule();
  if (!Location) return false;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch (err) {
    console.warn("[location] requestPermission error:", err);
    return false;
  }
}

/**
 * Get current position. Does not block if permission denied.
 * Returns null on any error, denied permission, or when expo-location is unavailable.
 */
export async function getCurrentPositionSafe(): Promise<GpsPoint | null> {
  const Location = getLocationModule();
  if (!Location) return null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      return null;
    }
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const coords = loc.coords;
    return {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracyM: coords.accuracy ?? 0,
      timestamp: new Date().toISOString(),
      source: (coords.accuracy ?? 999) <= 100 ? "gps" : "network",
    };
  } catch (err) {
    console.warn("[location] getCurrentPosition error:", err);
    return null;
  }
}
