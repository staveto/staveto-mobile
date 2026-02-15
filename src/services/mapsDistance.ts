/**
 * Calculate driving distance between two addresses.
 *
 * 1) Ak je nastavený EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: volá Google Directions API priamo.
 * 2) Inak fallback na Cloud Function calculateDistanceKm (vyžaduje auth).
 *
 * Enable in Google Cloud Console: Directions API
 */

const MIN_ADDRESS_LENGTH = 3;

function getApiKey(): string | null {
  return process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
}

function encodeAddress(addr: string): string {
  return encodeURIComponent(addr.trim());
}

/** Ak adresa neobsahuje čiarku alebo krajinu, pridá ", Slovensko" pre lepšiu geokódovanie */
function maybeAddCountry(addr: string): string {
  const t = addr.trim();
  if (t.length < 3) return t;
  const lower = t.toLowerCase();
  if (lower.includes("slovensko") || lower.includes("slovakia") || lower.includes(", sk") || lower.includes(", sk ")) return t;
  if (!t.includes(",")) return `${t}, Slovensko`;
  return t;
}

async function fetchFromDirectionsApi(from: string, to: string, apiKey: string): Promise<number> {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeAddress(from)}&destination=${encodeAddress(to)}&mode=driving&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sieťová chyba: ${response.status}`);
  }

  const data = (await response.json()) as {
    status?: string;
    error_message?: string;
    routes?: Array<{
      legs?: Array<{
        distance?: { value?: number; text?: string };
      }>;
    }>;
  };

  if (data.status === "ZERO_RESULTS" || data.status === "NOT_FOUND") {
    throw new Error("Adresa nebola nájdená. Skúste pridať krajinu (napr. Martin, Slovensko) alebo zadajte km ručne.");
  }
  if (data.status === "REQUEST_DENIED") {
    const raw = data.error_message ?? "API kľúč neplatný.";
    const hint =
      " Skontrolujte: 1) Billing zapnutý v projekte, 2) Directions API povolené, 3) Application restrictions = None (alebo správny Android package + SHA-1).";
    throw new Error(raw + hint);
  }
  if (data.status === "OVER_QUERY_LIMIT") {
    throw new Error("Prekročený limit API. Skúste neskôr.");
  }
  if (data.status !== "OK") {
    throw new Error(data.error_message ?? `Výpočet zlyhal: ${data.status ?? "unknown"}`);
  }

  const distanceValue = data.routes?.[0]?.legs?.[0]?.distance?.value;
  if (typeof distanceValue !== "number" || distanceValue < 0) {
    throw new Error("Neplatná odpoveď z API");
  }
  const km = distanceValue / 1000;
  return Math.round(km * 10) / 10;
}

/**
 * Calculate driving distance in km between two addresses.
 * Uses Google Directions API (ak je kľúč) alebo Cloud Function (fallback).
 *
 * @param from - Origin address
 * @param to - Destination address
 * @returns Distance in km, rounded to 1 decimal place
 * @throws Error on invalid address, network error, quota exceeded, or API error
 */
export async function calculateRouteDistanceKm(from: string, to: string): Promise<number> {
  const fromTrimmed = from?.trim() ?? "";
  const toTrimmed = to?.trim() ?? "";

  if (fromTrimmed.length < MIN_ADDRESS_LENGTH || toTrimmed.length < MIN_ADDRESS_LENGTH) {
    throw new Error("Adresa musí mať aspoň 3 znaky");
  }

  const apiKey = getApiKey();
  if (apiKey) {
    const fromEnc = maybeAddCountry(fromTrimmed);
    const toEnc = maybeAddCountry(toTrimmed);
    return fetchFromDirectionsApi(fromEnc, toEnc, apiKey);
  }

  // Fallback: Cloud Function (vyžaduje prihlásenie)
  try {
    const { calculateDistanceKm: cfCalculate } = await import("./distance");
    const fromEnc = maybeAddCountry(fromTrimmed);
    const toEnc = maybeAddCountry(toTrimmed);
    const result = await cfCalculate({ fromAddress: fromEnc, toAddress: toEnc, mode: "driving" });
    return Math.round(result.distanceKm * 10) / 10;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("NOT_FOUND") || msg.includes("not-found") || msg.includes("functions/")) {
      throw new Error("Výpočet vzdialenosti nie je dostupný. Pridajte EXPO_PUBLIC_GOOGLE_MAPS_API_KEY do .env alebo zadajte km ručne.");
    }
    throw err instanceof Error ? err : new Error("Nepodarilo sa vypočítať km. Skúste pridať EXPO_PUBLIC_GOOGLE_MAPS_API_KEY do .env alebo zadajte km ručne.");
  }
}
