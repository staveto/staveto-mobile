import React, { useCallback, useMemo, useRef, useState } from "react";
import type { ImageSourcePropType, ListRenderItemInfo, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import type { Locale } from "../i18n/translations";
import { colors, radius, spacing } from "../theme";

/** Rýchly výber na hero welcome (zvyšok cez „Ďalšie jazyky“). */
const HERO_BAR_LOCALES: Locale[] = ["en", "de", "es", "pl"];

type OnboardingStep = {
  id: string;
  titleKey: string;
  subtitleKey: string;
  image: ImageSourcePropType;
};

const STEPS: OnboardingStep[] = [
  {
    id: "step1",
    titleKey: "onboardingEvolution.step1.title",
    subtitleKey: "onboardingEvolution.step1.subtitle",
    image: require("../../assets/onboarding_1.png"),
  },
  {
    id: "step2",
    titleKey: "onboardingEvolution.step2.title",
    subtitleKey: "onboardingEvolution.step2.subtitle",
    image: require("../../assets/onboarding_2.png"),
  },
  {
    id: "step3",
    titleKey: "onboardingEvolution.step3.title",
    subtitleKey: "onboardingEvolution.step3.subtitle",
    image: require("../../assets/onboarding_3.png"),
  },
];

type Phase = "hero" | "carousel";

/** Odhad výšky horného riadku + päty karuselu (progress + CTA), mimo samotného zoznamu. */
const CAROUSEL_CHROME_HEIGHT = 56 + 156;

export function OnboardingEvolutionScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { t, locale, setLocale } = useI18n();
  const { finishOnboarding } = useAuth();
  const [phase, setPhase] = useState<Phase>("hero");
  const [ctaBusy, setCtaBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<OnboardingStep> | null>(null);

  const horizontalPad = spacing.lg;
  const textMaxWidth = useMemo(
    () => Math.min(400, Math.max(280, screenWidth - horizontalPad * 2)),
    [screenWidth, horizontalPad]
  );
  const carouselListBodyHeight = useMemo(() => {
    const raw = screenHeight - insets.top - insets.bottom - CAROUSEL_CHROME_HEIGHT;
    return Math.max(280, raw);
  }, [insets.bottom, insets.top, screenHeight]);

  const illustrationWidth = useMemo(() => {
    const target = Math.round(screenWidth * 0.9);
    const maxBySlide = Math.round(screenWidth - horizontalPad * 2 - 4);
    return Math.min(target, maxBySlide);
  }, [horizontalPad, screenWidth]);

  /**
   * Výška boxu pre ilustráciu (contain). Assety sú vyššie ako široké — starý limit
   * šírka×0.92 reálne brzdil výšku; horný limit odvodzujeme od portrétneho pomeru.
   */
  const illustrationHeight = useMemo(() => {
    const textBlockEstimate = Math.min(
      230,
      Math.max(118, Math.round(carouselListBodyHeight * 0.3))
    );
    const gapBelowText = spacing.xs;
    const spaceForImage = Math.max(0, carouselListBodyHeight - textBlockEstimate - gapBelowText);
    const fromPercent = Math.round(carouselListBodyHeight * 0.46);
    const portraitHeightCap = Math.round(illustrationWidth * 1.48);
    const bandMax = Math.round(carouselListBodyHeight * 0.54);
    const bandMin = Math.round(carouselListBodyHeight * 0.4);
    const target = Math.min(bandMax, Math.max(bandMin, fromPercent));
    return Math.min(target, spaceForImage, portraitHeightCap);
  }, [carouselListBodyHeight, illustrationWidth]);

  const heroCopyMaxWidth = useMemo(
    () => Math.min(300, Math.max(248, screenWidth - horizontalPad * 2 - 12)),
    [horizontalPad, screenWidth]
  );

  /** Užší riadok pre subtitle — elegantnejší zalamovaný text pod headline. */
  const heroSubtitleMaxWidth = useMemo(
    () => Math.round(heroCopyMaxWidth * 0.88),
    [heroCopyMaxWidth]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<OnboardingStep> | null | undefined, index: number) => ({
      length: screenWidth,
      offset: screenWidth * index,
      index,
    }),
    [screenWidth]
  );

  const onHeroPrimaryCta = useCallback(() => {
    setPhase("carousel");
    setActiveIndex(0);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const onCarouselComplete = useCallback(async () => {
    if (ctaBusy) return;
    setCtaBusy(true);
    try {
      await finishOnboarding();
      (navigation as { navigate: (screen: string) => void }).navigate("Register");
    } finally {
      setCtaBusy(false);
    }
  }, [ctaBusy, finishOnboarding, navigation]);

  const onLogin = useCallback(() => {
    (navigation as { navigate: (screen: string) => void }).navigate("Login");
  }, [navigation]);

  const onMoreLanguages = useCallback(() => {
    (navigation as { navigate: (screen: string) => void }).navigate("LanguageSelect");
  }, [navigation]);

  const goToStep = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, nextIndex));
    setActiveIndex(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
  }, []);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const raw = event.nativeEvent.contentOffset.x / screenWidth;
      const nextIndex = Math.min(STEPS.length - 1, Math.max(0, Math.round(raw)));
      setActiveIndex(nextIndex);
    },
    [screenWidth]
  );

  const onCarouselBack = useCallback(() => {
    if (activeIndex === 0) {
      setPhase("hero");
      return;
    }
    goToStep(activeIndex - 1);
  }, [activeIndex, goToStep]);

  const onSkip = useCallback(() => {
    if (activeIndex === STEPS.length - 1) return;
    goToStep(STEPS.length - 1);
  }, [activeIndex, goToStep]);

  const onCarouselNext = useCallback(async () => {
    const isLast = activeIndex === STEPS.length - 1;
    if (isLast) {
      await onCarouselComplete();
      return;
    }
    goToStep(activeIndex + 1);
  }, [activeIndex, goToStep, onCarouselComplete]);

  const renderCarouselItem = useCallback(
    ({ item }: ListRenderItemInfo<OnboardingStep>) => (
      <View style={[styles.slidePage, { width: screenWidth }]}>
        <View style={[styles.slideInner, { paddingHorizontal: horizontalPad }]}>
          <View style={[styles.textColumn, { maxWidth: textMaxWidth }]}>
            <Text style={styles.carouselTitle}>{t(item.titleKey)}</Text>
            <Text style={styles.carouselSubtitle}>{t(item.subtitleKey)}</Text>
            <Text style={styles.featureTag}>{t("onboardingEvolution.featureTag")}</Text>
          </View>
          <View style={styles.illustrationArea}>
            <View style={[styles.illustrationWrap, { width: illustrationWidth, height: illustrationHeight }]}>
              <Image source={item.image} style={styles.illustration} resizeMode="contain" />
            </View>
          </View>
        </View>
      </View>
    ),
    [horizontalPad, illustrationHeight, illustrationWidth, screenWidth, t, textMaxWidth]
  );

  const progressRatio = (activeIndex + 1) / STEPS.length;

  if (phase === "hero") {
    return (
      <View style={styles.root}>
        <ImageBackground
          source={require("../../assets/welcome-hero.jpg")}
          style={styles.bg}
          resizeMode="cover"
        >
          <View style={styles.overlayBase} pointerEvents="none" />
          <Svg
            width={screenWidth}
            height={screenHeight}
            style={styles.heroOverlaySvg}
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id="heroMainOverlay" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#030508" stopOpacity="0.12" />
                <Stop offset="0.22" stopColor="#030508" stopOpacity="0.28" />
                <Stop offset="0.44" stopColor="#030508" stopOpacity="0.62" />
                <Stop offset="0.56" stopColor="#030508" stopOpacity="0.52" />
                <Stop offset="0.72" stopColor="#030508" stopOpacity="0.46" />
                <Stop offset="0.88" stopColor="#030508" stopOpacity="0.58" />
                <Stop offset="1" stopColor="#030508" stopOpacity="0.54" />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill="url(#heroMainOverlay)" />
          </Svg>

          <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
            <View style={styles.langRow}>
              <View style={styles.moreLangColumn}>
                <Pressable
                  onPress={onMoreLanguages}
                  hitSlop={10}
                  accessibilityRole="button"
                  style={styles.moreLangPill}
                >
                  <Text
                    style={styles.moreLang}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {t("welcomeHero.moreLanguages")}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.heroLangSwitcherShell}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.heroLangPillsScroll}
                  contentContainerStyle={styles.heroLangPillsContent}
                >
                  {HERO_BAR_LOCALES.map((code) => {
                    const active = locale === code;
                    return (
                      <Pressable
                        key={code}
                        onPress={() => setLocale(code)}
                        hitSlop={6}
                        style={[styles.langPill, active && styles.langPillActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.langPillLabel, active && styles.langPillLabelActive]}>
                          {code.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.scrollContent,
                { paddingBottom: spacing.md + Math.round(screenHeight * 0.016) },
              ]}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.heroBlock, { marginTop: -Math.round(screenHeight * 0.054) }]}>
                <Image
                  source={require("../../assets/logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel="Staveto"
                />
                <Text style={styles.brandWord}>STAVETO</Text>
                <View style={[styles.heroCopyPanel, { maxWidth: heroCopyMaxWidth }]}>
                  <Text style={styles.headline} accessibilityRole="header">
                    {t("welcomeHero.headline")}
                  </Text>
                  <Text style={[styles.subtitle, { maxWidth: heroSubtitleMaxWidth }]}>
                    {t("welcomeHero.subtitle")}
                  </Text>
                </View>
                <Pressable
                  style={[styles.cta, ctaBusy && styles.ctaDisabled]}
                  onPress={onHeroPrimaryCta}
                  disabled={ctaBusy}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaText}>{t("welcomeHero.cta")}</Text>
                </Pressable>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <View style={styles.loginRow}>
                <Text style={styles.loginLead}>{t("welcomeHero.loginLead")}</Text>
                <Pressable onPress={onLogin} hitSlop={12} accessibilityRole="link">
                  <Text style={styles.loginLink}>{t("welcomeHero.loginLink")}</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </ImageBackground>
      </View>
    );
  }

  return (
    <View style={styles.carouselRoot}>
      <SafeAreaView style={styles.carouselSafe} edges={["top", "bottom"]}>
        <View style={[styles.carouselTopRow, { paddingHorizontal: horizontalPad }]}>
          <Pressable style={styles.backButton} onPress={onCarouselBack} hitSlop={10}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
            <Text style={styles.backText}>{t("common.back")}</Text>
          </Pressable>
          <Pressable style={styles.skipButton} onPress={onSkip} disabled={activeIndex === STEPS.length - 1}>
            <Text style={[styles.skipText, activeIndex === STEPS.length - 1 && styles.skipTextHidden]}>
              {t("onboardingEvolution.skip")}
            </Text>
          </Pressable>
        </View>

        <FlatList
          ref={(r) => {
            listRef.current = r;
          }}
          style={styles.carouselList}
          data={STEPS}
          keyExtractor={(item) => item.id}
          renderItem={renderCarouselItem}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={({ index }) => {
            listRef.current?.scrollToOffset({ offset: index * screenWidth, animated: false });
          }}
          keyboardShouldPersistTaps="handled"
          decelerationRate="fast"
          initialNumToRender={STEPS.length}
          windowSize={STEPS.length}
        />

        <View style={[styles.carouselFooter, { paddingHorizontal: horizontalPad }]}>
          <Text style={styles.progressText}>
            {t("onboardingEvolution.progress", {
              current: String(activeIndex + 1),
              total: String(STEPS.length),
            })}
          </Text>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.max(8, progressRatio * 100)}%` }]} />
          </View>
          <Pressable
            style={[styles.carouselCta, ctaBusy && styles.ctaDisabled]}
            onPress={onCarouselNext}
            disabled={ctaBusy}
            accessibilityRole="button"
            accessibilityState={{ busy: ctaBusy }}
          >
            {ctaBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.carouselCtaText}>
                {activeIndex === STEPS.length - 1 ? t("onboardingEvolution.startNow") : t("onboardingEvolution.next")}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  bg: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  overlayBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,5,8,0.2)",
  },
  heroOverlaySvg: {
    ...StyleSheet.absoluteFillObject,
  },
  safe: {
    flex: 1,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 6,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  moreLangColumn: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.xs,
  },
  moreLangPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(12, 18, 28, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  moreLang: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroLangSwitcherShell: {
    flexShrink: 0,
    backgroundColor: "rgba(12, 18, 28, 0.52)",
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  heroLangPillsScroll: {
    flexGrow: 0,
  },
  heroLangPillsContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  langPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  langPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  langPillLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  langPillLabelActive: {
    color: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.lg,
  },
  heroBlock: {
    alignItems: "center",
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  heroCopyPanel: {
    alignSelf: "center",
    width: "100%",
    borderRadius: 22,
    paddingHorizontal: spacing.md + 2,
    paddingTop: spacing.md,
    paddingBottom: spacing.md + 2,
    backgroundColor: "rgba(6,8,12,0.38)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.07)",
  },
  logo: {
    width: 280,
    height: 140,
    marginBottom: spacing.sm + 2,
  },
  brandWord: {
    color: colors.primary,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 5,
    marginBottom: spacing.md + 6,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
    lineHeight: 36,
    letterSpacing: -0.2,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  subtitle: {
    marginTop: spacing.sm + 4,
    alignSelf: "center",
    color: "rgba(255,255,255,0.96)",
    fontSize: 14,
    lineHeight: 26,
    textAlign: "center",
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cta: {
    marginTop: spacing.xl,
    minWidth: "100%",
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius + 4,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 10,
  },
  ctaDisabled: {
    opacity: 0.85,
  },
  ctaText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg + 10,
    paddingTop: spacing.sm,
  },
  loginRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
  },
  loginLead: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "500",
  },
  loginLink: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },

  carouselRoot: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  carouselSafe: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  carouselTopRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  backButton: {
    minWidth: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  skipButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  skipText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.primary,
  },
  skipTextHidden: {
    opacity: 0,
  },
  carouselList: {
    flex: 1,
    flexGrow: 1,
  },
  slidePage: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  slideInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  textColumn: {
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  carouselTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    lineHeight: 30,
  },
  carouselSubtitle: {
    marginTop: spacing.sm,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: "center",
    fontWeight: "500",
  },
  featureTag: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  illustrationArea: {
    flex: 1,
    width: "100%",
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  illustrationWrap: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  illustration: {
    width: "100%",
    height: "100%",
  },
  carouselFooter: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  progressText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  carouselCta: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radius + 2,
    paddingVertical: spacing.md + 2,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  carouselCtaText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
});
