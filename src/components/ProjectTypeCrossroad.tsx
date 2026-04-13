/**
 * @deprecated Unused in current navigation — kept for reference or future revival.
 * Active creation flow uses `CreateProjectWizard` + `projectTypeModel` storage types.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

export type SelectableProjectType = "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "MAINTENANCE";

const CARD_CONFIG: Array<{
  type: SelectableProjectType;
  position: "top" | "left" | "right" | "bottom";
  icon: React.ComponentProps<typeof Ionicons>["name"];
}> = [
  { type: "MANAGEMENT", position: "top", icon: "clipboard-outline" },
  { type: "RESIDENTIAL", position: "left", icon: "home-outline" },
  { type: "TRADE", position: "right", icon: "person-outline" },
  { type: "MAINTENANCE", position: "bottom", icon: "construct-outline" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type ProjectTypeCrossroadProps = {
  selectedType: SelectableProjectType | null;
  onSelectType: (type: SelectableProjectType) => void;
};

export function ProjectTypeCrossroad({ selectedType, onSelectType }: ProjectTypeCrossroadProps) {
  const { t } = useI18n();
  const { width: windowWidth } = useWindowDimensions();

  const roadSize = clamp(windowWidth - spacing.lg * 3, 248, 332);
  const center = roadSize / 2;
  const cardWidth = clamp(roadSize * 0.33, 94, 118);
  const cardHeight = clamp(roadSize * 0.23, 74, 92);
  const centerRadius = clamp(roadSize * 0.18, 44, 56);
  const edgePadding = 8;
  const arrowStrokeWidth = 3.2;
  const arrowGlowWidth = 9;

  const positions = {
    top: { left: center - cardWidth / 2, top: edgePadding },
    left: { left: edgePadding, top: center - cardHeight / 2 },
    right: { left: roadSize - cardWidth - edgePadding, top: center - cardHeight / 2 },
    bottom: { left: center - cardWidth / 2, top: roadSize - cardHeight - edgePadding },
  };

  // Arrow endpoints: from center to inner edge of each card
  const arrowEndpoints = {
    top: { x: center, y: cardHeight + edgePadding },
    left: { x: cardWidth + edgePadding, y: center },
    right: { x: roadSize - cardWidth - edgePadding, y: center },
    bottom: { x: center, y: roadSize - cardHeight - edgePadding },
  };

  const arrowPaths = [
    { from: [center, center], to: [arrowEndpoints.top.x, arrowEndpoints.top.y] },
    { from: [center, center], to: [arrowEndpoints.left.x, arrowEndpoints.left.y] },
    { from: [center, center], to: [arrowEndpoints.right.x, arrowEndpoints.right.y] },
    { from: [center, center], to: [arrowEndpoints.bottom.x, arrowEndpoints.bottom.y] },
  ];

  return (
    <View style={styles.wrapper}>
      <View style={[styles.container, { width: roadSize, height: roadSize }]}>
        <View
          pointerEvents="none"
          style={[
            styles.bgRingOuter,
            {
              width: roadSize * 0.74,
              height: roadSize * 0.74,
              borderRadius: (roadSize * 0.74) / 2,
              left: center - (roadSize * 0.74) / 2,
              top: center - (roadSize * 0.74) / 2,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.bgRingInner,
            {
              width: roadSize * 0.52,
              height: roadSize * 0.52,
              borderRadius: (roadSize * 0.52) / 2,
              left: center - (roadSize * 0.52) / 2,
              top: center - (roadSize * 0.52) / 2,
            },
          ]}
        />
      {/* Arrows layer (z-index 0) */}
      <Svg
        width={roadSize}
        height={roadSize}
        style={StyleSheet.absoluteFill}
      >
        {arrowPaths.map((arr, i) => (
          <React.Fragment key={i}>
            {/* Glow */}
            <Line
              x1={arr.from[0]}
              y1={arr.from[1]}
              x2={arr.to[0]}
              y2={arr.to[1]}
              stroke={colors.primary}
              strokeWidth={arrowGlowWidth}
              strokeOpacity={0.25}
              strokeLinecap="round"
            />
            {/* Main stroke */}
            <Line
              x1={arr.from[0]}
              y1={arr.from[1]}
              x2={arr.to[0]}
              y2={arr.to[1]}
              stroke={colors.primary}
              strokeWidth={arrowStrokeWidth}
              strokeLinecap="round"
            />
            {/* Arrowhead - small triangle at end */}
            <Arrowhead
              cx={arr.to[0]}
              cy={arr.to[1]}
              angle={getAngle(arr.from[0], arr.from[1], arr.to[0], arr.to[1])}
              size={8}
              fill={colors.primary}
            />
          </React.Fragment>
        ))}
      </Svg>

      {/* Center circle (z-index 1) */}
      <View
        style={[
          styles.centerCircle,
          {
            left: center - centerRadius,
            top: center - centerRadius,
            width: centerRadius * 2,
            height: centerRadius * 2,
            borderRadius: centerRadius,
          },
        ]}
      >
        <Text style={styles.centerText} numberOfLines={2} maxFontSizeMultiplier={1.1}>
          {t("createProject.yourProject")}
        </Text>
      </View>

      {/* Cards (z-index 2) */}
      {CARD_CONFIG.map(({ type, position, icon }) => {
        const pos = positions[position];
        const isActive = selectedType === type;
        return (
          <TouchableOpacity
            key={type}
            style={[
              styles.card,
              {
                left: pos.left,
                top: pos.top,
                width: cardWidth,
                minHeight: cardHeight,
              },
              isActive && styles.cardActive,
              isActive && styles.cardActiveScale,
            ]}
            onPress={() => onSelectType(type)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t(`createProject.type.${type}.title`)}
            accessibilityHint={t(`createProject.type.${type}.crossroadSubtitle`)}
            accessibilityState={{ selected: isActive }}
          >
            <View style={[styles.cardIconWrap, isActive && styles.cardIconWrapActive]}>
              <Ionicons
                name={icon}
                size={20}
                color={isActive ? colors.primary : colors.textMuted}
              />
            </View>
            <Text
              style={[styles.cardTitle, isActive && styles.cardTitleActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {t(`createProject.type.${type}.title`)}
            </Text>
            <Text
              style={[styles.cardSubtitle, isActive && styles.cardSubtitleActive]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.2}
            >
              {t(`createProject.type.${type}.crossroadSubtitle`)}
            </Text>
          </TouchableOpacity>
        );
      })}
      </View>
    </View>
  );
}

