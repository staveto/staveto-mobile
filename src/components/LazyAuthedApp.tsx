import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, InteractionManager, Platform } from "react-native";
import { colors } from "../theme";
import { IOS_SKIP_AUTH } from "../lib/iosDiagnostic";
import { isFirebaseAvailable } from "../lib/firebaseAvailable";
import AppShellMinimal from "../AppShellMinimal";
import AppShellAuthed from "../AppShellAuthed";

function pickShell(): React.ComponentType {
  return IOS_SKIP_AUTH || !isFirebaseAvailable() ? AppShellMinimal : AppShellAuthed;
}

export function LazyAuthedApp({ enabled }: { enabled: boolean }) {
  const [Mod, setMod] = useState<React.ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    try {
      require("../lib/bootLogger").bootStep("lazy_authed_loading", "H6" as any, {}).catch(() => {});
    } catch {}

    const applyShell = () => {
      try {
        try {
          require("../lib/bootLogger").bootStep("lazy_authed_loaded", "H6", {}).catch(() => {});
        } catch {}
        setMod(() => pickShell());
      } catch (e: unknown) {
        try {
          require("../lib/bootLogger").bootFail(e).catch(() => {});
        } catch {}
        setErr(String((e as Error)?.message ?? e));
      }
    };

    // Defer on iOS until after first frame (prevents native crash). Android: load immediately.
    if (Platform.OS === "ios" && !IOS_SKIP_AUTH) {
      let cancelled = false;
      let taskRef: { cancel: () => void } | null = null;
      const fallback = setTimeout(() => {
        if (!cancelled) {
          cancelled = true;
          taskRef?.cancel();
          applyShell();
        }
      }, 500);
      taskRef = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        cancelled = true;
        clearTimeout(fallback);
        setTimeout(applyShell, 100);
      });
      return () => {
        cancelled = true;
        clearTimeout(fallback);
        taskRef?.cancel();
      };
    }

    applyShell();
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
