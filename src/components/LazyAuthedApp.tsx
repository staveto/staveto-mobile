import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { colors } from "../theme";
import { IOS_SKIP_AUTH } from "../lib/iosDiagnostic";

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
    if (IOS_SKIP_AUTH) {
      import("../AppShellMinimal").then(loadShell).catch(onErr);
    } else {
      import("../AppShellAuthed").then(loadShell).catch(onErr);
    }
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
