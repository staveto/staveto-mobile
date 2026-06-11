import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { getAuth } from "../../firebase";
import { formatChatListTime } from "../../lib/businessChatUtils";
import {
  healOrgAccessForChat,
  getOtherParticipantUid,
  getUnreadCountForChat,
  listenBusinessChats,
  type BusinessChatDoc,
} from "../../services/businessChat";
import { listChatTeamMembers } from "../../services/businessChatTeam";

function resolveChatTitle(
  chat: BusinessChatDoc,
  currentUid: string,
  t: (key: string) => string,
  memberNames: Map<string, string>
): string {
  if (chat.type === "general") return t("business.chat.generalTitle");
  const otherUid = getOtherParticipantUid(chat, currentUid);
  if (otherUid && memberNames.has(otherUid)) return memberNames.get(otherUid)!;
  return chat.title || t("business.chat.directTitle");
}

export function BusinessChatListScreen() {
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const { t } = useI18n();
  const { activeBusinessOrgId } = useActiveOrg();
  const { isViewer, canAccessBusinessChat } = useOrgAccess();
  const uid = getAuth()?.currentUser?.uid ?? "";
  const canWriteChat = canAccessBusinessChat && !isViewer;

  const [chats, setChats] = useState<BusinessChatDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadByChatId, setUnreadByChatId] = useState<Record<string, number>>({});
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const [healing, setHealing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  const refreshUnreadCounts = useCallback(
    async (rows: BusinessChatDoc[]) => {
      if (!activeBusinessOrgId || !uid || rows.length === 0) {
        setUnreadByChatId({});
        return;
      }
      const pairs = await Promise.all(
        rows.map(
          async (chat) =>
            [chat.id, await getUnreadCountForChat(activeBusinessOrgId, uid, chat.id)] as const
        )
      );
      setUnreadByChatId(Object.fromEntries(pairs));
    },
    [activeBusinessOrgId, uid]
  );

  useEffect(() => {
    let cancelled = false;

    if (!activeBusinessOrgId || !uid) {
      setChats([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    void (async () => {
      setHealing(true);
      const accessOk = await healOrgAccessForChat(activeBusinessOrgId);
      if (cancelled) return;
      setHealing(false);

      if (!accessOk) {
        setError(t("business.chat.permissionDeniedFriendly"));
        setLoading(false);
        return;
      }

      let teamUids: string[] = [];
      try {
        const team = await listChatTeamMembers(activeBusinessOrgId, uid);
        if (!cancelled) {
          teamUids = team.map((m) => m.uid);
        }
      } catch {
        /* Per-doc DM listeners are best-effort without team list. */
      }

      const unsubscribe = listenBusinessChats(
        activeBusinessOrgId,
        uid,
        (rows) => {
          if (cancelled) return;
          setChats(rows);
          setLoading(false);
          setError(null);
          refreshUnreadCounts(rows).catch(() => {});
        },
        (snapshotError) => {
          if (cancelled) return;
          const raw = snapshotError.message || "";
          const friendly =
            raw.includes("permission-denied") || raw.includes("PERMISSION_DENIED")
              ? t("business.chat.permissionDeniedFriendly")
              : raw || t("business.chat.error");
          setError(friendly);
          setLoading(false);
        },
        { teamMemberUids: teamUids }
      );
      if (cancelled) unsubscribe();
      else cleanupRef.current = unsubscribe;
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [activeBusinessOrgId, refreshUnreadCounts, reloadToken, t, uid]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessOrgId || !uid) return;

    listChatTeamMembers(activeBusinessOrgId, uid)
      .then((rows) => {
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const m of rows) next.set(m.uid, m.displayName);
        setMemberNames(next);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeBusinessOrgId, uid]);

  const rows = useMemo(() => {
    if (error) return [];
    if (chats.length > 0) return chats;
    if (!activeBusinessOrgId) return [];
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
  }, [activeBusinessOrgId, chats, error, t]);

  const retryLoad = () => setReloadToken((n) => n + 1);

  if (loading || healing) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#EA580C" />
        <Text style={styles.loadingText}>{t("business.chat.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t("business.chat.title")}</Text>
        {canWriteChat ? (
          <Pressable
            style={styles.composeBtn}
            onPress={() => nav.navigate("BusinessChatCompose")}
            accessibilityLabel={t("business.chat.compose")}
          >
            <Ionicons name="create-outline" size={22} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={retryLoad}>
            <Text style={styles.retryText}>{t("home.retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {rows.length === 0 && !error ? (
        <Text style={styles.emptyText}>{t("business.chat.empty")}</Text>
      ) : (
        rows.map((chat) => {
          const unread = unreadByChatId[chat.id] ?? 0;
          const title = resolveChatTitle(chat, uid, t, memberNames);
          const isDirect = chat.type === "direct";
          return (
            <Pressable
              key={chat.id}
              style={styles.card}
              onPress={() =>
                nav.navigate("BusinessChatRoom", {
                  orgId: chat.orgId,
                  chatId: chat.id,
                  title,
                })
              }
            >
              <View style={styles.cardHead}>
                <View style={styles.iconWrap}>
                  <Ionicons
                    name={isDirect ? "person-outline" : "chatbubbles-outline"}
                    size={20}
                    color="#1E3A8A"
                  />
                </View>
                <View style={styles.mainCol}>
                  <Text style={styles.chatTitle}>{title}</Text>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {chat.lastMessageText || t("business.chat.noMessages")}
                  </Text>
                </View>
                <View style={styles.sideCol}>
                  <Text style={styles.timeText}>{formatChatListTime(chat.lastMessageAt)}</Text>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  composeBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
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
    flex: 1,
  },
  errorText: {
    color: "#FECACA",
    fontSize: 13,
    marginBottom: 4,
  },
  errorBlock: {
    gap: 10,
    marginBottom: 8,
  },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#EA580C",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
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
