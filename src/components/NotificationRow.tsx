import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import type { NotificationDoc } from "../services/notifications";

type Props = {
  notification: NotificationDoc;
  onPress: () => void;
  timeLabel: string;
};

const entityIcons: Record<NotificationDoc["entityType"], React.ComponentProps<typeof Ionicons>["name"]> = {
  task: "checkbox-outline",
  project: "folder-outline",
  expense: "cash-outline",
  document: "document-text-outline",
};

export function NotificationRow({ notification, onPress, timeLabel }: Props) {
  const isUnread = !notification.readAt;
  return (
    <TouchableOpacity
      style={[styles.row, isUnread && styles.rowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={entityIcons[notification.entityType]} size={22} color={colors.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={1}>
            {notification.title ?? "Notifikácia"}
          </Text>
          {isUnread && <View style={styles.unreadDot} />}
        </View>
        {notification.actorName ? (
          <Text style={styles.actor} numberOfLines={1}>
            {notification.actorName}
          </Text>
        ) : null}
        <Text style={styles.message} numberOfLines={2}>
          {notification.message}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
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
