/**
 * Publishes running/paused timer state under organizations/{orgId}/liveTimers/{uid}
 * so managers can see crew time tracking without reading users/{uid}.
 */
import { collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { getDocSmart } from "./firestoreSmartRead";
import type { ActiveTimer } from "./timeTracking";
import { resolveLatestWorkGps } from "./timeTracking";

export async function resolveProjectOrgId(projectId: string): Promise<string | null> {
  const normalized = projectId.trim();
  if (!normalized) return null;
  try {
    const snap = await getDocSmart(doc(db, "projects", normalized));
    const orgId = snap.data()?.orgId;
    return typeof orgId === "string" && orgId.trim() ? orgId.trim() : null;
  } catch {
    return null;
  }
}

export async function syncOrgLiveTimer(
  orgId: string | null | undefined,
  timer: ActiveTimer | null
): Promise<void> {
  const uid = auth.currentUser?.uid;
  const normalizedOrg = orgId?.trim();
  if (!uid || !normalizedOrg) return;

  const ref = doc(db, "organizations", normalizedOrg, "liveTimers", uid);
  if (!timer) {
    try {
      await deleteDoc(ref);
    } catch {
      /* best effort */
    }
    return;
  }

  try {
    const liveGps = resolveLatestWorkGps(timer);
    const pauseSince =
      timer.status === "paused" ? timer.pauses?.at(-1)?.startedAt ?? null : null;
    await setDoc(
      ref,
      {
        userId: uid,
        status: timer.status ?? "running",
        projectId: timer.projectId,
        projectNameSnapshot: timer.projectNameSnapshot,
        startedAt: timer.startedAt,
        runningSince: timer.status === "paused" ? null : (timer.runningSince ?? timer.startedAt),
        accumulatedMs: timer.accumulatedMs ?? 0,
        taskId: timer.taskId ?? null,
        taskTitleSnapshot: timer.taskTitleSnapshot ?? null,
        gpsStart: liveGps,
        gpsAccuracyM: liveGps?.accuracyM ?? null,
        gpsTimestamp: liveGps?.timestamp ?? null,
        pauseSince,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    if (__DEV__) console.warn("[orgLiveTimer] sync failed:", err);
  }
}

export type OrgLiveTimerRow = {
  uid: string;
  status: "running" | "paused";
  projectId?: string;
  projectNameSnapshot?: string;
  taskTitleSnapshot?: string | null;
  accumulatedMs?: number;
  runningSince?: string;
  startedAt?: string;
};

function parseOrgLiveTimerDoc(uid: string, raw: Record<string, unknown> | undefined): OrgLiveTimerRow | null {
  if (!raw) return null;
  const status = raw.status === "paused" ? "paused" : "running";
  return {
    uid,
    status,
    projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
    projectNameSnapshot:
      typeof raw.projectNameSnapshot === "string" ? raw.projectNameSnapshot : undefined,
    taskTitleSnapshot:
      typeof raw.taskTitleSnapshot === "string" ? raw.taskTitleSnapshot : null,
    accumulatedMs: typeof raw.accumulatedMs === "number" ? raw.accumulatedMs : undefined,
    runningSince: typeof raw.runningSince === "string" ? raw.runningSince : undefined,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
  };
}

export function subscribeOrgLiveTimers(
  orgId: string | null | undefined,
  onUpdate: (rows: OrgLiveTimerRow[]) => void
): () => void {
  const normalized = orgId?.trim();
  if (!normalized) {
    onUpdate([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, "organizations", normalized, "liveTimers"),
    (snap) => {
      const rows = snap.docs
        .map((d) => parseOrgLiveTimerDoc(d.id, d.data() as Record<string, unknown>))
        .filter((row): row is OrgLiveTimerRow => row !== null);
      onUpdate(rows);
    },
    () => onUpdate([])
  );
}

export function formatOrgLiveTimerElapsed(row: OrgLiveTimerRow, nowMs = Date.now()): string {
  const base = row.accumulatedMs ?? 0;
  if (row.status === "paused") {
    return formatHms(Math.floor(base / 1000));
  }
  const sinceIso = row.runningSince ?? row.startedAt;
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : nowMs;
  const totalSec = Math.max(0, Math.floor((base + Math.max(0, nowMs - sinceMs)) / 1000));
  return formatHms(totalSec);
}

function formatHms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
