import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { useOrgAccess } from "../../hooks/useOrgAccess";
import { getAuth } from "../../firebase";
import {
  ensureDirectChat,
  ensureGeneralChat,
  listenChatMessages,
  markChatRead,
  sendTextMessage,
  type BusinessChatMessageDoc,
} from "../../services/businessChat";

type ChatRouteParams = {
  orgId?: string;
  chatId?: string;
  chatType?: "general" | "direct";
  otherUserId?: string;
  title?: string;
};

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

function formatMessageTime(raw: unknown): string {
  const ms = toMillis(raw);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function BusinessChatRoomScreen() {
  const route = useRoute();
  const params = (route.params ?? {}) as ChatRouteParams;
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();
  const { canAccessBusiness } = useOrgAccess();
  const [messages, setMessages] = useState<BusinessChatMessageDoc[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedChatId, setResolvedChatId] = useState<string>("");
  const flatListRef = useRef<FlatList<BusinessChatMessageDoc> | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  const orgId = params.orgId ?? activeBusinessOrgId ?? "";
  const chatType = params.chatType === "direct" ? "direct" : "general";
  const routeChatId = params.chatId ?? (chatType === "general" ? "general" : "");
  const otherUserId = params.otherUserId ?? "";
  const chatTitle =
    params.title || (chatType === "direct" ? t("business.chat.directChat") : t("business.chat.companyChatTitle"));
  const uid = getAuth()?.currentUser?.uid ?? "";
  const canOpenBusinessChat = Boolean(
    activeBusinessOrgId &&
      canAccessBusiness &&
      activeOrganization &&
      activeMembership?.status === "active" &&
      orgId &&
      orgId === activeBusinessOrgId
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

  const refreshRead = useCallback(async () => {
    if (!orgId || !resolvedChatId) return;
    try {
      await markChatRead({ orgId, chatId: resolvedChatId });
    } catch {
      // Read marker is best effort in MVP.
    }
  }, [orgId, resolvedChatId]);

  useEffect(() => {
    let cancelled = false;
    if (!orgId || !canOpenBusinessChat) {
      setLoading(false);
      setResolvedChatId("");
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const ensureChat = async () => {
      if (chatType === "direct") {
        if (!otherUserId.trim()) {
          throw new Error("business-chat/no-access");
        }
        return ensureDirectChat(orgId, otherUserId);
      }
      await ensureGeneralChat(orgId);
      return routeChatId || "general";
    };
    ensureChat()
      .then((chatId) => {
        if (cancelled) return;
        setResolvedChatId(chatId);
        return listenChatMessages(
          orgId,
          chatId,
          (rows) => {
            if (cancelled) return;
            setMessages(rows.filter((m) => !m.deletedAt));
            setLoading(false);
            void refreshRead();
            requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: false }));
          },
          (snapshotError) => {
            if (cancelled) return;
            setError(mapFriendlyError(snapshotError));
            setLoading(false);
          }
        );
      })
      .then((unsubscribe) => {
        if (!unsubscribe) return;
        cleanupRef.current = unsubscribe;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(mapFriendlyError(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [canOpenBusinessChat, chatType, mapFriendlyError, orgId, otherUserId, refreshRead, routeChatId]);

  const canSend = canOpenBusinessChat && resolvedChatId.length > 0 && input.trim().length > 0 && !sending;

  const onSend = async () => {
    if (!canSend || !orgId || !resolvedChatId) return;
    setSending(true);
    setError(null);
    const textToSend = input.trim();
    setInput("");
    try {
      await sendTextMessage({ orgId, chatId: resolvedChatId, text: textToSend });
      await refreshRead();
      requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(mapFriendlyError(e));
      setInput(textToSend);
    } finally {
      setSending(false);
    }
  };

  const data = useMemo(() => messages, [messages]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>{chatTitle}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#EA580C" />
          <Text style={styles.loadingText}>{t("business.chat.loading")}</Text>
        </View>
      ) : !canOpenBusinessChat ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.emptyText}>{t("business.chat.noAccessBody")}</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesContent}
          ListEmptyComponent={<Text style={styles.emptyText}>{t("business.chat.noMessages")}</Text>}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.senderUid === uid;
            return (
              <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowOther]}>
                {!mine ? (
                  <Text style={styles.senderName} numberOfLines={1}>
                    {item.senderName || item.senderEmail || "User"}
                  </Text>
                ) : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther]}>
                    {item.text}
                  </Text>
                </View>
                <Text style={styles.time}>{formatMessageTime(item.createdAt)}</Text>
              </View>
            );
          }}
        />
      )}

      {canOpenBusinessChat ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={64}>
          <View style={[styles.inputWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <Pressable
              style={styles.photoBtn}
              onPress={() =>
                Alert.alert(t("business.chat.photoComingSoonTitle"), t("business.chat.photoComingSoonBody"))
              }
            >
              <Ionicons name="image-outline" size={22} color="#1E3A8A" />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t("business.chat.inputPlaceholder")}
              placeholderTextColor="#94A3B8"
              multiline
              style={styles.input}
              maxLength={1200}
            />
            <Pressable style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} disabled={!canSend} onPress={onSend}>
              <Text style={styles.sendText}>{t("business.chat.send")}</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0E1D3A",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: "#E2E8F0",
    marginTop: 10,
    fontWeight: "600",
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  emptyText: {
    color: "#CBD5E1",
    textAlign: "center",
    marginTop: 20,
  },
  messageRow: {
    maxWidth: "86%",
  },
  messageRowMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  messageRowOther: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  senderName: {
    color: "#CBD5E1",
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleMine: {
    backgroundColor: "#EA580C",
    borderBottomRightRadius: 6,
  },
  bubbleOther: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageTextMine: {
    color: "#FFFFFF",
  },
  messageTextOther: {
    color: "#0F172A",
  },
  time: {
    marginTop: 3,
    color: "#94A3B8",
    fontSize: 11,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: "#0B1730",
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.25)",
    gap: 8,
  },
  photoBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0F172A",
    fontSize: 15,
  },
  sendBtn: {
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EA580C",
    marginBottom: 6,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  errorText: {
    color: "#FECACA",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
});
