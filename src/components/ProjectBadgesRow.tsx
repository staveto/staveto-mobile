import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";

type ProjectBadgesRowProps = {
  isOwner: boolean;
  sharedWithCount: number;
  isSharedToMe?: boolean;
};

/**
 * Reusable row showing role icon (👑 owner / 👤 member) and shared badge (👥 n) when n > 0 or isSharedToMe.
 */
export function ProjectBadgesRow({ isOwner, sharedWithCount, isSharedToMe }: ProjectBadgesRowProps) {
  const { t } = useI18n();
  const n = sharedWithCount ?? 0;
  const showSharedBadge = n > 0 || !!isSharedToMe;
  const sharedLabel = isSharedToMe && !isOwner ? t("home.sharedBadge") : String(n);
  return (
    <View style={styles.row} accessible accessibilityRole="text">
      <Text
        style={styles.roleIcon}
        accessibilityLabel={isOwner ? t("home.roleOwner") : t("home.roleSharedWithMe")}
        maxFontSizeMultiplier={1.1}
      >
        {isOwner ? "👑" : "👤"}
      </Text>
      {showSharedBadge && (
        <View style={styles.sharedPill}>
          <Text style={styles.sharedText} maxFontSizeMultiplier={1.2} numberOfLines={1} accessibilityLabel={`Shared ${sharedLabel}`}>
            {isSharedToMe && !isOwner ? `👥 ${t("home.sharedBadge")}` : `👥 ${n}`}
          </Text>
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
