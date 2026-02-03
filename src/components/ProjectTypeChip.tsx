import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

type ProjectTypeChipProps = {
  projectType?: "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "BUILD" | "MAINTENANCE";
  label?: string; // Optional override label
  showIcon?: boolean;
};

/**
 * ProjectTypeChip component - displays project type (Výstavba, Údržba, Remeslo)
 * Used in project cards to show project category
 */
export function ProjectTypeChip({ projectType, label, showIcon = false }: ProjectTypeChipProps) {
  if (!projectType && !label) return null;

  // Get icon based on project type
  const getProjectIcon = (): keyof typeof Ionicons.glyphMap => {
    if (!projectType) return "folder-outline";
    if (projectType === "BUILD" || projectType === "MANAGEMENT") return "clipboard-outline";
    if (projectType === "MAINTENANCE" || projectType === "RESIDENTIAL") return "settings-outline";
    if (projectType === "TRADE") return "construct-outline";
    return "folder-outline";
  };

  const displayLabel = label || projectType || "";

  return (
    <View style={styles.chip}>
      {showIcon && projectType && (
        <Ionicons
          name={getProjectIcon()}
          size={10}
          color={colors.textMuted}
          style={styles.icon}
        />
      )}
      <Text style={styles.label}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  icon: {
    marginRight: spacing.xs / 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
    color: colors.textMuted,
    textTransform: "capitalize",
  },
});
