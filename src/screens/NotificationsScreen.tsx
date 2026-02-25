import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
} from "react-native";
import { showToast } from "../helpers/toast";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useUnreadCountContext } from "../context/UnreadCountContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import * as notificationsService from "../services/notifications";
import type { NotificationDoc, NotificationType } from "../services/notifications";
import * as invitesService from "../services/invites";
import type { PendingInvite } from "../services/invites";
import * as tasksService from "../services/tasks";
import { ICON_HIT_SLOP } from "../utils/accessibility";

export function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const { refresh: refreshUnreadCount, setCount: setUnreadCount } = useUnreadCountContext();
  const navigation = useNavigation();
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "today" | "overdue">("unread");
  const [showMenu, setShowMenu] = useState(false);

  const loadNotifications = useCallback(async (isRefresh = false) => {
    if (!orgId) {
      setLoading(false);
      setRefreshing(false);
      setNotifications([]);
      setPendingInvites([]);
      return;
    }
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [list, invites] = await Promise.all([
        notificationsService.listNotifications(orgId, { limitCount: 50 }),
        invitesService.listPendingInvites(),
      ]);
      setNotifications(list);
      setPendingInvites(invites);
    } catch (error: any) {
      console.error("[NotificationsScreen] Error loading:", error);
      setNotifications([]);
      setPendingInvites([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  const onRefresh = useCallback(() => {
    loadNotifications(true);
  }, [loadNotifications]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications(false);
    }, [loadNotifications])
  );

  const markAsRead = useCallback(
    async (notification: NotificationDoc) => {
      try {
        await notificationsService.markNotificationAsRead(notification);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n))
        );
      } catch (error: any) {
        console.error("[NotificationsScreen] Error marking as read:", error);
      }
    },
    []
  );

  const handleMarkAllAsRead = useCallback(async () => {
    if (!orgId) return;
    try {
      setUnreadCount(0);
      await notificationsService.markAllAsRead(orgId);
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setShowMenu(false);
      await refreshUnreadCount();
    } catch (error: any) {
      console.error("[NotificationsScreen] Error marking all as read:", error);
      await refreshUnreadCount();
      Alert.alert(t("common.error"), t("notifications.markAllReadFailed"));
    }
  }, [orgId, refreshUnreadCount, setUnreadCount]);

  // Safe date helpers (handle Timestamp, string, Date, null)
  const toDateSafe = (v: any): Date | null => {
    if (!v) return null;
    // Firestore Timestamp (RNFirebase)
    if (typeof v === "object" && typeof v.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    // "YYYY-MM-DD" string
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    // ISO string / millis / Date
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const toDateOnly = (v: any): Date | null => {
    const d = toDateSafe(v);
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const formatRelativeTime = (createdAt: any): string => {
    const date = toDateSafe(createdAt);
    if (!date) return "";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 60) return `${Math.max(diffMinutes, 1)} min`;
    if (diffHours < 24) return `${diffHours} h`;
    if (diffDays === 1) return t("notifications.yesterday");
    if (diffDays < 7) return `${diffDays} d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} t`;
    return `${Math.floor(diffDays / 30)} m`;
  };

  const getNotificationIcon = (type: NotificationType): React.ComponentProps<typeof Ionicons>["name"] => {
    switch (type) {
      case "TASK_DUE_TODAY":
        return "time-outline";
      case "TASK_OVERDUE":
        return "warning-outline";
      case "TASK_ASSIGNED":
      case "PROBLEM_ASSIGNED":
        return "checkmark-circle-outline";
      case "EXPENSE_ADDED":
        return "cash-outline";
      case "DIARY_ADDED":
        return "journal-outline";
      case "PROJECT_CREATED":
        return "add-circle-outline";
      case "PROJECT_ACTIVITY":
        return "folder-outline";
      case "MEMBER_JOINED":
      case "PROJECT_INVITED":
        return "person-add-outline";
      case "MEMBER_LEFT":
      case "MEMBER_REMOVED":
        return "person-remove-outline";
      case "SYNC_ISSUE":
        return "cloud-offline-outline";
      default:
        return "notifications-outline";
    }
  };

  const getNotificationTitle = (n: NotificationDoc): string => {
    switch (n.type) {
      case "TASK_DUE_TODAY":
        return t("notifications.taskToday");
      case "TASK_OVERDUE":
        return t("notifications.overdue");
      case "TASK_ASSIGNED":
        return t("notifications.assignedTask");
      case "PROBLEM_ASSIGNED":
        return t("notifications.problemAssigned");
      case "EXPENSE_ADDED":
        return t("notifications.newExpense");
      case "DIARY_ADDED":
        return t("notifications.diaryAdded");
      case "PROJECT_CREATED":
        return t("notifications.newProject");
      case "PROJECT_ACTIVITY":
        return t("notifications.projectChange");
      case "MEMBER_JOINED":
        return t("notifications.memberJoined");
      case "PROJECT_INVITED":
        return t("notifications.type.projectInvited");
      case "MEMBER_LEFT":
        return t("notifications.memberLeft");
      case "MEMBER_REMOVED":
        return t("notifications.memberRemoved");
      case "SYNC_ISSUE":
        return t("notifications.syncError");
      default:
        return t("notifications.default");
    }
  };

  const getNotificationSubtitle = (n: NotificationDoc): string => {
    const parts: string[] = [];
    if (n.projectName) parts.push(`${t("notifications.projectLabel")}: ${n.projectName}`);
    if (n.taskTitle) parts.push(n.taskTitle);
    if (n.amount != null) parts.push(`${n.amount} ${n.currency || "EUR"}`);
    if (n.message) parts.push(n.message);
    return parts.join(" • ") || t("notifications.noDescription");
  };

  /** Navigate to the related item (project, task, etc.). Also marks as read. */
  const handleNavigateToNotification = useCallback(
    async (notification: NotificationDoc) => {
      await markAsRead(notification);

      const taskIdForDetail =
        notification.taskId ?? (notification.meta?.taskId as string | undefined);

      if (notification.type === "TASK_ASSIGNED" && notification.projectId) {
        if (!taskIdForDetail) {
          const parentNav = navigation.getParent();
          if (parentNav) {
            (parentNav as any).navigate("ProjectOverview", { projectId: notification.projectId });
          }
          return;
        }
        try {
          const task = await tasksService.getTaskById(notification.projectId, taskIdForDetail);
          if (task) {
            const parentNav = navigation.getParent();
            if (parentNav) {
              (parentNav as any).navigate("TaskDetail", { task });
            }
            return;
          }
        } catch (error) {
          console.error("[NotificationsScreen] Error loading task for TASK_ASSIGNED:", error);
        }
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectOverview", { projectId: notification.projectId });
        }
        showToast("K projektu už nemáš prístup.");
        return;
      }

      if (notification.type === "TASK_DUE_TODAY" || notification.type === "TASK_OVERDUE") {
        if (notification.taskId && notification.projectId) {
          try {
            const task = await tasksService.getTaskById(notification.projectId, notification.taskId);
            if (task) {
              // Navigate to root stack TaskDetail screen
              const parentNav = navigation.getParent();
              if (parentNav) {
                (parentNav as any).navigate("TaskDetail", { task });
              }
              return;
            }
          } catch (error) {
            console.error("[NotificationsScreen] Error loading task:", error);
          }
        }
        const dueFilter = notification.type === "TASK_DUE_TODAY" ? "today" : "overdue";
        // Navigate to Home tab -> Tasks screen
        (navigation as any).navigate("Home", {
          screen: "Tasks",
          params: { dueFilter },
        });
      } else if (notification.type === "PROBLEM_ASSIGNED" && notification.projectId) {
        const problemId = notification.problemId ?? (notification.meta?.problemId as string) ?? notification.deepLink?.params?.problemId;
        if (problemId) {
          const parentNav = navigation.getParent();
          if (parentNav) {
            (parentNav as any).navigate("ProblemDetail", { projectId: notification.projectId, problemId });
          }
          return;
        }
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectOverview", { projectId: notification.projectId });
        }
      } else if (notification.type === "EXPENSE_ADDED" && notification.projectId && notification.expenseId) {
        // Navigate to root stack ProjectOverview screen
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectOverview", {
            projectId: notification.projectId,
            openExpenseId: notification.expenseId,
          });
        }
      } else if (notification.type === "DIARY_ADDED" && notification.projectId) {
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectOverview", {
            projectId: notification.projectId,
            openDiaryModal: true,
          });
        }
      } else if (notification.type === "PROJECT_INVITED") {
        // Navigate to ProjectInvites to accept/decline
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectInvites");
        }
      } else if (
        (notification.type === "PROJECT_ACTIVITY" ||
          notification.type === "PROJECT_CREATED" ||
          notification.type === "MEMBER_JOINED" ||
          notification.type === "MEMBER_LEFT" ||
          notification.type === "MEMBER_REMOVED") &&
        notification.projectId
      ) {
        // Navigate to root stack ProjectOverview screen
        const parentNav = navigation.getParent();
        if (parentNav) {
          (parentNav as any).navigate("ProjectOverview", {
            projectId: notification.projectId,
          });
        }
      } else if (notification.type === "SYNC_ISSUE") {
        Alert.alert(t("notifications.syncErrorTitle"), notification.message || t("notifications.syncError"));
      }
    },
    [navigation, markAsRead]
  );

  /** Tap on card: mark as read only, no navigation. */
  const handleMarkAsReadOnly = useCallback(
    (notification: NotificationDoc) => {
      if (!notification.readAt) {
        markAsRead(notification);
      }
    },
    [markAsRead]
  );

  const isTodayNotification = (n: NotificationDoc) => {
    if (n.type === "TASK_DUE_TODAY") return true;
    const date = toDateOnly(n.dueDate);
    if (!date) return false;
    const today = toDateOnly(new Date());
    return !!today && date.getTime() === today.getTime();
  };

  const isOverdueNotification = (n: NotificationDoc) => {
    if (n.type === "TASK_OVERDUE") return true;
    const date = toDateOnly(n.dueDate);
    if (!date) return false;
    const today = toDateOnly(new Date());
    return !!today && date.getTime() < today.getTime();
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.readAt;
    if (filter === "today") return isTodayNotification(n);
    if (filter === "overdue") return isOverdueNotification(n);
    return true;
  });

  const unreadNotificationsCount = notifications.filter((n) => !n.readAt).length;
  const unreadCount = unreadNotificationsCount + pendingInvites.length;
  const todayCount = notifications.filter(isTodayNotification).length;
  const overdueCount = notifications.filter(isOverdueNotification).length;

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header" maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {t("tabs.notifications")}
        </Text>
        <TouchableOpacity
          style={styles.headerMenu}
          onPress={() => setShowMenu(true)}
          accessibilityRole="button"
          accessibilityLabel="Open actions"
          hitSlop={ICON_HIT_SLOP}
        >
          <Ionicons name="ellipsis-vertical" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      {/* Filter Bar - Neprečítané je prvé a default */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterChip, filter === "unread" && styles.filterChipActive, { marginRight: spacing.sm }]}
          onPress={() => setFilter("unread")}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === "unread" }}
        >
          <Text style={[styles.filterChipText, filter === "unread" && styles.filterChipTextActive]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("notifications.unread")} {unreadCount > 0 && `(${unreadCount})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === "all" && styles.filterChipActive, { marginRight: spacing.sm }]}
          onPress={() => setFilter("all")}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === "all" }}
        >
          <Text style={[styles.filterChipText, filter === "all" && styles.filterChipTextActive]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("projectOverview.allTasksFilter")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === "today" && styles.filterChipActive, { marginRight: spacing.sm }]}
          onPress={() => setFilter("today")}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === "today" }}
        >
          <Text style={[styles.filterChipText, filter === "today" && styles.filterChipTextActive]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("notifications.today")} {todayCount > 0 && `(${todayCount})`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === "overdue" && styles.filterChipActive]}
          onPress={() => setFilter("overdue")}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === "overdue" }}
        >
          <Text style={[styles.filterChipText, filter === "overdue" && styles.filterChipTextActive]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("notifications.overdue")} {overdueCount > 0 && `(${overdueCount})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Notifications List */}
      {filter === "unread" && pendingInvites.length > 0 ? (
        <FlatList
          data={[
            ...pendingInvites.map((inv) => ({ kind: "invite" as const, id: `invite-${inv.projectId}`, invite: inv })),
            ...filteredNotifications.map((n) => ({ kind: "notification" as const, id: n.id, notification: n })),
          ]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
          renderItem={({ item }) =>
            item.kind === "invite" ? (
              <TouchableOpacity
                style={[styles.notificationCard, styles.notificationCardUnread]}
                onPress={() => {
                  const parentNav = navigation.getParent();
                  if (parentNav) (parentNav as any).navigate("ProjectInvites");
                }}
                activeOpacity={0.7}
              >
                <View style={styles.cardContent}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="person-add-outline" size={52} color={colors.primary} />
                  </View>
                  <View style={styles.textContainer}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {t("notifications.type.projectInvited")}
                    </Text>
                    <Text style={styles.cardSubtitle} numberOfLines={2}>
                      {t("notifications.projectLabel")}: {item.invite.projectName}
                    </Text>
                  </View>
                  <View style={styles.rightContainer}>
                    <View style={styles.unreadDot} />
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={[styles.notificationCard, !item.notification.readAt && styles.notificationCardUnread]}>
                <TouchableOpacity
                  style={styles.cardContent}
                  onPress={() => handleMarkAsReadOnly(item.notification)}
                  activeOpacity={0.7}
                >
                  <View style={styles.iconContainer}>
                    <Ionicons name={getNotificationIcon(item.notification.type)} size={52} color={colors.primary} />
                  </View>
                  <View style={styles.textContainer}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {getNotificationTitle(item.notification)}
                    </Text>
                    <Text style={styles.cardSubtitle} numberOfLines={2}>
                      {getNotificationSubtitle(item.notification)}
                    </Text>
                  </View>
                  <View style={styles.rightContainer}>
                    {!item.notification.readAt && <View style={styles.unreadDot} />}
                    <Text style={styles.timeText}>{formatRelativeTime(item.notification.createdAt)}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.chevronButton}
                  onPress={() => handleNavigateToNotification(item.notification)}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Open notification"
                >
                  <Ionicons name="chevron-forward" size={24} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )
          }
        />
      ) : filteredNotifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText} maxFontSizeMultiplier={1.2}>
            {filter === "unread" ? t("notifications.noUnread") : t("notifications.none")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
          renderItem={({ item }) => (
            <View style={[styles.notificationCard, !item.readAt && styles.notificationCardUnread]}>
              <TouchableOpacity
                style={styles.cardContent}
                onPress={() => handleMarkAsReadOnly(item)}
                activeOpacity={0.7}
              >
                <View style={styles.iconContainer}>
                  <Ionicons name={getNotificationIcon(item.type)} size={52} color={colors.primary} />
                </View>
                <View style={styles.textContainer}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {getNotificationTitle(item)}
                  </Text>
                  <Text style={styles.cardSubtitle} numberOfLines={2}>
                    {getNotificationSubtitle(item)}
                  </Text>
                </View>
                <View style={styles.rightContainer}>
                  {!item.readAt && <View style={styles.unreadDot} />}
                  <Text style={styles.timeText}>{formatRelativeTime(item.createdAt)}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.chevronButton}
                onPress={() => handleNavigateToNotification(item)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Open notification"
              >
                <Ionicons name="chevron-forward" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Menu Modal */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleMarkAllAsRead}>
              <Text style={styles.menuItemText}>{t("notifications.markAllRead")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setShowMenu(false)}>
              <Text style={styles.menuItemText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  headerMenu: {
    padding: spacing.xs,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  filterBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    minHeight: 44,
    justifyContent: "center",
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textMuted,
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  listContent: {
    padding: spacing.md,
  },
  notificationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 80,
  },
  notificationCardUnread: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primary + "15",
  },
  cardContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  textContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  rightContainer: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  chevronButton: {
    padding: spacing.sm,
    marginLeft: spacing.xs,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginBottom: spacing.xs,
  },
  timeText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "500",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.md,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  menuCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingVertical: spacing.sm,
  },
  menuItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: "500",
  },
});
