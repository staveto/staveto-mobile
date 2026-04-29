import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { evaluateStoreUpdate, type StoreUpdateCheckResult } from "../services/appUpdateService";
import { UpdateAvailableModal } from "./UpdateAvailableModal";
import { ForceUpdateModal } from "./ForceUpdateModal";

const MIN_CHECK_INTERVAL_MS = 55_000;

type Props = {
  /** When false, no checks (e.g. not yet in main app shell). */
  enabled: boolean;
};

/**
 * Store-version prompts (App Store / Play). Independent from expo-updates OTA.
 */
export function StoreUpdateGate({ enabled }: Props) {
  const [softVisible, setSoftVisible] = useState(false);
  const [forcedVisible, setForcedVisible] = useState(false);
  const [result, setResult] = useState<StoreUpdateCheckResult | null>(null);
  const lastCheckAtRef = useRef(0);
  const forcedActiveRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastCheckAtRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckAtRef.current = now;

    try {
      const r = await evaluateStoreUpdate({ respectSoftThrottle: true });
      if (r.kind === "forced") {
        forcedActiveRef.current = true;
        setResult(r);
        setForcedVisible(true);
        setSoftVisible(false);
        return;
      }
      if (forcedActiveRef.current) {
        return;
      }
      if (r.kind === "soft") {
        setResult(r);
        setSoftVisible(true);
        setForcedVisible(false);
        return;
      }
      setSoftVisible(false);
    } catch (e) {
      console.warn("[StoreUpdateGate] check failed:", e);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      void runCheck();
    }, 1200);
    return () => clearTimeout(t);
  }, [enabled, runCheck]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void runCheck();
      }
    });
    return () => sub.remove();
  }, [enabled, runCheck]);

  const handleSoftDismiss = () => {
    setSoftVisible(false);
  };

  return (
    <>
      <UpdateAvailableModal
        visible={softVisible && !!result?.storeUrl}
        storeUrl={result?.storeUrl ?? ""}
        remoteMessage={result?.message}
        onDismiss={handleSoftDismiss}
      />
      <ForceUpdateModal
        visible={forcedVisible && !!result?.storeUrl}
        storeUrl={result?.storeUrl ?? ""}
        remoteMessage={result?.message}
      />
    </>
  );
}
