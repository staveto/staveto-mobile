/**
 * AI project creation: brief → generated draft plan → user review/edit → create in Firestore (callable).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Modal,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import {
  generateProjectStructureWithAI,
  createProjectFromAiPlan,
  refineGeneratedProjectNodeCall,
  uploadAiDraftDocument,
  normalizeCallableErrorCode,
  type CreateProjectFromAiPlanParams,
  type AiDraftDocument,
  type AiGenerationStatus,
} from "../services/aiProjectService";
import { patchProjectDocument } from "../services/projects";
import { uploadAttachment } from "../services/attachments";
import { createProjectDocument } from "../services/projectDocuments";
import { getAuth } from "../firebase";
import type { AiProjectPlan, AiTask } from "../lib/aiProjectSchema";
import type { AiProjectDraft } from "../lib/aiProjectDraft";
import {
  aiPlanToDraft,
  appendDraftTask,
  deleteDraftPhase,
  deleteDraftTask,
  draftPhaseToAiPhase,
  draftTaskToAiTask,
  draftToAiProjectPlan,
  replaceDraftPhase,
  replaceDraftTask,
  updateDraftPhaseField,
  updateDraftTaskField,
} from "../lib/aiProjectDraft";
import { ProjectAIDraftReview } from "./ProjectAIDraftReview";
import { RefineDraftNodeSheet } from "./RefineDraftNodeSheet";
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

type Step = "brief" | "generating" | "review";

type Props = {
  onCreated: (projectId: string) => void;
  onManual: () => void;
  onCancel: () => void;
  /** `unified` = no BUILD/TRADE in UI; AI infers structure from plain language. */
  flowVariant?: "legacy" | "unified";
  /** Context from wizard: Bau/Aufträge + work type (Neubau, Renovierung, etc.) — legacy only. */
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

/** Raw code + message for __DEV__ diagnostics under the friendly AI error line. */
function formatAiDiagnostic(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: unknown };
  const code = normalizeCallableErrorCode(err?.code) || "";
  const rawMsg = err instanceof Error ? err.message : String(e ?? "");
  let detailExtra = "";
  if (err?.details != null && typeof err.details !== "string") {
    try {
      detailExtra = JSON.stringify(err.details).slice(0, 140);
    } catch {
      detailExtra = "";
    }
  }
  const parts = [
    code ? `[${code}]` : "",
    normalizeAiErrorMessage(rawMsg).slice(0, 220),
    detailExtra ? `details:${detailExtra}` : "",
  ].filter(Boolean);
  return parts.join(" ").trim().slice(0, 320);
}

type UploadStatus = "local" | "uploading" | "uploaded" | "failed";

type DraftAttachment = AiDraftDocument & {
  id: string;
  status: UploadStatus;
  storagePath?: string;
  errorCode?: string;
};

/** Gemini / backend provider failures — user-facing hint points to secrets & deploy. */
function looksLikeGeminiOrProviderFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("generation failed at the provider") ||
    m.includes("gemini api") ||
    m.includes("generativelanguage.googleapis") ||
    m.includes("invalid api key") ||
    m.includes("permission_denied") ||
    (m.includes("quota") && m.includes("exceeded")) ||
    (m.includes("access denied") && m.includes("403")) ||
    m.includes("api configuration is outdated") ||
    m.includes("rejected the request (auth)")
  );
}

function getAiErrorMessage(code: string | undefined, message: string, t: (key: string) => string): string {
  const cleaned = normalizeAiErrorMessage(message);
  const codeLower = normalizeCallableErrorCode(code);
  const msgLower = cleaned.toLowerCase();
  const generic =
    t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.";
  const maxDetailLen = 320;

  if (!cleaned && !code) return generic;
  if (codeLower === "unauthenticated" || msgLower.includes("authentication required")) {
    return t("createProject.ai.errorAuth") || "Musíte byť prihlásený. Skúste sa odhlásiť a znova prihlásiť.";
  }
  if (
    codeLower === "not-found" ||
    msgLower === "not_found" ||
    msgLower.includes("not_found") ||
    cleaned.trim().toUpperCase() === "NOT_FOUND"
  ) {
    return (
      t("createProject.ai.errorCallableNotFound") ||
      "Funkcia na úpravu položky nie je na serveri dostupná (NOT_FOUND). Nasadiť refineGeneratedProjectNode vo Firebase alebo uprav položku ručne."
    );
  }
  if (looksLikeGeminiOrProviderFailure(cleaned) || looksLikeGeminiOrProviderFailure(message)) {
    return (
      t("createProject.ai.errorProvider") ||
      "Server nemá platné pripojenie k Gemini (kľúč API alebo konfigurácia). Skontroluj Firebase Functions secret GOOGLE_GENERATIVE_AI_API_KEY a deploy, alebo pokračuj bez AI."
    );
  }
  if (
    codeLower === "failed-precondition" &&
    (msgLower.includes("ai service not configured") ||
      msgLower.includes("set google_generative_ai_api_key") ||
      msgLower.includes("not configured. set google"))
  ) {
    return t("createProject.ai.errorNotConfigured") || "AI služba nie je nakonfigurovaná. Kontaktujte podporu.";
  }
  if (codeLower === "resource-exhausted" || msgLower.includes("overloaded")) {
    return t("createProject.ai.errorRateLimit") || "AI je dočasne preťažená. Skúste o chvíľu alebo pokračujte bez AI.";
  }
  if (codeLower === "deadline-exceeded" || codeLower === "cancelled") {
    return t("createProject.ai.errorNetwork") || "Slabé pripojenie alebo žiadny internet. Skúste znova.";
  }
  if (
    msgLower.includes("network request failed") ||
    msgLower.includes("failed to fetch") ||
    msgLower.includes("abort") ||
    msgLower.includes("aborted") ||
    msgLower.includes("timed out") ||
    msgLower.includes("timeout") ||
    msgLower.includes("slabé pripojenie")
  ) {
    return t("createProject.ai.errorNetwork") || "Slabé pripojenie alebo žiadny internet. Skúste znova.";
  }
  if (msgLower.includes("network")) {
    return t("createProject.ai.errorNetwork") || "Slabé pripojenie alebo žiadny internet. Skúste znova.";
  }

  const trimmedDetail = cleaned.trim();
  const bareInternal =
    trimmedDetail.length === 0 ||
    /^internal(\s+error)?$/i.test(trimmedDetail) ||
    trimmedDetail.toLowerCase() === "internal";
  if (codeLower === "internal" && bareInternal) {
    return generic;
  }

  if (trimmedDetail.length > 0) {
    return trimmedDetail.length > maxDetailLen
      ? `${trimmedDetail.slice(0, maxDetailLen - 1).trimEnd()}…`
      : trimmedDetail;
  }

  return generic;
}

