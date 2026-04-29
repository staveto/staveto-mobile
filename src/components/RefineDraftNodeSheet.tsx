import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

export type RefineDraftNodeSheetProps = {
  visible: boolean;
  /** Modal sheet title (phase vs task). */
  sheetTitle: string;
  previewLabel: string;
  previewTitle: string;
  previewDescription?: string;
  changeLabel: string;
  extraLabel: string;
  changePlaceholder?: string;
  extraPlaceholder?: string;
  submitLabel: string;
  updatingLabel: string;
  editManuallyLabel: string;
  cancelLabel: string;
  onClose: () => void;
  onSubmit: (change: string, extra: string) => Promise<void>;
  onEditManually: () => void;
};

export function RefineDraftNodeSheet({
  visible,
  sheetTitle,
  previewLabel,
  previewTitle,
  previewDescription,
  changeLabel,
  extraLabel,
  changePlaceholder,
  extraPlaceholder,
  submitLabel,
  updatingLabel,
  editManuallyLabel,
  cancelLabel,
  onClose,
  onSubmit,
  onEditManually,
}: RefineDraftNodeSheetProps) {
  const insets = useSafeAreaInsets();
  const [change, setChange] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setChange("");
      setExtra("");
      setBusy(false);
      setSubmitError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (!change.trim() || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(change.trim(), extra.trim());
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSubmitError(msg || null);
    } finally {
      setBusy(false);
    }
  };

  const dismissOverlay = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissOverlay}>
      <Pressable style={styles.overlay} onPress={dismissOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboard}
        >
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle} numberOfLines={3}>
                  {sheetTitle}
                </Text>
                <TouchableOpacity
                  onPress={dismissOverlay}
                  disabled={busy}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={26} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.previewBox}>
                <Text style={styles.previewMini}>{previewLabel}</Text>
                <Text style={styles.previewTitleText} numberOfLines={5}>
                  {previewTitle}
                </Text>
                {previewDescription?.trim() ? (
                  <Text style={styles.previewDescText} numberOfLines={12}>
                    {previewDescription.trim()}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.label}>{changeLabel}</Text>
              <TextInput
                style={styles.textArea}
                value={change}
                onChangeText={setChange}
                placeholder={changePlaceholder}
                placeholderTextColor={colors.inputPlaceholderOnLight}
                multiline
                textAlignVertical="top"
                editable={!busy}
              />

              <Text style={[styles.label, { marginTop: spacing.md }]}>{extraLabel}</Text>
              <TextInput
                style={[styles.textArea, styles.textAreaShort]}
                value={extra}
                onChangeText={setExtra}
                placeholder={extraPlaceholder}
                placeholderTextColor={colors.inputPlaceholderOnLight}
                multiline
                textAlignVertical="top"
                editable={!busy}
              />

              {submitError ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {submitError}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.primaryBtn, (!change.trim() || busy) && styles.primaryBtnDisabled]}
                onPress={() => void submit()}
                disabled={!change.trim() || busy}
                activeOpacity={0.88}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="sparkles-outline" size={20} color="#fff" />
                    <Text style={styles.primaryBtnText}>{submitLabel}</Text>
                  </>
                )}
              </TouchableOpacity>
              {busy ? <Text style={styles.hint}>{updatingLabel}</Text> : null}

              <TouchableOpacity
                style={[styles.secondaryBtn, busy && styles.secondaryBtnDisabled]}
                onPress={() => {
                  if (busy) return;
                  onEditManually();
                }}
                disabled={busy}
                activeOpacity={0.88}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
                <Text style={styles.secondaryBtnText}>{editManuallyLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={dismissOverlay} disabled={busy}>
                <Text style={[styles.cancelBtnText, busy && styles.cancelBtnTextDisabled]}>{cancelLabel}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  keyboard: {
    maxHeight: "92%",
  },
  sheet: {
    backgroundColor: colors.formPanel,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    maxHeight: Platform.OS === "ios" ? "88%" : "92%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 22,
  },
  previewBox: {
    backgroundColor: "#fff",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  previewMini: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  previewTitleText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 6,
    lineHeight: 22,
  },
  previewDescText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
    opacity: 0.92,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 6,
  },
  textArea: {
    minHeight: 100,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#fff",
  },
  textAreaShort: {
    minHeight: 72,
  },
  primaryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.text,
    textAlign: "center",
  },
  secondaryBtn: {
    marginTop: spacing.md,
    borderRadius: radius,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: "#fff",
  },
  secondaryBtnDisabled: {
    opacity: 0.45,
  },
  secondaryBtnText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  cancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  cancelBtnTextDisabled: {
    opacity: 0.45,
  },
  errorText: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },
});
