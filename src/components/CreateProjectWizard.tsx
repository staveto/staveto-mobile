/**
 * Simplified new-project wizard: BUILD vs TRADE only.
 * TRADE: standard job vs service/maintenance → property vs equipment maintenance.
 * BUILD: Neubau / Renovierung only. Name step before AI/manual choice.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type {
  ProjectEngineType,
  WorkType,
  BusinessMode,
  CreationMode,
  JobWorkflowKind,
  ServiceMaintenanceScope,
} from "../lib/projectEnums";

export type WizardResult = {
  engineType: ProjectEngineType;
  workType: WorkType | null;
  businessMode: BusinessMode | null;
  creationMode: CreationMode;
  jobWorkflowKind?: JobWorkflowKind | null;
  serviceMaintenanceScope?: ServiceMaintenanceScope | null;
  /** Shown in next modal / AI brief — required before creation mode. */
  projectNameOrDescription: string;
};

const ENGINE_TYPES = ["BUILD", "TRADE"] as const satisfies readonly ProjectEngineType[];
const BUILD_KINDS = ["NEW_BUILD", "RENOVATION"] as const;

type Props = {
  onComplete: (result: WizardResult) => void;
  onCancel: () => void;
  initialEngineType?: "BUILD" | "TRADE";
};

export function CreateProjectWizard({ onComplete, onCancel, initialEngineType }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [engineType, setEngineType] = useState<ProjectEngineType | null>(null);
  const [buildKind, setBuildKind] = useState<(typeof BUILD_KINDS)[number] | null>(null);
  const [tradeKind, setTradeKind] = useState<JobWorkflowKind | null>(null);
  const [serviceScope, setServiceScope] = useState<ServiceMaintenanceScope | null>(null);
  const [projectTitle, setProjectTitle] = useState("");

  /** Preselect only — user always sees step 1 (BUILD vs TRADE) first. */
  useEffect(() => {
    if (initialEngineType === "BUILD" || initialEngineType === "TRADE") {
      setEngineType(initialEngineType);
    }
  }, [initialEngineType]);

  const deriveWorkType = useCallback((): WorkType | null => {
    if (!engineType) return null;
    if (engineType === "BUILD") {
      if (buildKind === "NEW_BUILD") return "NEW_BUILD";
      if (buildKind === "RENOVATION") return "RENOVATION";
      return null;
    }
    if (tradeKind === "SERVICE") return "REPAIR";
    if (tradeKind === "STANDARD") return "REPAIR";
    return "REPAIR";
  }, [engineType, buildKind, tradeKind]);

  const completeWithCreationMode = useCallback(
    (creationMode: CreationMode) => {
      if (!engineType) return;
      const wt = deriveWorkType();
      const name = projectTitle.trim();
      if (!name) return;
      const jwk: JobWorkflowKind | null = engineType === "TRADE" ? tradeKind : null;
      const sms: ServiceMaintenanceScope | null =
        engineType === "TRADE" && tradeKind === "SERVICE" ? serviceScope : null;
      onComplete({
        engineType,
        workType: wt,
        businessMode: null,
        creationMode,
        jobWorkflowKind: jwk,
        serviceMaintenanceScope: sms,
        projectNameOrDescription: name,
      });
    },
    [engineType, deriveWorkType, onComplete, projectTitle, serviceScope, tradeKind]
  );

  const goNext = () => {
    if (step === 1 && engineType) setStep(2);
    else if (step === 2) {
      if (engineType === "BUILD") {
        if (!buildKind) return;
        setStep(4);
      } else {
        if (!tradeKind) return;
        if (tradeKind === "SERVICE") setStep(3);
        else setStep(4);
      }
    } else if (step === 3) {
      if (!serviceScope) return;
      setStep(4);
    } else if (step === 4) {
      if (!projectTitle.trim()) return;
      setStep(5);
    }
  };

  const goBack = () => {
    if (step === 1) onCancel();
    else if (step === 2) {
      setStep(1);
    } else if (step === 3) setStep(2);
    else if (step === 4) {
      if (engineType === "TRADE" && tradeKind === "SERVICE") setStep(3);
      else setStep(2);
    } else if (step === 5) setStep(4);
  };

  const canNext = () => {
    if (step === 1) return !!engineType;
    if (step === 2) {
      if (engineType === "BUILD") return !!buildKind;
      return !!tradeKind;
    }
    if (step === 3) return !!serviceScope;
    if (step === 4) return projectTitle.trim().length > 0;
    return false;
  };

  const getStepTitle = () => {
    if (step === 1) return t("createProject.wizard.step1Title");
    if (step === 2 && engineType === "BUILD") return t("createProject.wizard.v2.buildKindTitle");
    if (step === 2 && engineType === "TRADE") return t("createProject.wizard.v2.tradeKindTitle");
    if (step === 3) return t("createProject.wizard.v2.serviceScopeTitle");
    if (step === 4) return t("createProject.wizard.v2.nameStepTitle");
    return t("createProject.wizard.howToStartTitle");
  };

  return (
    <View style={styles.wrapper}>
      {step === 1 ? (
        <View style={styles.step1HeaderOnly}>
          <Text style={styles.stepHeadline}>{t("createProject.wizard.step1Headline")}</Text>
          {initialEngineType === "BUILD" || initialEngineType === "TRADE" ? (
            <Text style={styles.step1Recommended}>{t("createProject.wizard.step1RecommendedSubtitle")}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.stepTitle}>{getStepTitle()}</Text>
      )}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {step === 1 && (
          <View style={styles.engineCardsColumn}>
            {ENGINE_TYPES.map((type) => {
              const isActive = engineType === type;
              const icon = type === "BUILD" ? "home-outline" : "briefcase-outline";
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.engineCardFull, isActive && styles.engineCardFullActive]}
                  onPress={() => setEngineType(type)}
                  activeOpacity={0.88}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isActive }}
                >
                  <View style={styles.engineCardInnerRow}>
                    <View style={[styles.engineAccentStrip, isActive && styles.engineAccentStripActive]} />
                    <View style={styles.engineCardMain}>
                      <View style={[styles.engineIconWrapLarge, isActive && styles.engineIconWrapLargeActive]}>
                        <Ionicons name={icon} size={34} color={isActive ? colors.primary : colors.textMuted} />
                      </View>
                      <View style={styles.engineCardBody}>
                        <View style={styles.engineCardTitleRow}>
                          <Text style={[styles.engineCardTitle, isActive && styles.engineCardTitleActive]} numberOfLines={1}>
                            {t(`createProject.wizard.engine.${type}`)}
                          </Text>
                          {isActive ? (
                            <View style={styles.checkBubble}>
                              <Ionicons name="checkmark" size={20} color="#fff" />
                            </View>
                          ) : null}
                        </View>
                        <Text style={[styles.engineCardSubtitle, isActive && styles.engineCardSubtitleActive]} numberOfLines={2}>
                          {t(`createProject.wizard.engineCardLine.${type}`)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 2 && engineType === "BUILD" && (
          <View style={styles.chipsRow}>
            {BUILD_KINDS.map((k) => {
              const isActive = buildKind === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setBuildKind(isActive ? null : k)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {t(`createProject.wizard.v2.buildKind.${k}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 2 && engineType === "TRADE" && (
          <View style={styles.chipsRow}>
            {(["STANDARD", "SERVICE"] as const).map((k) => {
              const isActive = tradeKind === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => {
                    setTradeKind(isActive ? null : k);
                    if (k === "STANDARD") setServiceScope(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {t(`createProject.wizard.v2.tradeKind.${k}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 3 && engineType === "TRADE" && tradeKind === "SERVICE" && (
          <View style={styles.chipsRow}>
            {(["PROPERTY", "EQUIPMENT"] as const).map((k) => {
              const isActive = serviceScope === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setServiceScope(isActive ? null : k)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {t(`createProject.wizard.v2.serviceScope.${k}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 4 && (
          <View style={styles.nameBlock}>
            <Text style={styles.nameSubtitle}>{t("createProject.wizard.v2.nameStepSubtitle")}</Text>
            <TextInput
              style={styles.nameInput}
              value={projectTitle}
              onChangeText={setProjectTitle}
              placeholder={t("createProject.wizard.v2.namePlaceholder")}
              placeholderTextColor={colors.textMuted}
              multiline
              maxFontSizeMultiplier={1.35}
              accessibilityLabel={t("createProject.wizard.v2.nameStepTitle")}
            />
          </View>
        )}

        {step === 5 && engineType && (
          <View style={styles.creationStep}>
            {/* Quick start (MANUAL) — primary card, comes first because it's the safest default */}
            <TouchableOpacity
              style={[styles.creationChoiceCard, styles.creationChoiceCardPrimary]}
              onPress={() => completeWithCreationMode("MANUAL")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="flash-outline" size={26} color={colors.primary} />
                <Text style={styles.creationChoiceTitle}>
                  {t(`createProject.wizard.creationMode.MANUAL.${engineType}`)}
                </Text>
              </View>
              <Text style={styles.creationChoiceHint}>
                {t(`createProject.wizard.creationModeManualSubtitle.${engineType}`)}
              </Text>
              <View style={styles.bulletsRow}>
                {[0, 1, 2].map((idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                    <Text style={styles.bulletText}>
                      {t(`createProject.wizard.manualBullets.${engineType}.${idx}`)}
                    </Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>

            {/* Suggested steps / AI plan */}
            <TouchableOpacity
              style={styles.creationChoiceCard}
              onPress={() => completeWithCreationMode("AI")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="sparkles-outline" size={24} color={colors.primary} />
                <Text style={styles.creationChoiceTitle}>
                  {t(`createProject.wizard.creationMode.AI.${engineType}`)}
                </Text>
              </View>
              <Text style={styles.creationChoiceHintMuted}>
                {t(`createProject.wizard.creationModeAiSubtitle.${engineType}`)}
              </Text>
            </TouchableOpacity>

            {/* Copy from previous job/project — first-class option */}
            <TouchableOpacity
              style={styles.creationChoiceCard}
              onPress={() => completeWithCreationMode("CLONE")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="copy-outline" size={24} color={colors.textMuted} />
                <Text style={styles.creationChoiceTitle}>
                  {t(`createProject.wizard.creationMode.CLONE.${engineType}`)}
                </Text>
              </View>
              <Text style={styles.creationChoiceHintMuted}>
                {t(`createProject.wizard.creationModeCloneSubtitle.${engineType}`)}
              </Text>
            </TouchableOpacity>

            {/* National template — BUILD only */}
            {engineType === "BUILD" ? (
              <TouchableOpacity
                style={styles.creationChoiceCard}
                onPress={() => completeWithCreationMode("TEMPLATE")}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={styles.creationChoiceHeader}>
                  <Ionicons name="layers-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.creationChoiceTitle}>
                    {t("createProject.wizard.creationMode.TEMPLATE.BUILD")}
                  </Text>
                </View>
                <Text style={styles.creationChoiceHintMuted}>
                  {t("createProject.wizard.creationModeTemplateSubtitle")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.buttons, step === 5 && styles.buttonsStep4Only]}>
        <TouchableOpacity style={[styles.cancelBtn, step === 5 && styles.cancelBtnAlone]} onPress={goBack}>
          <Text style={styles.cancelBtnText}>
            {step === 1 ? t("projects.cancel") : t("projects.back")}
          </Text>
        </TouchableOpacity>
        {step !== 5 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !canNext() && styles.nextBtnDisabled, canNext() && styles.nextBtnReady]}
            onPress={goNext}
            disabled={!canNext()}
          >
            <Text style={styles.nextBtnText}>{t("projects.next")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    minHeight: 280,
  },
  step1HeaderOnly: {
    marginBottom: spacing.sm,
  },
  step1Recommended: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  stepHeadline: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  engineCardsColumn: {
    gap: spacing.md,
    marginBottom: spacing.md,
    width: "100%",
  },
  engineCardFull: {
    width: "100%",
    borderRadius: radius + 4,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  engineCardFullActive: {
    borderColor: colors.primary,
    borderWidth: 3,
    backgroundColor: colors.primary + "18",
    ...Platform.select({
      ios: {
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  engineCardInnerRow: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: spacing.lg,
    paddingRight: spacing.md,
    paddingLeft: 0,
  },
  engineAccentStrip: {
    width: 5,
    marginRight: spacing.sm,
    borderRadius: 3,
    backgroundColor: "transparent",
    alignSelf: "stretch",
    minHeight: 48,
  },
  engineAccentStripActive: {
    backgroundColor: colors.primary,
  },
  engineCardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    minWidth: 0,
  },
  engineIconWrapLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  engineIconWrapLargeActive: {
    backgroundColor: colors.primary + "22",
    borderColor: colors.primary,
  },
  engineCardBody: {
    flex: 1,
    minWidth: 0,
  },
  engineCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: 4,
    minHeight: 32,
  },
  checkBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  engineCardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    flex: 1,
    letterSpacing: -0.3,
  },
  engineCardTitleActive: {
    color: colors.primary,
  },
  engineCardSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    fontWeight: "500",
    marginBottom: spacing.sm,
  },
  engineCardSubtitleActive: {
    color: colors.text,
    opacity: 0.88,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "15",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: "600",
  },
  nameBlock: {
    marginBottom: spacing.md,
  },
  nameSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  nameInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 100,
    textAlignVertical: "top",
  },
  creationStep: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  step4Lead: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  creationChoiceCard: {
    padding: spacing.md,
    borderRadius: radius + 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  creationChoiceCardPrimary: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primary + "12",
  },
  creationChoiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  creationChoiceTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  creationChoiceHint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginLeft: 22 + spacing.sm,
  },
  creationChoiceHintMuted: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginLeft: 22 + spacing.sm,
  },
  bulletsRow: {
    marginTop: spacing.sm,
    marginLeft: 22 + spacing.sm,
    gap: 4,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  bulletText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
    fontWeight: "500",
  },
  buttons: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  buttonsStep4Only: {
    justifyContent: "center",
  },
  cancelBtnAlone: {
    flexGrow: 1,
    maxWidth: "100%",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: "500",
  },
  nextBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
  },
  nextBtnReady: {
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.28,
        shadowRadius: 5,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  nextBtnDisabled: {
    opacity: 0.36,
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
