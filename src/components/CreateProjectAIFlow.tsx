/**
 * AI project creation: brief → generated draft plan → user review/edit → create in Firestore (callable).
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import {
  generateProjectStructureWithAI,
  createProjectFromAiPlan,
  uploadAiDraftDocument,
  normalizeCallableErrorCode,
  type CreateProjectFromAiPlanParams,
  type AiDraftDocument,
} from "../services/aiProjectService";
import { patchProjectDocument } from "../services/projects";
import type { AiProjectPlan } from "../lib/aiProjectSchema";
import type {
  ProjectEngineType,
  WorkType,
  JobWorkflowKind,
  ServiceMaintenanceScope,
} from "../lib/projectEnums";

let DocumentPicker: typeof import("expo-document-picker") | null = null;
let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  DocumentPicker = require("expo-document-picker");
} catch {
  // optional
}
try {
  ImagePicker = require("expo-image-picker");
} catch {
  // optional
}

type Step = "brief" | "preview" | "generating";

type Props = {
  onCreated: (projectId: string) => void;
  onManual: () => void;
  /** BUILD catalog path — skip AI and use country template (phases). */
  onUseTemplate?: () => void;
  onCancel: () => void;
  /** Context from wizard: Bau/Aufträge + work type (Neubau, Renovierung, etc.) */
  engineType?: ProjectEngineType;
  workType?: WorkType | null;
  /** Prefilled from wizard name/description step */
  initialBrief?: string;
  jobWorkflowKind?: JobWorkflowKind | null;
  serviceMaintenanceScope?: ServiceMaintenanceScope | null;
};

function getCategoryLabel(category: string, t: (key: string) => string): string {
  const key = `createProject.ai.category.${category}`;
  const translated = t(key);
  return translated !== key ? translated : category;
}

function getScopeLabel(scope: string, t: (key: string) => string): string {
  const key = `createProject.ai.scope.${scope}`;
  const translated = t(key);
  return translated !== key ? translated : scope;
}

function normalizeAiErrorMessage(message: string): string {
  return message.replace(/^\[internal\]\s*/i, "").replace(/\s*\[internal\]\s*/gi, " ").trim();
}

function getAiErrorMessage(code: string | undefined, message: string, t: (key: string) => string): string {
  const cleaned = normalizeAiErrorMessage(message);
  const codeLower = normalizeCallableErrorCode(code);
  const msgLower = cleaned.toLowerCase();
  if (!cleaned && !code) return t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.";
  if (codeLower === "unauthenticated" || msgLower.includes("authentication required")) {
    return t("createProject.ai.errorAuth") || "Musíte byť prihlásený. Skúste sa odhlásiť a znova prihlásiť.";
  }
  if (codeLower === "failed-precondition" || msgLower.includes("not configured") || msgLower.includes("api key")) {
    return t("createProject.ai.errorNotConfigured") || "AI služba nie je nakonfigurovaná. Kontaktujte podporu.";
  }
  if (codeLower === "resource-exhausted" || msgLower.includes("overloaded")) {
    return t("createProject.ai.errorRateLimit") || "AI je dočasne preťažená. Skúste o chvíľu alebo pokračujte bez AI.";
  }
  if (msgLower.includes("network") || msgLower.includes("timeout") || msgLower.includes("slabé pripojenie")) {
    return t("createProject.ai.errorNetwork") || "Slabé pripojenie alebo žiadny internet. Skúste znova.";
  }
  if (msgLower.includes("internal") || msgLower.includes("ai generation failed")) {
    return t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.";
  }
  return cleaned && cleaned.length < 120 ? cleaned : (t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.");
}

function isWeakAiTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  if (t === "untitled" || t === "untitled project") return true;
  if (t === "bez názvu" || t === "bez nazvu") return true;
  if (t === "ohne titel" || t === "neues projekt") return true;
  if (t === "nový projekt" || t === "novy projekt") return true;
  if (/^project(\s+\d+)?$/i.test(t)) return true;
  return false;
}

function firstMeaningfulLine(text: string): string {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return lines[0] ?? "";
}

