/**
 * Shared project creation UX: archetype → AI, manual blank, or copy.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useActiveOrg } from "../hooks/useActiveOrg";
import { colors, radius, spacing } from "../theme";
import { ContactPickerSheet } from "./ContactPickerSheet";
import {
  isCustomerFacingJobArchetype,
  formatContactSummaryLine,
  patchPrimaryContactToProject,
  logNewJobContactDebug,
} from "../lib/newJobContact";
import type { BusinessContact } from "../services/businessContacts";
import type { ProjectDoc } from "../services/projects";
import {
  getActiveProductProjectType,
  isKnownStorageType,
  isLegacyMaintenanceEquipmentHub,
} from "../lib/projectTypeModel";
import {
  NEW_JOB_ARCHETYPES,
  resolveInternalProjectTypeFromArchetype,
  type NewJobArchetype,
} from "../lib/projectEnums";
import { CreateProjectAIFlow } from "./CreateProjectAIFlow";
import { CloneProjectModal } from "./CloneProjectModal";
import { CloneSourcePickerModal } from "./CloneSourcePickerModal";
import { ProjectTypeCustomizeSheet } from "./ProjectTypeCustomizeSheet";
import {
  loadVisibleProjectArchetypes,
  logProjectTypePreferencesDebug,
} from "../services/projectArchetypePreferences";
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

type Step = "archetype" | "contact" | "choose" | "ai" | "manual";

type ClonePhase = "idle" | "pick" | "modal";

type StartMethod = "ai" | "manual" | "clone";

type Props = {
  variant: UnifiedProjectCreationVariant;
  /** Projects list for copy path (in-app). Onboarding passes []. */
  existingProjects: ProjectDoc[];
  internalHints: InternalProjectHints;
  submitting?: boolean;
  onSuccess: (payload: UnifiedProjectCreationSuccess) => void | Promise<void>;
};

const ARCHETYPE_ICONS: Record<NewJobArchetype, keyof typeof Ionicons.glyphMap> = {
  service_inspection: "medkit-outline",
  customer_job: "briefcase-outline",
  large_construction_project: "home-outline",
  own_build: "hammer-outline",
  internal_project: "business-outline",
};

function logNewJobFlowDebug(payload: Record<string, unknown>) {
  if (__DEV__) console.log("[NewJobFlowDebug]", payload);
}

function filterCloneSources(projects: ProjectDoc[]): ProjectDoc[] {
  return projects.filter((p) => {
    if (!p.projectType || !isKnownStorageType(p.projectType)) return false;
    if (isLegacyMaintenanceEquipmentHub(p)) return false;
    const active = getActiveProductProjectType(p);
    return active === "BUILD" || active === "TRADE";
  });
}

function tArchetypeKey(archetype: NewJobArchetype, suffix: string): string {
  return `createProject.archetype.${archetype}.${suffix}`;
}

