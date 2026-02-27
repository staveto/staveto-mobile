import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { getCallable, db } from "../firebase";
import { showToast } from "../helpers/toast";
import { COUNTRY_CODES, getLocalizedCountryName } from "../utils/countries";
import { doc, getDoc } from "../lib/rnFirestore";

const ALLOWED_PROJECT_TYPES = ["BUILD", "RESIDENTIAL", "TRADE", "MANAGEMENT"] as const;

type Props = {
  visible: boolean;
  onClose: () => void;
  sourceProjectId: string;
  sourceProjectName: string;
  sourceProjectType?: string;
  sourceCountryCode?: string;
  sourceCity?: string;
  sourceAddressText?: string;
  isOwner: boolean;
  onSuccess: (newProjectId: string) => void;
};

export function CloneProjectModal({
  visible,
  onClose,
  sourceProjectId,
  sourceProjectName,
  sourceProjectType,
  sourceCountryCode = "SK",
  sourceCity = "",
  sourceAddressText = "",
  isOwner,
  onSuccess,
}: Props) {
  const { t, locale } = useI18n();
  const [newName, setNewName] = useState(`${sourceProjectName} (kópia)`);
  const [newCountry, setNewCountry] = useState(sourceCountryCode || "SK");
  const [newCity, setNewCity] = useState(sourceCity || "");
  const [newAddress, setNewAddress] = useState(sourceAddressText || "");
  const [keepAssignees, setKeepAssignees] = useState(true);
  const [keepEstimates, setKeepEstimates] = useState(true);
  const [keepTags, setKeepTags] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setNewName(`${sourceProjectName} (kópia)`);
      setNewCountry(sourceCountryCode || "SK");
      setNewCity(sourceCity || "");
      setNewAddress(sourceAddressText || "");
      setKeepAssignees(true);
      setKeepEstimates(true);
      setKeepTags(true);
      setError(null);
    }
  }, [visible, sourceProjectName, sourceCountryCode, sourceCity, sourceAddressText]);

  const handleClose = useCallback(() => {
    if (!submitting) {
      setError(null);
      onClose();
    }
  }, [submitting, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!newName.trim()) {
      setError(t("createProject.nameRequired"));
      return;
    }
    if (!sourceProjectId) {
      setError(t("projects.cloneError"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (__DEV__) console.log("[CloneProjectModal] clone start, sourceProjectId:", sourceProjectId);
      // Verify project exists on server before calling CF (avoids not-found from stale cache)
      const projectSnap = await getDoc(doc(db, "projects", sourceProjectId), { source: "server" });
      if (!projectSnap.exists()) {
        if (__DEV__) console.warn("[CloneProjectModal] project not found on server:", sourceProjectId);
        setError(t("projects.cloneNotFound"));
        setSubmitting(false);
        return;
      }
      if (__DEV__) console.log("[CloneProjectModal] project exists on server, calling CF...");
      const cloneFn = getCallable<{
        sourceProjectId: string;
        newName: string;
        countryCode?: string;
        city?: string;
        addressText?: string;
        keepAssignees: boolean;
        keepEstimates: boolean;
        keepTags: boolean;
      }, { status?: string; newProjectId?: string; jobQueued?: boolean; jobId?: string }>("cloneProjectStructure");
      const result = await cloneFn({
        sourceProjectId,
        newName: newName.trim(),
        countryCode: newCountry?.trim() || undefined,
        city: newCity?.trim() || undefined,
        addressText: newAddress?.trim() || undefined,
        keepAssignees,
        keepEstimates,
        keepTags,
      });
      const data = result.data;
      if (data?.status === "done" && data.newProjectId) {
        onSuccess(data.newProjectId);
        handleClose();
      } else if (data?.jobQueued === true) {
        showToast(t("projects.cloneInProgress"));
        handleClose();
      } else {
        setError(t("projects.cloneError"));
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; details?: unknown };
      if (__DEV__) {
        console.warn("[CloneProjectModal] clone error:", err.code, err.message, err.details);
      }
      if (err.code === "functions/failed-precondition") {
        setError(t("projects.clone_NOT_ALLOWED_TYPE"));
      } else if (err.code === "functions/permission-denied") {
        setError(t("projects.clone_only_admin"));
      } else if (err.code === "functions/not-found") {
        setError(t("projects.cloneNotFound"));
      } else {
        setError(t("projects.cloneError"));
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    newName,
    newCountry,
    newCity,
    newAddress,
    sourceProjectId,
    keepAssignees,
    keepEstimates,
    keepTags,
    t,
    onSuccess,
    handleClose,
  ]);

  const canShow = visible && isOwner && sourceProjectType && ALLOWED_PROJECT_TYPES.includes(sourceProjectType as (typeof ALLOWED_PROJECT_TYPES)[number]);

  if (!canShow) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {t("projects.cloneModalTitle")}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t("projects.cancel")}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t("projects.namePlaceholder")} *</Text>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={(text) => {
              setNewName(text);
              setError(null);
            }}
            placeholder={t("projects.namePlaceholder")}
            placeholderTextColor={colors.textMuted}
            editable={!submitting}
            autoCapitalize="sentences"
          />

          <Text style={styles.label}>{t("projects.country")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryRow}>
            {COUNTRY_CODES.slice(0, 12).map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.countryChip, newCountry === code && styles.countryChipActive]}
                onPress={() => { setNewCountry(code); setError(null); }}
                disabled={submitting}
              >
                <Text style={[styles.countryChipText, newCountry === code && styles.countryChipTextActive]}>
                  {getLocalizedCountryName(code, locale)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>{t("projects.city")}</Text>
          <TextInput
            style={styles.input}
            value={newCity}
            onChangeText={(text) => { setNewCity(text); setError(null); }}
            placeholder={t("projects.cityPlaceholder")}
            placeholderTextColor={colors.textMuted}
            editable={!submitting}
          />

          <Text style={styles.label}>{t("projects.address")}</Text>
          <TextInput
            style={styles.input}
            value={newAddress}
            onChangeText={(text) => { setNewAddress(text); setError(null); }}
            placeholder={t("createProject.addressPlaceholder")}
            placeholderTextColor={colors.textMuted}
            editable={!submitting}
          />

          <View style={styles.options}>
            <View style={styles.optionRow}>
              <Text style={styles.optionLabel}>{t("projects.cloneOptionsKeepAssignees")}</Text>
              <Switch
                value={keepAssignees}
                onValueChange={setKeepAssignees}
                disabled={submitting}
                trackColor={{ false: colors.textMuted, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.optionRow}>
              <Text style={styles.optionLabel}>{t("projects.cloneOptionsKeepEstimates")}</Text>
              <Switch
                value={keepEstimates}
                onValueChange={setKeepEstimates}
                disabled={submitting}
                trackColor={{ false: colors.textMuted, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.optionRow}>
              <Text style={styles.optionLabel}>{t("projects.cloneOptionsKeepTags")}</Text>
              <Switch
                value={keepTags}
                onValueChange={setKeepTags}
                disabled={submitting}
                trackColor={{ false: colors.textMuted, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {error ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          </ScrollView>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting || !newName.trim()}
            accessibilityRole="button"
            accessibilityLabel={t("projects.cloneStructure")}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>{t("projects.cloneStructure")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
  },
  modal: {
    backgroundColor: colors.background,
    borderRadius: 16,
    marginHorizontal: spacing.lg,
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
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  scrollContent: {
    maxHeight: 320,
    marginBottom: spacing.sm,
  },
  countryRow: {
    marginBottom: spacing.lg,
  },
  countryChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.textMuted,
  },
  countryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  countryChipText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  countryChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  options: {
    marginBottom: spacing.lg,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  optionLabel: {
    fontSize: 15,
    color: colors.text,
    flex: 1,
  },
  errorWrap: {
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 14,
    color: "#e74c3c",
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