/** Prefer AI title when meaningful; otherwise first line of user brief. */
function resolveFinalProjectTitle(userBrief: string, aiTitle: string): string {
  const briefLine = firstMeaningfulLine(userBrief);
  const trimmedAi = aiTitle.trim();
  if (!isWeakAiTitle(trimmedAi)) return trimmedAi;
  if (briefLine) {
    return briefLine.length > 120 ? `${briefLine.slice(0, 117)}…` : briefLine;
  }
  return trimmedAi || "Project";
}

/** BUILD-only: roof, area, floors — never sent for TRADE briefs. */
function buildConstructionDetailsPayload(
  t: (key: string) => string,
  roofType: string,
  areaM2: string,
  floorCount: string
): string | undefined {
  const details: string[] = [];
  if (roofType.trim()) details.push(`${t("createProject.ai.roofType")}: ${roofType.trim()}`);
  if (areaM2.trim()) details.push(`${t("createProject.ai.areaM2")}: ${areaM2.trim()}`);
  if (floorCount.trim()) details.push(`${t("createProject.ai.floorCount")}: ${floorCount.trim()}`);
  return details.length > 0 ? details.join("; ") : undefined;
}

/** TRADE: optional site / client / notes for AI context (no building dimensions). */
function buildTradeDetailsPayload(
  t: (key: string) => string,
  location: string,
  clientOrObject: string,
  notes: string
): string | undefined {
  const details: string[] = [];
  if (location.trim()) details.push(`${t("createProject.ai.tradeLocationLabel")}: ${location.trim()}`);
  if (clientOrObject.trim()) details.push(`${t("createProject.ai.tradeClientLabel")}: ${clientOrObject.trim()}`);
  if (notes.trim()) details.push(`${t("createProject.ai.tradeNotesLabel")}: ${notes.trim()}`);
  return details.length > 0 ? details.join("; ") : undefined;
}

const TRADE_AI_STRUCTURE_HINT =
  "Task context: craftsman's trade job (Handwerksauftrag / service visit), not residential new-build shell construction. Prefer a compact checklist of on-site work steps, materials, safety, and handover — avoid generic multi-phase house construction unless the brief clearly describes that.";