function getAngle(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

function Arrowhead({
  cx,
  cy,
  angle,
  size,
  fill,
}: {
  cx: number;
  cy: number;
  angle: number;
  size: number;
  fill: string;
}) {
  const tipX = cx;
  const tipY = cy;
  const halfW = size * 0.5;
  const leftX = cx - Math.cos(angle) * size + Math.sin(angle) * halfW;
  const leftY = cy - Math.sin(angle) * size - Math.cos(angle) * halfW;
  const rightX = cx - Math.cos(angle) * size - Math.sin(angle) * halfW;
  const rightY = cy - Math.sin(angle) * size + Math.cos(angle) * halfW;
  const d = `M ${tipX} ${tipY} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`;
  return <Path d={d} fill={fill} />;
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
  },
  container: {
    position: "relative",
  },
  bgRingOuter: {
    position: "absolute",
    borderWidth: 1,
    borderColor: colors.primary + "30",
    backgroundColor: colors.primary + "0A",
  },
  bgRingInner: {
    position: "absolute",
    borderWidth: 1,
    borderColor: colors.primary + "26",
    backgroundColor: colors.primary + "08",
  },
  centerCircle: {
    position: "absolute",
    backgroundColor: colors.background,
    borderWidth: 2.5,
    borderColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  centerText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
    lineHeight: 16,
  },
  card: {
    position: "absolute",
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingVertical: spacing.sm - 1,
    paddingHorizontal: spacing.sm,
    borderRadius: radius + 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    zIndex: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  cardActive: {
    backgroundColor: colors.primary + "15",
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  cardActiveScale: {
    transform: [{ scale: 1.03 }],
  },
  cardIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    backgroundColor: colors.background,
  },
  cardIconWrapActive: {
    backgroundColor: colors.primary + "12",
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 3,
  },
  cardTitleActive: {
    color: colors.primary,
  },
  cardSubtitle: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  cardSubtitleActive: {
    color: colors.textMuted,
  },
});
