import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";

let SpeechRecognition: typeof import("expo-speech-recognition") | null = null;
let AudioModule: typeof import("expo-av") | null = null;
try {
  SpeechRecognition = require("expo-speech-recognition");
} catch (e) {
  // expo-speech-recognition not installed
}
try {
  AudioModule = require("expo-av");
} catch (e) {
  // expo-av not installed
}

const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  sk: "sk-SK",
  de: "de-DE",
  cs: "cs-CZ",
  es: "es-ES",
  it: "it-IT",
  pl: "pl-PL",
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (text: string, recordingUri?: string | null) => void;
  initialText?: string;
  initialRecordingUri?: string | null;
  placeholder?: string;
  title?: string;
};

export function DescriptionInputModal({
  visible,
  onClose,
  onConfirm,
  initialText = "",
  initialRecordingUri = null,
  placeholder,
  title,
}: Props) {
  const { t, locale } = useI18n();
  const [text, setText] = useState(initialText);
  const [recordingUri, setRecordingUri] = useState<string | null>(initialRecordingUri);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const transcriptRef = useRef("");
  const resultListenerRef = useRef<{ remove: () => void } | null>(null);
  const endListenerRef = useRef<{ remove: () => void } | null>(null);
  const recordingRef = useRef<import("expo-av").Recording | null>(null);

  const speechLang = LOCALE_MAP[locale] ?? "en-US";

  const stopRecordingAndGetUri = useCallback(async (): Promise<string | null> => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec || !AudioModule) return null;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      return uri ?? null;
    } catch (e: any) {
      const code = String(e?.code ?? "").toLowerCase();
      if (code === "e_audio_nodata") return null; // Too short on Android
      console.warn("[DescriptionInputModal] Stop recording error:", e);
      return null;
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setText(initialText);
      setRecordingUri(initialRecordingUri);
      setIsRecording(false);
      transcriptRef.current = "";
    }
  }, [visible, initialText, initialRecordingUri]);

  const safeCatch = useCallback((p: unknown) => {
    if (p != null && typeof (p as Promise<unknown>)?.catch === "function") {
      (p as Promise<unknown>).catch(() => {});
    }
  }, []);

  useEffect(() => {
    return () => {
      resultListenerRef.current?.remove();
      endListenerRef.current?.remove();
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        safeCatch(SpeechRecognition.ExpoSpeechRecognitionModule.abort());
      }
      safeCatch(recordingRef.current?.stopAndUnloadAsync());
      recordingRef.current = null;
    };
  }, [safeCatch]);

  const handleClose = useCallback(async () => {
    if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
      safeCatch(SpeechRecognition.ExpoSpeechRecognitionModule.abort());
    }
    resultListenerRef.current?.remove();
    endListenerRef.current?.remove();
    if (recordingRef.current) {
      await stopRecordingAndGetUri();
    }
    setText(initialText);
    setRecordingUri(initialRecordingUri);
    setIsRecording(false);
    onClose();
  }, [initialText, initialRecordingUri, onClose, stopRecordingAndGetUri, safeCatch]);

  const handleConfirm = useCallback(() => {
    onConfirm(text.trim(), recordingUri);
    setText("");
    setRecordingUri(null);
    setIsRecording(false);
    onClose();
  }, [text, recordingUri, onConfirm, onClose]);

  const handlePressIn = useCallback(async () => {
    if (!AudioModule?.Audio) {
      Alert.alert(t("common.error"), t("projectOverview.voiceRecordingNotAvailable"));
      return;
    }
    try {
      // Ensure no previous Recording exists (expo-av allows only one at a time)
      if (recordingRef.current) {
        await stopRecordingAndGetUri();
      }
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        safeCatch(SpeechRecognition.ExpoSpeechRecognitionModule.abort());
      }

      const { status } = await AudioModule.Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("common.error"), t("projectOverview.audioPermissionRequired"));
        return;
      }
      await AudioModule.Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      transcriptRef.current = "";
      setIsRecording(true);
      setIsTranscribing(!!SpeechRecognition?.ExpoSpeechRecognitionModule);

      const { recording } = await AudioModule.Audio.Recording.createAsync(
        AudioModule.Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;

      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        const avail = await SpeechRecognition.ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (avail) {
          const perm = await SpeechRecognition.ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (perm.granted) {
            resultListenerRef.current?.remove();
            endListenerRef.current?.remove();
            resultListenerRef.current = SpeechRecognition.ExpoSpeechRecognitionModule.addListener(
              "result",
              (event: { results: Array<{ transcript?: string }>; isFinal?: boolean }) => {
                const transcript = event.results?.[0]?.transcript ?? "";
                if (transcript) {
                  // API sends full transcript each time; replace to avoid duplication
                  transcriptRef.current = transcript;
                }
              }
            );
            endListenerRef.current = SpeechRecognition.ExpoSpeechRecognitionModule.addListener(
              "end",
              () => {
                setIsTranscribing(false);
                if (transcriptRef.current) {
                  setText((prev) => (prev ? `${prev} ${transcriptRef.current}` : transcriptRef.current));
                }
                resultListenerRef.current?.remove();
                endListenerRef.current?.remove();
              }
            );
            await SpeechRecognition.ExpoSpeechRecognitionModule.start({
              lang: speechLang,
              interimResults: true,
              continuous: true,
            });
          } else {
            setIsTranscribing(false);
          }
        } else {
          setIsTranscribing(false);
        }
      }
    } catch (error: any) {
      safeCatch(recordingRef.current?.stopAndUnloadAsync());
      recordingRef.current = null;
      setIsRecording(false);
      setIsTranscribing(false);
      Alert.alert(t("common.error"), t("projectOverview.failedToStartRecording", { error: error.message || t("common.unknown") }));
    }
  }, [t, speechLang, safeCatch, stopRecordingAndGetUri]);

  const handlePressOut = useCallback(async () => {
    if (!isRecording) return;
    try {
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        await SpeechRecognition.ExpoSpeechRecognitionModule.stop();
      }
      const uri = await stopRecordingAndGetUri();
      if (uri) setRecordingUri(uri);
    } catch (e) {
      await stopRecordingAndGetUri();
    } finally {
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [isRecording, stopRecordingAndGetUri]);

  const hasContent = text.trim().length > 0 || !!recordingUri;
  const displayTitle = title ?? t("projectOverview.descriptionModalTitle");

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{displayTitle}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder={placeholder ?? t("projectOverview.descriptionPlaceholder")}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />

          <View style={styles.actions}>
            {AudioModule?.Audio ? (
              <Pressable
                style={({ pressed }) => [
                  styles.holdRecordBtn,
                  (isRecording || pressed) && styles.holdRecordBtnActive,
                ]}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                delayLongPress={0}
              >
                {isTranscribing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name="mic"
                    size={40}
                    color={isRecording ? "#fff" : colors.primary}
                  />
                )}
                <Text style={[styles.holdRecordText, isRecording && styles.holdRecordTextActive]}>
                  {isRecording ? t("projectOverview.recording") : t("projectOverview.holdToRecord")}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.holdRecordUnavailable}>{t("projectOverview.voiceRecordingNotAvailable")}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.validateBtn, !hasContent && styles.validateBtnDisabled]}
            onPress={handleConfirm}
            disabled={!hasContent}
          >
            <Text style={styles.validateBtnText}>{t("projectOverview.validateDescription")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  closeBtn: {
    padding: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 120,
    marginBottom: spacing.md,
  },
  actions: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  holdRecordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.primary,
  },
  holdRecordBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  holdRecordText: {
    fontSize: 14,
    color: colors.textOnDark,
    marginTop: spacing.xs,
    fontWeight: "500",
  },
  holdRecordTextActive: {
    color: "#fff",
  },
  holdRecordUnavailable: {
    fontSize: 14,
    color: colors.textMuted,
  },
  validateBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  validateBtnDisabled: {
    opacity: 0.5,
  },
  validateBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
