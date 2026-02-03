import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

export function OnboardingIntroScreen() {
  const navigation = useNavigation();
  const { finishOnboarding } = useAuth();
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  const steps = useMemo(
    () => [t("onboardingIntro.step1"), t("onboardingIntro.step2"), t("onboardingIntro.step3")],
    [t]
  );

  const isLast = index === steps.length - 1;

  const onBack = () => {
    if (index === 0) {
      (navigation as { goBack: () => void }).goBack();
      return;
    }
    setIndex((i) => i - 1);
  };

  const onNext = async () => {
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    await finishOnboarding();
    (navigation as { navigate: (name: string) => void }).navigate("Register");
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>{`${index + 1} / ${steps.length}`}</Text>
        <Text style={styles.title}>{steps[index]}</Text>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} activeOpacity={0.8}>
          <Text style={styles.secondaryText}>{t("common.back")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={onNext} activeOpacity={0.8}>
          <Text style={styles.primaryText}>{isLast ? t("onboardingIntro.continue") : t("onboarding.next")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  step: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    lineHeight: 34,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  primaryBtn: {
    flex: 1.2,
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
