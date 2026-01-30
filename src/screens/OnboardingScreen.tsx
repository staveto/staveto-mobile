import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from "react-native";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

const { width } = Dimensions.get("window");

type Props = { onFinish: () => void };

export function OnboardingScreen({ onFinish }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const slides = [
    { titleKey: "onboarding.slide1.title", subtitleKey: "onboarding.slide1.subtitle" },
    { titleKey: "onboarding.slide2.title", subtitleKey: "onboarding.slide2.subtitle" },
    { titleKey: "onboarding.slide3.title", subtitleKey: "onboarding.slide3.subtitle" },
  ];
  const s = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{t(s.titleKey)}</Text>
        <Text style={styles.subtitle}>{t(s.subtitleKey)}</Text>
      </View>
      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.skipBtn} onPress={onFinish}>
          <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => (isLast ? onFinish() : setIndex((i) => i + 1))}
        >
          <Text style={styles.primaryText}>{isLast ? t("onboarding.start") : t("onboarding.next")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
    paddingVertical: spacing.lg * 2,
  },
  content: { flex: 1, justifyContent: "center" },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 24,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.primary, width: 24 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  skipBtn: { padding: spacing.sm },
  skipText: { color: colors.textMuted, fontSize: 16 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
