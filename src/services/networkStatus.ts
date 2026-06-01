/**
 * Shared network status helpers (NetInfo when available).
 */
export type NetworkStatus = "online" | "poor" | "offline";

export type NetworkSnapshot = {
  isOnline: boolean;
  isInternetReachable: boolean | null;
  type: string;
  status: NetworkStatus;
  lastChangedAt: number | null;
};

type NetInfoModule = {
  fetch: () => Promise<{
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
  }>;
  addEventListener: (cb: (state: {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
  }) => void) => () => void;
};

let NetInfo: NetInfoModule | null = null;
let lastChangedAt: number | null = null;

try {
  NetInfo = require("@react-native-community/netinfo").default;
} catch {
  if (__DEV__) console.warn("[networkStatus] NetInfo not available, assuming online");
}

const DEFAULT_POOR_TYPES = ["unknown"];

export function snapshotFromNetInfo(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string;
}): NetworkSnapshot {
  const isConnected = state.isConnected === true;
  const isInternetReachable =
    state.isInternetReachable === undefined || state.isInternetReachable === null
      ? null
      : state.isInternetReachable === true;
  const type = (state.type ?? "unknown").toLowerCase();

  const offline =
    !isConnected ||
    type === "none" ||
    (isInternetReachable === false && type !== "wifi");
  if (offline) {
    return {
      isOnline: false,
      isInternetReachable,
      type,
      status: "offline",
      lastChangedAt,
    };
  }

  const poor = DEFAULT_POOR_TYPES.some((t) => t.toLowerCase() === type);
  return {
    isOnline: true,
    isInternetReachable,
    type,
    status: poor ? "poor" : "online",
    lastChangedAt,
  };
}

export async function fetchNetworkSnapshot(): Promise<NetworkSnapshot> {
  if (!NetInfo) {
    return {
      isOnline: true,
      isInternetReachable: true,
      type: "unknown",
      status: "online",
      lastChangedAt,
    };
  }
  try {
    const state = await NetInfo.fetch();
    return snapshotFromNetInfo(state);
  } catch (e) {
    if (__DEV__) console.warn("[networkStatus] fetch failed:", e);
    return {
      isOnline: true,
      isInternetReachable: null,
      type: "unknown",
      status: "online",
      lastChangedAt,
    };
  }
}

export function subscribeNetworkStatus(
  onChange: (snapshot: NetworkSnapshot) => void
): () => void {
  if (!NetInfo) {
    onChange({
      isOnline: true,
      isInternetReachable: true,
      type: "unknown",
      status: "online",
      lastChangedAt: null,
    });
    return () => {};
  }

  const handler = (state: {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
  }) => {
    lastChangedAt = Date.now();
    onChange(snapshotFromNetInfo(state));
  };

  const unsub = NetInfo.addEventListener(handler);
  NetInfo.fetch().then(handler).catch(() => {});
  return unsub;
}
