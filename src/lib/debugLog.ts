/**
 * Debug instrumentation for crash investigation.
 * iOS Simulator: 127.0.0.1 = host. Android emulator: 10.0.2.2 = host.
 */
import { Platform } from "react-native";
const HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const ENDPOINT = `http://${HOST}:7242/ingest/0123687b-551a-46fb-a614-55cb13747844`;

export function dbg(
  hypothesisId: string,
  location: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const payload = {
    location,
    message,
    data: data ?? {},
    timestamp: Date.now(),
    hypothesisId,
  };
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
