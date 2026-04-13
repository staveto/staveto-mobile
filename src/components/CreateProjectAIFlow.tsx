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

function normalizeAiErrorMessage(message: string): string {
  return message.replace(/^\[internal\]\s*/i, "").replace(/\s*\[internal\]\s*/gi, " ").trim();
}

function getAiErrorMessage(code: string | undefined, message: string, t: (key: string) => string): string {
  const cleaned = normalizeAiErrorMessage(message);
  const codeLower = (code ?? "").toLowerCase();
  const msgLower = cleaned.toLowerCase();
  if (!cleaned && !code) return t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.";
  if (codeLower === "unauthenticated" || msgLower.includes("authentication required")) {
    return t("createProject.ai.errorAuth") || "Musíte byť prihlásený. Skúste sa odhlásiť a znova prihlásiť.";
  }
  if (codeLower === "failed-precondition" || msgLower.includes("not configured") || msgLower.includes("api key")) {
    return t("createProject.ai.errorNotConfigured") || "AI služba nie je nakonfigurovaná. Kontaktujte podporu.";
  }
  if (msgLower.includes("network") || msgLower.includes("timeout") || msgLower.includes("slabé pripojenie")) {
    return t("createProject.ai.errorNetwork") || "Slabé pripojenie alebo žiadny internet. Skúste znova.";
  }
  if (msgLower.includes("internal") || msgLower.includes("ai generation failed")) {
    return t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.";
  }
  return cleaned && cleaned.length < 120 ? cleaned : (t("createProject.ai.error") || "AI nemohla vytvoriť plán. Skús znova alebo vytvor manuálne.");
}

export function CreateProjectAIFlow({ onCreated, onManual, onCancel, engineType, workType }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("brief");
  const [brief, setBrief] = useState("");
  const [documents, setDocuments] = useState<AiDraftDocument[]>([]);
  const [roofType, setRoofType] = useState("");
  const [areaM2, setAreaM2] = useState("");
  const [floorCount, setFloorCount] = useState("");
  const [plan, setPlan] = useState<AiProjectPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);

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
        const fileName = asset.name ?? asset.fileName ?? `dokument_${Date.now()}.pdf`;
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

      const details: string[] = [];
      if (roofType.trim()) details.push(`${t("createProject.ai.roofType")}: ${roofType.trim()}`);
      if (areaM2.trim()) details.push(`${t("createProject.ai.areaM2")}: ${areaM2.trim()}`);
      if (floorCount.trim()) details.push(`${t("createProject.ai.floorCount")}: ${floorCount.trim()}`);
      const projectDetails = details.length > 0 ? details.join("; ") : undefined;

      const result = await generateProjectStructureWithAI(trimmed, {
        engineType,
        workType,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
        projectDetails,
      });
      setPlan(result);
      setStep("preview");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = (e as { code?: string })?.code;
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generation failed", code, msg);
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
      const details: string[] = [];
      if (roofType.trim()) details.push(`${t("createProject.ai.roofType")}: ${roofType.trim()}`);
      if (areaM2.trim()) details.push(`${t("createProject.ai.areaM2")}: ${areaM2.trim()}`);
      if (floorCount.trim()) details.push(`${t("createProject.ai.floorCount")}: ${floorCount.trim()}`);
      const projectDetails = details.length > 0 ? details.join("; ") : undefined;

      const result = await generateProjectStructureWithAI(brief.trim(), {
        engineType,
        workType,
        documentStoragePaths: documentStoragePaths.length > 0 ? documentStoragePaths : undefined,
        projectDetails,
      });
      setPlan(result);
      setStep("preview");
    } catch (e) {
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = (e as { code?: string })?.code;
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] AI generate again failed", code, msg);
      }
      setError(getAiErrorMessage(code, msg, t));
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
      const msg = normalizeAiErrorMessage(e instanceof Error ? e.message : String(e));
      const code = (e as { code?: string })?.code;
      if (__DEV__) {
        console.warn("[CreateProjectAIFlow] create from plan failed", code, msg);
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
        <Text style={styles.sectionLabel}>{t("createProject.ai.basicDetails")}</Text>
        <View style={styles.basicFieldsRow}>
          <View style={styles.basicField}>
            <Text style={styles.basicFieldLabel}>{t("createProject.ai.roofType")}</Text>
            <TextInput
              style={styles.basicFieldInput}
              value={roofType}
              onChangeText={setRoofType}
              placeholder={t("createProject.ai.roofTypePlaceholder")}
              placeholderTextColor="#888"
            />
          </View>
          <View style={styles.basicField}>
            <Text style={styles.basicFieldLabel}>{t("createProject.ai.areaM2")}</Text>
            <TextInput
              style={styles.basicFieldInput}
              value={areaM2}
              onChangeText={setAreaM2}
              placeholder={t("createProject.ai.areaPlaceholder")}
              placeholderTextColor="#888"
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
              placeholderTextColor="#888"
              keyboardType="numeric"
            />
          </View>
        </View>
        <View style={styles.attachSection}>
          <Text style={styles.attachSectionTitle}>{t("createProject.ai.attachTitle")}</Text>
          <Text style={styles.attachSectionHint}>{t("createProject.ai.attachHint")}</Text>
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
        </ScrollView>
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
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: radius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 14,
    color: colors.text,
  },
  attachSection: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  attachSectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: 4,
  },
  attachSectionHint: {
    fontSize: 13,
    color: "rgba(255,255,255,0.8)",
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
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  attachBtnText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textOnDark,
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
