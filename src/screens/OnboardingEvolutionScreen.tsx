import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

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

const PARTICLE_COUNT = 16;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingStep>);

function ConfettiBurst({ trigger }: { trigger: Animated.SharedValue<number> }) {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
        const angle = (Math.PI * 2 * i) / PARTICLE_COUNT;
        const radiusTarget = 28 + (i % 4) * 14;
        const size = 4 + (i % 3) * 2;
        return { key: `p-${i}`, angle, radiusTarget, size };
      }),
    []
  );

  return (
    <View pointerEvents="none" style={styles.confettiContainer}>
      {particles.map((particle, index) => (
        <ConfettiParticle
          key={particle.key}
          trigger={trigger}
          angle={particle.angle}
          radiusTarget={particle.radiusTarget}
          size={particle.size}
          delayMs={index * 12}
        />
      ))}
    </View>
  );
}

function ConfettiParticle({
  trigger,
  angle,
  radiusTarget,
  size,
  delayMs,
}: {
  trigger: Animated.SharedValue<number>;
  angle: number;
  radiusTarget: number;
  size: number;
  delayMs: number;
}) {
  const style = useAnimatedStyle(() => {
    const progress = interpolate(trigger.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    const delayed = interpolate(progress, [0, delayMs / 1000, 1], [0, 0, 1], Extrapolation.CLAMP);
    const travel = radiusTarget * delayed;
    return {
      opacity: 1 - delayed,
      transform: [
        { translateX: Math.cos(angle) * travel },
        { translateY: Math.sin(angle) * travel - delayed * 12 },
        { scale: 1 - delayed * 0.3 },
      ],
    };
  });

  return <Animated.View style={[styles.confettiParticle, { width: size, height: size, borderRadius: size / 2 }, style]} />;
}

export function OnboardingEvolutionScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { finishOnboarding } = useAuth();
  const listRef = useRef<FlatList<OnboardingStep> | null>(null);
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  /** Portrait hero: fill card edge-to-edge; `cover` crops overflow. */
  const heroCardWidth = Math.min(width - spacing.md * 2, 480);
  const heroImageHeight = Math.round(
    Math.max(280, Math.min(heroCardWidth * 1.18, height * 0.46, 580))
  );

  const imageOpacity = useSharedValue(1);
  const imageScale = useSharedValue(1);
  const imageRotateDeg = useSharedValue(0);
  const textOpacity = useSharedValue(1);
  const textTranslateY = useSharedValue(0);
  const burstTrigger = useSharedValue(0);

  const triggerStepAnimations = useCallback(() => {
    imageOpacity.value = 0;
    imageScale.value = 0.96;
    imageRotateDeg.value = -2;
    textOpacity.value = 0;
    textTranslateY.value = 10;
    burstTrigger.value = 0;

    imageOpacity.value = withTiming(1, { duration: 220 });
    imageScale.value = withSpring(1, { damping: 12, stiffness: 180 });
    imageRotateDeg.value = withTiming(0, { duration: 260 });
    textOpacity.value = withDelay(50, withTiming(1, { duration: 240 }));
    textTranslateY.value = withDelay(50, withTiming(0, { duration: 240 }));
    burstTrigger.value = withTiming(1, { duration: 420 });
  }, [burstTrigger, imageOpacity, imageRotateDeg, imageScale, textOpacity, textTranslateY]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
      if (nextIndex === activeIndex) return;
      setActiveIndex(nextIndex);
      triggerStepAnimations();
    },
    [activeIndex, triggerStepAnimations, width]
  );

  const mascotStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
    transform: [{ scale: imageScale.value }, { rotate: `${imageRotateDeg.value}deg` }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  const goToStep = useCallback(
    (nextIndex: number) => {
      listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setActiveIndex(nextIndex);
      triggerStepAnimations();
    },
    [triggerStepAnimations]
  );

  const onNext = useCallback(async () => {
    const isLast = activeIndex === STEPS.length - 1;
    if (isLast) {
      await finishOnboarding();
      (navigation as { navigate: (screen: string) => void }).navigate("Register");
      return;
    }
    goToStep(activeIndex + 1);
  }, [activeIndex, finishOnboarding, goToStep, navigation]);

  const onBack = useCallback(() => {
    if (activeIndex === 0) {
      (navigation as { goBack: () => void }).goBack();
      return;
    }
    goToStep(activeIndex - 1);
  }, [activeIndex, goToStep, navigation]);

  const onSkip = useCallback(() => {
    if (activeIndex === STEPS.length - 1) return;
    goToStep(STEPS.length - 1);
  }, [activeIndex, goToStep]);

  const progressRatio = (activeIndex + 1) / STEPS.length;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<OnboardingStep>) => {
      return (
        <View style={[styles.slide, { width }]}>
          <Animated.View style={[styles.textWrap, textStyle]}>
            <Text style={styles.title}>{t(item.titleKey)}</Text>
            <Text style={styles.subtitle}>{t(item.subtitleKey)}</Text>
            <Text style={styles.featureTag}>{t("onboardingEvolution.featureTag")}</Text>
          </Animated.View>
          <Animated.View
            style={[
              styles.imageWrap,
              { width: heroCardWidth, height: heroImageHeight },
              mascotStyle,
            ]}
          >
            <Image source={item.image} style={styles.image} resizeMode="cover" />
          </Animated.View>
        </View>
      );
    },
    [heroCardWidth, heroImageHeight, mascotStyle, textStyle, t, width]
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Pressable style={styles.backButton} onPress={onBack}>
              <Ionicons name="chevron-back" size={18} color={colors.text} />
              <Text style={styles.backText}>{t("common.back")}</Text>
            </Pressable>
            <Pressable style={styles.skipButton} onPress={onSkip} disabled={activeIndex === STEPS.length - 1}>
              <Text style={[styles.skipText, activeIndex === STEPS.length - 1 && styles.skipTextHidden]}>
                {t("onboardingEvolution.skip")}
              </Text>
            </Pressable>
          </View>

          <AnimatedFlatList
            ref={(node) => {
              listRef.current = node as FlatList<OnboardingStep> | null;
            }}
            style={styles.carousel}
            data={STEPS}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
          />

          <View style={styles.progressWrap}>
            <Text style={styles.progressText}>
              {t("onboardingEvolution.progress", {
                current: String(activeIndex + 1),
                total: String(STEPS.length),
              })}
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${Math.max(8, progressRatio * 100)}%` }]} />
            </View>
          </View>

          <Pressable style={styles.nextButton} onPress={onNext}>
            <Text style={styles.nextButtonText}>
              {activeIndex === STEPS.length - 1 ? t("onboardingEvolution.startNow") : t("onboardingEvolution.next")}
            </Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
        <ConfettiBurst trigger={burstTrigger} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  safe: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  topRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  backButton: {
    minWidth: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backButtonHidden: {
    opacity: 0,
  },
  backText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  skipButton: {
    minWidth: 56,
    alignItems: "flex-end",
  },
  skipText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  skipTextHidden: {
    opacity: 0,
  },
  carousel: {
    flex: 1,
    minHeight: 0,
  },
  slide: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  textWrap: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  imageWrap: {
    alignSelf: "center",
    marginTop: spacing.xs,
    borderRadius: radius * 2,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: "#16233f",
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: "#3a4663",
    textAlign: "center",
    maxWidth: 340,
  },
  featureTag: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.primary,
    fontWeight: "600",
  },
  progressWrap: {
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressText: {
    fontSize: 13,
    color: "#4d5b78",
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  progressBarTrack: {
    width: 140,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.1)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  nextButton: {
    marginTop: spacing.xs,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  confettiContainer: {
    position: "absolute",
    left: "50%",
    top: "54%",
    marginLeft: -4,
    marginTop: -4,
    width: 8,
    height: 8,
  },
  confettiParticle: {
    position: "absolute",
    backgroundColor: "#ff8a47",
  },
});
