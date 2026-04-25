/**
 * Running timer: one persistent local notification (stable identifier).
 * Legacy: 2h reminder IDs stored on activeTimer are cancelled via cancelLegacyReminderIds.
 * Uses expo-notifications — no continuous GPS; updates are driven from app/timer state.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const RUNNING_TIMER_CHANNEL_ID = "staveto-running-timer";
/** Stable id so schedule/replace never stacks duplicate tray entries. */
export const RUNNING_TIMER_NOTIFICATION_ID = "staveto-running-timer-v1";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function formatElapsedInBody(startedAtIso: string): string {
  const ms = Date.now() - new Date(startedAtIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function ensureRunningTimerChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(RUNNING_TIMER_CHANNEL_ID, {
    name: "Timer",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: [0],
  });
}

/**
 * Replace the single running-timer notification (same identifier = update path on Android).
 */
export async function replaceRunningTimerNotification(opts: {
  title: string;
  projectName: string;
  startedAtIso: string;
}): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    await ensureRunningTimerChannel();

    const elapsed = formatElapsedInBody(opts.startedAtIso);
    const body = `${opts.projectName} • ${elapsed}`;

    await Notifications.cancelScheduledNotificationAsync(RUNNING_TIMER_NOTIFICATION_ID).catch(() => {});
    await Notifications.dismissNotificationAsync(RUNNING_TIMER_NOTIFICATION_ID).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier: RUNNING_TIMER_NOTIFICATION_ID,
      content: {
        title: opts.title,
        body,
        sound: false,
        data: { kind: "running_timer" },
        ...(Platform.OS === "android"
          ? {
              color: "#1e2530",
              sticky: true,
              autoDismiss: false,
            }
          : {}),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn("[timerReminders] replaceRunningTimerNotification:", err);
  }
}

/** Remove running-timer notification from tray and cancel any scheduled slot with this id. */
export async function clearRunningTimerNotification(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(RUNNING_TIMER_NOTIFICATION_ID).catch(() => {});
    await Notifications.dismissNotificationAsync(RUNNING_TIMER_NOTIFICATION_ID).catch(() => {});
  } catch (err) {
    console.warn("[timerReminders] clearRunningTimerNotification:", err);
  }
}

/**
 * Cancel legacy per-timer scheduled reminder IDs (stored on users.activeTimer.reminderIds).
 * Safe to call with empty array.
 */
export async function cancelLegacyReminderIds(ids: string[] | undefined | null): Promise<void> {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (list.length === 0) return;
  try {
    await Promise.all(list.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  } catch (err) {
    console.warn("[timerReminders] cancelLegacyReminderIds:", err);
  }
}
