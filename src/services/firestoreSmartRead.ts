/**
 * Offline-first Firestore read wrapper.
 * When offline or on poor network, reads from cache first to avoid long hangs.
 */
import type { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import { withTimeout } from "../utils/withTimeout";

export type NetworkStatus = "online" | "poor" | "offline";

/** NetInfo type values (e.g. 'wifi', 'cellular', 'none', 'unknown') */
export type NetInfoStateType = string;

export type SmartReadOptions = {
  /** Connection types treated as poor (default ['cellular','unknown']) */
  poorTypes?: NetInfoStateType[];
  /** Force server even when offline (will likely fail); uses timeout to avoid hang */
  forceServer?: boolean;
  /** When poor network, prefer cache first (default true) */
  preferCacheWhenPoor?: boolean;
};

/** Only "unknown" is treated as poor — cellular uses server-first like WiFi so first load is not stuck on empty Firestore cache. */
const DEFAULT_POOR_TYPES: NetInfoStateType[] = ["unknown"];
const FORCE_SERVER_TIMEOUT_MS = 8000;
/** Cap server round-trips so UI never hangs forever (emulator / bad network). */
const SERVER_READ_TIMEOUT_MS = 15000;
/** When server read times out, an empty cache snapshot can hide real data — retry server once. */
const EMPTY_CACHE_SERVER_RETRY_MS = 28000;

let NetInfoModule: {
  fetch: () => Promise<{
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
  }>;
} | null = null;

try {
  NetInfoModule = require("@react-native-community/netinfo").default;
} catch {
  if (__DEV__) console.warn("[firestoreSmartRead] NetInfo not available, assuming online");
}

async function getNetworkStatus(opts?: SmartReadOptions): Promise<NetworkStatus> {
  if (!NetInfoModule) return "online";
  try {
    const state = await NetInfoModule.fetch();
    const isConnected = state.isConnected === true;
    const isReachable = state.isInternetReachable !== false;
    const type = (state.type ?? "unknown").toLowerCase();

    const offline = !isConnected || type === "none" || (!isReachable && type !== "wifi");
    if (offline) return "offline";

    const poorTypes = opts?.poorTypes ?? DEFAULT_POOR_TYPES;
    const poor = poorTypes.some((t) => t.toLowerCase() === type);
    if (poor) return "poor";

    return "online";
  } catch (e) {
    if (__DEV__) console.warn("[firestoreSmartRead] NetInfo.fetch failed:", e);
    return "online";
  }
}

type DocRef = FirebaseFirestoreTypes.DocumentReference<FirebaseFirestoreTypes.DocumentData>;
type QueryOrColRef =
  | FirebaseFirestoreTypes.Query<FirebaseFirestoreTypes.DocumentData>
  | FirebaseFirestoreTypes.CollectionReference<FirebaseFirestoreTypes.DocumentData>;

/**
 * Smart getDoc: cache-first when offline/poor, server-first when online.
 * Never throws due to cache miss alone; falls back to server when possible.
 * When forceServer: uses timeout so UI does not hang.
 */
export async function getDocSmart(
  ref: DocRef,
  opts?: SmartReadOptions
): Promise<FirebaseFirestoreTypes.DocumentSnapshot<FirebaseFirestoreTypes.DocumentData>> {
  const status = await getNetworkStatus(opts);
  const preferCacheWhenPoor = opts?.preferCacheWhenPoor !== false;
  const preferCache = status === "offline" || (status === "poor" && preferCacheWhenPoor);
  const forceServer = opts?.forceServer === true;

  if (forceServer) {
    try {
      return await withTimeout(
        ref.get({ source: "server" }),
        FORCE_SERVER_TIMEOUT_MS,
        "getDocSmart:forceServer"
      );
    } catch (err) {
      try {
        const cached = await ref.get({ source: "cache" });
        if (__DEV__) console.log("[firestoreSmartRead] getDoc server failed, used cache");
        return cached;
      } catch {
        throw addContext(err, "getDocSmart", ref.path);
      }
    }
  }

  if (preferCache) {
    if (__DEV__) console.log("[firestoreSmartRead] getDoc cache-first (offline/poor):", ref.path);
    try {
      return await ref.get({ source: "cache" });
    } catch (cacheErr) {
      if (status === "offline") {
        throw addContext(cacheErr, "getDocSmart (offline, cache miss)", ref.path);
      }
      if (__DEV__) console.log("[firestoreSmartRead] getDoc cache miss, fallback server:", ref.path);
      try {
        return await withTimeout(
          ref.get({ source: "server" }),
          SERVER_READ_TIMEOUT_MS,
          `getDocSmart:server:${ref.path}`
        );
      } catch (serverErr) {
        try {
          return await ref.get({ source: "cache" });
        } catch {
          throw addContext(serverErr, "getDocSmart", ref.path);
        }
      }
    }
  }

  if (__DEV__) console.log("[firestoreSmartRead] getDoc server-first (online):", ref.path);
  try {
    return await withTimeout(
      ref.get({ source: "server" }),
      SERVER_READ_TIMEOUT_MS,
      `getDocSmart:server:${ref.path}`
    );
  } catch (err) {
    try {
      const cached = await ref.get({ source: "cache" });
      if (__DEV__) console.log("[firestoreSmartRead] getDoc server failed or timeout, used cache:", ref.path);
      return cached;
    } catch {
      throw addContext(err, "getDocSmart", ref.path);
    }
  }
}

/**
 * Server timeout often yields an empty cache snapshot; one server retry avoids false empty lists.
 */
async function retryGetDocsIfEmptyCache(
  queryRef: QueryOrColRef,
  snap: FirebaseFirestoreTypes.QuerySnapshot<FirebaseFirestoreTypes.DocumentData>,
  opts: { status: NetworkStatus }
): Promise<FirebaseFirestoreTypes.QuerySnapshot<FirebaseFirestoreTypes.DocumentData>> {
  if (opts.status === "offline" || snap.docs.length > 0) {
    return snap;
  }
  // Empty online result is often a stale/timeout cache snapshot — always try server once.
  try {
    const serverSnap = await withTimeout(
      queryRef.get({ source: "server" }),
      EMPTY_CACHE_SERVER_RETRY_MS,
      "getDocsSmart:emptyCacheRetry"
    );
    if (serverSnap.docs.length > 0) {
      if (__DEV__) {
        console.warn("[firestoreSmartRead] getDocs: recovered non-empty result after empty cache retry");
      }
      return serverSnap;
    }
  } catch (retryErr) {
    if (__DEV__) console.warn("[firestoreSmartRead] getDocs empty-cache server retry failed:", retryErr);
  }
  return snap;
}

/**
 * Smart getDocs: same logic as getDocSmart for queries.
 */
export async function getDocsSmart(
  queryRef: QueryOrColRef,
  opts?: SmartReadOptions
): Promise<FirebaseFirestoreTypes.QuerySnapshot<FirebaseFirestoreTypes.DocumentData>> {
  const status = await getNetworkStatus(opts);
  const preferCacheWhenPoor = opts?.preferCacheWhenPoor !== false;
  const preferCache = status === "offline" || (status === "poor" && preferCacheWhenPoor);
  const forceServer = opts?.forceServer === true;
  const retryOpts = { status };

  if (forceServer) {
    try {
      return await retryGetDocsIfEmptyCache(
        queryRef,
        await withTimeout(
          queryRef.get({ source: "server" }),
          SERVER_READ_TIMEOUT_MS,
          "getDocsSmart:forceServer"
        ),
        retryOpts
      );
    } catch (err) {
      try {
        const cached = await queryRef.get({ source: "cache" });
        if (__DEV__) console.log("[firestoreSmartRead] getDocs server failed, used cache");
        return retryGetDocsIfEmptyCache(queryRef, cached, retryOpts);
      } catch {
        throw addContext(err, "getDocsSmart", "(query)");
      }
    }
  }

  if (preferCache) {
    if (__DEV__) console.log("[firestoreSmartRead] getDocs cache-first (offline/poor)");
    try {
      const cached = await queryRef.get({ source: "cache" });
      return retryGetDocsIfEmptyCache(queryRef, cached, retryOpts);
    } catch (cacheErr) {
      if (status === "offline") {
        throw addContext(cacheErr, "getDocsSmart (offline, cache miss)", "(query)");
      }
      if (__DEV__) console.log("[firestoreSmartRead] getDocs cache miss, fallback server");
      try {
        const serverSnap = await withTimeout(
          queryRef.get({ source: "server" }),
          SERVER_READ_TIMEOUT_MS,
          "getDocsSmart:server"
        );
        return retryGetDocsIfEmptyCache(queryRef, serverSnap, retryOpts);
      } catch (serverErr) {
        try {
          const cached = await queryRef.get({ source: "cache" });
          return retryGetDocsIfEmptyCache(queryRef, cached, retryOpts);
        } catch {
          throw addContext(serverErr, "getDocsSmart", "(query)");
        }
      }
    }
  }

  if (__DEV__) console.log("[firestoreSmartRead] getDocs server-first (online)");
  try {
    const serverSnap = await withTimeout(
      queryRef.get({ source: "server" }),
      SERVER_READ_TIMEOUT_MS,
      "getDocsSmart:server"
    );
    return retryGetDocsIfEmptyCache(queryRef, serverSnap, retryOpts);
  } catch (err) {
    try {
      const cached = await queryRef.get({ source: "cache" });
      if (__DEV__) console.log("[firestoreSmartRead] getDocs server failed or timeout, used cache");
      return retryGetDocsIfEmptyCache(queryRef, cached, retryOpts);
    } catch {
      throw addContext(err, "getDocsSmart", "(query)");
    }
  }
}

/**
 * Generic helper: run a read function with smart source selection.
 */
export async function runSmartRead<T>(
  readFn: (source: "cache" | "server") => Promise<T>,
  opts?: SmartReadOptions
): Promise<T> {
  const status = await getNetworkStatus(opts);
  const preferCacheWhenPoor = opts?.preferCacheWhenPoor !== false;
  const preferCache = status === "offline" || (status === "poor" && preferCacheWhenPoor);

  if (preferCache) {
    try {
      return await readFn("cache");
    } catch {
      if (status === "offline") throw new Error("Offline: cache miss");
      return readFn("server");
    }
  }
  try {
    return await readFn("server");
  } catch {
    return readFn("cache");
  }
}

function addContext(err: unknown, label: string, path: string): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const wrapped = new Error(`[${label}] ${path}: ${original.message}`);
  (wrapped as Error & { cause?: unknown }).cause = original;
  return wrapped;
}
