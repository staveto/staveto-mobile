/**
 * Lazy-loads AppWithI18n (I18nProvider + translations + LazyAuthedApp).
 * Keeps heavy imports out of initial App bundle so splash can hide quickly.
 */
import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { colors } from "../theme";

export function LazyAppWithI18n({ enabled }: { enabled: boolean }) {
  const [Mod, setMod] = useState<React.ComponentType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // #region agent log
    try {
      require("../lib/bootLogger").bootStep("lazy_i18n_loading", "H5", {}).catch(() => {});
    } catch {}
    // #endregion
    import("../AppWithI18n")
      .then((m) => {
        // #region agent log
        try {
          require("../lib/bootLogger").bootStep("lazy_i18n_loaded", "H5", {}).catch(() => {});
        } catch {}
        // #endregion
        setMod(() => m.default);
      })
      .catch((e) => {
        try {
          require("../lib/bootLogger").bootFail(e).catch(() => {});
        } catch {}
        setErr(String((e as Error)?.message ?? e));
      });
  }, [enabled]);

  if (!enabled) return null;

  if (err) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <Text style={{ fontSize: 16, color: colors.error, textAlign: "center" }}>
          Failed to load: {err}
        </Text>
      </View>
    );
  }

  if (!Mod) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Mod />;
}
