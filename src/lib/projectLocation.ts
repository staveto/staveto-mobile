/**
 * Job-site geocoding helpers — aligned with staveto-office `lib/projectLocation.ts`.
 * Uses OpenStreetMap Nominatim (rate-limited).
 */

export type ProjectCoordinates = {
  lat: number;
  lng: number;
};

const geocodeCache = new Map<string, ProjectCoordinates | null>();
const reverseGeocodeCache = new Map<string, string | null>();
let geocodeQueue: Promise<void> = Promise.resolve();
let lastGeocodeAt = 0;

const NOMINATIM_MIN_INTERVAL_MS = 1100;

const DEFAULT_MAP_CENTER: ProjectCoordinates = { lat: 48.7164, lng: 19.1455 };

const COUNTRY_MAP_CENTER: Record<string, ProjectCoordinates> = {
  SK: { lat: 48.7164, lng: 19.1455 },
  CZ: { lat: 49.8175, lng: 15.473 },
  AT: { lat: 47.5162, lng: 14.5501 },
  CH: { lat: 46.8182, lng: 8.2275 },
  DE: { lat: 51.1657, lng: 10.4515 },
  PL: { lat: 51.9194, lng: 19.1451 },
  HU: { lat: 47.1625, lng: 19.5033 },
};

export function getDefaultMapCenter(countryCode?: string | null): ProjectCoordinates {
  const code = countryCode?.trim().toUpperCase();
  if (code && COUNTRY_MAP_CENTER[code]) return COUNTRY_MAP_CENTER[code];
  return DEFAULT_MAP_CENTER;
}

function scheduleGeocode<T>(task: () => Promise<T>): Promise<T> {
  const run = geocodeQueue.then(async () => {
    const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastGeocodeAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastGeocodeAt = Date.now();
    return task();
  });
  geocodeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Geocode address via OpenStreetMap Nominatim (cached, rate-limited). */
export async function geocodeProjectAddress(
  address: string
): Promise<ProjectCoordinates | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  const coords = await scheduleGeocode(async () => {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      url.searchParams.set("q", address);

      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "StavetoMobile/1.0 (job site location picker)",
        },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = data[0];
      if (!hit?.lat || !hit.lon) return null;

      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  });

  geocodeCache.set(key, coords);
  return coords;
}

type NominatimAddress = {
  road?: string;
  house_number?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  postcode?: string;
  country?: string;
};

function formatNominatimAddress(address: NominatimAddress): string | null {
  const street = [address.road, address.house_number].filter(Boolean).join(" ").trim();
  const locality =
    address.city?.trim() ||
    address.town?.trim() ||
    address.village?.trim() ||
    address.municipality?.trim() ||
    "";
  const parts = [street, locality, address.postcode?.trim()].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

/** Reverse geocode coordinates via OpenStreetMap Nominatim (rate-limited). */
export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number
): Promise<string | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseGeocodeCache.has(key)) return reverseGeocodeCache.get(key) ?? null;

  const label = await scheduleGeocode(async () => {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "json");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("addressdetails", "1");

      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "StavetoMobile/1.0 (job site location picker)",
        },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        display_name?: string;
        address?: NominatimAddress;
      };
      const formatted = data.address ? formatNominatimAddress(data.address) : null;
      return formatted || data.display_name?.trim() || null;
    } catch {
      return null;
    }
  });

  reverseGeocodeCache.set(key, label);
  return label;
}
