import { Platform } from "react-native";

const INGEST_PATH = "/ingest/2418b79b-8c5b-4006-a07d-878605a09a96";
/** Cursor debug session — must match log file `debug-edcd6f.log` */
const DEBUG_SESSION_ID = "edcd6f";

/** Android emulator: 127.0.0.1 is the device; host ingest is 10.0.2.2 */
export function debugIngestUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
  return `http://${host}:7281${INGEST_PATH}`;
}

const AGENT_RING_KEY = "staveto_agent_debug_ring";
const AGENT_RING_MAX = 40;

function persistAgentRing(line: Record<string, unknown>): void {
  try {
    const AsyncStorage = require("@react-native-async-storage/async-storage").default;
    void AsyncStorage.getItem(AGENT_RING_KEY)
      .then((raw: string | null) => {
        const arr: unknown[] = raw ? JSON.parse(raw) : [];
        arr.push(line);
        return AsyncStorage.setItem(AGENT_RING_KEY, JSON.stringify(arr.slice(-AGENT_RING_MAX)));
      })
      .catch(() => {});
  } catch {}
}

export function postDebugIngest(payload: Record<string, unknown>): void {
  const body = {
    sessionId: DEBUG_SESSION_ID,
    timestamp: Date.now(),
    ...payload,
  };
  persistAgentRing(body);
  if (__DEV__) {
    try {
      console.warn("[debug-ingest]", payload.message ?? payload.location, body);
    } catch {}
  }
  try {
    fetch(debugIngestUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION_ID },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {}
}
