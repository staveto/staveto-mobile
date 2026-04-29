/**
 * Shared project creation UX: AI, manual blank, or copy — no BUILD/TRADE pick.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { colors, radius, spacing } from "../theme";
import type { ProjectDoc } from "../services/projects";
import {
  getActiveProductProjectType,
  isKnownStorageType,
  isLegacyMaintenanceEquipmentHub,
} from "../lib/projectTypeModel";
import { CreateProjectAIFlow } from "./CreateProjectAIFlow";
import { CloneProjectModal } from "./CloneProjectModal";
import { CloneSourcePickerModal } from "./CloneSourcePickerModal";
import {
  createManualBlankProject,
  resolveManualBlankInternalMetadata,
  type InternalProjectHints,
} from "../services/projectCreationService";

export type UnifiedProjectCreationVariant = "onboarding" | "inApp";

export type UnifiedProjectCreationSuccess = {
  projectId: string;
  source: "ai" | "manual" | "clone";
  /** For analytics / logging only */
  internalProjectType: "BUILD" | "TRADE";
};

type Step = "choose" | "ai" | "manual";

type ClonePhase = "idle" | "pick" | "modal";

type Props = {
  variant: UnifiedProjectCreationVariant;
  /** Projects list for copy path (in-app). Onboarding passes []. */
  existingProjects: ProjectDoc[];
  internalHints: InternalProjectHints;
  submitting?: boolean;
  onSuccess: (payload: UnifiedProjectCreationSuccess) => void | Promise<void>;
};

function filterCloneSources(projects: ProjectDoc[]): ProjectDoc[] {
  return projects.filter((p) => {
    if (!p.projectType || !isKnownStorageType(p.projectType)) return false;
    if (isLegacyMaintenanceEquipmentHub(p)) return false;
    const active = getActiveProductProjectType(p);
    return active === "BUILD" || active === "TRADE";
  });
}

