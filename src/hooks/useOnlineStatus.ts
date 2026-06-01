import { useState, useEffect } from "react";
import { subscribeNetworkStatus, type NetworkSnapshot } from "../services/networkStatus";

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
  isInternetReachable: boolean | null;
  lastChangedAt: number | null;
};

function toOnlineState(snapshot: NetworkSnapshot): OnlineState {
  const isOffline = !snapshot.isOnline;
  const isPoorNetwork = !isOffline && snapshot.status === "poor";
  return {
    isOnline: snapshot.isOnline,
    isOffline,
    isPoorNetwork,
    loading: false,
    isInternetReachable: snapshot.isInternetReachable,
    lastChangedAt: snapshot.lastChangedAt,
    netInfo: {
      isConnected: snapshot.isOnline,
      isInternetReachable: snapshot.isInternetReachable,
      type: snapshot.type,
    },
  };
}

/**
 * Returns { isOnline, isOffline, isPoorNetwork, netInfo }.
 * Uses NetInfo when available; fallback returns isOnline: true.
 */
export function useOnlineStatus(): OnlineState {
  const [state, setState] = useState<OnlineState>({
    isOnline: true,
    isOffline: false,
    isPoorNetwork: false,
    loading: true,
    netInfo: null,
    isInternetReachable: null,
    lastChangedAt: null,
  });

  useEffect(() => {
    const unsub = subscribeNetworkStatus((snapshot) => {
      setState(toOnlineState(snapshot));
    });
    return unsub;
  }, []);

  return state;
}