function mapStorageUploadErrorToMessage(
  err: unknown,
  t: (key: string) => string
): { message: string; code: string } {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? "").toLowerCase();
  const msg = String(e?.message ?? "");

  const isUnauthorized = code.includes("unauthorized") || msg.toLowerCase().includes("permission-denied");
  if (isUnauthorized) {
    return { code: "storage/unauthorized", message: t("createProject.ai.uploadErrorUnauthorized") };
  }
  if (code.includes("canceled") || code.includes("cancelled")) {
    return { code: "storage/canceled", message: t("createProject.ai.uploadErrorCanceled") };
  }
  if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("timeout")) {
    return { code: code || "network", message: t("createProject.ai.uploadErrorNetwork") };
  }
  return { code: code || "unknown", message: t("createProject.ai.uploadErrorUnknown") };
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

function buildUnifiedOptionalDetails(extra: string): string | undefined {
  const e = extra.trim();
  if (!e) return undefined;
  return [
    e,
    "Infer internally whether work fits phased construction vs compact trade/service tasks. Do not ask the user to classify the project.",
  ].join(" | ");
}

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
  onCancel,
  flowVariant = "legacy",
  engineType,
  workType,
  initialBrief,
  jobWorkflowKind,
  serviceMaintenanceScope,
}: Props) {
  const { t } = useI18n();
  const isUnified = flowVariant === "unified";
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const narrowActions = width < 380;

  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState("");
  const [documents, setDocuments] = useState<DraftAttachment[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [roofType, setRoofType] = useState("");
  const [areaM2, setAreaM2] = useState("");
  const [floorCount, setFloorCount] = useState("");
  const [tradeLocation, setTradeLocation] = useState("");
  const [tradeClientObject, setTradeClientObject] = useState("");
  const [tradeNotes, setTradeNotes] = useState("");
  const [draftPlan, setDraftPlan] = useState<AiProjectDraft | null>(null);
  const [editedPlanTitle, setEditedPlanTitle] = useState("");
  const [refineSheet, setRefineSheet] = useState<
    | null
    | { kind: "phase"; phaseId: string; pi: number }
    | { kind: "task"; phaseId: string; taskId: string; pi: number; ti: number }
  >(null);
  const [refiningKey, setRefiningKey] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<
    | null
    | { kind: "phase"; phaseId: string; title: string; description: string }
    | { kind: "task"; phaseId: string; taskId: string; title: string; description: string }
  >(null);
  const [addTaskPhaseId, setAddTaskPhaseId] = useState<string | null>(null);
  const [addTaskTitle, setAddTaskTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Dev-only raw callable hint shown under {@link error} for debugging AI failures. */
  const [lastAiDiagnostic, setLastAiDiagnostic] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiGenerationStatus | null>(null);
  const [aiBusyStartedAt, setAiBusyStartedAt] = useState<number | null>(null);
  const [aiElapsedMs, setAiElapsedMs] = useState(0);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [unifiedName, setUnifiedName] = useState("");
  const [unifiedDescription, setUnifiedDescription] = useState("");
  const [unifiedExtra, setUnifiedExtra] = useState("");
  /** Friendly reference (optional); synced with draft review edits when returning to prompt. */
  const [projectNumberInput, setProjectNumberInput] = useState("");

  const clearAiUiError = () => {
    setError(null);
    setLastAiDiagnostic(null);
  };

  useEffect(() => {
    const seed = initialBrief?.trim();
    if (!seed) return;
    if (isUnified) {
      setUnifiedDescription((prev) => (prev.trim() ? prev : seed));
    } else {
      setBrief((prev) => (prev.trim() ? prev : seed));
    }
  }, [initialBrief, isUnified]);

  /**
   * Tick elapsed time while the AI flow is busy (generating or saving) so the UI
   * can show "this is taking longer than usual" hints after ~15s.
   */
  useEffect(() => {
    if (aiBusyStartedAt == null) {
      setAiElapsedMs(0);
      return;
    }
    setAiElapsedMs(Date.now() - aiBusyStartedAt);
    const id = setInterval(() => {
      setAiElapsedMs(Date.now() - aiBusyStartedAt);
    }, 1000);
    return () => clearInterval(id);
  }, [aiBusyStartedAt]);

  const beginAiBusy = useCallback(() => {
    setAiStatus(null);
    setAiBusyStartedAt(Date.now());
  }, []);

  const endAiBusy = useCallback(() => {
    setAiStatus(null);
    setAiBusyStartedAt(null);
  }, []);

  const isTradeAi = !isUnified && engineType === "TRADE";

  const aiOptionsBase = useMemo(
    () => ({
      engineType: isUnified ? undefined : engineType,
      workType: isUnified ? undefined : workType,
      jobWorkflowKind: isUnified ? undefined : jobWorkflowKind ?? undefined,
      serviceMaintenanceScope: isUnified ? undefined : serviceMaintenanceScope ?? undefined,
    }),
    [engineType, workType, jobWorkflowKind, serviceMaintenanceScope, isUnified]
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
        const newDocs: DraftAttachment[] = result.assets.map((asset, i) => ({
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${i}`,
          localUri: asset.uri,
          fileName: asset.fileName ?? `foto_${Date.now()}_${i}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
          status: "local",
        }));
        setDocuments((prev) => [...prev, ...newDocs]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Photo pick error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.photoPickFailed"));
    }
  };

  const takePhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("createProject.ai.imagePickerNotInstalled"));
      return;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("common.error"), t("createProject.ai.cameraPermissionDenied"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (!result.canceled && asset?.uri) {
        const newDoc: DraftAttachment = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          localUri: asset.uri,
          fileName: asset.fileName ?? `foto_${Date.now()}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
          status: "local",
        };
        setDocuments((prev) => [...prev, newDoc]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Photo capture error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.takePhotoFailed"));
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
        setDocuments((prev) => [
          ...prev,
          {
            id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            localUri: asset.uri,
            fileName,
            mimeType,
            status: "local",
          },
        ]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Document pick error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.documentPickFailed"));
    }
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  /**
   * After project creation, copy draft files (photos + PDFs) into the project
   * so the user finds them in the project's photo gallery / Documents tab.
   *
   * Best-effort: failures per file are logged but do not block the flow,
   * because the project itself was created successfully.
   */
  const attachDraftFilesToProject = async (projectId: string): Promise<void> => {
    const filesToAttach = documents.filter((d) => !!d.localUri && d.status !== "failed");
    if (filesToAttach.length === 0) return;

    const ownerId = getAuth()?.currentUser?.uid ?? null;
    const total = filesToAttach.length;
    let done = 0;

    for (const file of filesToAttach) {
      try {
        const mime = (file.mimeType ?? "").toLowerCase();
        const isImage = mime.startsWith("image/");
        const isPdf = mime === "application/pdf" || file.fileName?.toLowerCase().endsWith(".pdf");
        const kind: "image" | "pdf" | "other" = isImage ? "image" : isPdf ? "pdf" : "other";

        const attachment = await uploadAttachment(projectId, {
          localUri: file.localUri,
          fileName: file.fileName,
          mimeType: file.mimeType,
          kind,
        });

        if ((kind === "pdf" || kind === "other") && ownerId) {
          try {
            await createProjectDocument(ownerId, projectId, {
              name: file.fileName,
              type: "other",
              attachmentId: attachment.id,
            });
          } catch (docErr) {
            if (__DEV__) {
              console.warn(
                `[CreateProjectAIFlow] createProjectDocument failed for ${file.fileName}:`,
                docErr
              );
            }
          }
        }
      } catch (err) {
        if (__DEV__) {
          console.warn(
            `[CreateProjectAIFlow] Failed to attach draft file ${file.fileName} to project ${projectId}:`,
            err
          );
        }
      } finally {
        done += 1;
        setAiStatus({ phase: "uploading_docs", current: done, total });
      }
    }
  };

  const ensureDraftId = (): string => {
    if (draftId) return draftId;
    const created = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    setDraftId(created);
    return created;
  };

  const uploadSingleDoc = async (doc: DraftAttachment): Promise<DraftAttachment> => {
    if (doc.status === "uploaded" && doc.storagePath) return doc;
    const effectiveDraftId = ensureDraftId();
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, status: "uploading", errorCode: undefined } : d))
    );
    try {
      const path = await uploadAiDraftDocument(
        { localUri: doc.localUri, fileName: doc.fileName, mimeType: doc.mimeType },
        effectiveDraftId
      );
      const updated: DraftAttachment = { ...doc, status: "uploaded", storagePath: path, errorCode: undefined };
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
      return updated;
    } catch (e) {
      const mapped = mapStorageUploadErrorToMessage(e, t);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] upload failed", { code: mapped.code, fileName: doc.fileName });
      }
      const failed: DraftAttachment = { ...doc, status: "failed", errorCode: mapped.code };
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? failed : d)));
      return failed;
    }
  };

  const runGeneration = async () => {
    const trimmed = isUnified
      ? [unifiedName.trim(), unifiedDescription.trim()].filter(Boolean).join("\n\n").trim()
      : brief.trim();
    if (!trimmed) {
      setLastAiDiagnostic(null);
      setError(isUnified ? t("createProject.unified.ai.briefMissing") : t("createProject.ai.briefRequired"));
      return;
    }
    if (isUnified && !unifiedName.trim()) {
      setLastAiDiagnostic(null);
      setError(t("createProject.nameRequired"));
      return;
    }
    if (isUnified && unifiedDescription.trim().length < 3) {
      setLastAiDiagnostic(null);
      setError(t("createProject.unified.ai.descriptionTooShort"));
      return;
    }

    clearAiUiError();
    setStep("generating");
    beginAiBusy();

    try {
      let documentStoragePaths: string[] = [];
      if (documents.length > 0) {
        setUploadingDocs(true);
        const toUpload = documents.filter((d) => d.status !== "uploaded");
        const alreadyUploaded = documents.filter((d) => d.status === "uploaded" && !!d.storagePath);
        const totalToUpload = toUpload.length;

        let uploadedCount = 0;
        if (totalToUpload > 0) {
          setAiStatus({ phase: "uploading_docs", current: 0, total: totalToUpload });
        }
        for (const d of toUpload) {
          const updated = await uploadSingleDoc(d);
          uploadedCount += 1;
          if (updated.status === "uploaded" && updated.storagePath) {
            documentStoragePaths.push(updated.storagePath);
          }
          if (totalToUpload > 0) {
            setAiStatus({
              phase: "uploading_docs",
              current: uploadedCount,
              total: totalToUpload,
            });
          }
        }
        for (const d of alreadyUploaded) {
          if (d.storagePath) documentStoragePaths.push(d.storagePath);
        }
        setUploadingDocs(false);
      }

      const projectDetails = isUnified
        ? buildUnifiedOptionalDetails(unifiedExtra)
        : mergeAiProjectDetails(
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
        onStatus: setAiStatus,
      });
      const draft = aiPlanToDraft(result, {
        projectNumber: projectNumberInput.trim() || undefined,
      });
      setDraftPlan(draft);
      setEditedPlanTitle(
        resolveFinalProjectTitle(isUnified ? unifiedName : brief, result.projectTitle ?? "")
      );
      setStep("review");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generation failed", code, msg.slice(0, 160));
      }
      setLastAiDiagnostic(__DEV__ ? formatAiDiagnostic(e) : null);
      setError(getAiErrorMessage(code, msg, t));
      setStep("brief");
      setUploadingDocs(false);
    } finally {
      endAiBusy();
    }
  };

  const handleManual = () => {
    onManual();
  };

  const handleChangeDescription = () => {
    if (draftPlan?.projectNumber?.trim()) {
      setProjectNumberInput(draftPlan.projectNumber.trim());
    }
    setStep("brief");
    clearAiUiError();
    setDraftPlan(null);
    setRefineSheet(null);
    setRefiningKey(null);
    if (isUnified) {
      setShowOptionalDetails(false);
    }
  };

  const briefForAiCalls = useMemo(() => {
    return isUnified
      ? [unifiedName.trim(), unifiedDescription.trim()].filter(Boolean).join("\n\n").trim()
      : brief.trim();
  }, [brief, isUnified, unifiedDescription, unifiedName]);

  const handleGenerateAgain = async () => {
    const trimmedAgain = isUnified
      ? [unifiedName.trim(), unifiedDescription.trim()].filter(Boolean).join("\n\n").trim()
      : brief.trim();
    if (!trimmedAgain) return;
    clearAiUiError();
    setStep("generating");
    beginAiBusy();
    try {
      let documentStoragePaths: string[] = [];
      if (documents.length > 0) {
        setUploadingDocs(true);
        const toUpload = documents.filter((d) => d.status !== "uploaded");
        const alreadyUploaded = documents.filter((d) => d.status === "uploaded" && !!d.storagePath);
        const totalToUpload = toUpload.length;
        let uploadedCount = 0;
        if (totalToUpload > 0) {
          setAiStatus({ phase: "uploading_docs", current: 0, total: totalToUpload });
        }
        for (const d of toUpload) {
          const updated = await uploadSingleDoc(d);
          uploadedCount += 1;
          if (updated.status === "uploaded" && updated.storagePath) {
            documentStoragePaths.push(updated.storagePath);
          }
          if (totalToUpload > 0) {
            setAiStatus({
              phase: "uploading_docs",
              current: uploadedCount,
              total: totalToUpload,
            });
          }
        }
        for (const d of alreadyUploaded) {
          if (d.storagePath) documentStoragePaths.push(d.storagePath);
        }
        setUploadingDocs(false);
      }
      const projectDetails = isUnified
        ? buildUnifiedOptionalDetails(unifiedExtra)
        : mergeAiProjectDetails(
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

      const result = await generateProjectStructureWithAI(trimmedAgain, {
        ...aiOptionsBase,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
        projectDetails,
        onStatus: setAiStatus,
      });
      setDraftPlan(
        aiPlanToDraft(result, {
          projectNumber: projectNumberInput.trim() || undefined,
        })
      );
      setEditedPlanTitle(
        resolveFinalProjectTitle(isUnified ? unifiedName : brief, result.projectTitle ?? "")
      );
      setStep("review");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generate again failed", code, msg.slice(0, 160));
      }
      setLastAiDiagnostic(__DEV__ ? formatAiDiagnostic(e) : null);
      setError(getAiErrorMessage(code, msg, t));
      setStep("review");
      setUploadingDocs(false);
    } finally {
      endAiBusy();
    }
  };

  const handleRefineSubmit = async (change: string, extra: string) => {
    if (!draftPlan || !refineSheet) {
      throw new Error(t("createProject.aiDraft.refineUnexpectedError"));
    }
    if (!briefForAiCalls.trim()) {
      throw new Error(
        isUnified ? t("createProject.unified.ai.briefMissing") : t("createProject.ai.briefRequired")
      );
    }

    const summaryLine = draftPlan.summary?.trim() ?? "";
    const phase = draftPlan.phases.find((p) => p.id === refineSheet.phaseId);
    if (!phase) {
      throw new Error(t("createProject.aiDraft.refineUnexpectedError"));
    }

    try {
      if (refineSheet.kind === "phase") {
        setRefiningKey(refineSheet.phaseId);
        let res: Awaited<ReturnType<typeof refineGeneratedProjectNodeCall>>;
        try {
          res = await refineGeneratedProjectNodeCall({
            projectBrief: briefForAiCalls,
            draftSummary: summaryLine,
            nodeKind: "phase",
            phaseIndex: refineSheet.pi,
            currentPhase: draftPhaseToAiPhase(phase),
            userChangeRequest: change,
            extraContext: extra || undefined,
          });
        } catch (e: unknown) {
          const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
          const code = normalizeCallableErrorCode((e as { code?: string })?.code);
          if (__DEV__) {
            console.warn("[CreateProjectAIFlow] refine phase failed", code, msg.slice(0, 160));
          }
          throw new Error(getAiErrorMessage(code, msg, t));
        }
        if (res.kind !== "phase") {
          throw new Error(t("createProject.aiDraft.refineUnexpectedError"));
        }
        setDraftPlan((prev) => (prev ? replaceDraftPhase(prev, refineSheet.phaseId, res.phase) : prev));
      } else {
        const task = phase.tasks.find((x) => x.id === refineSheet.taskId);
        if (!task) {
          throw new Error(t("createProject.aiDraft.refineUnexpectedError"));
        }
        setRefiningKey(`${refineSheet.phaseId}:${refineSheet.taskId}`);
        let res: Awaited<ReturnType<typeof refineGeneratedProjectNodeCall>>;
        try {
          res = await refineGeneratedProjectNodeCall({
            projectBrief: briefForAiCalls,
            draftSummary: summaryLine,
            nodeKind: "task",
            phaseIndex: refineSheet.pi,
            taskIndex: refineSheet.ti,
            currentTask: draftTaskToAiTask(task),
            userChangeRequest: change,
            extraContext: extra || undefined,
          });
        } catch (e: unknown) {
          const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
          const code = normalizeCallableErrorCode((e as { code?: string })?.code);
          if (__DEV__) {
            console.warn("[CreateProjectAIFlow] refine task failed", code, msg.slice(0, 160));
          }
          throw new Error(getAiErrorMessage(code, msg, t));
        }
        if (res.kind !== "task") {
          throw new Error(t("createProject.aiDraft.refineUnexpectedError"));
        }
        setDraftPlan((prev) =>
          prev ? replaceDraftTask(prev, refineSheet.phaseId, refineSheet.taskId, res.task) : prev
        );
      }
    } finally {
      setRefiningKey(null);
    }
  };

  const handleCreate = async () => {
    if (!draftPlan) return;
    const userSeed = isUnified ? unifiedName.trim() : brief.trim();
    const title = resolveFinalProjectTitle(userSeed, (editedPlanTitle.trim() || draftPlan.projectTitle).trim());
    if (!title.trim()) {
      setLastAiDiagnostic(null);
      setError(t("createProject.nameRequired"));
      return;
    }
    if (!draftPlan.phases.length || draftPlan.phases.some((p) => !p.tasks.length)) {
      setLastAiDiagnostic(null);
      setError(t("createProject.aiDraft.emptyDraftError"));
      return;
    }

    clearAiUiError();
    setSubmitting(true);
    beginAiBusy();
    setAiStatus({ phase: "saving" });

    try {
      const mergedPlan = draftToAiProjectPlan({
        ...draftPlan,
        projectTitle: title.trim(),
      });
      const originalBrief = isUnified
        ? [unifiedName.trim(), unifiedDescription.trim()].filter(Boolean).join("\n\n").trim() || undefined
        : brief.trim() || undefined;
      const params: CreateProjectFromAiPlanParams = {
        plan: mergedPlan,
        originalBrief,
        projectNumber: draftPlan.projectNumber?.trim() || undefined,
        onStatus: setAiStatus,
      };
      const projectId = await createProjectFromAiPlan(params);

      if (!isUnified) {
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
      }

      // Re-upload AI draft files into the project itself so the user can find
      // them later under photos / documents. Best-effort, never blocks success.
      const filesToReupload = documents.filter((d) => !!d.localUri && d.status !== "failed");
      if (filesToReupload.length > 0) {
        try {
          setUploadingDocs(true);
          setAiStatus({
            phase: "uploading_docs",
            current: 0,
            total: filesToReupload.length,
          });
          await attachDraftFilesToProject(projectId);
        } finally {
          setUploadingDocs(false);
        }
      }

      onCreated(projectId);
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = normalizeCallableErrorCode((e as { code?: string })?.code);
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] create from plan failed", code, msg.slice(0, 160));
      }
      setLastAiDiagnostic(__DEV__ ? formatAiDiagnostic(e) : null);
      setError(getAiErrorMessage(code, msg, t));
    } finally {
      setSubmitting(false);
      endAiBusy();
    }
  };

  if (step === "generating") {
    const elapsedSeconds = Math.floor(aiElapsedMs / 1000);
    const showSlowHint = elapsedSeconds >= 15;
    const showRetryDetail = aiStatus?.phase === "retrying";

    const statusLine = (() => {
      if (uploadingDocs && (!aiStatus || aiStatus.phase === "uploading_docs")) {
        const cur = aiStatus?.phase === "uploading_docs" ? aiStatus.current : undefined;
        const tot = aiStatus?.phase === "uploading_docs" ? aiStatus.total : undefined;
        if (typeof cur === "number" && typeof tot === "number" && tot > 0) {
          return t("createProject.ai.statusUploadingDocsProgress", {
            current: String(cur),
            total: String(tot),
          });
        }
        return t("createProject.ai.uploadingDocs");
      }
      switch (aiStatus?.phase) {
        case "connecting":
          return t("createProject.ai.statusConnecting");
        case "thinking":
          return t("createProject.ai.statusThinking");
        case "saving":
          return t("createProject.ai.statusSaving");
        case "validating":
          return t("createProject.ai.statusValidating");
        case "retrying":
          return t("createProject.ai.statusRetrying", {
            attempt: String(aiStatus.attempt),
            max: String(aiStatus.maxAttempts),
          });
        default:
          return t("createProject.ai.generating");
      }
    })();

    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.generatingText}>{statusLine}</Text>
        {elapsedSeconds > 3 ? (
          <Text style={styles.generatingElapsed}>
            {t("createProject.ai.statusElapsedSeconds", { seconds: String(elapsedSeconds) })}
          </Text>
        ) : null}
        {showRetryDetail ? (
          <Text style={styles.generatingRetryHint}>
            {t("createProject.ai.statusRetryHint")}
          </Text>
        ) : null}
        {showSlowHint && !showRetryDetail ? (
          <Text style={styles.generatingSlowHint}>{t("createProject.ai.statusSlowHint")}</Text>
        ) : null}
      </View>
    );
  }

  if (step === "brief") {
    const failedUploadsCount = documents.filter((d) => d.status === "failed").length;
    const hasAnyAttachments = documents.length > 0;

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <ScrollView style={styles.briefScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {isUnified ? (
            <>
              <Text style={styles.title}>{t("createProject.unified.ai.screenTitle")}</Text>
              <Text style={styles.subtitle}>{t("createProject.unified.ai.screenSubtitle")}</Text>
              <Text style={styles.mainLabel}>{t("createProject.unified.ai.nameLabel")}</Text>
              <TextInput
                style={styles.tradeFieldInput}
                value={unifiedName}
                onChangeText={(text) => {
                  setUnifiedName(text);
                  clearAiUiError();
                }}
                placeholder={t("createProject.unified.ai.namePlaceholder")}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={[styles.mainLabel, { marginTop: spacing.md }]}>
                {t("createProject.unified.ai.descriptionLabel")}
              </Text>
              <Text style={styles.mainHelper}>{t("createProject.unified.ai.descriptionHelper")}</Text>
              <TextInput
                style={styles.textArea}
                value={unifiedDescription}
                onChangeText={(text) => {
                  setUnifiedDescription(text);
                  clearAiUiError();
                }}
                placeholder={t("createProject.unified.ai.descriptionPlaceholder")}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              <Text style={[styles.mainLabel, { marginTop: spacing.md }]}>
                {t("createProject.aiDraft.projectNumberLabel")}
              </Text>
              <TextInput
                style={styles.tradeFieldInput}
                value={projectNumberInput}
                onChangeText={(text) => {
                  setProjectNumberInput(text);
                  clearAiUiError();
                }}
                placeholder={t("createProject.aiDraft.projectNumberPlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={styles.optionalToggle}
                onPress={() => setShowOptionalDetails((v) => !v)}
                activeOpacity={0.85}
              >
                <Text style={styles.optionalToggleText}>{t("createProject.unified.ai.optionalToggle")}</Text>
                <Ionicons
                  name={showOptionalDetails ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
              {showOptionalDetails ? (
                <View style={styles.optionalCard}>
                  <TextInput
                    style={[styles.tradeFieldInput, styles.tradeNotesInput]}
                    value={unifiedExtra}
                    onChangeText={setUnifiedExtra}
                    placeholder={t("createProject.unified.ai.optionalPlaceholder")}
                    placeholderTextColor={colors.textMuted}
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.title}>{t("createProject.ai.title")}</Text>
              <Text style={styles.subtitle}>{t("createProject.ai.subtitle")}</Text>

              <Text style={styles.mainLabel}>
                {isTradeAi ? t("createProject.ai.mainLabelTrade") : t("createProject.ai.mainLabel")}
              </Text>
              <Text style={styles.mainHelper}>{t("createProject.ai.mainHelper")}</Text>
              {initialBrief?.trim() ? (
                <Text style={styles.briefPrefilledHint}>{t("createProject.ai.briefPrefilledHint")}</Text>
              ) : null}
              <TextInput
                style={styles.textArea}
                value={brief}
                onChangeText={(text) => {
                  setBrief(text);
                  clearAiUiError();
                }}
                placeholder={isTradeAi ? t("createProject.ai.mainPlaceholderTrade") : t("createProject.ai.mainPlaceholder")}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
                editable={true}
              />
              <Text style={[styles.mainLabel, { marginTop: spacing.md }]}>
                {t("createProject.aiDraft.projectNumberLabel")}
              </Text>
              <TextInput
                style={styles.tradeFieldInput}
                value={projectNumberInput}
                onChangeText={(text) => {
                  setProjectNumberInput(text);
                  clearAiUiError();
                }}
                placeholder={t("createProject.aiDraft.projectNumberPlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={styles.optionalToggle}
                onPress={() => setShowOptionalDetails((v) => !v)}
                activeOpacity={0.85}
              >
                <Text style={styles.optionalToggleText}>
                  {isTradeAi ? t("createProject.ai.tradeOptionalSection") : t("createProject.ai.buildDetailsSection")}
                </Text>
                <Ionicons
                  name={showOptionalDetails ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {showOptionalDetails ? (
                isTradeAi ? (
                  <View style={styles.optionalCard}>
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
                  </View>
                ) : (
                  <View style={styles.optionalCard}>
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
                  </View>
                )
              ) : null}
            </>
          )}
          <View style={styles.attachSection}>
            <Text style={styles.attachSectionTitle}>
              {isUnified
                ? t("createProject.unified.ai.attachTitle")
                : isTradeAi
                  ? t("createProject.ai.attachTitleTrade")
                  : t("createProject.ai.attachTitle")}
            </Text>
            <Text style={styles.attachSectionHint}>
              {isUnified
                ? t("createProject.unified.ai.attachHint")
                : isTradeAi
                  ? t("createProject.ai.attachHintTrade")
                  : t("createProject.ai.attachHint")}
            </Text>
            <View style={styles.attachButtons}>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={takePhoto}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.ai.takePhoto")}
              >
                <View style={styles.attachIconWrap}>
                  <Ionicons name="camera-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.attachBtnText}>{t("createProject.ai.takePhoto")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.ai.chooseFromGallery")}
              >
                <View style={styles.attachIconWrap}>
                  <Ionicons name="images-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.attachBtnText}>{t("createProject.ai.chooseFromGallery")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={pickDocument}
                accessibilityRole="button"
                accessibilityLabel={t("createProject.ai.addDocument")}
              >
                <View style={styles.attachIconWrap}>
                  <Ionicons name="document-text-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.attachBtnText}>{t("createProject.ai.addDocument")}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {hasAnyAttachments ? (
            <View style={styles.docList}>
              {documents.map((doc) => {
                const isImage = (doc.mimeType ?? "").startsWith("image/");
                const statusIcon =
                  doc.status === "uploaded"
                    ? "checkmark-circle"
                    : doc.status === "failed"
                      ? "alert-circle"
                      : doc.status === "uploading"
                        ? "cloud-upload-outline"
                        : "time-outline";
                const statusColor =
                  doc.status === "uploaded"
                    ? "#2e7d32"
                    : doc.status === "failed"
                      ? "#c62828"
                      : colors.textMuted;

                const statusText =
                  doc.status === "uploaded"
                    ? t("createProject.ai.uploadStatusUploaded")
                    : doc.status === "uploading"
                      ? t("createProject.ai.uploadStatusUploading")
                      : doc.status === "failed"
                        ? t("createProject.ai.uploadStatusFailed")
                        : t("createProject.ai.uploadStatusPending");

                const humanErr =
                  doc.status === "failed"
                    ? mapStorageUploadErrorToMessage({ code: doc.errorCode }, t).message
                    : null;

                return (
                  <View key={doc.id} style={styles.docItem}>
                    <Ionicons
                      name={isImage ? "image-outline" : "document-text-outline"}
                      size={18}
                      color={colors.primary}
                    />
                    <View style={styles.docMain}>
                      <Text style={styles.docName} numberOfLines={1}>
                        {doc.fileName}
                      </Text>
                      <View style={styles.docMetaRow}>
                        <Ionicons name={statusIcon as any} size={14} color={statusColor} />
                        <Text style={[styles.docStatusText, doc.status === "failed" && styles.docStatusTextError]}>
                          {statusText}
                        </Text>
                      </View>
                      {humanErr ? <Text style={styles.docErrorText}>{humanErr}</Text> : null}
                    </View>

                    {doc.status === "failed" ? (
                      <View style={styles.docActions}>
                        <TouchableOpacity
                          onPress={() => uploadSingleDoc(doc)}
                          style={styles.docActionBtn}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.docActionText}>{t("createProject.ai.retry")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => removeDocument(doc.id)}
                          style={styles.docActionBtn}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.docActionText}>{t("createProject.ai.remove")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => removeDocument(doc.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        disabled={doc.status === "uploading"}
                      >
                        <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={styles.aiInfoBox}>
            <Ionicons name="information-circle-outline" size={18} color={styles.aiInfoIcon.color} style={styles.aiInfoIcon} />
            <Text style={styles.aiInfoText}>{t("createProject.ai.disclaimer")}</Text>
          </View>

          {failedUploadsCount > 0 ? (
            <Text style={styles.attachNonBlockingHint}>{t("createProject.ai.attachNonBlockingHint")}</Text>
          ) : null}

          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              {__DEV__ && lastAiDiagnostic ? (
                <Text style={styles.errorDiagnosticText} selectable>
                  {lastAiDiagnostic}
                </Text>
              ) : null}
            </>
          ) : null}
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
            </View>
          </View>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>{t("projects.cancel")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (step === "review" && draftPlan) {
    const legacyCategoryLabel = !isUnified ? getCategoryLabel(draftPlan.category, t) : "";
    const legacyScopeLabel = !isUnified ? getScopeLabel(draftPlan.scope, t) : "";

    const applyEditSave = () => {
      if (!editModal || !draftPlan) return;
      if (editModal.kind === "phase") {
        setDraftPlan(
          updateDraftPhaseField(draftPlan, editModal.phaseId, {
            name: editModal.title.trim(),
            description: editModal.description.trim() || undefined,
          })
        );
      } else {
        setDraftPlan(
          updateDraftTaskField(draftPlan, editModal.phaseId, editModal.taskId, {
            title: editModal.title.trim(),
            description: editModal.description.trim() || undefined,
          })
        );
      }
      setEditModal(null);
    };

    const openEditPhase = (phaseId: string) => {
      const ph = draftPlan.phases.find((p) => p.id === phaseId);
      if (!ph) return;
      setEditModal({
        kind: "phase",
        phaseId,
        title: ph.name,
        description: ph.description ?? "",
      });
    };

    const openEditTask = (phaseId: string, taskId: string) => {
      const ph = draftPlan.phases.find((p) => p.id === phaseId);
      const tk = ph?.tasks.find((x) => x.id === taskId);
      if (!tk) return;
      setEditModal({
        kind: "task",
        phaseId,
        taskId,
        title: tk.title,
        description: tk.description ?? "",
      });
    };

    const refinePreview = refineSheet
      ? (() => {
          const ph = draftPlan.phases.find((p) => p.id === refineSheet.phaseId);
          if (!ph) return { title: "", description: "" };
          if (refineSheet.kind === "phase") {
            return { title: ph.name, description: ph.description ?? "" };
          }
          const tk = ph.tasks.find((x) => x.id === refineSheet.taskId);
          return { title: tk?.title ?? "", description: tk?.description ?? "" };
        })()
      : { title: "", description: "" };

    const handleEditManuallyFromRefine = () => {
      if (!refineSheet || !draftPlan) return;
      const snap = refineSheet;
      const ph = draftPlan.phases.find((p) => p.id === snap.phaseId);
      setRefineSheet(null);
      if (!ph) return;
      if (snap.kind === "phase") {
        setEditModal({
          kind: "phase",
          phaseId: snap.phaseId,
          title: ph.name,
          description: ph.description ?? "",
        });
      } else {
        const tk = ph.tasks.find((x) => x.id === snap.taskId);
        if (!tk) return;
        setEditModal({
          kind: "task",
          phaseId: snap.phaseId,
          taskId: snap.taskId,
          title: tk.title,
          description: tk.description ?? "",
        });
      }
    };

    return (
      <View style={[styles.container, styles.previewRoot]}>
        {!isUnified ? (
          <View style={styles.legacyHintCard}>
            <Text style={styles.legacyHintLabel}>{t("createProject.ai.projectType")}</Text>
            <Text style={styles.legacyHintBody}>{legacyCategoryLabel}</Text>
            <Text style={[styles.legacyHintLabel, { marginTop: spacing.sm }]}>{t("createProject.ai.scope")}</Text>
            <Text style={styles.legacyHintBody}>{legacyScopeLabel}</Text>
          </View>
        ) : null}

        <View style={{ flex: 1, minHeight: 0 }}>
          <ProjectAIDraftReview
          draft={draftPlan}
          editedTitle={editedPlanTitle}
          onChangeTitle={setEditedPlanTitle}
          editedProjectNumber={draftPlan.projectNumber ?? ""}
          onChangeProjectNumber={(value) =>
            setDraftPlan((prev) => (prev ? { ...prev, projectNumber: value } : prev))
          }
          refiningKey={refiningKey}
          onRefinePhase={(phaseId, pi) => setRefineSheet({ kind: "phase", phaseId, pi })}
          onRefineTask={(phaseId, taskId, pi, ti) =>
            setRefineSheet({ kind: "task", phaseId, taskId, pi, ti })
          }
          onEditPhase={openEditPhase}
          onEditTask={openEditTask}
          onDeletePhase={(phaseId) =>
            Alert.alert(
              t("createProject.aiDraft.deleteConfirmTitle"),
              t("createProject.aiDraft.deleteConfirmPhaseBody"),
              [
                { text: t("projects.cancel"), style: "cancel" },
                {
                  text: t("createProject.aiDraft.delete"),
                  style: "destructive",
                  onPress: () =>
                    setDraftPlan((prev) => (prev ? deleteDraftPhase(prev, phaseId) : prev)),
                },
              ]
            )
          }
          onDeleteTask={(phaseId, taskId) =>
            Alert.alert(
              t("createProject.aiDraft.deleteConfirmTitle"),
              t("createProject.aiDraft.deleteConfirmTaskBody"),
              [
                { text: t("projects.cancel"), style: "cancel" },
                {
                  text: t("createProject.aiDraft.delete"),
                  style: "destructive",
                  onPress: () =>
                    setDraftPlan((prev) => (prev ? deleteDraftTask(prev, phaseId, taskId) : prev)),
                },
              ]
            )
          }
          onAddTask={(phaseId) => {
            setAddTaskPhaseId(phaseId);
            setAddTaskTitle("");
          }}
          />
        </View>

        {error ? (
          <>
            <Text style={styles.errorText}>{error}</Text>
            {__DEV__ && lastAiDiagnostic ? (
              <Text style={styles.errorDiagnosticText} selectable>
                {lastAiDiagnostic}
              </Text>
            ) : null}
          </>
        ) : null}
        {error ? (
          <View style={[styles.previewFallbackRow, narrowActions && styles.secondaryActionsColumn]}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, styles.previewFallbackBtn, narrowActions && styles.btnFullWidth]}
              onPress={() => {
                clearAiUiError();
                onManual();
              }}
            >
              <Text style={styles.btnSecondaryText}>{t("createProject.ai.continueManual")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View
          style={[
            styles.previewFooter,
            { paddingBottom: Math.max(insets.bottom, spacing.xs) },
          ]}
        >
          <View style={[styles.previewActionsSecondary, narrowActions && styles.secondaryActionsColumn]}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, styles.btnCompact, narrowActions && styles.btnFullWidth]}
              onPress={handleChangeDescription}
            >
              <Text style={styles.btnSecondaryTextCompact} numberOfLines={1}>
                {t("createProject.aiDraft.backToPrompt")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, styles.btnCompact, narrowActions && styles.btnFullWidth]}
              onPress={handleGenerateAgain}
              disabled={refiningKey !== null}
            >
              <Text style={styles.btnSecondaryTextCompact} numberOfLines={1}>
                {t("createProject.aiDraft.regenerateWholeDraft")}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, styles.createBtnCompact]}
            onPress={handleCreate}
            disabled={submitting || refiningKey !== null}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryTextCompact}>{t("createProject.aiDraft.confirmProject")}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelInlineBtn} onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
            <Text style={styles.cancelText}>{t("projects.cancel")}</Text>
          </TouchableOpacity>
        </View>

        <RefineDraftNodeSheet
          visible={!!refineSheet}
          sheetTitle={
            refineSheet?.kind === "task"
              ? t("createProject.aiDraft.refineTaskTitle")
              : t("createProject.aiDraft.refinePhaseTitle")
          }
          previewLabel={t("createProject.aiDraft.previewLabel")}
          previewTitle={refinePreview.title}
          previewDescription={refinePreview.description}
          changeLabel={t("createProject.aiDraft.whatShouldChange")}
          extraLabel={t("createProject.aiDraft.addMoreDetails")}
          changePlaceholder={t("createProject.aiDraft.whatShouldChangePlaceholder")}
          extraPlaceholder={t("createProject.aiDraft.addMoreDetailsPlaceholder")}
          submitLabel={
            refineSheet?.kind === "task"
              ? t("createProject.aiDraft.regenerateOnlyTask")
              : t("createProject.aiDraft.regenerateOnlyPhase")
          }
          updatingLabel={t("createProject.aiDraft.updatingThisItem")}
          editManuallyLabel={t("createProject.aiDraft.editManually")}
          cancelLabel={t("projects.cancel")}
          onClose={() => !refiningKey && setRefineSheet(null)}
          onSubmit={handleRefineSubmit}
          onEditManually={handleEditManuallyFromRefine}
        />

        <Modal visible={!!editModal} transparent animationType="fade">
          <View style={styles.editModalOverlay}>
            <View style={styles.editModalCard}>
              <Text style={styles.editModalTitle}>
                {editModal?.kind === "phase"
                  ? t("createProject.aiDraft.editPhaseTitle")
                  : t("createProject.aiDraft.editTaskTitle")}
              </Text>
              <Text style={styles.editModalLabel}>{t("createProject.aiDraft.editNameLabel")}</Text>
              <TextInput
                style={styles.editModalInput}
                value={editModal?.title ?? ""}
                onChangeText={(tx) =>
                  setEditModal((prev) => (prev ? { ...prev, title: tx } : prev))
                }
                placeholderTextColor={colors.inputPlaceholderOnLight}
              />
              <Text style={styles.editModalLabel}>{t("createProject.aiDraft.editDescLabel")}</Text>
              <TextInput
                style={[styles.editModalInput, styles.editModalArea]}
                value={editModal?.description ?? ""}
                onChangeText={(tx) =>
                  setEditModal((prev) => (prev ? { ...prev, description: tx } : prev))
                }
                multiline
                textAlignVertical="top"
                placeholderTextColor={colors.inputPlaceholderOnLight}
              />
              <View style={styles.editModalActions}>
                <TouchableOpacity style={styles.editModalSecondary} onPress={() => setEditModal(null)}>
                  <Text style={styles.editModalSecondaryText}>{t("projects.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editModalPrimary} onPress={applyEditSave}>
                  <Text style={styles.editModalPrimaryText}>{t("createProject.aiDraft.saveEdit")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={!!addTaskPhaseId} transparent animationType="fade">
          <View style={styles.editModalOverlay}>
            <View style={styles.editModalCard}>
              <Text style={styles.editModalTitle}>{t("createProject.aiDraft.addTaskTitle")}</Text>
              <TextInput
                style={styles.editModalInput}
                value={addTaskTitle}
                onChangeText={setAddTaskTitle}
                placeholder={t("createProject.aiDraft.addTaskPlaceholder")}
                placeholderTextColor={colors.inputPlaceholderOnLight}
              />
              <View style={styles.editModalActions}>
                <TouchableOpacity
                  style={styles.editModalSecondary}
                  onPress={() => {
                    setAddTaskPhaseId(null);
                    setAddTaskTitle("");
                  }}
                >
                  <Text style={styles.editModalSecondaryText}>{t("projects.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editModalPrimary}
                  onPress={() => {
                    if (!addTaskPhaseId || !addTaskTitle.trim()) return;
                    const nt: AiTask = {
                      title: addTaskTitle.trim(),
                      description: undefined,
                      taskType: "execution",
                      priority: "medium",
                    };
                    setDraftPlan((prev) =>
                      prev && addTaskPhaseId ? appendDraftTask(prev, addTaskPhaseId, nt) : prev
                    );
                    setAddTaskPhaseId(null);
                    setAddTaskTitle("");
                  }}
                >
                  <Text style={styles.editModalPrimaryText}>{t("createProject.aiDraft.addTaskSave")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    padding: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  mainLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
    lineHeight: 22,
  },
  mainHelper: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 18,
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
  optionalToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  optionalToggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  optionalCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  basicFieldsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: 0,
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
    backgroundColor: colors.card,
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
    gap: spacing.sm,
  },
  attachBtn: {
    alignItems: "center",
    flex: 1,
    paddingVertical: spacing.xs,
  },
  attachIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary + "10",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  attachBtnText: {
    fontSize: 12,
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  docMain: {
    flex: 1,
    minWidth: 0,
  },
  docName: {
    fontSize: 13,
    color: colors.text,
    marginBottom: 2,
  },
  docMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  docStatusText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  docStatusTextError: {
    color: "#c62828",
  },
  docErrorText: {
    marginTop: 4,
    fontSize: 12,
    color: "#c62828",
    lineHeight: 16,
  },
  docActions: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  docActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  docActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  aiInfoBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: 16,
    backgroundColor: "#EEF4FF",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "#C9D8F2",
    marginBottom: spacing.sm,
    alignItems: "flex-start",
  },
  aiInfoIcon: {
    color: "#173B74",
    marginTop: 1,
  },
  aiInfoText: {
    flex: 1,
    fontSize: 14,
    color: "#173B74",
    lineHeight: 20,
    fontWeight: "500",
    textAlign: "left",
  },
  attachNonBlockingHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  generatingText: {
    marginTop: spacing.md,
    fontSize: 15,
    fontWeight: "500",
    color: colors.text,
    textAlign: "center",
  },
  generatingElapsed: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
  generatingSlowHint: {
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: "center",
    maxWidth: 320,
  },
  generatingRetryHint: {
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 18,
    color: "#b58400",
    textAlign: "center",
    maxWidth: 320,
  },
  errorText: {
    fontSize: 13,
    color: "#c62828",
    marginBottom: spacing.sm,
  },
  errorDiagnosticText: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
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
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  previewActionsSecondary: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: spacing.xs,
  },
  createBtn: {
    minHeight: 48,
  },
  btnCompact: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  btnSecondaryTextCompact: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  createBtnCompact: {
    paddingVertical: spacing.sm + 2,
    minHeight: 0,
  },
  btnPrimaryTextCompact: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  cancelInlineBtn: {
    alignItems: "center",
    paddingVertical: 4,
    marginTop: 0,
  },
  legacyHintCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legacyHintLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },
  legacyHintBody: {
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  editModalCard: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  editModalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },
  editModalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 6,
  },
  editModalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.sm,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm,
    backgroundColor: "#fff",
  },
  editModalArea: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  editModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  editModalSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  editModalSecondaryText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  editModalPrimary: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radius,
  },
  editModalPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
});