export function UnifiedProjectCreationFlow({
  variant,
  existingProjects,
  internalHints,
  submitting: parentSubmitting,
  onSuccess,
}: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("choose");
  const [clonePhase, setClonePhase] = useState<ClonePhase>("idle");
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [cloneSource, setCloneSource] = useState<ProjectDoc | null>(null);

  const cloneSources = useMemo(() => filterCloneSources(existingProjects), [existingProjects]);
  const allowCopy = variant === "inApp" && cloneSources.length > 0;

  const resetAll = useCallback(() => {
    setStep("choose");
    setClonePhase("idle");
    setManualName("");
    setManualDescription("");
    setCloneSource(null);
  }, []);

  const goChoose = useCallback(() => {
    setStep("choose");
    setClonePhase("idle");
    setManualName("");
    setManualDescription("");
    setCloneSource(null);
  }, []);

  const handleManualSubmit = useCallback(async () => {
    const name = manualName.trim();
    if (!name) {
      Alert.alert("", t("createProject.nameRequired"));
      return;
    }
    setCreating(true);
    try {
      const projectId = await createManualBlankProject({
        name,
        description: manualDescription.trim() || undefined,
        hints: internalHints,
      });
      const internalProjectType = resolveManualBlankInternalMetadata(internalHints, {
        name,
        description: manualDescription,
      }).projectType;
      await onSuccess({ projectId, source: "manual", internalProjectType });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert("", msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreating(false);
    }
  }, [internalHints, manualDescription, manualName, onSuccess, t]);

  const onCopyTap = useCallback(() => {
    if (!allowCopy) {
      Alert.alert("", t("createProject.unified.copyEmpty"));
      return;
    }
    setClonePhase("pick");
  }, [allowCopy, t]);

  const busy = creating || !!parentSubmitting;

  const renderChoose = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.chooseScrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>{t("createProject.unified.title")}</Text>
      <Text style={styles.screenSubtitle}>{t("createProject.unified.subtitle")}</Text>

      <OptionCard
        icon="sparkles-outline"
        title={t("createProject.unified.card.ai.title")}
        description={t("createProject.unified.card.ai.description")}
        onPress={() => setStep("ai")}
        disabled={busy}
      />
      <OptionCard
        icon="create-outline"
        title={t("createProject.unified.card.manual.title")}
        description={t("createProject.unified.card.manual.description")}
        onPress={() => setStep("manual")}
        disabled={busy}
      />
      <OptionCard
        icon="copy-outline"
        title={t("createProject.unified.card.copy.title")}
        description={t("createProject.unified.card.copy.description")}
        onPress={onCopyTap}
        disabled={busy || !allowCopy}
        dimmed={!allowCopy}
      />
    </ScrollView>
  );

  const renderManual = () => (
    <View style={[styles.column, styles.flex]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg, paddingHorizontal: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>{t("createProject.unified.manual.title")}</Text>
        <Text style={styles.fieldLabel}>{t("createProject.unified.manual.nameLabel")}</Text>
        <TextInput
          style={styles.input}
          value={manualName}
          onChangeText={setManualName}
          placeholder={t("createProject.unified.manual.namePlaceholder")}
          placeholderTextColor={colors.textMuted}
          editable={!busy}
        />
        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
          {t("createProject.unified.manual.descriptionLabel")}
        </Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={manualDescription}
          onChangeText={setManualDescription}
          placeholder={t("createProject.unified.manual.descriptionPlaceholder")}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          editable={!busy}
        />
        <Text style={styles.helper}>{t("createProject.unified.manual.descriptionHelper")}</Text>
      </ScrollView>
      <View style={[styles.footerRow, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TouchableOpacity style={styles.btnGhost} onPress={goChoose} disabled={busy}>
          <Text style={styles.btnGhostText}>{t("createProject.unified.chooseAnotherWay")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, (!manualName.trim() || busy) && styles.btnDisabled]}
          onPress={() => void handleManualSubmit()}
          disabled={!manualName.trim() || busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>{t("createProject.unified.manual.createCta")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const cloneOwner = !!cloneSource?.ownerId && cloneSource.ownerId === user?.id;

  return (
    <>
      {step === "choose" ? renderChoose() : null}
      {step === "ai" ? (
        <View style={styles.flex}>
          <CreateProjectAIFlow
            flowVariant="unified"
            onCreated={async (projectId) => {
              await onSuccess({ projectId, source: "ai", internalProjectType: "TRADE" });
            }}
            onManual={() => setStep("manual")}
            onCancel={goChoose}
          />
        </View>
      ) : null}
      {step === "manual" ? renderManual() : null}

      <CloneSourcePickerModal
        visible={clonePhase === "pick"}
        engineType="ALL"
        projects={existingProjects}
        onClose={() => setClonePhase("idle")}
        onPick={(p) => {
          setCloneSource(p);
          setClonePhase("modal");
        }}
      />
      <CloneProjectModal
        visible={clonePhase === "modal" && !!cloneSource}
        onClose={() => {
          setClonePhase("idle");
          setCloneSource(null);
        }}
        sourceProjectId={cloneSource?.id ?? ""}
        sourceProjectName={cloneSource?.name ?? ""}
        sourceProjectType={cloneSource?.projectType}
        sourceJobsTabVisible={cloneSource?.jobsTabVisible}
        sourceCountryCode={cloneSource?.countryCode}
        sourceCity={cloneSource?.city}
        sourceAddressText={cloneSource?.addressText}
        isOwner={cloneOwner}
        onSuccess={async (newId) => {
          const picked = cloneSource;
          setClonePhase("idle");
          setCloneSource(null);
          const internalProjectType =
            picked && getActiveProductProjectType(picked) === "BUILD" ? "BUILD" : "TRADE";
          await onSuccess({
            projectId: newId,
            source: "clone",
            internalProjectType,
          });
        }}
      />
    </>
  );
}

function OptionCard({
  icon,
  title,
  description,
  onPress,
  disabled,
  dimmed,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        dimmed && styles.cardDimmed,
        pressed && !disabled && styles.cardPressed,
      ]}
      accessibilityRole="button"
    >
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.cardTextCol}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.cardDesc} numberOfLines={3}>
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textMuted} style={styles.cardChevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  column: { flex: 1 },
  scroll: { flex: 1 },
  chooseScrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  screenTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  screenSubtitle: {
    fontSize: 14,
    color: colors.text,
    opacity: 0.85,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardPressed: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  cardDimmed: { opacity: 0.45 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTextCol: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 4 },
  cardDesc: { fontSize: 13, color: colors.text, lineHeight: 18, opacity: 0.88 },
  cardChevron: { alignSelf: "center" },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
  },
  textArea: { minHeight: 96, paddingTop: spacing.sm },
  helper: { fontSize: 13, color: colors.text, marginTop: spacing.sm, lineHeight: 18, opacity: 0.85 },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  btnGhostText: { fontSize: 15, fontWeight: "600", color: colors.primary },
  btnPrimary: {
    flexShrink: 0,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
});
