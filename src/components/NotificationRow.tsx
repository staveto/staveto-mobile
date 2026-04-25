import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { hasMeaningfulReadAt, type NotificationDoc } from "../services/notifications";

type Props = {
  notification: NotificationDoc;
  onPress: () => void;
  timeLabel: string;
};

const entityIcons: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  task: "checkbox-outline",
  project: "folder-outline",
  expense: "cash-outline",
  document: "document-text-outline",
};

export function NotificationRow({ notification, onPress, timeLabel }: Props) {
  const isUnread = !hasMeaningfulReadAt(notification.readAt);
  const iconName = (notification.entityType && entityIcons[notification.entityType]) ?? "notifications-outline";
  const displayTitle = notification.title ?? notification.message ?? "Notifikácia";
  const displayActor = notification.actorName ?? notification.fromUserName;
  const accessibilitySummary = `${displayTitle}${isUnread ? ", unread" : ", read"}${displayActor ? `, ${displayActor}` : ""}`;
  return (
    <TouchableOpacity
      style={[styles.row, isUnread && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilitySummary}
      accessibilityHint={timeLabel}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={iconName} size={22} color={colors.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {displayTitle}
          </Text>
          {isUnread && <View style={styles.unreadDot} />}
        </View>
        {displayActor ? (
          <Text style={styles.actor} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {displayActor}
          </Text>
        ) : null}
        {notification.message ? (
          <Text style={styles.message} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {notification.message}
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={1.1}>
          {notification.projectId ? `Projekt • ${timeLabel}` : timeLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowUnread: {
    borderColor: colors.primary,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${colors.primary}15`,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  content: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  titleUnread: {
    color: colors.textOnDark,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  actor: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  message: {
    fontSize: 14,
    color: colors.text,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
