import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { colors, radius, spacing } from "../theme";

type Props = {
  visible: boolean;
  imageUri?: string;
  title?: string;
  subtitle?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onFinished?: () => void;
  durationMs?: number;
};

const PREVIEW_WIDTH = Math.min(Dimensions.get("window").width - spacing.lg * 2, 360);
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH * 1.35);

export function DocumentScanOverlay({
  visible,
  imageUri,
  title,
  subtitle,
  cancelLabel,
  onCancel,
  onFinished,
  durationMs = 1500,
}: Props) {
  const scanLineY = useRef(new Animated.Value(0)).current;
  const scanGlow = useRef(new Animated.Value(0.45)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const [showSubtitle, setShowSubtitle] = useState(false);
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const glowRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) {
      scanLineY.setValue(0);
      scanGlow.setValue(0.45);
      subtitleOpacity.setValue(0);
      setShowSubtitle(false);
      loopRef.current?.stop();
      glowRef.current?.stop();
      return;
    }

    setShowSubtitle(false);
    subtitleOpacity.setValue(0);

    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineY, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loopRef.current = scanLoop;
    scanLoop.start();

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanGlow, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(scanGlow, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    glowRef.current = glowLoop;
    glowLoop.start();

    const subtitleTimer = setTimeout(() => {
      setShowSubtitle(true);
      Animated.timing(subtitleOpacity, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }).start();
    }, 750);

    const finishTimer = setTimeout(() => {
      onFinished?.();
    }, durationMs);

    return () => {
      clearTimeout(subtitleTimer);
      clearTimeout(finishTimer);
      loopRef.current?.stop();
      glowRef.current?.stop();
    };
  }, [visible, durationMs, onFinished, scanGlow, scanLineY, subtitleOpacity]);

  const lineTranslateY = scanLineY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PREVIEW_HEIGHT - 4],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.content}>
          {imageUri ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="cover" />
              <View style={styles.previewDim} />
              <Animated.View
                style={[
                  styles.scanLine,
                  {
                    opacity: scanGlow,
                    transform: [{ translateY: lineTranslateY }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.scanLineGlow,
                  {
                    opacity: scanGlow,
                    transform: [{ translateY: lineTranslateY }],
                  },
                ]}
              />
            </View>
          ) : null}

          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle && showSubtitle ? (
            <Animated.Text style={[styles.subtitle, { opacity: subtitleOpacity }]}>{subtitle}</Animated.Text>
          ) : null}

          {cancelLabel && onCancel ? (
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.85}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 22, 48, 0.96)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  content: {
    width: "100%",
    alignItems: "center",
  },
  previewWrap: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: radius,
    overflow: "hidden",
    marginBottom: spacing.lg,
    backgroundColor: "#0a1628",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  previewImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  previewDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 22, 48, 0.35)",
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.95,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  scanLineGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 28,
    marginTop: -12,
    backgroundColor: "rgba(224, 103, 55, 0.22)",
  },
  title: {
    color: colors.textOnDark,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.labelMutedOnDark,
    fontSize: 14,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  cancelBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    color: colors.teamAccent,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
