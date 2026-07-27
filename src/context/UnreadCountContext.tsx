import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useAuth } from "./AuthContext";
import { auth } from "../firebase";
import * as notificationsService from "../services/notifications";
import * as invitesService from "../services/invites";

type UnreadCountValue = {
  count: number;
  loading: boolean;
  refresh: () => Promise<void>;
  setCount: (n: number) => void;
};

const UnreadCountContext = createContext<UnreadCountValue | null>(null);

export function UnreadCountProvider({ children }: { children: React.ReactNode }) {
  const { orgId } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    /**
     * Notification inbox identity must match Notifications screen:
     * only the signed-in Firebase user (no orgId fallback).
     */
    const uid = auth()?.currentUser?.uid ?? null;
    if (!uid) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [list, pendingInvites] = await Promise.all([
        notificationsService.listNotifications(uid, {
          limitCount: notificationsService.USER_NOTIFICATION_QUERY_LIMIT,
        }),
        invitesService.listPendingInvites(),
      ]);
      const invitesByProject = new Map<string, (typeof pendingInvites)[number]>();
      for (const inv of pendingInvites) {
        if (!inv?.projectId || invitesByProject.has(inv.projectId)) continue;
        invitesByProject.set(inv.projectId, inv);
      }
      const uniqueInvites = [...invitesByProject.values()];
      const pendingProjectIds = new Set(invitesByProject.keys());
      const unreadNotifications = list.filter(
        (n) =>
          !notificationsService.hasMeaningfulReadAt(n.readAt) &&
          !notificationsService.isCoveredByPendingProjectInvite(n, pendingProjectIds)
      ).length;
      const total = unreadNotifications + uniqueInvites.length;
      setCount(total > 99 ? 99 : total);
    } catch {
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [orgId]); // orgId keeps refresh in sync with login lifecycle (even though uid source is Firebase user only)

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live sync with web: badge updates when office/root notification docs change.
  useEffect(() => {
    const uid = auth()?.currentUser?.uid ?? null;
    if (!uid) return;
    return notificationsService.subscribeNotificationInboxChanges(uid, () => {
      void refresh();
    });
  }, [refresh, orgId]);

  // Backup poll (live listeners cover mark-read; this catches invite / edge cases).
  useEffect(() => {
    const interval = setInterval(refresh, 120_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Sync app icon badge (red circle on home screen) with unread count
  useEffect(() => {
    if (Platform.OS === "web") return;
    Notifications.setBadgeCountAsync(count).catch(() => {});
  }, [count]);

  const value: UnreadCountValue = {
    count,
    loading,
    refresh,
    setCount,
  };

  return (
    <UnreadCountContext.Provider value={value}>
      {children}
    </UnreadCountContext.Provider>
  );
}

export function useUnreadCountContext(): UnreadCountValue {
  const ctx = useContext(UnreadCountContext);
  if (!ctx) {
    throw new Error("useUnreadCountContext must be used within UnreadCountProvider");
  }
  return ctx;
}
