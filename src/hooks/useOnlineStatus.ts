import { useState, useEffect } from "react";

export type NetInfoState = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string;
};

export type OnlineState = {
  isOnline: boolean;
  isOffline: boolean;
  isPoorNetwork: boolean;
  loading: boolean;
  netInfo: NetInfoState | null;
};

/**
 * Returns { isOnline, isOffline, isPoorNetwork, netInfo }.
 * Uses NetInfo when available; fallback returns isOnline: true.
 * - isOffline: !isConnected OR type==='none' OR isInternetReachable===false
 * - isPoorNetwork: type in ['cellular','unknown'] (weak signal)
 */
export function useOnlineStatus(): OnlineState {
  const [state, setState] = useState<OnlineState>({
    isOnline: true,
    isOffline: false,
    isPoorNetwork: false,
    loading: true,
    netInfo: null,
  });

  useEffect(() => {
    let NetInfo: {
      addEventListener: (cb: (s: NetInfoState) => void) => () => void;
      fetch?: () => Promise<NetInfoState>;
    } | null = null;
    try {
      NetInfo = require("@react-native-community/netinfo").default;
    } catch {
      setState({
        isOnline: true,
        isOffline: false,
        isPoorNetwork: false,
        loading: false,
        netInfo: null,
      });
      return;
    }

    const update = (info: NetInfoState) => {
      const isConnected = info.isConnected === true;
      const isReachable = info.isInternetReachable !== false;
      const type = (info.type ?? "unknown").toLowerCase();

      const isOffline =
        !isConnected ||
        type === "none" ||
        (!isReachable && type !== "wifi");
      const isPoor =
        !isOffline &&
        (type === "cellular" || type === "unknown");
      const isOnline = !isOffline;

      setState({
        isOnline,
        isOffline,
        isPoorNetwork: isPoor,
        loading: false,
        netInfo: info,
      });
    };

    const unsub = NetInfo.addEventListener(update);

    if (NetInfo.fetch) {
      NetInfo.fetch().then(update).catch(() => {});
    }

    return () => unsub();
  }, []);

  return state;
}
