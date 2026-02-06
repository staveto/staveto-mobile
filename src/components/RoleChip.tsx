import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getRoleColor, normalizeRoleKey, type RoleKey } from "../helpers/role";
import type { ProjectDoc } from "../services/projects";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";

type RoleChipProps = {
  project: ProjectDoc & { ownerId?: string };
  currentUserId: string;
  showIcon?: boolean;
};

/**
 * RoleChip component - displays user's role in a project
 * Always shows TEXT label (SPRÁVCA/STAVBYVEDÚCI/REMESLENÍK)
 * Optional icon for visual enhancement
 */
export function RoleChip({ project, currentUserId, showIcon = true }: RoleChipProps) {
  const { t } = useI18n();
  const roleKey = normalizeRoleKey(project, currentUserId);
  const roleColor = getRoleColor(roleKey);
  const roleLabel =
    roleKey === "ADMIN"
      ? t("role.admin")
      : roleKey === "MANAGER"
      ? t("role.manager")
      : roleKey === "TRADE"
      ? t("role.trade")
      : t("role.unknown");

  // Get icon based on role
  const getRoleIcon = (key: RoleKey): keyof typeof Ionicons.glyphMap => {
    switch (key) {
      case "ADMIN":
        return "shield-checkmark-outline";
      case "MANAGER":
        return "construct-outline";
      case "TRADE":
        return "hammer-outline";
      default:
        return "help-outline";
    }
  };

  return (
    <View style={[styles.chip, { backgroundColor: roleColor + "15", borderColor: roleColor + "40" }]}>
      {showIcon && (
        <Ionicons
          name={getRoleIcon(roleKey)}
          size={12}
          color={roleColor}
          style={styles.icon}
        />
      )}
      <Text style={[styles.label, { color: roleColor }]}>{roleLabel}</Text>
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
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  icon: {
    marginRight: spacing.xs / 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
