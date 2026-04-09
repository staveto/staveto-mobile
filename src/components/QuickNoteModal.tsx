import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Image,
  Alert,
  Dimensions,
  ActionSheetIOS,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { persistQuickNoteMedia, type QuickNoteAttachment } from "../services/quickNotes";

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  /* optional */
}

const MAX_ATTACHMENTS = 5;
const { height: SCREEN_H } = Dimensions.get("window");

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (text: string, attachments?: QuickNoteAttachment[]) => Promise<void>;
  placeholder?: string;
  saveLabel?: string;
};

export function QuickNoteModal({
  visible,
  onClose,
  onSaved,
  onSubmit,
  placeholder = "Čo si chcete zapamätať?",
  saveLabel = "Uložiť",
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<QuickNoteAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setText("");
      setAttachments([]);
      setSaving(false);
      setKeyboardOffset(0);
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subShow = Keyboard.addListener(showEv, (e) => {
      setKeyboardOffset(e.endCoordinates.height);
    });
    const subHide = Keyboard.addListener(hideEv, () => setKeyboardOffset(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  const bottomInset = keyboardOffset > 0 ? keyboardOffset : insets.bottom + spacing.lg;

  const addAttachment = useCallback(async (kind: "image" | "video", from: "camera" | "library") => {
    if (!ImagePicker) {
      Alert.alert(t("common.error") || "Chyba", t("projectOverview.galleryPermissionGeneral") || "");
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) return;
    setPicking(true);
    try {
      if (from === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            t("common.error") || "Chyba",
            t("projectOverview.galleryPermissionGeneral") || "Potrebujeme prístup ku kamere."
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes:
            kind === "video" ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
          quality: kind === "image" ? 0.85 : 1,
          videoMaxDuration: 120,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const uri = await persistQuickNoteMedia(result.assets[0].uri, kind);
        setAttachments((prev) => [...prev, { uri, kind }]);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            t("common.error") || "Chyba",
            t("projectOverview.galleryPermissionGeneral") || "Potrebujeme prístup ku galérii."
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          quality: 0.85,
          videoMaxDuration: 120,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        const mime = (asset as { mimeType?: string }).mimeType ?? "";
        const looksVideo =
          asset.type === "video" ||
          (asset.duration != null && asset.duration > 0) ||
          /video\//i.test(mime) ||
          /\.(mp4|mov|m4v)(\?|$)/i.test(asset.uri);
        const mediaKind: "image" | "video" = looksVideo ? "video" : "image";
        const uri = await persistQuickNoteMedia(asset.uri, mediaKind);
        setAttachments((prev) => [...prev, { uri, kind: mediaKind }]);
      }
    } catch (e) {
      if (__DEV__) console.warn("[QuickNoteModal] pick media failed:", e);
      Alert.alert(t("common.error") || "Chyba", t("projectOverview.galleryPermissionGeneral") || "");
    } finally {
      setPicking(false);
    }
  }, [attachments.length, t]);

  const showMediaPicker = useCallback(() => {
    if (!ImagePicker) {
      Alert.alert(t("common.error") || "Chyba", t("projectOverview.galleryPermissionGeneral") || "");
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS || picking) return;

    const takePhoto = () => {
      void addAttachment("image", "camera");
    };
    const fromGallery = () => {
      void addAttachment("image", "library");
    };

    const cancel = t("common.cancel") || "Zrušiť";
    const optPhoto = t("projectOverview.takePhoto") || "Odfotiť";
    const optGallery = t("projectOverview.selectFromGallery") || "Galéria";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [cancel, optPhoto, optGallery],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) takePhoto();
          else if (buttonIndex === 2) fromGallery();
        }
      );
    } else {
      Alert.alert("", undefined, [
        { text: cancel, style: "cancel" },
        { text: optPhoto, onPress: takePhoto },
        { text: optGallery, onPress: fromGallery },
      ]);
    }
  }, [attachments.length, picking, t, addAttachment]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || saving) return;
    setSaving(true);
    try {
      await onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
      onSaved();
      onClose();
    } catch (e) {
      if (__DEV__) console.warn("[QuickNoteModal] save failed:", e);
    } finally {
      setSaving(false);
    }
  }, [text, attachments, saving, onSubmit, onSaved, onClose]);

  const canSave = (text.trim().length > 0 || attachments.length > 0) && !saving;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheetOuter,
            {
              paddingBottom: bottomInset,
              maxHeight: SCREEN_H * 0.92,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.panel}>
              <View style={styles.header}>
                <Text style={styles.title}>{t("quickNotes.add") || "Rýchly zápis"}</Text>
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    onPress={showMediaPicker}
                    disabled={picking || attachments.length >= MAX_ATTACHMENTS}
                    style={[styles.attachIconBtn, picking && styles.attachIconBtnDisabled]}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("projectOverview.takePhoto")}, ${t("projectOverview.selectFromGallery")}`}
                  >
                    <Ionicons name="images-outline" size={26} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              {attachments.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {attachments.map((a, i) => (
                    <View key={`${a.uri}-${i}`} style={styles.thumbWrap}>
                      {a.kind === "image" ? (
                        <Image source={{ uri: a.uri }} style={styles.thumb} />
                      ) : (
                        <View style={[styles.thumb, styles.thumbVideo]}>
                          <Ionicons name="videocam" size={28} color="#fff" />
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.thumbRemove}
                        onPress={() => removeAttachment(i)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={22} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TextInput
                ref={inputRef}
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
                maxLength={500}
                editable={!saving}
                returnKeyType="default"
              />

              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>{saveLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheetOuter: {
    width: "100%",
    backgroundColor: "transparent",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  attachIconBtn: {
    padding: spacing.xs,
  },
  attachIconBtnDisabled: { opacity: 0.45 },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginRight: spacing.sm,
  },
  thumbRow: {
    marginBottom: spacing.md,
    maxHeight: 88,
  },
  thumbWrap: {
    marginRight: spacing.sm,
    position: "relative",
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radius,
    backgroundColor: colors.border,
  },
  thumbVideo: {
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRemove: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 100,
    maxHeight: 180,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
