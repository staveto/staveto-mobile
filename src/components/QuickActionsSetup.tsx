/**
 * Sets up app shortcuts (long-press on icon) and handles quick action callbacks.
 */
import React, { useEffect } from "react";
import { Platform } from "react-native";
import * as QuickActions from "expo-quick-actions";
import { useQuickActionCallback } from "expo-quick-actions/hooks";
import { useAuth } from "../context/AuthContext";
import { useQuickNoteContext } from "../context/QuickNoteContext";
import { navigationRef } from "./PushNotificationHandler";
import { useI18n } from "../i18n/I18nContext";

const QUICK_NOTE_ID = "quick_note";

export function QuickActionsSetup() {
  const { user } = useAuth();
  const ctx = useQuickNoteContext();
  const { t } = useI18n();

  useEffect(() => {
    QuickActions.isSupported().then((supported) => {
      if (__DEV__) console.log("[QuickActions] isSupported:", supported);
      if (!supported) return;
      const items = [
        {
          id: QUICK_NOTE_ID,
          title: t("quickNotes.add") || "Rýchly zápis",
          subtitle: Platform.OS === "ios" ? (t("quickNotes.addSubtitle") || "Pridať poznámku") : undefined,
          icon: Platform.OS === "ios" ? "symbol:square.and.pencil" : "compose",
          params: {},
        },
      ];
      QuickActions.setItems(items)
        .then(() => {
          if (__DEV__) console.log("[QuickActions] setItems OK – dlhý ťah na ikonu by mal zobraziť akciu");
        })
        .catch((e) => {
          if (__DEV__) console.warn("[QuickActions] setItems failed:", e);
        });
    });
  }, [t]);

  useQuickActionCallback((action) => {
    if (action.id !== QUICK_NOTE_ID) return;
    if (!user?.id) return;
    if (!ctx) return;

    if (navigationRef.isReady()) {
      try {
        (navigationRef as any).navigate("AppTabs", {
          screen: "Main",
          params: {
            screen: "Home",
            params: { screen: "HomeMain" },
          },
        });
        setTimeout(() => ctx.triggerOpenQuickNote(), 500);
      } catch (e) {
        if (__DEV__) console.warn("[QuickActions] navigate failed:", e);
        setTimeout(() => ctx.triggerOpenQuickNote(), 300);
      }
    } else {
      setTimeout(() => ctx.triggerOpenQuickNote(), 500);
    }
  });
  return null;
}