function tArchetype(
  t: (key: string, params?: Record<string, string>) => string,
  archetype: NewJobArchetype | null | undefined,
  suffix: string,
  fallbackKey: string,
  params?: Record<string, string>
): string {
  if (archetype) {
    const key = tArchetypeKey(archetype, suffix);
    const translated = t(key, params);
    if (translated !== key) return translated;
  }
  return t(fallbackKey, params);
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
  const { activeBusinessOrgId } = useActiveOrg();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("archetype");
  const [jobArchetype, setJobArchetype] = useState<NewJobArchetype | null>(null);
  const [selectedContact, setSelectedContact] = useState<BusinessContact | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactPickerMode, setContactPickerMode] = useState<"list" | "create">("list");
  const [lastStartMethod, setLastStartMethod] = useState<StartMethod | null>(null);
  const [clonePhase, setClonePhase] = useState<ClonePhase>("idle");
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [cloneSource, setCloneSource] = useState<ProjectDoc | null>(null);
  const [visibleArchetypes, setVisibleArchetypes] = useState<NewJobArchetype[]>([...NEW_JOB_ARCHETYPES]);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { visible, defaultUsed } = await loadVisibleProjectArchetypes();
      if (cancelled) return;
      setVisibleArchetypes(visible);
      const hidden = NEW_JOB_ARCHETYPES.filter((id) => !visible.includes(id));
      logProjectTypePreferencesDebug({
        visibleArchetypes: visible,
        hiddenArchetypes: hidden,
        defaultUsed,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!jobArchetype) return;
    if (!visibleArchetypes.includes(jobArchetype)) {
      const next = visibleArchetypes[0] ?? null;
      setJobArchetype(next);
      logNewJobFlowDebug({
        selectedArchetype: next,
        startMethod: lastStartMethod,
        createMode: "archetype_reset_hidden",
      });
    }
  }, [jobArchetype, lastStartMethod, visibleArchetypes]);

  const cloneSources = useMemo(() => filterCloneSources(existingProjects), [existingProjects]);
  const allowCopy = variant === "inApp" && cloneSources.length > 0;

  const goArchetype = useCallback(() => {
    setStep("archetype");
    setClonePhase("idle");
    setManualName("");
    setManualDescription("");
    setCloneSource(null);
    setLastStartMethod(null);
    setSelectedContact(null);
    setContactPickerOpen(false);
  }, []);

  const goChoose = useCallback(() => {
    setStep("choose");
    setClonePhase("idle");
    setManualName("");
    setManualDescription("");
    setCloneSource(null);
  }, []);

  const selectArchetype = useCallback((archetype: NewJobArchetype) => {
    setJobArchetype(archetype);
    setSelectedContact(null);
    logNewJobFlowDebug({ selectedArchetype: archetype, startMethod: null, createMode: "archetype_pick" });
    setStep(isCustomerFacingJobArchetype(archetype) ? "contact" : "choose");
  }, []);

  const goContact = useCallback(() => {
    if (jobArchetype && isCustomerFacingJobArchetype(jobArchetype)) {
      setStep("contact");
    } else {
      goArchetype();
    }
  }, [goArchetype, jobArchetype]);

  useEffect(() => {
    if (step !== "contact" || !jobArchetype) return;
    logNewJobContactDebug({
      archetype: jobArchetype,
      hasActiveBusinessOrgId: !!activeBusinessOrgId,
      hasSelectedContact: !!selectedContact,
      selectedContactType: selectedContact?.contactType ?? null,
      hasEmail: !!selectedContact?.email?.trim(),
      hasPhone: !!selectedContact?.phone?.trim(),
      hasAddress: !!selectedContact?.address?.trim(),
    });
  }, [step, jobArchetype, activeBusinessOrgId, selectedContact]);

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
      if (selectedContact) {
        await patchPrimaryContactToProject(projectId, selectedContact);
      }
      const internalProjectType = jobArchetype
        ? resolveInternalProjectTypeFromArchetype(jobArchetype)
        : resolveManualBlankInternalMetadata(internalHints, {
            name,
            description: manualDescription,
          }).projectType;
      logNewJobFlowDebug({
        selectedArchetype: jobArchetype,
        startMethod: "manual",
        createMode: "manual_create",
      });
      await onSuccess({ projectId, source: "manual", internalProjectType });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert("", msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreating(false);
    }
  }, [internalHints, jobArchetype, manualDescription, manualName, onSuccess, selectedContact, t]);

  const onCopyTap = useCallback(() => {
    if (!allowCopy) {
      Alert.alert("", t("createProject.unified.copyEmpty"));
      return;
    }
    setLastStartMethod("clone");
    logNewJobFlowDebug({
      selectedArchetype: jobArchetype,
      startMethod: "clone",
      createMode: "clone_pick",
    });
    setClonePhase("pick");
  }, [allowCopy, jobArchetype, t]);

  const busy = creating || !!parentSubmitting;

  const selectedArchetypeLabel = jobArchetype
    ? t(tArchetypeKey(jobArchetype, "label"))
    : "";

  const manualTitleKey = jobArchetype
    ? tArchetypeKey(jobArchetype, "manual.title")
    : "createProject.unified.manual.title";
  const manualNameLabelKey = jobArchetype
    ? tArchetypeKey(jobArchetype, "manual.nameLabel")
    : "createProject.unified.manual.nameLabel";
  const manualCreateCtaKey = jobArchetype
    ? tArchetypeKey(jobArchetype, "manual.createCta")
    : "createProject.unified.manual.createCta";

  const handleArchetypePrefsSaved = useCallback((visible: NewJobArchetype[]) => {
    setVisibleArchetypes(visible);
    const hidden = NEW_JOB_ARCHETYPES.filter((id) => !visible.includes(id));
    logProjectTypePreferencesDebug({
      visibleArchetypes: visible,
      hiddenArchetypes: hidden,
      defaultUsed: false,
    });
  }, []);

  const renderArchetypePicker = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.chooseScrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.archetypePickerHeader}>
        <View style={styles.archetypePickerHeaderText}>
          <Text style={styles.screenTitle}>{t("createProject.archetypePicker.title")}</Text>
        </View>
        <TouchableOpacity
          style={styles.customizeBtn}
          onPress={() => setCustomizeOpen(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("createProject.archetypeCustomize.accessibilityLabel")}
        >
          <Ionicons name="options-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <Text style={styles.screenSubtitle}>{t("createProject.archetypePicker.subtitle")}</Text>

      {visibleArchetypes.map((archetype) => (
        <OptionCard
          key={archetype}
          icon={ARCHETYPE_ICONS[archetype]}
          title={t(tArchetypeKey(archetype, "label"))}
          description={t(tArchetypeKey(archetype, "description"))}
          onPress={() => selectArchetype(archetype)}
          disabled={busy}
        />
      ))}
    </ScrollView>
  );

  const renderContact = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.chooseScrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity style={styles.backLink} onPress={goArchetype} disabled={busy}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backLinkText}>{t("createProject.unified.changeArchetype")}</Text>
      </TouchableOpacity>
      {jobArchetype ? (
        <Text style={styles.flowTitle}>
          {tArchetype(t, jobArchetype, "flowTitle", "projects.modalTitle")}
        </Text>
      ) : null}
      <Text style={styles.screenTitle}>{t("createProject.newJob.contact.title")}</Text>
      <Text style={styles.screenSubtitle}>{t("createProject.newJob.contact.subtitle")}</Text>
      {selectedContact ? (
        <View style={styles.contactSummaryCard}>
          <Text style={styles.contactSummaryLabel}>{t("createProject.newJob.contact.summaryTitle")}</Text>
          <Text style={styles.contactSummaryValue}>{formatContactSummaryLine(selectedContact)}</Text>
        </View>
      ) : null}
      {activeBusinessOrgId ? (
        <>
          <OptionCard
            icon="person-outline"
            title={t("createProject.newJob.contact.selectContact")}
            description=""
            onPress={() => {
              setContactPickerMode("list");
              setContactPickerOpen(true);
            }}
            disabled={busy}
          />
          <OptionCard
            icon="person-add-outline"
            title={t("createProject.newJob.contact.createContact")}
            description=""
            onPress={() => {
              setContactPickerMode("create");
              setContactPickerOpen(true);
            }}
            disabled={busy}
          />
        </>
      ) : null}
      <TouchableOpacity
        style={[styles.btnGhost, { marginTop: spacing.md }]}
        onPress={() => {
          setSelectedContact(null);
          setStep("choose");
        }}
        disabled={busy}
      >
        <Text style={styles.btnGhostText}>{t("createProject.newJob.contact.continueWithout")}</Text>
      </TouchableOpacity>
      {selectedContact ? (
        <TouchableOpacity
          style={[styles.btnPrimary, { marginTop: spacing.sm }]}
          onPress={() => setStep("choose")}
          disabled={busy}
        >
          <Text style={styles.btnPrimaryText}>{t("common.continue")}</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );

  const renderChoose = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.chooseScrollContent, { paddingBottom: insets.bottom + spacing.lg }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity
        style={styles.backLink}
        onPress={
          jobArchetype && isCustomerFacingJobArchetype(jobArchetype) ? goContact : goArchetype
        }
        disabled={busy}
      >
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
        <Text style={styles.backLinkText}>{t("createProject.unified.changeArchetype")}</Text>
      </TouchableOpacity>

      {jobArchetype ? (
        <Text style={styles.flowTitle}>
          {tArchetype(t, jobArchetype, "flowTitle", "projects.modalTitle")}
        </Text>
      ) : null}

      <Text style={styles.screenTitle}>
        {tArchetype(t, jobArchetype, "choose.title", "createProject.unified.title")}
      </Text>
      {selectedArchetypeLabel ? (
        <View style={styles.archetypeChip}>
          <Text style={styles.archetypeChipText}>
            {t("createProject.unified.selectedArchetypeLabel", {
              label: selectedArchetypeLabel,
            })}
          </Text>
        </View>
      ) : null}
      {jobArchetype && isCustomerFacingJobArchetype(jobArchetype) ? (
        <TouchableOpacity style={styles.contactChip} onPress={goContact} disabled={busy}>
          <Text style={styles.contactChipLabel}>{t("createProject.newJob.contact.summaryTitle")}</Text>
          <Text style={styles.contactChipValue}>
            {selectedContact
              ? formatContactSummaryLine(selectedContact)
              : t("createProject.newJob.contact.noneSelected")}
          </Text>
          <Text style={styles.contactChipAction}>{t("createProject.newJob.contact.changeContact")}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.screenSubtitle}>
        {tArchetype(t, jobArchetype, "choose.subtitle", "createProject.unified.subtitle")}
      </Text>

      <OptionCard
        icon="sparkles-outline"
        title={tArchetype(t, jobArchetype, "card.ai.title", "createProject.unified.card.ai.title")}
        description={tArchetype(
          t,
          jobArchetype,
          "card.ai.description",
          "createProject.unified.card.ai.description"
        )}
        onPress={() => {
          setLastStartMethod("ai");
          logNewJobFlowDebug({
            selectedArchetype: jobArchetype,
            startMethod: "ai",
            createMode: "ai_brief",
          });
          setStep("ai");
        }}
        disabled={busy}
      />
      <OptionCard
        icon="create-outline"
        title={tArchetype(t, jobArchetype, "card.manual.title", "createProject.unified.card.manual.title")}
        description={tArchetype(
          t,
          jobArchetype,
          "card.manual.description",
          "createProject.unified.card.manual.description"
        )}
        onPress={() => {
          setLastStartMethod("manual");
          logNewJobFlowDebug({
            selectedArchetype: jobArchetype,
            startMethod: "manual",
            createMode: "manual_form",
          });
          setStep("manual");
        }}
        disabled={busy}
      />
      <OptionCard
        icon="copy-outline"
        title={tArchetype(t, jobArchetype, "card.copy.title", "createProject.unified.card.copy.title")}
        description={tArchetype(
          t,
          jobArchetype,
          "card.copy.description",
          "createProject.unified.card.copy.description"
        )}
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
        <TouchableOpacity style={styles.backLink} onPress={goChoose} disabled={busy}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backLinkText}>{t("createProject.unified.chooseAnotherWay")}</Text>
        </TouchableOpacity>
        {jobArchetype ? (
          <Text style={styles.flowTitle}>
            {tArchetype(t, jobArchetype, "flowTitle", "projects.modalTitle")}
          </Text>
        ) : null}
        <Text style={styles.screenTitle}>{t(manualTitleKey)}</Text>
        <Text style={styles.fieldLabel}>{t(manualNameLabelKey)}</Text>
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
            <Text style={styles.btnPrimaryText}>{t(manualCreateCtaKey)}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const cloneOwner = !!cloneSource?.ownerId && cloneSource.ownerId === user?.id;

  return (
    <>
      {step === "archetype" ? renderArchetypePicker() : null}
      {step === "contact" ? renderContact() : null}
      {step === "choose" ? renderChoose() : null}
      {step === "ai" && jobArchetype ? (
        <View style={styles.flex}>
          <CreateProjectAIFlow
            flowVariant="unified"
            jobArchetype={jobArchetype}
            selectedContact={selectedContact}
            showContactSummary={isCustomerFacingJobArchetype(jobArchetype)}
            hasActiveBusinessOrgId={!!activeBusinessOrgId}
            onRequestChangeContact={() => {
              setContactPickerMode("list");
              setContactPickerOpen(true);
            }}
            onCreated={async (projectId) => {
              const internalProjectType = resolveInternalProjectTypeFromArchetype(jobArchetype);
              logNewJobFlowDebug({
                selectedArchetype: jobArchetype,
                startMethod: lastStartMethod ?? "ai",
                createMode: "ai_create_confirmed",
              });
              await onSuccess({ projectId, source: "ai", internalProjectType });
            }}
            onManual={() => setStep("manual")}
            onCancel={goChoose}
          />
        </View>
      ) : null}
      {step === "manual" ? renderManual() : null}

      <ContactPickerSheet
        visible={contactPickerOpen}
        orgId={activeBusinessOrgId}
        jobArchetype={jobArchetype}
        initialMode={contactPickerMode}
        onDismiss={() => setContactPickerOpen(false)}
        onSelect={(contact) => {
          setSelectedContact(contact);
          setContactPickerOpen(false);
          if (step === "contact") setStep("choose");
        }}
      />

      <ProjectTypeCustomizeSheet
        visible={customizeOpen}
        enabledArchetypes={visibleArchetypes}
        onDismiss={() => setCustomizeOpen(false)}
        onSaved={handleArchetypePrefsSaved}
      />

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
          const internalProjectType = jobArchetype
            ? resolveInternalProjectTypeFromArchetype(jobArchetype)
            : picked && getActiveProductProjectType(picked) === "BUILD"
              ? "BUILD"
              : "TRADE";
          logNewJobFlowDebug({
            selectedArchetype: jobArchetype,
            startMethod: "clone",
            createMode: "clone_create_confirmed",
          });
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
  flowTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  archetypePickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  archetypePickerHeaderText: { flex: 1, minWidth: 0 },
  customizeBtn: {
    width: 44,
    height: 44,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
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
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
  },
  backLinkText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
  archetypeChip: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(224, 103, 55, 0.12)",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(224, 103, 55, 0.35)",
  },
  archetypeChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  contactSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  contactSummaryLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: 4,
  },
  contactSummaryValue: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  contactChip: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  contactChipLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  contactChipValue: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginTop: 4,
  },
  contactChipAction: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
    marginTop: spacing.xs,
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
