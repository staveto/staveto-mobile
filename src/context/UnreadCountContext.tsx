import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "./AuthContext";
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
