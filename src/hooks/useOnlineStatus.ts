import { useState, useEffect } from "react";

type OnlineState = {
  isOnline: boolean;
  loading: boolean;
};

/**
 * Returns { isOnline, loading }.
 * Uses NetInfo when available; fallback returns isOnline: true (button enabled, errors handled by toast).
 */
export function useOnlineStatus(): OnlineState {
  const [state, setState] = useState<OnlineState>({ isOnline: true, loading: true });

  useEffect(() => {
    let NetInfo: { addEventListener: (cb: (s: { isConnected?: boolean; isInternetReachable?: boolean | null }) => void) => () => void } | null = null;
    try {
      NetInfo = require("@react-native-community/netinfo").default;
    } catch {
      setState({ isOnline: true, loading: false });
      return;
    }

    const unsub = NetInfo.addEventListener((info) => {
      const online = info.isConnected === true && info.isInternetReachable !== false;
      setState({ isOnline: online, loading: false });
    });

    return () => unsub();
  }, []);

  return state;
}