function mergeAiProjectDetails(
  engineType: ProjectEngineType | undefined,
  t: (key: string) => string,
  roofType: string,
  areaM2: string,
  floorCount: string,
  tradeLocation: string,
  tradeClient: string,
  tradeNotes: string,
  jobWorkflowKind: JobWorkflowKind | null | undefined,
  serviceMaintenanceScope: ServiceMaintenanceScope | null | undefined
): string | undefined {
  const parts: string[] = [];
  if (engineType === "TRADE") {
    parts.push(TRADE_AI_STRUCTURE_HINT);
    if (jobWorkflowKind === "SERVICE") {
      parts.push(
        "Workflow: service/maintenance. Prefer visit-based or SLA-style task groups. If scope is property/building care vs equipment, align tasks accordingly."
      );
      if (serviceMaintenanceScope === "PROPERTY") {
        parts.push("Maintenance scope: building/property/real-estate (not machine inventory).");
      } else if (serviceMaintenanceScope === "EQUIPMENT") {
        parts.push("Maintenance scope: equipment/machine on site (not property portfolio).");
      }
    }
    const tradeBits = buildTradeDetailsPayload(t, tradeLocation, tradeClient, tradeNotes);
    if (tradeBits) parts.push(tradeBits);
  } else {
    const buildBits = buildConstructionDetailsPayload(t, roofType, areaM2, floorCount);
    if (buildBits) parts.push(buildBits);
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

export function CreateProjectAIFlow({
  onCreated,
  onManual,
  onUseTemplate,
  onCancel,
  engineType,
  workType,
  initialBrief,
  jobWorkflowKind,
  serviceMaintenanceScope,
}: Props) {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const narrowActions = width < 380;

  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState("");
  const [documents, setDocuments] = useState<AiDraftDocument[]>([]);
  const [roofType, setRoofType] = useState("");
  const [areaM2, setAreaM2] = useState("");
  const [floorCount, setFloorCount] = useState("");
  const [tradeLocation, setTradeLocation] = useState("");
  const [tradeClientObject, setTradeClientObject] = useState("");
  const [tradeNotes, setTradeNotes] = useState("");
  const [plan, setPlan] = useState<AiProjectPlan | null>(null);
  const [editedPlanTitle, setEditedPlanTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  useEffect(() => {
    const seed = initialBrief?.trim();
    if (!seed) return;
    setBrief((prev) => (prev.trim() ? prev : seed));
  }, [initialBrief]);

  const isTradeAi = engineType === "TRADE";

  const aiOptionsBase = useMemo(
    () => ({
      engineType,
      workType,
      jobWorkflowKind: jobWorkflowKind ?? undefined,
      serviceMaintenanceScope: serviceMaintenanceScope ?? undefined,
    }),
    [engineType, workType, jobWorkflowKind, serviceMaintenanceScope]
  );

  const pickPhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("createProject.ai.imagePickerNotInstalled"));
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("common.error"), t("createProject.ai.photoPermissionDenied"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.length) {
        const newDocs = result.assets.map((asset, i) => ({
          localUri: asset.uri,
          fileName: asset.fileName ?? `foto_${Date.now()}_${i}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
        }));
        setDocuments((prev) => [...prev, ...newDocs]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Photo pick error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.photoPickFailed"));
    }
  };

  const pickDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert(t("common.error"), t("createProject.ai.documentPickerNotInstalled"));
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const mimeType = asset.mimeType ?? "application/pdf";
        const fileName = asset.name ?? `dokument_${Date.now()}.pdf`;
        setDocuments((prev) => [...prev, { localUri: asset.uri, fileName, mimeType }]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Document pick error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.documentPickFailed"));
    }
  };

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const runGeneration = async () => {
    const trimmed = brief.trim();
    if (!trimmed) {
      setError(t("createProject.ai.briefRequired"));
      return;
    }

    setError(null);
    setStep("generating");

    try {
      let documentStoragePaths: string[] = [];
      if (documents.length > 0) {
        setUploadingDocs(true);
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        for (const doc of documents) {
          const path = await uploadAiDraftDocument(doc, draftId);
          documentStoragePaths.push(path);
        }
        setUploadingDocs(false);
      }

      const projectDetails = mergeAiProjectDetails(
        engineType,
        t,
        roofType,
        areaM2,
        floorCount,
        tradeLocation,
        tradeClientObject,
        tradeNotes,
        jobWorkflowKind,
        serviceMaintenanceScope
      );

      const result = await generateProjectStructureWithAI(trimmed, {
        ...aiOptionsBase,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
        projectDetails,
      });
      setPlan(result);
      setEditedPlanTitle(resolveFinalProjectTitle(trimmed, result.projectTitle ?? ""));
      setStep("preview");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generation failed", code, msg.slice(0, 160));
      }
      setError(getAiErrorMessage(code, msg, t));
      setStep("brief");
      setUploadingDocs(false);
    }
  };

  const handleManual = () => {
    onManual();
  };

  const handleChangeDescription = () => {
    setStep("brief");
    setError(null);
    setPlan(null);
  };

  const handleGenerateAgain = async () => {
    if (!brief.trim()) return;
    setError(null);
    setStep("generating");
    try {
      let documentStoragePaths: string[] = [];
      if (documents.length > 0) {
        setUploadingDocs(true);
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        for (const doc of documents) {
          const path = await uploadAiDraftDocument(doc, draftId);
          documentStoragePaths.push(path);
        }
        setUploadingDocs(false);
      }
      const projectDetails = mergeAiProjectDetails(
        engineType,
        t,
        roofType,
        areaM2,
        floorCount,
        tradeLocation,
        tradeClientObject,
        tradeNotes,
        jobWorkflowKind,
        serviceMaintenanceScope
      );

      const result = await generateProjectStructureWithAI(brief.trim(), {
        ...aiOptionsBase,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
        projectDetails,
      });
      setPlan(result);
      setEditedPlanTitle(resolveFinalProjectTitle(brief.trim(), result.projectTitle ?? ""));
      setStep("preview");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generate again failed", code, msg.slice(0, 160));
      }
      setError(getAiErrorMessage(code, msg, t));
      setStep("preview");
      setUploadingDocs(false);
    }
  };

  const handleCreate = async () => {
    if (!plan) return;
    const title = resolveFinalProjectTitle(brief.trim(), (editedPlanTitle.trim() || plan.projectTitle).trim());
    if (!title.trim()) {
      setError(t("createProject.nameRequired"));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const mergedPlan: AiProjectPlan = { ...plan, projectTitle: title.trim() };
      const params: CreateProjectFromAiPlanParams = {
        plan: mergedPlan,
        originalBrief: brief.trim() || undefined,
      };
      const projectId = await createProjectFromAiPlan(params);

      const patch: Record<string, unknown> = {};
      if (jobWorkflowKind === "STANDARD" || jobWorkflowKind === "SERVICE") {
        patch.jobWorkflowKind = jobWorkflowKind;
      }
      if (serviceMaintenanceScope === "PROPERTY" || serviceMaintenanceScope === "EQUIPMENT") {
        patch.serviceMaintenanceScope = serviceMaintenanceScope;
      }
      if (Object.keys(patch).length > 0) {
        try {
          await patchProjectDocument(projectId, patch);
        } catch (patchErr) {
          if (__DEV__) console.warn("[CreateProjectAIFlow] workflow patch failed", patchErr);
        }
      }

      onCreated(projectId);
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] create from plan failed", code, msg.slice(0, 160));
      }
      setError(getAiErrorMessage(code, msg, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "generating") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.generatingText}>
          {uploadingDocs ? t("createProject.ai.uploadingDocs") : t("createProject.ai.generating")}
        </Text>
      </View>
    );
  }

  if (step === "brief") {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <ScrollView style={styles.briefScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.question}>
            {isTradeAi ? t("createProject.ai.questionTrade") : t("createProject.ai.question")}
          </Text>
          {initialBrief?.trim() ? (
            <Text style={styles.briefPrefilledHint}>{t("createProject.ai.briefPrefilledHint")}</Text>
          ) : null}
          <TextInput
            style={styles.textArea}
            value={brief}
            onChangeText={(text) => {
              setBrief(text);
              setError(null);
            }}
            placeholder={isTradeAi ? t("createProject.ai.placeholderTrade") : t("createProject.ai.placeholder")}
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            editable={true}
          />
          {isTradeAi ? (
            <>
              <Text style={styles.sectionLabel}>{t("createProject.ai.tradeOptionalSection")}</Text>
              <Text style={styles.tradeFieldLabel}>{t("createProject.ai.tradeLocationLabel")}</Text>
              <TextInput
                style={styles.tradeFieldInput}
                value={tradeLocation}
                onChangeText={setTradeLocation}
                placeholder={t("createProject.ai.tradeLocationPlaceholder")}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.tradeFieldLabel}>{t("createProject.ai.tradeClientLabel")}</Text>
              <TextInput
                style={styles.tradeFieldInput}
                value={tradeClientObject}
                onChangeText={setTradeClientObject}
                placeholder={t("createProject.ai.tradeClientPlaceholder")}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.tradeFieldLabel}>{t("createProject.ai.tradeNotesLabel")}</Text>
              <TextInput
                style={[styles.tradeFieldInput, styles.tradeNotesInput]}
                value={tradeNotes}
                onChangeText={setTradeNotes}
                placeholder={t("createProject.ai.tradeNotesPlaceholder")}
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>{t("createProject.ai.buildDetailsSection")}</Text>
              <View style={styles.basicFieldsRow}>
                <View style={styles.basicField}>
                  <Text style={styles.basicFieldLabel}>{t("createProject.ai.roofType")}</Text>
                  <TextInput
                    style={styles.basicFieldInput}
                    value={roofType}
                    onChangeText={setRoofType}
                    placeholder={t("createProject.ai.roofTypePlaceholder")}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <View style={styles.basicField}>
                  <Text style={styles.basicFieldLabel}>{t("createProject.ai.areaM2")}</Text>
                  <TextInput
                    style={styles.basicFieldInput}
                    value={areaM2}
                    onChangeText={setAreaM2}
                    placeholder={t("createProject.ai.areaPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.basicField}>
                  <Text style={styles.basicFieldLabel}>{t("createProject.ai.floorCount")}</Text>
                  <TextInput
                    style={styles.basicFieldInput}
                    value={floorCount}
                    onChangeText={setFloorCount}
                    placeholder={t("createProject.ai.floorPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </>
          )}
          <View style={styles.attachSection}>
            <Text style={styles.attachSectionTitle}>
              {isTradeAi ? t("createProject.ai.attachTitleTrade") : t("createProject.ai.attachTitle")}
            </Text>
            <Text style={styles.attachSectionHint}>
              {isTradeAi ? t("createProject.ai.attachHintTrade") : t("createProject.ai.attachHint")}
            </Text>
            <View style={styles.attachButtons}>
              <TouchableOpacity style={styles.attachBtn} onPress={pickPhoto}>
                <View style={styles.attachIconWrap}>
                  <Ionicons name="camera-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.attachBtnText}>{t("createProject.ai.addPhoto")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachBtn} onPress={pickDocument}>
                <View style={styles.attachIconWrap}>
                  <Ionicons name="document-text-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.attachBtnText}>{t("createProject.ai.addDocument")}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {documents.length > 0 && (
            <View style={styles.docList}>
              {documents.map((doc, i) => {
                const isImage = (doc.mimeType ?? "").startsWith("image/");
                return (
                  <View key={i} style={styles.docItem}>
                    <Ionicons
                      name={isImage ? "image-outline" : "document-text-outline"}
                      size={18}
                      color={colors.primary}
                    />
                    <Text style={styles.docName} numberOfLines={1}>
                      {doc.fileName}
                    </Text>
                    <TouchableOpacity onPress={() => removeDocument(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={runGeneration}>
              <Ionicons name="sparkles" size={18} color="#fff" />
              <Text style={styles.btnPrimaryText}>
                {error ? t("createProject.ai.tryAgain") : t("createProject.ai.withAi")}
              </Text>
            </TouchableOpacity>
            <View style={[styles.secondaryActions, narrowActions && styles.secondaryActionsColumn]}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary, styles.secondaryActionBtn, narrowActions && styles.btnFullWidth]}
                onPress={handleManual}
              >
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <Text style={styles.btnSecondaryText}>{t("createProject.ai.manual")}</Text>
              </TouchableOpacity>
              {onUseTemplate ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary, styles.secondaryActionBtn, narrowActions && styles.btnFullWidth]}
                  onPress={() => {
                    setError(null);
                    onUseTemplate();
                  }}
                >
                  <Ionicons name="layers-outline" size={18} color={colors.primary} />
                  <Text style={styles.btnSecondaryText}>{t("createProject.ai.useTemplate")}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>{t("projects.cancel")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (step === "preview" && plan) {
    const categoryLabel = getCategoryLabel(plan.category, t);
    const scopeLabel = getScopeLabel(plan.scope, t);

    return (
      <View style={[styles.container, styles.previewRoot]}>
        <Text style={styles.previewTitle}>{t("createProject.ai.previewTitle")}</Text>
        <Text style={styles.previewSubtitle}>{t("createProject.ai.previewSubtitle")}</Text>

        <ScrollView
          style={styles.previewScroll}
          contentContainerStyle={{ paddingBottom: spacing.md }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.proposalCard}>
            <Text style={styles.proposalCardLabel}>{t("createProject.ai.editTitleLabel")}</Text>
            <TextInput
              style={styles.titleEditInput}
              value={editedPlanTitle}
              onChangeText={setEditedPlanTitle}
              placeholder={t("createProject.ai.projectName")}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t("createProject.ai.editTitleLabel")}
            />
          </View>

          <View style={styles.proposalCard}>
            <Text style={styles.proposalCardLabel}>{t("createProject.ai.projectType")}</Text>
            <Text style={styles.proposalBody}>{categoryLabel}</Text>
            <Text style={[styles.proposalCardLabel, { marginTop: spacing.sm }]}>{t("createProject.ai.scope")}</Text>
            <Text style={styles.proposalBody}>{scopeLabel}</Text>
            {plan.summary?.trim() ? (
              <>
                <Text style={[styles.proposalCardLabel, { marginTop: spacing.sm }]}>{t("createProject.ai.summary")}</Text>
                <Text style={styles.proposalBody}>{plan.summary.trim()}</Text>
              </>
            ) : null}
          </View>

          <Text style={styles.phasesTitle}>{t("createProject.ai.phases")}</Text>
          {plan.phases.map((phase, pi) => (
            <View key={pi} style={styles.phaseBlock}>
              <Text style={styles.phaseName}>{phase.name}</Text>
              {phase.tasks.map((task, ti) => (
                <View key={ti} style={styles.taskRow}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.taskTitle}>{task.title}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {error ? (
          <View style={[styles.previewFallbackRow, narrowActions && styles.secondaryActionsColumn]}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, styles.previewFallbackBtn, narrowActions && styles.btnFullWidth]}
              onPress={() => {
                setError(null);
                onManual();
              }}
            >
              <Text style={styles.btnSecondaryText}>{t("createProject.ai.manual")}</Text>
            </TouchableOpacity>
            {onUseTemplate ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary, styles.previewFallbackBtn, narrowActions && styles.btnFullWidth]}
                onPress={() => {
                  setError(null);
                  onUseTemplate();
                }}
              >
                <Text style={styles.btnSecondaryText}>{t("createProject.ai.useTemplate")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            styles.previewFooter,
            narrowActions && styles.previewFooterColumn,
            { paddingBottom: Math.max(insets.bottom, spacing.sm) },
          ]}
        >
          <View style={[styles.previewActionsSecondary, narrowActions && styles.secondaryActionsColumn]}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, narrowActions && styles.btnFullWidth]}
              onPress={handleChangeDescription}
            >
              <Text style={styles.btnSecondaryText}>{t("createProject.ai.changeDescription")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, narrowActions && styles.btnFullWidth]}
              onPress={handleGenerateAgain}
            >
              <Text style={styles.btnSecondaryText}>{t("createProject.ai.generateAgain")}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, styles.createBtn, narrowActions && styles.btnFullWidth]}
            onPress={handleCreate}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>{t("createProject.ai.confirmCreate")}</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>{t("projects.cancel")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
  },
  previewRoot: {
    paddingBottom: 0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  question: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
    lineHeight: 22,
  },
  briefPrefilledHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  textArea: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
  briefScroll: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  basicFieldsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  basicField: {
    flex: 1,
    minWidth: 90,
  },
  basicFieldLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  basicFieldInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tradeFieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: 4,
    marginTop: spacing.xs,
  },
  tradeFieldInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  tradeNotesInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  attachSection: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachSectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  attachSectionHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  attachButtons: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  attachBtn: {
    alignItems: "center",
    flex: 1,
  },
  attachIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.primary + "14",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  attachBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    textAlign: "center",
  },
  docList: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  docItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  docName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  generatingText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 13,
    color: "#c62828",
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  secondaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  secondaryActionsColumn: {
    flexDirection: "column",
  },
  secondaryActionBtn: {
    flex: 1,
    minWidth: 120,
  },
  btnFullWidth: {
    width: "100%",
    flex: undefined,
    minWidth: undefined,
  },
  previewFallbackRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  previewFallbackBtn: {
    flex: 1,
    minWidth: 100,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  btnSecondary: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  previewSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  previewScroll: {
    flex: 1,
    flexGrow: 1,
  },
  proposalCard: {
    backgroundColor: colors.card,
    borderRadius: radius + 1,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  proposalCardLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  proposalBody: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  titleEditInput: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  phasesTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  phaseBlock: {
    marginBottom: spacing.md,
    paddingLeft: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  phaseName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: 2,
  },
  taskTitle: {
    fontSize: 13,
    color: colors.text,
    flex: 1,
    lineHeight: 18,
  },
  previewFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  previewFooterColumn: {
    flexDirection: "column",
  },
  previewActionsSecondary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  createBtn: {
    minHeight: 48,
  },
});
