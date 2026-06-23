/**
 * Notify org managers when a crew member starts, pauses, or stops a live timer.
 */
import { auth } from "../firebase";
import type { ActiveTimer } from "./timeTracking";

type TimerPhase = "running" | "paused" | null;

const prevTimerPhase = new Map<string, TimerPhase>();
const lastTimerSnapshot = new Map<string, ActiveTimer>();

async function notifyOrgManagersOfTimerEvent(args: {
  orgId: string;
  workerUid: string;
  workerName: string | null;
  type: "TIMER_STARTED" | "TIMER_PAUSED" | "TIMER_STOPPED";
  timer: ActiveTimer | null;
}): Promise<void> {
  const { createTimerEventNotification } = await import("./notifications");
  const notified = new Set<string>();

  const notifyUid = async (targetUid: string) => {
    if (!targetUid || targetUid === args.workerUid || notified.has(targetUid)) return;
    try {
      await createTimerEventNotification({
        userId: targetUid,
        orgId: args.orgId,
        workerUid: args.workerUid,
        type: args.type,
        projectId: args.timer?.projectId ?? null,
        projectName: args.timer?.projectNameSnapshot ?? null,
        taskTitle: args.timer?.taskTitleSnapshot ?? null,
        fromUserId: args.workerUid,
        fromUserName: args.workerName,
        startedAt: args.timer?.startedAt ?? null,
      });
      notified.add(targetUid);
    } catch (e) {
      if (__DEV__) console.warn("[orgLiveTimer] notify manager failed:", e);
    }
  };

  try {
    const { getOrganization } = await import("./organizations");
    const org = await getOrganization(args.orgId);
    if (org?.ownerUid) await notifyUid(org.ownerUid);
  } catch (e) {
    if (__DEV__) console.warn("[orgLiveTimer] org owner lookup failed:", e);
  }

  try {
    const { listMembers } = await import("./businessMembers");
    const members = await listMembers(args.orgId);
    for (const m of members) {
      const uid = (m.userId?.trim() || m.id?.trim()) ?? "";
      if (
        m.status === "active" &&
        (m.role === "owner" || m.role === "admin" || m.role === "manager") &&
        uid
      ) {
        await notifyUid(uid);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[orgLiveTimer] listMembers failed:", e);
  }
}

function resolveTimerPhase(timer: ActiveTimer | null): TimerPhase {
  if (!timer) return null;
  return timer.status === "paused" ? "paused" : "running";
}

async function emitTimerTransitionNotifications(
  orgId: string,
  timer: ActiveTimer | null
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const prev = prevTimerPhase.get(uid) ?? null;
  const next = resolveTimerPhase(timer);
  if (prev === next) return;

  const workerName =
    auth.currentUser?.displayName ?? auth.currentUser?.email ?? null;
  const snapshot = timer ?? lastTimerSnapshot.get(uid) ?? null;

  if (next === "running" && (prev === null || prev === "paused")) {
    await notifyOrgManagersOfTimerEvent({
      orgId,
      workerUid: uid,
      workerName,
      type: "TIMER_STARTED",
      timer: snapshot,
    });
  } else if (next === "paused" && prev === "running") {
    await notifyOrgManagersOfTimerEvent({
      orgId,
      workerUid: uid,
      workerName,
      type: "TIMER_PAUSED",
      timer: snapshot,
    });
  } else if (next === null && prev !== null) {
    await notifyOrgManagersOfTimerEvent({
      orgId,
      workerUid: uid,
      workerName,
      type: "TIMER_STOPPED",
      timer: snapshot,
    });
  }

  if (timer) lastTimerSnapshot.set(uid, timer);
  else lastTimerSnapshot.delete(uid);
  prevTimerPhase.set(uid, next);
}

export { emitTimerTransitionNotifications };
