import { getFns } from "../firebase";

export type CalculateDistanceInput = {
  fromAddress: string;
  toAddress: string;
  countryCode?: string;
  mode?: "driving";
};

export type CalculateDistanceResult = {
  distanceKm: number;
  durationMin?: number;
};

/**
 * Call Cloud Function to compute driving distance between two addresses.
 * Requires auth. Throws on API/network errors.
 */
export async function calculateDistanceKm(input: CalculateDistanceInput): Promise<CalculateDistanceResult> {
  const fns = getFns();
  const result = await fns.httpsCallable("calculateDistanceKm")({
    fromAddress: input.fromAddress.trim(),
    toAddress: input.toAddress.trim(),
    mode: input.mode ?? "driving",
    ...(input.countryCode && { countryCode: input.countryCode }),
  });
  const data = result.data as CalculateDistanceResult;
  if (typeof data?.distanceKm !== "number") {
    throw new Error("Invalid response from calculateDistanceKm");
  }
  return { distanceKm: data.distanceKm, durationMin: data.durationMin };
}
