import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

type Slide = {
  titleKey: string;
  subtitleKey: string;
  imageKey?: string;
};

type Props = { onFinish: () => void };

export function OnboardingScreen({ onFinish }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  
  const slides: Slide[] = [
    { titleKey: "onboarding.slide1.title", subtitleKey: "onboarding.slide1.subtitle" },
    { titleKey: "onboarding.slide2.title", subtitleKey: "onboarding.slide2.subtitle" },
    { titleKey: "onboarding.slide3.title", subtitleKey: "onboarding.slide3.subtitle" },
    { titleKey: "onboarding.slide4.title", subtitleKey: "onboarding.slide4.subtitle" },
    { titleKey: "onboarding.slide5.title", subtitleKey: "onboarding.slide5.subtitle" },
  ];
  
  const s = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <View style={styles.container}>
      {/* Skip button - top right */}
      <TouchableOpacity
        style={[styles.skipButton, { top: insets.top + spacing.md, right: spacing.md }]}
        onPress={onFinish}
      >
        <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Logo - only on first slide */}
        {index === 0 && (
          <Image 
            source={require("../../assets/logo.png")} 
            style={styles.logo} 
            resizeMode="contain" 
            accessibilityLabel="Staveto logo" 
          />
        )}
        
        {/* Illustration placeholder - for other slides */}
        {index !== 0 && (
          <View style={styles.illustrationPlaceholder}>
            {/* Future: Add illustration images here */}
          </View>
        )}
        
        <Text style={styles.title}>{t(s.titleKey)}</Text>
        <Text style={styles.subtitle}>{t(s.subtitleKey)}</Text>
        
        {/* Duration microcopy - only on first slide */}
        {index === 0 && (
          <Text style={styles.duration}>{t("onboarding.duration")}</Text>
        )}
      </View>

      {/* Dots indicator */}
      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      {/* Footer with Next/Start button */}
      <View style={styles.footer}>
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
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  logo: {
    width: 200,
    height: 100,
    marginBottom: spacing.xl,
  },
  illustrationPlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: colors.card,
    borderRadius: radius,
    marginBottom: spacing.xl,
    opacity: 0.3,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  duration: {
    fontSize: 14,
    color: "#FFFFFF",
    textAlign: "center",
    marginTop: spacing.sm,
    opacity: 0.8,
  },
  skipButton: {
    position: "absolute",
    zIndex: 10,
    padding: spacing.sm,
  },
  skipText: {
    color: colors.textMuted,
    fontSize: 16,
    opacity: 0.8,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingVertical: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  footer: {
    paddingBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});
