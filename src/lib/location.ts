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

const CHECKPOINT_TIMEOUT_MS = 6000;

function coordsToGpsPoint(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): GpsPoint {
  const accuracyM = coords.accuracy ?? 0;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM,
    timestamp: new Date().toISOString(),
    source: accuracyM <= 100 ? "gps" : "network",
  };
}

/**
 * One-shot GPS read for timer start/stop. Higher accuracy when available.
 * Never starts background or continuous tracking.
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
    return coordsToGpsPoint(loc.coords);
  } catch (err) {
    console.warn("[location] getCurrentPosition error:", err);
    return null;
  }
}

/**
 * Battery-friendly one-shot GPS for pause/resume checkpoints.
 * Balanced accuracy + hard timeout — no watchPosition, no background updates.
 */
export async function getTimerCheckpointGps(): Promise<GpsPoint | null> {
  const Location = getLocationModule();
  if (!Location) return null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      return null;
    }
    const locPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), CHECKPOINT_TIMEOUT_MS);
    });
    const result = await Promise.race([locPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    if (!result || typeof result !== "object" || !("coords" in result)) {
      return null;
    }
    return coordsToGpsPoint((result as { coords: Parameters<typeof coordsToGpsPoint>[0] }).coords);
  } catch (err) {
    console.warn("[location] getTimerCheckpointGps error:", err);
    return null;
  }
}
