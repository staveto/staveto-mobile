import { useState, useEffect, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "../context/AuthContext";
import * as notificationsService from "../services/notifications";
import * as invitesService from "../services/invites";

/**
 * Returns total count of items needing attention: unread notifications + pending project invites.
 * Used for badge on Notifications tab and drawer nav item.
 */
export function useUnreadCount(): { count: number; loading: boolean; refresh: () => void } {
  const { orgId } = useAuth();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [unreadNotifications, pendingInvites] = await Promise.all([
        notificationsService.getUnreadCount(orgId),
        invitesService.listPendingInvites(),
      ]);
      const total = unreadNotifications + pendingInvites.length;
      setCount(total > 99 ? 99 : total);
    } catch {
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { count, loading, refresh };
}
