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
  Switch,
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

let SpeechRecognition: typeof import("expo-speech-recognition") | null = null;
function ensureSpeechModule(): void {
  if (SpeechRecognition) return;
  try {
    SpeechRecognition = require("expo-speech-recognition");
  } catch {
    /* optional */
  }
}

const SPEECH_LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  sk: "sk-SK",
  de: "de-DE",
  cs: "cs-CZ",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
};

const MAX_ATTACHMENTS = 5;
const { height: SCREEN_H } = Dimensions.get("window");

export type QuickNoteSubmitOptions = {
  shareWithManager?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (
    text: string,
    attachments?: QuickNoteAttachment[],
    options?: QuickNoteSubmitOptions
  ) => Promise<void>;
  placeholder?: string;
  saveLabel?: string;
  /** Show toggle to share note with manager (field workers). */
  showShareWithManager?: boolean;
  /** Default for share toggle when modal opens (defaults to showShareWithManager). */
  defaultShareWithManager?: boolean;
};

export function QuickNoteModal({
  visible,
  onClose,
  onSaved,
  onSubmit,
  placeholder = "Čo si chcete zapamätať?",
  saveLabel = "Uložiť",
  showShareWithManager = false,
  defaultShareWithManager,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<QuickNoteAttachment[]>([]);
  const [shareWithManager, setShareWithManager] = useState(
    defaultShareWithManager ?? showShareWithManager
  );
  const [saving, setSaving] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [picking, setPicking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const baseTextRef = useRef("");
  const transcriptRef = useRef("");
  const resultListenerRef = useRef<{ remove: () => void } | null>(null);
  const endListenerRef = useRef<{ remove: () => void } | null>(null);
  const errorListenerRef = useRef<{ remove: () => void } | null>(null);

  const speechLang = SPEECH_LOCALE_MAP[locale] ?? "en-US";

  const safeCatch = useCallback((p: unknown) => {
    if (p != null && typeof (p as Promise<unknown>)?.catch === "function") {
      (p as Promise<unknown>).catch(() => {});
    }
  }, []);

  const cleanupListeners = useCallback(() => {
    resultListenerRef.current?.remove();
    endListenerRef.current?.remove();
    errorListenerRef.current?.remove();
    resultListenerRef.current = null;
    endListenerRef.current = null;
    errorListenerRef.current = null;
  }, []);

  useEffect(() => {
    if (visible) {
      ensureSpeechModule();
      setText("");
      setAttachments([]);
      setShareWithManager(defaultShareWithManager ?? showShareWithManager);
      setSaving(false);
      setKeyboardOffset(0);
      setIsRecording(false);
      transcriptRef.current = "";
      baseTextRef.current = "";
      setTimeout(() => inputRef.current?.focus(), 350);
    } else {
      cleanupListeners();
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        safeCatch(SpeechRecognition.ExpoSpeechRecognitionModule.abort());
      }
    }
  }, [visible, cleanupListeners, safeCatch, defaultShareWithManager, showShareWithManager]);

  useEffect(() => {
    return () => {
      cleanupListeners();
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        safeCatch(SpeechRecognition.ExpoSpeechRecognitionModule.abort());
      }
    };
  }, [cleanupListeners, safeCatch]);

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

  const startVoice = useCallback(async () => {
    ensureSpeechModule();
    const Mod = SpeechRecognition?.ExpoSpeechRecognitionModule;
    if (!Mod) {
      setVoiceUnavailable(true);
      return;
    }
    try {
      const avail = await Mod.isRecognitionAvailable();
      if (!avail) {
        setVoiceUnavailable(true);
        return;
      }
      const perm = await Mod.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t("common.error") || "Chyba",
          t("projectOverview.audioPermissionRequired") || "Microphone permission required."
        );
        return;
      }
      cleanupListeners();
      transcriptRef.current = "";
      baseTextRef.current = text;
      setIsRecording(true);

      resultListenerRef.current = Mod.addListener(
        "result",
        (event: { results: Array<{ transcript?: string }>; isFinal?: boolean }) => {
          const transcript = event.results?.[0]?.transcript ?? "";
          if (!transcript) return;
          transcriptRef.current = transcript;
          const base = baseTextRef.current;
          const merged = base ? `${base} ${transcript}` : transcript;
          setText(merged);
        }
      );
      endListenerRef.current = Mod.addListener("end", () => {
        setIsRecording(false);
        cleanupListeners();
      });
      errorListenerRef.current = Mod.addListener("error", () => {
        setIsRecording(false);
        cleanupListeners();
      });

      await Mod.start({
        lang: speechLang,
        interimResults: true,
        continuous: true,
      });
    } catch (e) {
      if (__DEV__) console.warn("[QuickNoteModal] startVoice failed:", e);
      setIsRecording(false);
      cleanupListeners();
    }
  }, [cleanupListeners, speechLang, t, text]);

  const stopVoice = useCallback(async () => {
    const Mod = SpeechRecognition?.ExpoSpeechRecognitionModule;
    if (!Mod) {
      setIsRecording(false);
      return;
    }
    try {
      await Mod.stop();
    } catch (e) {
      try {
        await Mod.abort();
      } catch {
        /* ignore */
      }
    } finally {
      setIsRecording(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || saving) return;
    setSaving(true);
    try {
      await onSubmit(trimmed, attachments.length > 0 ? attachments : undefined, {
        shareWithManager: showShareWithManager ? shareWithManager : undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      if (__DEV__) console.warn("[QuickNoteModal] save failed:", e);
      Alert.alert(t("common.error") || "Error", t("quickNote.saveFailed") || "Could not save note.");
    } finally {
      setSaving(false);
    }
  }, [text, attachments, saving, onSubmit, onSaved, onClose, showShareWithManager, shareWithManager]);

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
              <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
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
                    <Ionicons name="images-outline" size={24} color="#c85528" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Ionicons name="close" size={24} color="#475569" />
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

              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  style={[styles.input, styles.inputWithMic]}
                  value={text}
                  onChangeText={setText}
                  placeholder={placeholder}
                  placeholderTextColor={colors.inputPlaceholderOnLight}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  editable={!saving}
                  returnKeyType="default"
                />
                {!voiceUnavailable ? (
                  <TouchableOpacity
                    style={[styles.micBtn, isRecording && styles.micBtnActive]}
                    onPressIn={() => {
                      void startVoice();
                    }}
                    onPressOut={() => {
                      void stopVoice();
                    }}
                    disabled={saving}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={isRecording ? "Recording, release to stop" : "Hold to record"}
                    accessibilityHint="Hold to record voice note, release to transcribe"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={isRecording ? "mic" : "mic-outline"}
                      size={22}
                      color="#fff"
                    />
                    {isRecording ? <View style={styles.micPulseDot} /> : null}
                  </TouchableOpacity>
                ) : null}
              </View>
              {isRecording ? (
                <Text style={styles.micHint} maxFontSizeMultiplier={1.2}>
                  ● {t("projectOverview.recording") || "Recording"}…
                </Text>
              ) : null}

              {showShareWithManager ? (
                <View style={[styles.shareRow, shareWithManager && styles.shareRowActive]}>
                  <View style={styles.shareIconWrap}>
                    <Ionicons
                      name={shareWithManager ? "people" : "people-outline"}
                      size={20}
                      color={shareWithManager ? colors.primary : "#64748b"}
                    />
                  </View>
                  <View style={styles.shareRowText}>
                    <Text style={styles.shareLabel}>{t("quickNote.shareWithManager")}</Text>
                    <Text style={styles.shareHint}>{t("quickNote.shareWithManagerHint")}</Text>
                  </View>
                  <Switch
                    value={shareWithManager}
                    onValueChange={setShareWithManager}
                    trackColor={{ false: "#cbd5e1", true: "#f4b494" }}
                    thumbColor={shareWithManager ? colors.primary : "#f8fafc"}
                    ios_backgroundColor="#cbd5e1"
                    accessibilityLabel={t("quickNote.shareWithManager")}
                  />
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.saveBtn, canSave ? styles.saveBtnEnabled : styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.88}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextDisabled]}>{saveLabel}</Text>
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
    backgroundColor: "rgba(15,23,42,0.55)",
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
    backgroundColor: "#ffffff",
    borderTopLeftRadius: radius + 4,
    borderTopRightRadius: radius + 4,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
    marginBottom: spacing.md,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(224,103,55,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachIconBtnDisabled: { opacity: 0.45 },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
    marginRight: spacing.sm,
    letterSpacing: -0.2,
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
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 17,
    lineHeight: 24,
    color: "#0f172a",
    minHeight: 112,
    maxHeight: 180,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
  inputWithMic: {
    flex: 1,
    marginBottom: 0,
  },
  micBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#c85528",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  micBtnActive: {
    backgroundColor: "#dc2626",
    transform: [{ scale: 1.08 }],
  },
  micPulseDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
  },
  micHint: {
    fontSize: 13,
    color: "#dc2626",
    fontWeight: "600",
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#f1f5f9",
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  shareRowActive: {
    backgroundColor: "rgba(224,103,55,0.08)",
    borderColor: "rgba(224,103,55,0.35)",
  },
  shareIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  shareRowText: {
    flex: 1,
    minWidth: 0,
  },
  shareLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  shareHint: {
    marginTop: 3,
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  saveBtn: {
    paddingVertical: spacing.md + 2,
    borderRadius: radius,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  saveBtnEnabled: {
    backgroundColor: "#c85528",
    shadowColor: "#c85528",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  saveBtnDisabled: {
    backgroundColor: "#e2e8f0",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  saveBtnTextDisabled: {
    color: "#64748b",
    fontWeight: "700",
  },
});
