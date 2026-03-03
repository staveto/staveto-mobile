/**
 * FeedbackModal – collect user feedback (bug/idea/other) with metadata.
 * Writes to Firestore `feedback` collection. Analytics: feedback_opened, feedback_submitted (no message text).
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Switch,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { logEventSafe } from "../services/analytics";
import { submitFeedback, type FeedbackType } from "../services/feedbackService";

const MIN_MESSAGE_LENGTH = 10;

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  source?: string;
  userId: string;
  orgId?: string | null;
  currentScreen?: string;
  actionContext?: string;
}

const FEEDBACK_TYPES: { value: FeedbackType; labelKey: string }[] = [
  { value: "bug", labelKey: "feedback.typeBug" },
  { value: "idea", labelKey: "feedback.typeIdea" },
  { value: "other", labelKey: "feedback.typeOther" },
];

export function FeedbackModal({
  visible,
  onClose,
  source = "account",
  userId,
  orgId,
  currentScreen,
  actionContext,
}: FeedbackModalProps) {
  const { t } = useI18n();
  const [type, setType] = useState<FeedbackType>("bug");
  const [rating, setRating] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [allowContact, setAllowContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      logEventSafe("feedback_opened", { source });
    }
  }, [visible, source]);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < MIN_MESSAGE_LENGTH) {
      setError(t("feedback.messageTooShort") || `Min ${MIN_MESSAGE_LENGTH} characters`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitFeedback({
        userId,
        orgId,
        type,
        rating,
        message: trimmed,
        allowContact,
        context: { screen: currentScreen, action: actionContext },
      });
      logEventSafe("feedback_submitted", { type, ...(rating != null && { rating }) });
      setMessage("");
      setRating(undefined);
      setType("bug");
      setAllowContact(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("feedback.title") || "Send Feedback"}</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={28} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>{t("feedback.typeLabel") || "Type"}</Text>
            <View style={styles.typeRow}>
              {FEEDBACK_TYPES.map(({ value, labelKey }) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.typeChip, type === value && styles.typeChipActive]}
                  onPress={() => setType(value)}
                >
                  <Text style={[styles.typeChipText, type === value && styles.typeChipTextActive]}>
                    {t(labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t("feedback.ratingLabel") || "Rating (optional)"}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setRating(rating === n ? undefined : n)}
                  style={styles.star}
                >
                  <Ionicons
                    name={rating != null && n <= rating ? "star" : "star-outline"}
                    size={32}
                    color={rating != null && n <= rating ? "#FFB800" : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t("feedback.messageLabel") || "Message (required, min 10 chars)"}</Text>
            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder={t("feedback.messagePlaceholder") || "Describe your feedback..."}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={2000}
            />

            <View style={styles.allowRow}>
              <Text style={styles.allowLabel}>{t("feedback.allowContact") || "Allow contact"}</Text>
              <Switch
                value={allowContact}
                onValueChange={setAllowContact}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitText}>{t("feedback.submit") || "Submit"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius * 2,
    borderTopRightRadius: radius * 2,
    maxHeight: "90%",
    paddingBottom: Platform.OS === "ios" ? 34 : spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  scroll: {
    padding: spacing.lg,
    maxHeight: 400,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  typeChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.border + "40",
  },
  typeChipActive: {
    backgroundColor: colors.primary,
  },
  typeChipText: {
    fontSize: 14,
    color: colors.text,
  },
  typeChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  ratingRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  star: {
    padding: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 100,
    marginBottom: spacing.lg,
  },
  allowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  allowLabel: {
    fontSize: 16,
    color: colors.text,
  },
  error: {
    fontSize: 14,
    color: "#FF5722",
    marginBottom: spacing.md,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: radius,
    backgroundColor: colors.border + "60",
  },
  cancelText: {
    fontSize: 16,
    color: colors.text,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderRadius: radius,
    backgroundColor: colors.primary,
  },
  submitDisabled: {
    opacity: 0.7,
  },
  submitText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
