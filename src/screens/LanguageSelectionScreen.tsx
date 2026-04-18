import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { Locale } from "../i18n/translations";

const LANGUAGE_SELECTION_DONE_KEY = "language_selection_done";

/** Len tieto štyri jazyky; CZ = locale `cs` v i18n. */
const SLIDER_LANGS: { code: Locale; short: string }[] = [
  { code: "de", short: "DE" },
  { code: "en", short: "EN" },
  { code: "es", short: "ES" },
  { code: "cs", short: "CZ" },
];

type Props = { onComplete?: () => void };

export function LanguageSelectionScreen({ onComplete }: Props) {
  const navigation = useNavigation();
  const { t, locale, setLocale } = useI18n();
  const [trackW, setTrackW] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const segmentW = trackW > 0 ? trackW / SLIDER_LANGS.length : 0;

  const syncThumb = useCallback(
    (w: number) => {
      if (w <= 0) return;
      const idx = SLIDER_LANGS.findIndex((l) => l.code === locale);
      const i = idx >= 0 ? idx : 0;
      slideX.setValue((i * w) / SLIDER_LANGS.length);
    },
    [locale, slideX]
  );

  useEffect(() => {
    syncThumb(trackW);
  }, [syncThumb, trackW]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackW(w);
    syncThumb(w);
  };

  const onSelect = (code: Locale) => {
    setLocale(code);
    AsyncStorage.setItem(LANGUAGE_SELECTION_DONE_KEY, "1").catch(() => {});
    if (onComplete) {
      onComplete();
    } else {
      (navigation as { navigate: (name: string) => void }).navigate("OnboardingIntro");
    }
  };

  const onSegmentPress = (index: number) => {
    const { code } = SLIDER_LANGS[index];
    if (trackW > 0) {
      Animated.spring(slideX, {
        toValue: (index * trackW) / SLIDER_LANGS.length,
        useNativeDriver: true,
        friction: 9,
        tension: 80,
      }).start();
    }
    onSelect(code);
  };

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Staveto logo"
      />
      <Text style={styles.title}>{t("languageSelect.title")}</Text>
      <Text style={styles.subtitle}>{t("languageSelect.subtitle")}</Text>

      <View style={styles.sliderWrap}>
        <View style={styles.track} onLayout={onTrackLayout}>
          {segmentW > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  width: segmentW,
                  transform: [{ translateX: slideX }],
                },
              ]}
            />
          ) : null}
          <View style={styles.segmentsRow}>
            {SLIDER_LANGS.map((lang, index) => (
              <Pressable
                key={lang.code}
                style={styles.segment}
                onPress={() => onSegmentPress(index)}
                accessibilityRole="button"
                accessibilityLabel={lang.short}
              >
                <Text style={styles.segmentLabel}>{lang.short}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {!onComplete && (
        <Pressable
          style={styles.loginLink}
          onPress={() => (navigation as { navigate: (name: string) => void }).navigate("Login")}
        >
          <Text style={styles.loginLinkText}>{t("register.haveAccount")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    color: "#fff",
    textAlign: "center",
  },
  logo: {
    width: 160,
    height: 80,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sliderWrap: {
    marginTop: spacing.xl * 1.25,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  track: {
    borderRadius: radius + 6,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    minHeight: 52,
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius + 4,
    backgroundColor: colors.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 52,
  },
  segment: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  segmentLabel: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  loginLink: {
    marginTop: spacing.xl,
    alignItems: "center",
  },
  loginLinkText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
  },
});
