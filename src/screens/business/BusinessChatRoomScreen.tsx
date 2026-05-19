import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../../i18n/I18nContext";
import { useActiveOrg } from "../../hooks/useActiveOrg";
import { getAuth } from "../../firebase";
import {
  ensureGeneralChat,
  listenChatMessages,
  markChatRead,
  sendImageMessage,
  sendTextMessage,
  type BusinessChatMessageDoc,
} from "../../services/businessChat";
import { useOrgAccess } from "../../hooks/useOrgAccess";

type ChatRouteParams = {
  orgId?: string;
  chatId?: string;
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
  const { activeBusinessOrgId } = useActiveOrg();
  const { isViewer, canAccessBusinessChat } = useOrgAccess();
  const [messages, setMessages] = useState<BusinessChatMessageDoc[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<BusinessChatMessageDoc> | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  const orgId = params.orgId ?? activeBusinessOrgId ?? "";
  const chatId = params.chatId ?? "general";
  const chatTitle = params.title || t("business.chat.generalTitle");
  const uid = getAuth()?.currentUser?.uid ?? "";

  const refreshRead = useCallback(async () => {
    if (!orgId || !chatId) return;
    try {
      await markChatRead({ orgId, chatId });
    } catch {
      // Read marker is best effort in MVP.
    }
  }, [chatId, orgId]);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setLoading(false);
      setError(t("business.chat.error"));
      return;
    }
    setLoading(true);
    setError(null);
    ensureGeneralChat(orgId)
      .then(() => {
        if (cancelled) return;
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
            setError(snapshotError.message || t("business.chat.error"));
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
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [chatId, orgId, refreshRead, t]);

  const canWriteChat = canAccessBusinessChat && !isViewer;
  const canSend = canWriteChat && input.trim().length > 0 && !sending && !uploadingPhoto;

  const onSend = async () => {
    if (!canWriteChat) return;
    if (!canSend || !orgId || !chatId) return;
    setSending(true);
    setError(null);
    const textToSend = input.trim();
    setInput("");
    try {
      await sendTextMessage({ orgId, chatId, text: textToSend });
      await refreshRead();
      requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || t("business.chat.error"));
      setInput(textToSend);
    } finally {
      setSending(false);
    }
  };

  const onPickPhoto = useCallback(async () => {
    if (!canWriteChat || !orgId || !chatId) {
      Alert.alert(t("business.chat.noAccessTitle"), t("business.chat.noAccessBody"));
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("business.chat.noAccessTitle"), t("business.chat.error"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    setError(null);
    try {
      await sendImageMessage({
        orgId,
        chatId,
        localUri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      await refreshRead();
      requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || t("business.chat.error"));
    } finally {
      setUploadingPhoto(false);
    }
  }, [canWriteChat, chatId, orgId, refreshRead, t]);

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
                  {item.type === "image" && item.imageUrl ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.chatImage}
                      resizeMode="cover"
                      accessibilityLabel="Photo"
                    />
                  ) : (
                    <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther]}>
                      {item.text}
                    </Text>
                  )}
                </View>
                <Text style={styles.time}>{formatMessageTime(item.createdAt)}</Text>
              </View>
            );
          }}
        />
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={64}>
        <View style={[styles.inputWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable
            style={[styles.photoBtn, (!canWriteChat || uploadingPhoto) && styles.photoBtnDisabled]}
            onPress={onPickPhoto}
            disabled={!canWriteChat || uploadingPhoto || sending}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color="#1E3A8A" />
            ) : (
              <Ionicons name="image-outline" size={22} color="#1E3A8A" />
            )}
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t("business.chat.inputPlaceholder")}
            placeholderTextColor="#94A3B8"
            multiline
            style={styles.input}
            maxLength={1200}
            editable={canWriteChat && !uploadingPhoto}
          />
          <Pressable style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]} disabled={!canSend} onPress={onSend}>
            <Text style={styles.sendText}>{t("business.chat.send")}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </KeyboardAvoidingView>
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
  chatImage: {
    width: 220,
    height: 165,
    borderRadius: 10,
    backgroundColor: "#E2E8F0",
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
  photoBtnDisabled: {
    opacity: 0.45,
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
