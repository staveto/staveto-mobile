/**
 * Local timer reminders - every 2 hours while timer is active.
 * Uses expo-notifications. Cancels all on stop.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const REMINDER_INTERVAL_HOURS = 2;
const MAX_REMINDERS = 6; // 2h, 4h, 6h, 8h, 10h, 12h

// Ensure notifications are shown when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Schedule reminder notifications every 2 hours (up to 12h).
 * Returns array of notification ids to cancel later.
 */
export async function scheduleEvery2hReminder(projectName: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return ids;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("timer-reminders", {
        name: "Timer reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    for (let i = 1; i <= MAX_REMINDERS; i++) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Timer beží",
          body: `Časovač pre "${projectName}" stále beží. Zastaviť alebo pokračovať?`,
        },
        trigger: {
          seconds: REMINDER_INTERVAL_HOURS * 3600 * i,
          channelId: "timer-reminders",
        },
      });
      ids.push(id);
    }
    return ids;
  } catch (err) {
    console.warn("[timerReminders] schedule error:", err);
    return ids;
  }
}

/**
 * Cancel all scheduled reminder notifications.
 */
export async function cancelReminders(ids: string[]): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationsAsync(ids);
  } catch (err) {
    console.warn("[timerReminders] cancel error:", err);
  }
}
