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
try {
  SpeechRecognition = require("expo-speech-recognition");
} catch (e) {
  // expo-speech-recognition not installed
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

  const speechLang = LOCALE_MAP[locale] ?? "en-US";

  useEffect(() => {
    if (visible) {
      setText(initialText);
      setRecordingUri(initialRecordingUri);
      setIsRecording(false);
      transcriptRef.current = "";
    }
  }, [visible, initialText, initialRecordingUri]);

  useEffect(() => {
    return () => {
      resultListenerRef.current?.remove();
      endListenerRef.current?.remove();
      if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
        SpeechRecognition.ExpoSpeechRecognitionModule.abort().catch(() => {});
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (SpeechRecognition?.ExpoSpeechRecognitionModule) {
      SpeechRecognition.ExpoSpeechRecognitionModule.abort().catch(() => {});
    }
    resultListenerRef.current?.remove();
    endListenerRef.current?.remove();
    setText(initialText);
    setRecordingUri(initialRecordingUri);
    setIsRecording(false);
    onClose();
  }, [initialText, initialRecordingUri, onClose]);

  const handleConfirm = useCallback(() => {
    onConfirm(text.trim(), recordingUri);
    setText("");
    setRecordingUri(null);
    setIsRecording(false);
    onClose();
  }, [text, recordingUri, onConfirm, onClose]);

  const handlePressIn = useCallback(async () => {
    if (!SpeechRecognition?.ExpoSpeechRecognitionModule) {
      Alert.alert(t("common.error"), t("projectOverview.voiceRecordingNotAvailable"));
      return;
    }
    try {
      const result = await SpeechRecognition.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert(t("common.error"), t("projectOverview.audioPermissionRequired"));
        return;
      }
      const available = await SpeechRecognition.ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        Alert.alert(t("common.error"), t("projectOverview.voiceRecordingNotAvailable"));
        return;
      }
      transcriptRef.current = "";
      setIsRecording(true);
      setIsTranscribing(true);

      resultListenerRef.current?.remove();
      endListenerRef.current?.remove();

      resultListenerRef.current = SpeechRecognition.ExpoSpeechRecognitionModule.addListener(
        "result",
        (event: { results: Array<{ transcript?: string }>; isFinal?: boolean }) => {
          const transcript = event.results?.[0]?.transcript ?? "";
          if (transcript) {
            if (event.isFinal) {
              transcriptRef.current = (transcriptRef.current ? transcriptRef.current + " " : "") + transcript;
            } else {
              transcriptRef.current = transcript; // interim, overwritten by final
            }
          }
        }
      );

      endListenerRef.current = SpeechRecognition.ExpoSpeechRecognitionModule.addListener(
        "end",
        () => {
          setIsRecording(false);
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
    } catch (error: any) {
      setIsRecording(false);
      setIsTranscribing(false);
      Alert.alert(t("common.error"), t("projectOverview.failedToStartRecording", { error: error.message || t("common.unknown") }));
    }
  }, [t, speechLang]);

  const handlePressOut = useCallback(async () => {
    if (!SpeechRecognition?.ExpoSpeechRecognitionModule || !isRecording) return;
    try {
      await SpeechRecognition.ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      // ignore
    }
  }, [isRecording]);

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
            {SpeechRecognition ? (
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
    fontSize: 12,
    color: colors.primary,
    marginTop: spacing.xs,
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
