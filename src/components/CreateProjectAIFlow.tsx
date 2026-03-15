/**
 * AI-first project creation flow.
 * Screen 1: Project brief input + optional technical documents
 * Screen 2: AI preview (phases + tasks)
 */

import React, { useState } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import {
  generateProjectStructureWithAI,
  createProjectFromAiPlan,
  uploadAiDraftDocument,
  type CreateProjectFromAiPlanParams,
  type AiDraftDocument,
} from "../services/aiProjectService";
import type { AiProjectPlan } from "../lib/aiProjectSchema";
import type { ProjectEngineType, WorkType } from "../lib/projectEnums";

let DocumentPicker: typeof import("expo-document-picker") | null = null;
try {
  DocumentPicker = require("expo-document-picker");
} catch {
  // optional
}

type Step = "brief" | "preview" | "generating";

type Props = {
  onCreated: (projectId: string) => void;
  onManual: () => void;
  onCancel: () => void;
  /** Context from wizard: Bau/Aufträge + work type (Neubau, Renovierung, etc.) */
  engineType?: ProjectEngineType;
  workType?: WorkType | null;
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

export function CreateProjectAIFlow({ onCreated, onManual, onCancel, engineType, workType }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState("");
  const [documents, setDocuments] = useState<AiDraftDocument[]>([]);
  const [plan, setPlan] = useState<AiProjectPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  const pickDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert(t("common.error"), t("createProject.ai.documentPickerNotInstalled"));
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const mimeType = asset.mimeType ?? "application/pdf";
        const fileName =
          asset.name ?? asset.fileName ?? `dokument_${Date.now()}.${mimeType.includes("pdf") ? "pdf" : "jpg"}`;
        setDocuments((prev) => [
          ...prev,
          { localUri: asset.uri, fileName, mimeType },
        ]);
      }
    } catch (err) {
      console.error("[CreateProjectAIFlow] Document pick error:", err);
      Alert.alert(t("common.error"), t("createProject.ai.documentPickFailed"));
    }
  };

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleWithAI = async () => {
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

      const result = await generateProjectStructureWithAI(trimmed, {
        engineType,
        workType,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
      });
      setPlan(result);
      setStep("preview");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      if (__DEV__) {
        console.error("[CreateProjectAIFlow] AI generation failed:", { code, message: msg, error: e });
      }
      setError(t("createProject.ai.error"));
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
      const result = await generateProjectStructureWithAI(brief.trim(), {
        engineType,
        workType,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
      });
      setPlan(result);
      setStep("preview");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code;
      if (__DEV__) {
        console.error("[CreateProjectAIFlow] AI generate again failed:", { code, message: msg });
      }
      setError(t("createProject.ai.error"));
      setStep("preview");
      setUploadingDocs(false);
    }
  };

  const handleCreate = async () => {
    if (!plan) return;

    setError(null);
    setSubmitting(true);

    try {
      const params: CreateProjectFromAiPlanParams = {
        plan,
        originalBrief: brief.trim() || undefined,
      };
      const projectId = await createProjectFromAiPlan(params);
      onCreated(projectId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
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
        <Text style={styles.question}>{t("createProject.ai.question")}</Text>
        <TextInput
          style={styles.textArea}
          value={brief}
          onChangeText={(text) => {
            setBrief(text);
            setError(null);
          }}
          placeholder={t("createProject.ai.placeholder")}
          placeholderTextColor="#666666"
          multiline
          numberOfLines={4}
          editable={true}
        />
        <Text style={styles.documentsLabel}>{t("createProject.ai.documentsLabel")}</Text>
        <TouchableOpacity style={styles.addDocBtn} onPress={pickDocument}>
          <Ionicons name="document-attach-outline" size={20} color={colors.primary} />
          <Text style={styles.addDocText}>{t("createProject.ai.addDocuments")}</Text>
        </TouchableOpacity>
        {documents.length > 0 && (
          <View style={styles.docList}>
            {documents.map((doc, i) => (
              <View key={i} style={styles.docItem}>
                <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                <Text style={styles.docName} numberOfLines={1}>
                  {doc.fileName}
                </Text>
                <TouchableOpacity onPress={() => removeDocument(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={handleWithAI}
          >
            <Ionicons name="sparkles" size={18} color="#fff" />
            <Text style={styles.btnPrimaryText}>{t("createProject.ai.withAi")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleManual}>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <Text style={styles.btnSecondaryText}>{t("createProject.ai.manual")}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>{t("projects.cancel")}</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    );
  }

  if (step === "preview" && plan) {
    const categoryLabel = getCategoryLabel(plan.category, t);
    const scopeLabel = getScopeLabel(plan.scope, t);

    return (
      <View style={styles.container}>
        <Text style={styles.previewTitle}>{t("createProject.ai.previewTitle")}</Text>
        <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>{t("createProject.ai.projectName")}</Text>
            <Text style={styles.previewValue}>{plan.projectTitle}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>{t("createProject.ai.projectType")}</Text>
            <Text style={styles.previewValue}>{categoryLabel}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>{t("createProject.ai.scope")}</Text>
            <Text style={styles.previewValue}>{scopeLabel}</Text>
          </View>
          {plan.summary?.trim() && (
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>{t("createProject.ai.summary")}</Text>
              <Text style={styles.previewValue}>{plan.summary.trim()}</Text>
            </View>
          )}
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
        {error && <Text style={styles.errorText}>{error}</Text>}
        <View style={styles.previewActions}>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleChangeDescription}>
            <Text style={styles.btnSecondaryText}>{t("createProject.ai.changeDescription")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={handleGenerateAgain}>
            <Text style={styles.btnSecondaryText}>{t("createProject.ai.generateAgain")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={handleCreate}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>{t("createProject.ai.createProject")}</Text>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
  },
  question: {
    fontSize: 14,
    color: colors.text,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  textArea: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: radius,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
  documentsLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  addDocBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  addDocText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
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
    color: "rgba(255,255,255,0.9)",
  },
  errorText: {
    fontSize: 13,
    color: "#ff6b6b",
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginBottom: spacing.md,
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
    backgroundColor: "transparent",
    borderColor: colors.primary,
  },
  btnSecondaryText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
    color: colors.text,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.md,
  },
  previewScroll: {
    flex: 1,
    maxHeight: 280,
    marginBottom: spacing.md,
  },
  previewRow: {
    marginBottom: spacing.sm,
  },
  previewLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    marginBottom: 2,
  },
  previewValue: {
    fontSize: 15,
    color: colors.textOnDark,
    fontWeight: "500",
  },
  phasesTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textOnDark,
    marginTop: spacing.md,
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
    color: colors.textOnDark,
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
    color: "rgba(255,255,255,0.9)",
    flex: 1,
  },
  previewActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
});
