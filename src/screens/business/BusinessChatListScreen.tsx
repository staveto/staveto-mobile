import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { getAuth } from "../../firebase";
import {
  ensureGeneralChat,
  getUnreadChatCountForChat,
  listenBusinessChatMembers,
  listenBusinessChats,
  type BusinessChatDoc,
  type BusinessChatMemberDoc,
} from "../../services/businessChat";

export function BusinessChatListScreen() {
  const navigation = useNavigation();
  const nav = navigation as unknown as { navigate: (name: string, params?: object) => void };
  const { t } = useI18n();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();
  const { canAccessBusiness } = useOrgAccess();
  const [generalChat, setGeneralChat] = useState<BusinessChatDoc | null>(null);
  const [members, setMembers] = useState<BusinessChatMemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generalUnreadCount, setGeneralUnreadCount] = useState(0);
  const cleanupChatsRef = React.useRef<(() => void) | null>(null);
  const cleanupMembersRef = React.useRef<(() => void) | null>(null);
  const uid = getAuth()?.currentUser?.uid ?? "";
  const canOpenBusinessChat = Boolean(
    activeBusinessOrgId &&
      canAccessBusiness &&
      activeOrganization &&
      activeMembership?.status === "active"
  );

  const mapFriendlyError = useCallback(
    (raw: unknown): string => {
      const message = raw instanceof Error ? raw.message : String(raw ?? "");
      if (
        message.includes("permission-denied") ||
        message.includes("firestore/permission-denied") ||
        message.includes("business-chat/no-access")
      ) {
        return t("business.chat.permissionDeniedFriendly");
      }
      return t("business.chat.error");
    },
    [t]
  );

  const refreshGeneralUnread = useCallback(
    async (chatId: string) => {
      if (!activeBusinessOrgId || !uid || !canOpenBusinessChat) {
        setGeneralUnreadCount(0);
        return;
      }
      try {
        const unread = await getUnreadChatCountForChat(activeBusinessOrgId, chatId, uid);
        setGeneralUnreadCount(unread);
      } catch {
        setGeneralUnreadCount(0);
      }
    },
    [activeBusinessOrgId, canOpenBusinessChat, uid]
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessOrgId || !canOpenBusinessChat) {
      setGeneralChat(null);
      setMembers([]);
      setGeneralUnreadCount(0);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    ensureGeneralChat(activeBusinessOrgId)
      .then(() => {
        if (cancelled) return;
        const unsubscribeChats = listenBusinessChats(
          activeBusinessOrgId,
          (rows) => {
            if (cancelled) return;
            const general = rows.find((row) => row.id === "general" || row.type === "general") ?? null;
            setGeneralChat(general);
            setLoading(false);
            if (general?.id) {
              void refreshGeneralUnread(general.id);
            } else {
              setGeneralUnreadCount(0);
            }
          },
          (snapshotError) => {
            if (cancelled) return;
            setError(mapFriendlyError(snapshotError));
            setLoading(false);
          }
        );
        if (cancelled) unsubscribeChats();
        else cleanupChatsRef.current = unsubscribeChats;

        const unsubscribeMembers = listenBusinessChatMembers(
          activeBusinessOrgId,
          (rows) => {
            if (cancelled) return;
            const visibleRows = uid ? rows.filter((row) => row.uid !== uid) : rows;
            setMembers(visibleRows);
          },
          (snapshotError) => {
            if (cancelled) return;
            setError(mapFriendlyError(snapshotError));
          }
        );
        if (cancelled) unsubscribeMembers();
        else cleanupMembersRef.current = unsubscribeMembers;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(mapFriendlyError(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      cleanupChatsRef.current?.();
      cleanupChatsRef.current = null;
      cleanupMembersRef.current?.();
      cleanupMembersRef.current = null;
    };
  }, [activeBusinessOrgId, canOpenBusinessChat, mapFriendlyError, refreshGeneralUnread, uid]);

  const companyChat = useMemo<BusinessChatDoc | null>(() => {
    if (generalChat) return generalChat;
    if (!activeBusinessOrgId || !canOpenBusinessChat) return null;
    return {
      id: "general",
      orgId: activeBusinessOrgId,
      type: "general",
      title: t("business.chat.companyChatTitle"),
      createdAt: null,
      updatedAt: null,
      lastMessageText: "",
      lastMessageAt: null,
      lastMessageByUid: null,
      participantUids: [],
    };
  }, [activeBusinessOrgId, canOpenBusinessChat, generalChat, t]);

  const memberRoleLabel = useCallback(
    (role: BusinessChatMemberDoc["role"]): string => t(`business.chat.memberRole.${role}`),
    [t]
  );

  const getInitials = useCallback((name: string): string => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }, []);

  const openGeneralChat = useCallback(() => {
    if (!companyChat) return;
    nav.navigate("BusinessChatRoom", {
      orgId: companyChat.orgId,
      chatId: companyChat.id,
      chatType: "general",
      title: companyChat.title || t("business.chat.companyChatTitle"),
    });
  }, [companyChat, nav, t]);

  const openDirectChat = useCallback(
    (member: BusinessChatMemberDoc) => {
      if (!activeBusinessOrgId) return;
      nav.navigate("BusinessChatRoom", {
        orgId: activeBusinessOrgId,
        chatType: "direct",
        otherUserId: member.uid,
        title: member.displayName || t("business.chat.directChat"),
      });
    },
    [activeBusinessOrgId, nav, t]
  );

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#EA580C" />
        <Text style={styles.loadingText}>{t("business.chat.loading")}</Text>
      </View>
    );
  }

  if (!canOpenBusinessChat) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("business.chat.inboxTitle")}</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoBody}>{t("business.chat.noAccessBody")}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Text
        style={styles.title}
        accessibilityRole="header"
        accessibilityLabel={t("business.chat.inboxTitle")}
      >
        {t("business.chat.inboxTitle")}
      </Text>
      <Text style={styles.subtitle}>{t("business.chat.inboxSubtitle")}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>{t("business.chat.workCommunication")}</Text>
      {companyChat ? (
        <Pressable style={styles.card} onPress={openGeneralChat}>
          <View style={styles.cardHead}>
            <View style={styles.iconWrap}>
              <Ionicons name="chatbubbles-outline" size={20} color="#1E3A8A" />
            </View>
            <View style={styles.mainCol}>
              <Text style={styles.chatTitle}>{t("business.chat.companyChatTitle")}</Text>
              <Text style={styles.lastMessage} numberOfLines={1}>
                {companyChat.lastMessageText || t("business.chat.companyChatSubtitle")}
              </Text>
            </View>
            <View style={styles.sideCol}>
              {generalUnreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{generalUnreadCount > 99 ? "99+" : String(generalUnreadCount)}</Text>
                </View>
              ) : null}
            </View>
          </View>
          <Text style={styles.openText}>{t("business.chat.openChat")} ›</Text>
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>{t("business.chat.teamMembers")}</Text>
      {members.length === 0 ? (
        <Text style={styles.emptyText}>{t("business.chat.noTeamMembers")}</Text>
      ) : (
        members.map((member) => (
          <Pressable key={member.id} style={styles.memberRow} onPress={() => openDirectChat(member)}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>{getInitials(member.displayName)}</Text>
            </View>
            <View style={styles.memberMain}>
              <Text style={styles.memberName}>{member.displayName}</Text>
              <Text style={styles.memberRole}>{memberRoleLabel(member.role)}</Text>
            </View>
            <Text style={styles.openTextInline}>{t("business.chat.openChat")} ›</Text>
          </Pressable>
        ))
      )}

      <View style={styles.comingSoonCard}>
        <View style={styles.comingSoonHead}>
          <Ionicons name="sparkles-outline" size={16} color="#CBD5E1" />
          <Text style={styles.comingSoonTitle}>{t("business.chat.comingSoonTitle")}</Text>
        </View>
        <Text style={styles.comingSoonBody}>{t("business.chat.comingSoonBody")}</Text>
      </View>
    </ScrollView>
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
  scrollContent: {
    paddingBottom: 24,
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
    marginBottom: 4,
  },
  subtitle: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  infoCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
  },
  infoBody: {
    color: "#E2E8F0",
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: "#FECACA",
    fontSize: 13,
    marginBottom: 4,
  },
  sectionTitle: {
    color: "#E2E8F0",
    fontWeight: "700",
    fontSize: 15,
    marginTop: 8,
    marginBottom: 2,
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
    minWidth: 20,
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
  memberRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  memberAvatarText: {
    color: "#1E3A8A",
    fontSize: 13,
    fontWeight: "800",
  },
  memberMain: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
  },
  memberRole: {
    marginTop: 2,
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  openTextInline: {
    color: "#1E3A8A",
    fontWeight: "700",
    fontSize: 13,
    marginLeft: 8,
  },
  comingSoonCard: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  comingSoonHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  comingSoonTitle: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  comingSoonBody: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18,
  },
});
