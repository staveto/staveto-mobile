import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { getAuth } from "../../firebase";
import {
  ensureGeneralChat,
  getUnreadChatCount,
  listenBusinessChats,
  type BusinessChatDoc,
} from "../../services/businessChat";

function toMillis(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof raw === "object" && raw !== null) {
    const maybe = raw as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      const parsed = maybe.toDate().getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

function formatTime(raw: unknown): string {
  const ms = toMillis(raw);
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString();
}

export function BusinessChatListScreen() {
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const { t } = useI18n();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();
  const { canAccessBusiness } = useOrgAccess();
  const [chats, setChats] = useState<BusinessChatDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadByChatId, setUnreadByChatId] = useState<Record<string, number>>({});
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const canOpenBusinessChat = Boolean(
    activeBusinessOrgId &&
      canAccessBusiness &&
      activeOrganization &&
      activeMembership?.status === "active"
  );

  const refreshUnreadCounts = useCallback(
    async (rows: BusinessChatDoc[]) => {
      const uid = getAuth()?.currentUser?.uid ?? null;
      if (!activeBusinessOrgId || !uid || rows.length === 0 || !canOpenBusinessChat) {
        setUnreadByChatId({});
        return;
      }
      const pairs = await Promise.all(
        rows.map(async (chat) => [chat.id, await getUnreadChatCount(activeBusinessOrgId, uid)] as const)
      );
      setUnreadByChatId(Object.fromEntries(pairs));
    },
    [activeBusinessOrgId, canOpenBusinessChat]
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessOrgId || !canOpenBusinessChat) {
      setChats([]);
      setLoading(false);
      setError(t("business.chat.businessRequiredBody"));
      return;
    }

    setLoading(true);
    setError(null);
    ensureGeneralChat(activeBusinessOrgId)
      .then(() => {
        if (cancelled) return;
        const unsubscribe = listenBusinessChats(
          activeBusinessOrgId,
          (rows) => {
            if (cancelled) return;
            setChats(rows);
            setLoading(false);
            refreshUnreadCounts(rows).catch(() => {});
          },
          (snapshotError) => {
            if (cancelled) return;
            setError(snapshotError.message || t("business.chat.error"));
            setLoading(false);
          }
        );
        if (cancelled) unsubscribe();
        else cleanupRef.current = unsubscribe;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [activeBusinessOrgId, canOpenBusinessChat, refreshUnreadCounts, t]);

  const rows = useMemo(() => {
    if (chats.length > 0) return chats;
    if (!activeBusinessOrgId || !canOpenBusinessChat) return [];
    return [
      {
        id: "general",
        orgId: activeBusinessOrgId,
        type: "general" as const,
        title: t("business.chat.generalTitle"),
        createdAt: null,
        updatedAt: null,
        lastMessageText: "",
        lastMessageAt: null,
        lastMessageByUid: null,
      },
    ];
  }, [activeBusinessOrgId, canOpenBusinessChat, chats, t]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#EA580C" />
        <Text style={styles.loadingText}>{t("business.chat.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("business.chat.title")}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {rows.length === 0 ? (
        <Text style={styles.emptyText}>{t("business.chat.empty")}</Text>
      ) : (
        rows.map((chat) => {
          const unread = unreadByChatId[chat.id] ?? 0;
          return (
            <Pressable
              key={chat.id}
              style={styles.card}
              onPress={() =>
                nav.navigate("BusinessChatRoom", {
                  orgId: chat.orgId,
                  chatId: chat.id,
                  title: chat.title || t("business.chat.generalTitle"),
                })
              }
            >
              <View style={styles.cardHead}>
                <View style={styles.iconWrap}>
                  <Ionicons name="chatbubbles-outline" size={20} color="#1E3A8A" />
                </View>
                <View style={styles.mainCol}>
                  <Text style={styles.chatTitle}>{chat.title || t("business.chat.generalTitle")}</Text>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {chat.lastMessageText || t("business.chat.noMessages")}
                  </Text>
                </View>
                <View style={styles.sideCol}>
                  <Text style={styles.timeText}>{formatTime(chat.lastMessageAt)}</Text>
                  {unread > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Text style={styles.openText}>{t("business.chat.open")} ›</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 10,
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: "#0E1D3A",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  errorText: {
    color: "#FECACA",
    fontSize: 13,
    marginBottom: 4,
  },
  emptyText: {
    color: "#CBD5E1",
    fontSize: 14,
    marginTop: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  mainCol: {
    flex: 1,
    minWidth: 0,
  },
  sideCol: {
    minWidth: 52,
    alignItems: "flex-end",
    gap: 4,
  },
  chatTitle: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  lastMessage: {
    marginTop: 2,
    color: "#475569",
    fontSize: 13,
  },
  timeText: {
    color: "#64748B",
    fontSize: 12,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  openText: {
    marginTop: 8,
    color: "#1E3A8A",
    alignSelf: "flex-end",
    fontWeight: "700",
    fontSize: 13,
  },
});
