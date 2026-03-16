import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, InteractionManager, Platform } from "react-native";
import { colors } from "../theme";
import { IOS_SKIP_AUTH } from "../lib/iosDiagnostic";
import { isFirebaseAvailable } from "../lib/firebaseAvailable";

export function LazyAuthedApp({ enabled }: { enabled: boolean }) {
  const [Mod, setMod] = useState<React.ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // #region agent log
    try {
      require("../lib/bootLogger").bootStep("lazy_authed_loading", "H6" as any, {}).catch(() => {});
    } catch {}
    // #endregion
    const loadShell = (m: { default: React.ComponentType }) => {
      try {
        require("../lib/bootLogger").bootStep("lazy_authed_loaded", "H6", {}).catch(() => {});
      } catch {}
      setMod(() => m.default);
    };
    const onErr = (e: unknown) => {
      try {
        require("../lib/bootLogger").bootFail(e).catch(() => {});
      } catch {}
      setErr(String((e as Error)?.message ?? e));
    };
    const doLoad = () => {
      if (IOS_SKIP_AUTH || !isFirebaseAvailable()) {
        import("../AppShellMinimal").then(loadShell).catch(onErr);
      } else {
        import("../AppShellAuthed").then(loadShell).catch(onErr);
      }
    };
    // Defer Firebase load on iOS until after first frame (prevents native crash)
    if (Platform.OS === "ios" && !IOS_SKIP_AUTH) {
      const task = InteractionManager.runAfterInteractions(() => {
        setTimeout(doLoad, 100);
      });
      return () => task.cancel();
    }
    doLoad();
  }, [enabled]);

  if (!enabled) return null;

  if (err) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Text style={{ fontSize: 16, color: colors.error, textAlign: "center" }}>
          Failed to load app: {err}
        </Text>
      </View>
    );
  }

  if (!Mod) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }

  return <Mod />;
}
