import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, radius, colors } from "../theme";
import {
  buildHomeQuickActions,
  resolveHomeQuickActionRole,
  type HomeQuickActionDef,
  type HomeQuickActionId,
  type HomeQuickActionRoleInput,
} from "../lib/homeQuickActions";

const TILE_MIN = 88;

type Props = {
  roleInput?: HomeQuickActionRoleInput;
  /** Override tile list (e.g. field launcher). */
  actions?: HomeQuickActionDef[];
  columns?: 2 | 3;
  showTitle?: boolean;
  onAction: (id: HomeQuickActionId) => void;
  t: (key: string, params?: Record<string, string>) => string;
  /** Optional subtitle under time tile when timer is active (HH:MM:SS). */
  timeSubtitle?: string | null;
  timeActive?: boolean;
  timePaused?: boolean;
};

export function HomeQuickActionsGrid({
  roleInput,
  actions: actionsOverride,
  columns = 3,
  showTitle = true,
  onAction,
  t,
  timeSubtitle,
  timeActive,
  timePaused,
}: Props) {
  const actions = useMemo(() => {
    if (actionsOverride) return actionsOverride;
    if (!roleInput) return [];
    const role = resolveHomeQuickActionRole(roleInput);
    return buildHomeQuickActions(role);
  }, [actionsOverride, roleInput]);

  const tileStyle = columns === 2 ? styles.tile2col : styles.tile3col;

  return (
    <View style={styles.wrap} accessibilityRole="menu">
      {showTitle ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t("home.quickActions.title")}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {actions.map((action) => {
          const isTime = action.id === "time";
          const accent = action.accent ?? colors.primary;
          const iconColor = isTime && timeActive ? (timePaused ? "#f59e0b" : "#22c55e") : accent;
          return (
            <Pressable
              key={action.id}
              style={({ pressed }) => [
                tileStyle,
                isTime && timeActive ? styles.tileTimeActive : null,
                pressed ? styles.tilePressed : null,
              ]}
              onPress={() => onAction(action.id)}
              accessibilityRole="button"
              accessibilityLabel={t(action.labelKey)}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${accent}18` }]}>
                <Ionicons
                  name={isTime && timeActive ? (timePaused ? "pause" : "time") : action.icon}
                  size={26}
                  color={iconColor}
                />
                {isTime && timeActive && !timePaused ? <View style={styles.liveDot} /> : null}
              </View>
              <Text style={styles.label} numberOfLines={2} maxFontSizeMultiplier={1.15}>
                {t(action.labelKey)}
              </Text>
              {isTime && timeSubtitle ? (
                <Text
                  style={[styles.timeSubtitle, timePaused ? styles.timeSubtitlePaused : null]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}
                >
                  {timeSubtitle}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.textOnDark,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile3col: {
    width: "31%",
    minWidth: TILE_MIN,
    minHeight: TILE_MIN,
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: radius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  tile2col: {
    width: "48%",
    minWidth: TILE_MIN,
    minHeight: 104,
    flexGrow: 1,
    flexBasis: "48%",
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  tileTimeActive: {
    borderColor: "rgba(34,197,94,0.45)",
    backgroundColor: "#f0fdf4",
  },
  tilePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  liveDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    lineHeight: 14,
  },
  timeSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "800",
    color: "#22c55e",
    fontVariant: ["tabular-nums"],
  },
  timeSubtitlePaused: {
    color: "#f59e0b",
  },
});
