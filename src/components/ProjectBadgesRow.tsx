import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../theme";

type ProjectBadgesRowProps = {
  isOwner: boolean;
  sharedWithCount: number;
};

/**
 * Reusable row showing role icon (👑 owner / 👤 member) and shared badge (👥 n) when n > 0.
 */
export function ProjectBadgesRow({ isOwner, sharedWithCount }: ProjectBadgesRowProps) {
  const n = sharedWithCount ?? 0;
  return (
    <View style={styles.row}>
      <Text style={styles.roleIcon} accessibilityLabel={isOwner ? "Vlastník" : "Zdieľané so mnou"}>
        {isOwner ? "👑" : "👤"}
      </Text>
      {n > 0 && (
        <View style={styles.sharedPill}>
          <Text style={styles.sharedText}>👥 {n}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  roleIcon: {
    fontSize: 14,
  },
  sharedPill: {
    backgroundColor: colors.primary + "20",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sharedText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
  },
});
