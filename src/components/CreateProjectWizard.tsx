import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform } from "react-native";
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

  const nextEnabled = canNext();

  const getStepTitle = () => {
    if (step === 1) return t("createProject.wizard.step1Title");
    if (step === 2 && engineType) return t(`createProject.wizard.step2Title.${engineType}`);
    if (step === 3 && engineType) return t(`createProject.wizard.step3Title.${engineType}`);
    return t("createProject.wizard.step4Title");
  };

  return (
    <View style={styles.wrapper}>
      {step === 1 ? (
        <View style={styles.step1HeaderOnly}>
          <Text style={styles.stepHeadline}>{t("createProject.wizard.step1Headline")}</Text>
        </View>
      ) : (
        <Text style={styles.stepTitle}>{getStepTitle()}</Text>
      )}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {step === 1 && (
          <View style={styles.engineCardsColumn}>
            {ENGINE_TYPES.map((type) => {
              const isActive = engineType === type;
              const icon =
                type === "BUILD"
                  ? "home-outline"
                  : type === "TRADE"
                    ? "briefcase-outline"
                    : "settings-outline";
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
                        <View style={styles.engineExampleChipsRow}>
                          {([0, 1, 2] as const).map((i) => (
                            <View key={i} style={styles.engineExampleChip}>
                              <Text style={styles.engineExampleChipText} numberOfLines={1}>
                                {t(`createProject.wizard.engineChip.${type}.${i}`)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
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
              style={[styles.creationChoiceCard, styles.creationChoiceCardPrimary]}
              onPress={() => completeWithCreationMode("AI")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="sparkles-outline" size={26} color={colors.primary} />
                <Text style={styles.creationChoiceTitle}>{t("createProject.wizard.creationMode.AI")}</Text>
              </View>
              <Text style={styles.creationChoiceHint} numberOfLines={2}>
                {t(`createProject.wizard.creationModeAiHint.${engineType}`)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.creationChoiceCard}
              onPress={() => completeWithCreationMode("MANUAL")}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={styles.creationChoiceHeader}>
                <Ionicons name="create-outline" size={24} color={colors.textMuted} />
                <Text style={styles.creationChoiceTitle}>{t("createProject.wizard.creationMode.MANUAL")}</Text>
              </View>
              <Text style={styles.creationChoiceHintMuted} numberOfLines={2}>
                {t(`createProject.wizard.creationModeManualHint.${engineType}`)}
              </Text>
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

      <View style={[styles.buttons, step === 4 && styles.buttonsStep4Only]}>
        <TouchableOpacity style={[styles.cancelBtn, step === 4 && styles.cancelBtnAlone]} onPress={handleBack}>
          <Text style={styles.cancelBtnText}>{step === 1 ? t("projects.cancel") : t("projects.back")}</Text>
        </TouchableOpacity>
        {step !== 4 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !nextEnabled && styles.nextBtnDisabled, nextEnabled && styles.nextBtnReady]}
            onPress={handleNext}
            disabled={!nextEnabled}
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
  step1HeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  step1HeaderTextCol: {
    flex: 1,
    minWidth: 0,
  },
  step1HelpIcon: {
    paddingTop: 2,
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
      android: {
        elevation: 5,
      },
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
  engineExampleChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  engineExampleChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderWidth: 0,
  },
  engineExampleChipText: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.textMuted,
    opacity: 0.82,
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
      android: {
        elevation: 6,
      },
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
