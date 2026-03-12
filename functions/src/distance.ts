import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { log } from "firebase-functions/logger";

/** Secret v Secret Manager: staveto-functions-maps (obsahuje Google Maps API key) */
const MAPS_API_KEY = defineSecret("staveto-functions-maps");

type CalculateDistanceInput = {
  fromAddress: string;
  toAddress: string;
  countryCode?: string;
  mode?: "driving";
};

type CalculateDistanceResult = {
  distanceKm: number;
  durationMin?: number;
};

/**
 * Callable: compute driving distance between two addresses via Google Directions API.
 * Requires MAPS_API_KEY secret. Region: europe-west1.
 */
export const calculateDistanceKm = onCall(
  {
    region: "europe-west1",
    secrets: [MAPS_API_KEY],
    invoker: "public",
  },
  async (request): Promise<CalculateDistanceResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = request.data as CalculateDistanceInput;
    const fromAddress = typeof data?.fromAddress === "string" ? data.fromAddress.trim() : "";
    const toAddress = typeof data?.toAddress === "string" ? data.toAddress.trim() : "";

    if (!fromAddress || !toAddress) {
      throw new HttpsError("invalid-argument", "fromAddress and toAddress are required.");
    }

    const mode = data?.mode === "driving" ? "driving" : "driving";
    const apiKey = process.env.MAPS_API_KEY ?? MAPS_API_KEY.value();
    if (!apiKey) {
      log("[calculateDistanceKm] MAPS_API_KEY secret is empty");
      throw new HttpsError("internal", "distance_failed");
    }

    const origin = encodeURIComponent(fromAddress);
    const destination = encodeURIComponent(toAddress);
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=${mode}&key=${apiKey}`;

    try {
      const res = await fetch(url);
      const json = (await res.json()) as {
        status?: string;
        routes?: Array<{
          legs?: Array<{
            distance?: { value?: number; text?: string };
            duration?: { value?: number; text?: string };
          }>;
        }>;
      };

      if (json.status !== "OK" || !json.routes?.length) {
        log("[calculateDistanceKm] API returned no routes", {
          status: json.status,
          fromAddress: fromAddress.substring(0, 50),
          toAddress: toAddress.substring(0, 50),
        });
        throw new HttpsError("internal", "distance_failed");
      }

      const leg = json.routes[0]?.legs?.[0];
      const distanceMeters = leg?.distance?.value;
      const durationSeconds = leg?.duration?.value;

      if (distanceMeters == null || distanceMeters <= 0) {
        log("[calculateDistanceKm] No distance in response", { leg });
        throw new HttpsError("internal", "distance_failed");
      }

      const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
      const durationMin = durationSeconds != null ? Math.round(durationSeconds / 60) : undefined;

      return { distanceKm, durationMin };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      log("[calculateDistanceKm] Request failed", { error: String(e), fromAddress: fromAddress.substring(0, 30), toAddress: toAddress.substring(0, 30) });
      throw new HttpsError("internal", "distance_failed");
    }
  }
);
