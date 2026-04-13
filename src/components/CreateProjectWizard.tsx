import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type {
  ProjectEngineType,
  WorkType,
  BusinessMode,
  CreationMode,
} from "../lib/projectEnums";
import {
  WORK_TYPES_BUILD,
  WORK_TYPES_TRADE,
  MAINTENANCE_SCOPES,
} from "../lib/projectEnums";

export type WizardResult = {
  engineType: ProjectEngineType;
  workType: WorkType | null;
  businessMode: BusinessMode | null;
  creationMode: CreationMode;
};

const ENGINE_TYPES: ProjectEngineType[] = ["BUILD", "TRADE", "MAINTENANCE"];
const BUSINESS_MODES: BusinessMode[] = ["DIRECT", "SUBCONTRACT", "INTERNAL"];

type Props = {
  onComplete: (result: WizardResult) => void;
  onCancel: () => void;
};

export function CreateProjectWizard({ onComplete, onCancel }: Props) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState(1);
  const [engineType, setEngineType] = useState<ProjectEngineType | null>(null);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [businessMode, setBusinessMode] = useState<BusinessMode | null>(null);
  const [showHelpSheet, setShowHelpSheet] = useState(false);

  const completeWithCreationMode = useCallback(
    (creationMode: CreationMode) => {
      if (!engineType) return;
      onComplete({ engineType, workType, businessMode, creationMode });
    },
    [engineType, workType, businessMode, onComplete]
  );

  const handleNext = () => {
    if (step === 1 && engineType) {
      setStep(2);
    } else if (step === 2) {
      if (engineType === "MAINTENANCE") {
        onComplete({
          engineType: "MAINTENANCE",
          workType,
          businessMode: null,
          creationMode: "MANUAL",
        });
      } else {
        setStep(3);
      }
    } else if (step === 3) {
      setStep(4);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
    else onCancel();
  };

  const canNext = () => {
    if (step === 1) return !!engineType;
    return true;
  };

  const getStepTitle = () => {
    if (step === 1) return t("createProject.wizard.step1Title");
    if (step === 2 && engineType) return t(`createProject.wizard.step2Title.${engineType}`);
    if (step === 3 && engineType) return t(`createProject.wizard.step3Title.${engineType}`);
    return t("createProject.wizard.step4Title");
  };

  return (
    <View style={styles.wrapper}>
      {step === 1 ? (
        <>
          <Text style={styles.stepHeadline}>{t("createProject.wizard.step1Headline")}</Text>
          <Text style={styles.stepSubtitle}>{t("createProject.wizard.step1Subtitle")}</Text>
        </>
      ) : (
        <Text style={styles.stepTitle}>{getStepTitle()}</Text>
      )}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {step === 1 && (
          <>
            <View style={styles.cardsRow}>
              {ENGINE_TYPES.map((type) => {
                const isActive = engineType === type;
                const icon = type === "BUILD" ? "clipboard-outline" : type === "TRADE" ? "person-outline" : "construct-outline";
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.engineCard, isActive && styles.engineCardActive]}
                    onPress={() => setEngineType(type)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.engineIconWrap, isActive && styles.engineIconWrapActive]}>
                      <Ionicons name={icon} size={24} color={isActive ? colors.primary : colors.textMuted} />
                    </View>
                    <View style={styles.engineTitleRow}>
                      <Text style={[styles.engineTitle, isActive && styles.engineTitleActive]}>
                        {t(`createProject.wizard.engine.${type}`)}
                      </Text>
                      {(type === "TRADE" || type === "BUILD") && (
                        <View style={styles.engineBadge}>
                          <Text style={styles.engineBadgeText}>
                            {t(`createProject.wizard.engineBadge.${type}`)}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.engineDescription}>
                      {t(`createProject.wizard.engineDescription.${type}`)}
                    </Text>
                    <Text style={styles.engineIdeal}>
                      {t(`createProject.wizard.engineIdeal.${type}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.learnMoreLink} onPress={() => setShowHelpSheet(true)}>
              <Ionicons name="help-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.learnMoreText}>{t("createProject.wizard.learnMore")}</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && engineType && (
          <View style={styles.chipsRow}>
            {(engineType === "BUILD"
              ? WORK_TYPES_BUILD
              : engineType === "TRADE"
                ? WORK_TYPES_TRADE
                : MAINTENANCE_SCOPES
            ).map((type) => {
              const isActive = workType === type;
              const keyPrefix =
                engineType === "MAINTENANCE"
                  ? "createProject.wizard.maintenanceScope"
                  : "createProject.wizard.workType";
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setWorkType(isActive ? null : type)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {t(`${keyPrefix}.${type}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 3 && engineType && engineType !== "MAINTENANCE" && (
          <View style={styles.chipsRow}>
            {BUSINESS_MODES.map((mode) => {
              const isActive = businessMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setBusinessMode(isActive ? null : mode)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {t(`createProject.wizard.businessMode.${engineType}.${mode}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 4 && engineType && (
          <View style={styles.creationStep}>
            <Text style={styles.step4Lead}>{t(`createProject.wizard.step4Subtitle.${engineType}`)}</Text>
            <TouchableOpacity
              style={styles.creationChoiceCard}
              onPress={() => completeWithCreationMode("AI")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
                <Text style={styles.creationChoiceTitle}>{t("createProject.wizard.creationMode.AI")}</Text>
              </View>
              <Text style={styles.creationChoiceHint}>{t(`createProject.wizard.creationModeAiHint.${engineType}`)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.creationChoiceCard}
              onPress={() => completeWithCreationMode("MANUAL")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="create-outline" size={22} color={colors.textMuted} />
                <Text style={styles.creationChoiceTitle}>{t("createProject.wizard.creationMode.MANUAL")}</Text>
              </View>
              <Text style={styles.creationChoiceHintMuted}>{t(`createProject.wizard.creationModeManualHint.${engineType}`)}</Text>
            </TouchableOpacity>
            {engineType === "BUILD" && locale === "sk" ? (
              <TouchableOpacity
                style={styles.creationChoiceCard}
                onPress={() => completeWithCreationMode("TEMPLATE")}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <View style={styles.creationChoiceHeader}>
                  <Ionicons name="copy-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.creationChoiceTitle}>{t("createProject.wizard.creationMode.TEMPLATE")}</Text>
                </View>
                <Text style={styles.creationChoiceHintMuted}>{t("createProject.wizard.creationModeTemplateHint")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>

      {step === 1 && (
        <Text style={styles.laterCombine}>{t("createProject.wizard.laterCombine")}</Text>
      )}
      <View style={[styles.buttons, step === 4 && styles.buttonsStep4Only]}>
        <TouchableOpacity style={[styles.cancelBtn, step === 4 && styles.cancelBtnAlone]} onPress={handleBack}>
          <Text style={styles.cancelBtnText}>{step === 1 ? t("projects.cancel") : t("projects.back")}</Text>
        </TouchableOpacity>
        {step !== 4 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !canNext() && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={!canNext()}
          >
            <Text style={styles.nextBtnText}>{t("projects.next")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal visible={showHelpSheet} transparent animationType="slide">
        <View style={styles.helpOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowHelpSheet(false)} />
          <View style={styles.helpSheet}>
            <View style={styles.helpHandle} />
            <Text style={styles.helpTitle}>{t("createProject.wizard.helpSheetTitle")}</Text>
            <ScrollView style={styles.helpScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.helpBlock}>
                <Text style={styles.helpText}>{t("createProject.wizard.helpWhenBau")}</Text>
              </View>
              <View style={styles.helpBlock}>
                <Text style={styles.helpText}>{t("createProject.wizard.helpWhenTrade")}</Text>
              </View>
              <View style={styles.helpBlock}>
                <Text style={styles.helpText}>{t("createProject.wizard.helpWhenMaintenance")}</Text>
              </View>
              <Text style={styles.helpAiHint}>{t("createProject.wizard.aiHint")}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.helpCloseBtn} onPress={() => setShowHelpSheet(false)}>
              <Text style={styles.helpCloseText}>{t("common.close")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    minHeight: 280,
  },
  stepHeadline: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  stepSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 20,
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
  cardsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  engineCard: {
    flex: 1,
    minWidth: 100,
    padding: spacing.md,
    borderRadius: radius + 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  engineCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "12",
  },
  engineIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  engineIconWrapActive: {
    backgroundColor: colors.primary + "20",
  },
  engineTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 2,
  },
  engineTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  engineTitleActive: {
    color: colors.primary,
  },
  engineBadge: {
    backgroundColor: colors.primary + "18",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  engineBadgeText: {
    fontSize: 9,
    fontWeight: "600",
    color: colors.primary,
  },
  engineSubtitle: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  engineDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 4,
  },
  engineIdeal: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.primary,
    fontWeight: "600",
  },
  learnMoreLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  learnMoreText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
  },
  laterCombine: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: "center",
    lineHeight: 16,
  },
  helpOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  helpSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    maxHeight: "70%",
  },
  helpHandle: {
    width: 36,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.35)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  helpTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.lg,
  },
  helpScroll: {
    maxHeight: 280,
    marginBottom: spacing.md,
  },
  helpBlock: {
    marginBottom: spacing.lg,
  },
  helpText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textOnDark,
  },
  helpAiHint: {
    fontSize: 13,
    lineHeight: 18,
    color: "rgba(255,255,255,0.92)",
    fontStyle: "italic",
    marginTop: spacing.sm,
  },
  helpCloseBtn: {
    paddingVertical: spacing.md,
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
  },
  helpCloseText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
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
  nextBtnDisabled: {
    opacity: 0.5,
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
