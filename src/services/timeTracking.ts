/**
 * Time tracking service: start/stop timer, manual entry, active timer state.
 * Uses users/{uid}.activeTimer and timeEntries collection.
 */

import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  Timestamp,
  query,
  where,
  orderBy,
  limit,
} from "../lib/rnFirestore";
import firestore from "@react-native-firebase/firestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { safeFirestoreDocData } from "../lib/safeFirestoreDocData";
import { getDocsSmart, type SmartReadOptions } from "./firestoreSmartRead";
import { getCurrentPositionSafe, requestLocationPermission, type GpsPoint } from "../lib/location";
import { cancelLegacyReminderIds, clearRunningTimerNotification, replaceRunningTimerNotification } from "./timerReminders";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import { createTimeTrackingStoppedNotification } from "./notifications";
import { postDebugIngest } from "../lib/debugIngest";

/** Project time reads: avoid cache-first on poor network (stale empty snapshot before server sync). */
const TIME_ENTRIES_READ_OPTS: SmartReadOptions = { preferCacheWhenPoor: false };

/**
 * Always prefer server for time entry queries: persistent local cache can stay empty after
 * first offline session and mask real rows until cleared; rules/index changes also need fresh data.
 */
async function getDocsTimeEntriesQuerySnap(queryRef: Parameters<typeof getDocsSmart>[0]) {
  return await getDocsSmart(queryRef, { ...TIME_ENTRIES_READ_OPTS, forceServer: true });
}

const AUTO_STOP_HOURS = 12;

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    t = setTimeout(() => resolve(onTimeout), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

/** Timer lifecycle: "running" = ticking, "paused" = stopped between work segments. */
export type TimerStatus = "running" | "paused";

/** One pause window inside a timer session. `endedAt` filled on resume; missing while currently paused. */
export type TimerPause = {
  startedAt: string;
  endedAt?: string;
};

export type ActiveTimer = {
  projectId: string;
  projectNameSnapshot: string;
  startedAt: string;
  source: string;
  gpsStart?: GpsPoint | null;
  reminderIds?: string[];
  phaseId?: string | null;
  phaseNameSnapshot?: string | null;
  taskId?: string | null;
  taskTitleSnapshot?: string | null;
  /** `projects[].ownerId` at start — used for offline permission + stop when Firestore member cache is empty. */
  ownerIdSnapshot?: string | null;
  /**
   * Pause/resume support. Old timers without these fields keep working
   * (treated as always-running started at `startedAt`).
   */
  status?: TimerStatus;
  /** When the current running segment started; null while paused. */
  runningSince?: string | null;
  /** Net working time across previous segments — does NOT include the currently running segment. */
  accumulatedMs?: number;
  /** Pause windows during this session; last entry may be open (no `endedAt`) while currently paused. */
  pauses?: TimerPause[];
};

export type TimeEntryDoc = {
  id: string;
  projectId: string;
  projectNameSnapshot: string;
  userId: string;
  userNameSnapshot: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  mode: "timer" | "manual";
  date?: string; // YYYY-MM-DD for manual entries
  note?: string;
  gpsStart?: GpsPoint | null;
  gpsEnd?: GpsPoint | null;
  flags?: { reminded?: boolean; autoStopped?: boolean; lowAccuracy?: boolean };
  phaseId?: string | null;
  phaseNameSnapshot?: string | null;
  taskId?: string | null;
  taskTitleSnapshot?: string | null;
  /** Optional: pause windows during the timer session (only present for newer entries). */
  pauses?: TimerPause[];
  /** Optional: net work duration in ms (no pauses). `durationMinutes` remains the canonical metric for reports. */
  workDurationMs?: number;
  createdAt?: string;
  updatedAt?: string;
};

/** Normalize common Firestore / CSV / UI date strings before `new Date(...)`. */
function normalizeIsoLikeString(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d/.test(t)) return t.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  return t;
}

function toIso(ts: unknown): string | undefined {
  if (ts == null || ts === "") return undefined;
  if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (ts as { toDate: () => Date }).toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
    } catch {
      /* fall through */
    }
  }
  if (ts instanceof Timestamp) {
    try {
      return ts.toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  if (typeof ts === "string") {
    const raw = ts.trim();
    if (!raw) return undefined;
    const n = normalizeIsoLikeString(raw);
    const d = new Date(n);
    if (Number.isFinite(d.getTime())) return d.toISOString();
    const d2 = new Date(raw);
    return Number.isFinite(d2.getTime()) ? d2.toISOString() : undefined;
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const ms = Math.abs(ts) < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  if (typeof ts === "object" && ts !== null) {
    const anyTs = ts as {
      seconds?: unknown;
      _seconds?: unknown;
      nanoseconds?: unknown;
      _nanoseconds?: unknown;
    };
    const sec =
      typeof anyTs.seconds === "number"
        ? anyTs.seconds
        : typeof anyTs._seconds === "number"
          ? anyTs._seconds
          : null;
    if (sec !== null && Number.isFinite(sec)) {
      const nano =
        typeof anyTs.nanoseconds === "number"
          ? anyTs.nanoseconds
          : typeof anyTs._nanoseconds === "number"
            ? anyTs._nanoseconds
            : 0;
      const d = new Date(sec * 1000 + (Number(nano) || 0) / 1e6);
      return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
    }
  }
  return undefined;
}

function coerceManualDateYmd(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return undefined;
  }
  const iso = toIso(raw);
  if (!iso) return undefined;
  return localCalendarYmdFromIso(iso);
}

function coerceDurationMinutes(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return Number(raw) || 0;
  if (typeof raw === "bigint") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (raw != null && typeof raw === "object") {
    const v = (raw as { valueOf?: () => unknown }).valueOf?.();
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const toNum = (raw as { toNumber?: () => number }).toNumber;
    if (typeof toNum === "function") {
      try {
        const n = toNum.call(raw);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }
  }
  const n = Number(raw as number);
  return Number.isFinite(n) ? n : 0;
}

function coerceTimeEntryFlags(raw: unknown): TimeEntryDoc["flags"] | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: NonNullable<TimeEntryDoc["flags"]> = {};
  if (o.reminded === true) out.reminded = true;
  if (o.autoStopped === true) out.autoStopped = true;
  if (o.lowAccuracy === true) out.lowAccuracy = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function ensureCanWriteTime(projectId: string, uid: string, projectOwnerIdHint?: string | null): Promise<void> {
  const access = await fetchProjectAccess(projectId, uid, projectOwnerIdHint ?? undefined);
  if (access.canWriteTime) return;
  /** Offline / empty cache: UI only lists projects the user may access; owner may write time without member doc in cache. */
  if (projectOwnerIdHint && projectOwnerIdHint === uid) return;
  throw new Error("Nemáte oprávnenie zapisovať hodiny do tohto projektu.");
}

export type GetActiveTimerReadOpts = {
  /** Use after writes when local cache can briefly miss `activeTimer`. */
  source?: "default" | "server";
};

/** Parse persisted pauses array; tolerates legacy timers without the field. */
function coerceTimerPauses(raw: unknown): TimerPause[] {
  if (!Array.isArray(raw)) return [];
  const out: TimerPause[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const map = item as Record<string, unknown>;
    const startedAt = toIso(map.startedAt) ?? (typeof map.startedAt === "string" ? map.startedAt : "");
    if (!startedAt) continue;
    const endedAtIso = toIso(map.endedAt);
    const endedAt = endedAtIso ?? (typeof map.endedAt === "string" && map.endedAt ? map.endedAt : undefined);
    out.push(endedAt ? { startedAt, endedAt } : { startedAt });
  }
  return out;
}

function coerceTimerStatus(raw: unknown): TimerStatus | undefined {
  if (raw === "paused" || raw === "running") return raw;
  return undefined;
}

async function readActiveTimerFromUserDoc(uid: string, opts?: GetActiveTimerReadOpts): Promise<ActiveTimer | null> {
  const userRef = doc(db, paths.userDoc(uid));
  /** Always use DocumentReference.get — modular `getDoc(ref)` with RNFB ref can yield bad snapshots / TypeError on `.data()`. */
  const snap = opts?.source === "server" ? await userRef.get({ source: "server" }) : await userRef.get();
  if (!snap || typeof (snap as { data?: unknown }).data !== "function") return null;
  const data = snap.data();
  if (!data || typeof data !== "object") return null;
  const at = (data as Record<string, unknown>).activeTimer;
  if (at == null || typeof at !== "object" || Array.isArray(at)) return null;
  const atMap = at as Record<string, unknown>;
  const startedAt = toIso(atMap.startedAt);
  if (!startedAt) return null;
  const ownerIdSnapshot = typeof atMap.ownerIdSnapshot === "string" ? atMap.ownerIdSnapshot : null;
  const status = coerceTimerStatus(atMap.status);
  const runningSinceIso = toIso(atMap.runningSince) ?? (typeof atMap.runningSince === "string" ? atMap.runningSince : null);
  const accumulatedRaw = atMap.accumulatedMs;
  const accumulatedMs = typeof accumulatedRaw === "number" && Number.isFinite(accumulatedRaw) ? accumulatedRaw : undefined;
  return {
    projectId: (atMap.projectId as string) ?? "",
    projectNameSnapshot: (atMap.projectNameSnapshot as string) ?? (atMap.projectName as string) ?? "",
    startedAt,
    source: (atMap.source as string) ?? "home_quick_timer",
    gpsStart: (atMap.gpsStart as GpsPoint | null | undefined) ?? null,
    reminderIds: Array.isArray(atMap.reminderIds) ? (atMap.reminderIds as string[]) : [],
    phaseId: (atMap.phaseId as string | null | undefined) ?? null,
    phaseNameSnapshot: (atMap.phaseNameSnapshot as string | null | undefined) ?? null,
    taskId: (atMap.taskId as string | null | undefined) ?? null,
    taskTitleSnapshot: (atMap.taskTitleSnapshot as string | null | undefined) ?? null,
    ownerIdSnapshot,
    status,
    runningSince: runningSinceIso ?? null,
    accumulatedMs,
    pauses: coerceTimerPauses(atMap.pauses),
  };
}

/**
 * Net work milliseconds for an active timer at `nowIso` (or now).
 * - Running: `accumulatedMs + (now - runningSince)` (legacy fallback: `now - startedAt`).
 * - Paused: just `accumulatedMs`.
 * Always returns >= 0. Safe for legacy timers without status / accumulated fields.
 */
export function calculateActiveTimerWorkMs(activeTimer: ActiveTimer, nowIso?: string): number {
  const total = typeof activeTimer.accumulatedMs === "number" && Number.isFinite(activeTimer.accumulatedMs)
    ? activeTimer.accumulatedMs
    : 0;
  if (activeTimer.status === "paused") {
    return Math.max(0, total);
  }
  const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();
  const sinceIso = activeTimer.runningSince ?? activeTimer.startedAt;
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : NaN;
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) {
    return Math.max(0, total);
  }
  return Math.max(0, total + (nowMs - sinceMs));
}

/**
 * Get current user's active timer from users/{uid}.
 * On Firestore/network errors returns null (safe for flows that must not throw).
 */
export async function getActiveTimer(readOpts?: GetActiveTimerReadOpts): Promise<ActiveTimer | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    return await readActiveTimerFromUserDoc(uid, readOpts);
  } catch (err) {
    console.warn("[timeTracking] getActiveTimer error:", err);
    return null;
  }
}

export type ActiveTimerRefreshResult =
  | { ok: true; timer: ActiveTimer | null }
  | { ok: false };

/**
 * Same source of truth as {@link getActiveTimer}, but distinguishes fetch failure
 * so UI can avoid clearing a known-good running state on transient errors.
 *
 * @param explicitUid Prefer the signed-in user id from app context when Firebase
 * `auth.currentUser` can briefly lag behind after cold start.
 */
export async function getActiveTimerRefreshResult(
  explicitUid?: string | null,
  readOpts?: GetActiveTimerReadOpts
): Promise<ActiveTimerRefreshResult> {
  const uid = explicitUid ?? auth.currentUser?.uid;
  if (!uid) return { ok: true, timer: null };
  try {
    const timer = await readActiveTimerFromUserDoc(uid, readOpts);
    return { ok: true, timer };
  } catch (err) {
    console.warn("[timeTracking] getActiveTimerRefreshResult error:", err);
    return { ok: false };
  }
}

/**
 * Start timer for project. Gets GPS if permission granted.
 */
export type StartTimerOpts = {
  phaseId?: string | null;
  phaseNameSnapshot?: string | null;
  taskId?: string | null;
  taskTitleSnapshot?: string | null;
  /** `project.ownerId` from UI — enables offline start when Firestore project/member reads miss cache. */
  projectOwnerId?: string | null;
};

export async function startTimer(projectId: string, projectName: string, opts?: StartTimerOpts): Promise<ActiveTimer> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const pid = projectId.trim();
  if (!pid) throw new Error("Chýba ID projektu.");
  const existing = await getActiveTimer();
  if (existing) throw new Error("Časovač už beží. Najprv ho zastavte.");
  await ensureCanWriteTime(pid, uid, opts?.projectOwnerId ?? null);

  await requestLocationPermission();
  const gpsStart = await getCurrentPositionSafe();
  const startedAt = new Date().toISOString();
  const ownerIdSnapshot = opts?.projectOwnerId ?? null;

  const activeTimerPayload: ActiveTimer = {
    projectId: pid,
    projectNameSnapshot: projectName,
    startedAt,
    source: "home_quick_timer",
    gpsStart: gpsStart ?? null,
    reminderIds: [],
    phaseId: opts?.phaseId ?? null,
    phaseNameSnapshot: opts?.phaseNameSnapshot ?? null,
    taskId: opts?.taskId ?? null,
    taskTitleSnapshot: opts?.taskTitleSnapshot ?? null,
    ownerIdSnapshot,
    status: "running",
    runningSince: startedAt,
    accumulatedMs: 0,
    pauses: [],
  };

  const userRef = doc(db, paths.userDoc(uid));
  await updateDoc(userRef, {
    activeTimer: {
      projectId: pid,
      projectNameSnapshot: projectName,
      startedAt,
      source: "home_quick_timer",
      gpsStart: gpsStart ?? null,
      reminderIds: [],
      phaseId: opts?.phaseId ?? null,
      phaseNameSnapshot: opts?.phaseNameSnapshot ?? null,
      taskId: opts?.taskId ?? null,
      taskTitleSnapshot: opts?.taskTitleSnapshot ?? null,
      ownerIdSnapshot: ownerIdSnapshot ?? null,
      status: "running",
      runningSince: startedAt,
      accumulatedMs: 0,
      pauses: [],
    },
  });

  try {
    await replaceRunningTimerNotification({
      title: "Timer running",
      projectName,
      startedAtIso: startedAt,
    });
  } catch (err) {
    console.warn("[timeTracking] replaceRunningTimerNotification (offline OK):", err);
  }

  return activeTimerPayload;
}

/**
 * Pause the running timer (if any).
 * - Computes new `accumulatedMs` from server-side state to stay safe under double-tap / multi-device.
 * - Appends an open pause window `{ startedAt: now }`.
 * - Idempotent: no-op when there is no active timer or it's already paused.
 * - Clears the running notification (UI is no longer ticking).
 */
export async function pauseTimer(): Promise<ActiveTimer | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const userRef = doc(db, paths.userDoc(uid));
  const nowIso = new Date().toISOString();

  const result = await runTransaction<ActiveTimer | null>(async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown> | undefined;
    const at = data?.activeTimer;
    if (!at || typeof at !== "object" || Array.isArray(at)) return null;
    const atMap = at as Record<string, unknown>;
    const status = coerceTimerStatus(atMap.status);
    /** Already paused — nothing to do. Legacy timers without status are treated as running. */
    if (status === "paused") {
      return null;
    }
    const startedAt = toIso(atMap.startedAt) ?? (typeof atMap.startedAt === "string" ? atMap.startedAt : "");
    const runningSinceIso = toIso(atMap.runningSince) ?? (typeof atMap.runningSince === "string" ? atMap.runningSince : "") ?? "";
    const sinceIso = runningSinceIso || startedAt;
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : NaN;
    const prevAccumulated =
      typeof atMap.accumulatedMs === "number" && Number.isFinite(atMap.accumulatedMs) ? atMap.accumulatedMs : 0;
    const segmentMs = Number.isFinite(sinceMs) ? Math.max(0, new Date(nowIso).getTime() - sinceMs) : 0;
    const newAccumulated = Math.max(0, prevAccumulated + segmentMs);
    const prevPauses = coerceTimerPauses(atMap.pauses);
    const nextPauses: TimerPause[] = [...prevPauses, { startedAt: nowIso }];

    const next: Record<string, unknown> = {
      ...atMap,
      status: "paused",
      runningSince: null,
      accumulatedMs: newAccumulated,
      pauses: nextPauses,
    };
    transaction.update(userRef, { activeTimer: next });
    /** Return the post-update view for callers that want to update UI without an extra read round-trip. */
    return {
      projectId: (atMap.projectId as string) ?? "",
      projectNameSnapshot: (atMap.projectNameSnapshot as string) ?? (atMap.projectName as string) ?? "",
      startedAt: startedAt || nowIso,
      source: (atMap.source as string) ?? "home_quick_timer",
      gpsStart: (atMap.gpsStart as GpsPoint | null | undefined) ?? null,
      reminderIds: Array.isArray(atMap.reminderIds) ? (atMap.reminderIds as string[]) : [],
      phaseId: (atMap.phaseId as string | null | undefined) ?? null,
      phaseNameSnapshot: (atMap.phaseNameSnapshot as string | null | undefined) ?? null,
      taskId: (atMap.taskId as string | null | undefined) ?? null,
      taskTitleSnapshot: (atMap.taskTitleSnapshot as string | null | undefined) ?? null,
      ownerIdSnapshot: typeof atMap.ownerIdSnapshot === "string" ? atMap.ownerIdSnapshot : null,
      status: "paused",
      runningSince: null,
      accumulatedMs: newAccumulated,
      pauses: nextPauses,
    };
  });

  if (result) {
    /** Don't show "running" tray entry while paused. Resume re-creates it. */
    try {
      await clearRunningTimerNotification();
    } catch (err) {
      console.warn("[timeTracking] pauseTimer clearRunningTimerNotification:", err);
    }
  }

  return result;
}

/**
 * Resume a paused timer (if any).
 * - Closes the last open pause window with `endedAt: now`.
 * - Sets `status="running"`, `runningSince=now`. `accumulatedMs` stays untouched.
 * - Idempotent: no-op when there is no active timer or it's already running.
 */
export async function resumeTimer(): Promise<ActiveTimer | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const userRef = doc(db, paths.userDoc(uid));
  const nowIso = new Date().toISOString();

  const result = await runTransaction<ActiveTimer | null>(async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown> | undefined;
    const at = data?.activeTimer;
    if (!at || typeof at !== "object" || Array.isArray(at)) return null;
    const atMap = at as Record<string, unknown>;
    const status = coerceTimerStatus(atMap.status);
    /** Only resume from paused. Legacy / running timers are no-op. */
    if (status !== "paused") {
      return null;
    }

    const prevPauses = coerceTimerPauses(atMap.pauses);
    const nextPauses: TimerPause[] = prevPauses.map((p, idx) =>
      idx === prevPauses.length - 1 && !p.endedAt ? { ...p, endedAt: nowIso } : p
    );
    /** Defensive: if no open pause was found, append a closed zero-length one so audit trail isn't lost. */
    if (
      nextPauses.length === 0 ||
      (nextPauses[nextPauses.length - 1]?.endedAt && prevPauses.every((p) => !!p.endedAt))
    ) {
      nextPauses.push({ startedAt: nowIso, endedAt: nowIso });
    }

    const accumulatedMs =
      typeof atMap.accumulatedMs === "number" && Number.isFinite(atMap.accumulatedMs) ? atMap.accumulatedMs : 0;

    const next: Record<string, unknown> = {
      ...atMap,
      status: "running",
      runningSince: nowIso,
      accumulatedMs,
      pauses: nextPauses,
    };
    transaction.update(userRef, { activeTimer: next });

    return {
      projectId: (atMap.projectId as string) ?? "",
      projectNameSnapshot: (atMap.projectNameSnapshot as string) ?? (atMap.projectName as string) ?? "",
      startedAt: toIso(atMap.startedAt) ?? (typeof atMap.startedAt === "string" ? atMap.startedAt : nowIso),
      source: (atMap.source as string) ?? "home_quick_timer",
      gpsStart: (atMap.gpsStart as GpsPoint | null | undefined) ?? null,
      reminderIds: Array.isArray(atMap.reminderIds) ? (atMap.reminderIds as string[]) : [],
      phaseId: (atMap.phaseId as string | null | undefined) ?? null,
      phaseNameSnapshot: (atMap.phaseNameSnapshot as string | null | undefined) ?? null,
      taskId: (atMap.taskId as string | null | undefined) ?? null,
      taskTitleSnapshot: (atMap.taskTitleSnapshot as string | null | undefined) ?? null,
      ownerIdSnapshot: typeof atMap.ownerIdSnapshot === "string" ? atMap.ownerIdSnapshot : null,
      status: "running",
      runningSince: nowIso,
      accumulatedMs,
      pauses: nextPauses,
    };
  });

  if (result) {
    try {
      await replaceRunningTimerNotification({
        title: "Timer running",
        projectName: result.projectNameSnapshot,
        startedAtIso: result.runningSince ?? result.startedAt,
      });
    } catch (err) {
      console.warn("[timeTracking] resumeTimer replaceRunningTimerNotification (offline OK):", err);
    }
  }

  return result;
}

export type StopTimerOpts = {
  /** When Firestore read of `users/{uid}.activeTimer` fails, use the timer the UI already shows (same source of truth). */
  knownActive?: ActiveTimer | null;
};

/**
 * Stop timer and create time entry.
 */
export async function stopTimer(note?: string, opts?: StopTimerOpts): Promise<TimeEntryDoc> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");

  let active = await getActiveTimer();
  if (!active && opts?.knownActive) {
    active = opts.knownActive;
  }
  if (!active) throw new Error("Žiadny aktívny časovač.");

  const entryPid = (active.projectId ?? "").trim();
  if (!entryPid) throw new Error("Aktívny časovač nemá platné ID projektu.");
  await ensureCanWriteTime(entryPid, uid, active.ownerIdSnapshot ?? null);

  const endedAt = new Date().toISOString();
  /**
   * Net work time across all running segments — pauses excluded.
   * Legacy timers without `accumulatedMs/runningSince` collapse back to wall-clock (`now - startedAt`),
   * which keeps existing rows behaving exactly as before.
   */
  const workMs = calculateActiveTimerWorkMs(active, endedAt);
  let durationMinutes = Math.round(workMs / 60000);
  if (durationMinutes < 1) durationMinutes = 1;

  /** Close the last pause window if we somehow stop while paused — preserves audit trail and totals. */
  const sessionPauses: TimerPause[] = (active.pauses ?? []).map((p, idx, arr) =>
    active.status === "paused" && idx === arr.length - 1 && !p.endedAt ? { ...p, endedAt } : p
  );

  const flags: { reminded?: boolean; autoStopped?: boolean; lowAccuracy?: boolean } = {};
  if (active.gpsStart && active.gpsStart.accuracyM > 50) {
    flags.lowAccuracy = true;
  }

  await requestLocationPermission();
  /** Emulator / weak GPS can hang on High accuracy — do not block stop forever. */
  const gpsEnd = await withTimeout(getCurrentPositionSafe(), 8000, null);
  if (gpsEnd && gpsEnd.accuracyM > 50) {
    flags.lowAccuracy = true;
  }

  await cancelLegacyReminderIds(active.reminderIds ?? []);
  await clearRunningTimerNotification();

  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";

  const entryData = {
    projectId: entryPid,
    projectNameSnapshot: active.projectNameSnapshot,
    userId: uid,
    userNameSnapshot: userName,
    startedAt: active.startedAt,
    endedAt,
    durationMinutes,
    mode: "timer" as const,
    note: note?.trim() || null,
    gpsStart: active.gpsStart ?? null,
    gpsEnd: gpsEnd ?? null,
    flags: Object.keys(flags).length > 0 ? flags : null,
    phaseId: active.phaseId ?? null,
    phaseNameSnapshot: active.phaseNameSnapshot ?? null,
    taskId: active.taskId ?? null,
    taskTitleSnapshot: active.taskTitleSnapshot ?? null,
    /** Empty array OK for legacy / no-pause sessions; reports tolerate missing field. */
    pauses: sessionPauses,
    workDurationMs: workMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const userRef = doc(db, paths.userDoc(uid));
  const newEntryRef = firestore().collection(paths.timeEntries()).doc();

  const entryId = await runTransaction<string>(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error("Profil používateľa sa nenašiel. Reštartuj aplikáciu a skús znova.");
    }
    transaction.set(newEntryRef, entryData);
    transaction.update(userRef, { activeTimer: firestore.FieldValue.delete() });
    return newEntryRef.id;
  });

  try {
    await createTimeTrackingStoppedNotification({
      userId: uid,
      projectId: entryPid,
      projectName: active.projectNameSnapshot,
      durationMinutes,
      timeEntryId: entryId,
    });
  } catch (err) {
    console.warn("[timeTracking] Failed to create stopped notification:", err);
  }

  return {
    id: entryId,
    ...entryData,
    createdAt: endedAt,
    updatedAt: endedAt,
  } as TimeEntryDoc;
}

export type AddManualEntryParams = {
  phaseId?: string | null;
  phaseNameSnapshot?: string | null;
  taskId?: string | null;
  taskTitleSnapshot?: string | null;
  projectOwnerId?: string | null;
};

/**
 * Add manual time entry (no GPS, no timer).
 */
export async function addManualEntry(
  projectId: string,
  projectName: string,
  dateYmd: string,
  durationMinutes: number,
  note?: string,
  opts?: AddManualEntryParams
): Promise<TimeEntryDoc> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const pid = projectId.trim();
  if (!pid) throw new Error("Chýba ID projektu.");
  await ensureCanWriteTime(pid, uid, opts?.projectOwnerId ?? null);

  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";
  const startedAt = ymdLocalStartToIso(dateYmd) ?? `${dateYmd}T00:00:00.000Z`;
  const endedAt = startedAt;

  const entryData = {
    projectId: pid,
    projectNameSnapshot: projectName,
    userId: uid,
    userNameSnapshot: userName,
    startedAt,
    endedAt,
    durationMinutes,
    mode: "manual" as const,
    date: dateYmd,
    note: note?.trim() || null,
    gpsStart: null,
    gpsEnd: null,
    flags: null,
    phaseId: opts?.phaseId ?? null,
    phaseNameSnapshot: opts?.phaseNameSnapshot ?? null,
    taskId: opts?.taskId ?? null,
    taskTitleSnapshot: opts?.taskTitleSnapshot ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, paths.timeEntries()), entryData);
  const now = new Date().toISOString();
  return {
    id: ref.id,
    ...entryData,
    createdAt: now,
    updatedAt: now,
  } as TimeEntryDoc;
}

/**
 * Check if active timer exceeded 12h. If so, auto-stop and return the entry.
 * Call on app open.
 */
export async function checkAutoStopOnAppOpen(): Promise<TimeEntryDoc | null> {
  const active = await getActiveTimer();
  if (!active) return null;

  /**
   * Auto-stop must not fire while paused — a paused timer doesn't accrue work
   * and the user is intentionally between segments. We use net work ms instead of wall-clock
   * so paused windows (incl. previous segments) don't push the timer over the threshold.
   */
  if (active.status === "paused") return null;
  const endedAt = new Date().toISOString();
  const workMs = calculateActiveTimerWorkMs(active, endedAt);
  const elapsedHours = workMs / (60 * 60 * 1000);
  if (elapsedHours <= AUTO_STOP_HOURS) return null;

  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const entryPid = (active.projectId ?? "").trim();
  if (!entryPid) return null;
  await ensureCanWriteTime(entryPid, uid, active.ownerIdSnapshot ?? null);

  let durationMinutes = Math.round(workMs / 60000);
  if (durationMinutes < 1) durationMinutes = 1;
  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";
  const sessionPauses: TimerPause[] = active.pauses ?? [];

  const entryData = {
    projectId: entryPid,
    projectNameSnapshot: active.projectNameSnapshot,
    userId: uid,
    userNameSnapshot: userName,
    startedAt: active.startedAt,
    endedAt,
    durationMinutes,
    mode: "timer" as const,
    note: null,
    gpsStart: active.gpsStart ?? null,
    gpsEnd: null,
    flags: { autoStopped: true },
    phaseId: active.phaseId ?? null,
    phaseNameSnapshot: active.phaseNameSnapshot ?? null,
    taskId: active.taskId ?? null,
    taskTitleSnapshot: active.taskTitleSnapshot ?? null,
    pauses: sessionPauses,
    workDurationMs: workMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const userRef = doc(db, paths.userDoc(uid));
  const newEntryRef = firestore().collection(paths.timeEntries()).doc();

  const entryId = await runTransaction<string>(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error("Profil používateľa sa nenašiel. Reštartuj aplikáciu a skús znova.");
    }
    transaction.set(newEntryRef, entryData);
    transaction.update(userRef, { activeTimer: firestore.FieldValue.delete() });
    return newEntryRef.id;
  });

  await cancelLegacyReminderIds(active.reminderIds ?? []);
  await clearRunningTimerNotification();

  return {
    id: entryId,
    ...entryData,
    createdAt: endedAt,
    updatedAt: endedAt,
  } as TimeEntryDoc;
}

const MAX_TIME_ENTRIES_PER_PROJECT_READ = 3500;

function padCalendarYmd(ymd: string, deltaDays: number): string {
  const parts = ymd.split("-").map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const day = parts[2];
  if (!y || !m || !day) return ymd;
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Local calendar `YYYY-MM-DD` → ISO instant (manual entries / parse backfill). */
function ymdLocalStartToIso(ymd: string): string | undefined {
  const parts = ymd.split("-").map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : undefined;
}

function localCalendarYmdFromIso(iso: string): string {
  const n = normalizeIsoLikeString(iso);
  const d = new Date(n || iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** YYYY-MM-DD for grouping / range checks — aligned with project overview aggregation. */
export function entryCalendarDayYmd(e: TimeEntryDoc): string {
  const dateStr =
    typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.date.trim()) ? e.date.trim().slice(0, 10) : "";
  const manualMode =
    e.mode === "manual" || (typeof e.mode === "string" && e.mode.trim().toLowerCase() === "manual");
  if (manualMode && dateStr) return dateStr;
  const fromStarted = e.startedAt ? localCalendarYmdFromIso(e.startedAt) : "";
  if (fromStarted) return fromStarted;
  const fromEnded = e.endedAt ? localCalendarYmdFromIso(e.endedAt) : "";
  if (fromEnded) return fromEnded;
  if (e.createdAt) {
    const y = localCalendarYmdFromIso(e.createdAt);
    if (y) return y;
  }
  return dateStr;
}

function entrySortKeyMs(e: TimeEntryDoc): number {
  if (e.startedAt) {
    const n = normalizeIsoLikeString(e.startedAt);
    const t = new Date(n || e.startedAt).getTime();
    if (Number.isFinite(t) && t !== 0) return t;
  }
  const day = entryCalendarDayYmd(e);
  if (day) return new Date(`${day}T12:00:00`).getTime();
  return 0;
}

/** Manual: `date`; timer: local calendar day of `startedAt` — matches project overview aggregation. */
function entryCalendarDayInRange(e: TimeEntryDoc, fromYmd: string, toYmd: string): boolean {
  const dayKey = entryCalendarDayYmd(e);
  if (!dayKey) {
    console.log("[PTS-RANGE] empty dayKey (entry excluded)", {
      id: e.id,
      mode: e.mode,
      startedAtType: typeof e.startedAt,
      date: e.date,
      fromYmd,
      toYmd,
    });
    return false;
  }
  return dayKey >= fromYmd && dayKey <= toYmd;
}

function sortEntriesByStartedDesc(a: TimeEntryDoc, b: TimeEntryDoc): number {
  return entrySortKeyMs(b) - entrySortKeyMs(a);
}

/** Normalize project id from Firestore (string, trimmed, or DocumentReference path). */
function coerceProjectIdFromFirestore(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    const path = (raw as { path?: unknown }).path;
    if (typeof path === "string" && path.length > 0) {
      const prefix = "projects/";
      return (path.startsWith(prefix) ? path.slice(prefix.length) : path.split("/").pop() ?? "").trim();
    }
  }
  return String(raw).trim();
}

/** Parse Firestore doc to TimeEntryDoc. */
function parseTimeEntryDoc(d: { id: string; data: () => unknown }): TimeEntryDoc {
  let raw: unknown;
  try {
    raw = typeof d.data === "function" ? d.data() : undefined;
  } catch (e) {
    if (__DEV__) console.warn("[timeTracking][parseTimeEntryDoc] data() threw", { id: d.id, err: e });
    raw = undefined;
  }
  const data = safeFirestoreDocData(raw, `parseTimeEntryDoc:${d.id}`);
  let startedAt = toIso(data.startedAt) ?? (typeof data.startedAt === "string" ? data.startedAt : "");
  let endedAt = toIso(data.endedAt) ?? (typeof data.endedAt === "string" ? data.endedAt : "");
  if (!startedAt && endedAt) {
    startedAt = endedAt;
  }
  const durationMinutes = coerceDurationMinutes(data.durationMinutes);
  const dateField = coerceManualDateYmd(data.date);
  const modeRaw = data.mode;
  const modeStr = typeof modeRaw === "string" ? modeRaw : typeof modeRaw === "number" ? String(modeRaw) : "";
  const mode: "timer" | "manual" = modeStr.trim().toLowerCase() === "manual" ? "manual" : "timer";
  if (!startedAt && dateField) {
    startedAt = ymdLocalStartToIso(dateField) ?? `${dateField}T00:00:00.000Z`;
    if (!endedAt) endedAt = startedAt;
  }
  if (__DEV__) {
    const startedRaw = data.startedAt;
    if (!startedAt || (durationMinutes <= 0 && data.durationMinutes != null)) {
      console.log("[parseTimeEntryDoc]", d.id, {
        startedAtOut: startedAt || "(empty)",
        startedAtRawType: startedRaw == null ? "null" : typeof startedRaw,
        durationMinutes,
        durationRaw: data.durationMinutes,
        mode: data.mode,
        date: dateField ?? data.date,
      });
    }
  }
  if (!startedAt && durationMinutes > 0) {
    console.log("[PTS-PARSE] positive duration but empty startedAt", {
      idLen: d.id?.length ?? 0,
      durationMinutes,
      mode: data.mode,
      rawStartedType: data.startedAt == null ? "null" : typeof data.startedAt,
    });
  }
  const parsedPauses = coerceTimerPauses(data.pauses);
  const workDurationRaw = data.workDurationMs;
  const workDurationMs =
    typeof workDurationRaw === "number" && Number.isFinite(workDurationRaw) && workDurationRaw >= 0
      ? workDurationRaw
      : undefined;
  return {
    id: d.id,
    projectId: coerceProjectIdFromFirestore(data.projectId),
    projectNameSnapshot: (data.projectNameSnapshot as string) ?? "",
    userId: String((data.userId as string) ?? "").trim(),
    userNameSnapshot: (data.userNameSnapshot as string) ?? "",
    startedAt,
    endedAt,
    durationMinutes,
    mode,
    date: dateField,
    note: (data.note as string) ?? undefined,
    gpsStart: data.gpsStart ?? null,
    gpsEnd: data.gpsEnd ?? null,
    flags: coerceTimeEntryFlags(data.flags),
    phaseId: (data.phaseId as string) ?? undefined,
    phaseNameSnapshot: (data.phaseNameSnapshot as string) ?? undefined,
    taskId: (data.taskId as string) ?? undefined,
    taskTitleSnapshot: (data.taskTitleSnapshot as string) ?? undefined,
    pauses: parsedPauses.length > 0 ? parsedPauses : undefined,
    workDurationMs,
    createdAt: toIso(data.createdAt) ?? undefined,
    updatedAt: toIso(data.updatedAt) ?? undefined,
  } as TimeEntryDoc;
}

/**
 * List time entries for a user within a date range.
 * @param userId - Current user ID
 * @param fromYmd - Start date YYYY-MM-DD (inclusive)
 * @param toYmd - End date YYYY-MM-DD (inclusive)
 * @param readOpts - optional higher `limit` when merging project slices from a wide user query
 */
export async function listTimeEntries(
  userId: string,
  fromYmd: string,
  toYmd: string,
  readOpts?: { limit?: number }
): Promise<TimeEntryDoc[]> {
  if (!userId) return [];
  /**
   * Do not range-filter `startedAt` in Firestore. Mixed Timestamp vs ISO string on documents
   * makes server-side `>=` / `<=` against string bounds return empty; we already filter by
   * local calendar day in memory (`entryCalendarDayInRange`).
   */
  const lim = Math.min(8000, Math.max(1, readOpts?.limit ?? 4000));

  const c = collection(db, paths.timeEntries());
  const q = query(c, where("userId", "==", userId), orderBy("startedAt", "desc"), limit(lim));
  const snap = await getDocsSmart(q, TIME_ENTRIES_READ_OPTS);
  const mapped: TimeEntryDoc[] = [];
  for (const d of snap.docs) {
    try {
      mapped.push(parseTimeEntryDoc({ id: d.id, data: d.data.bind(d) }));
    } catch (err) {
      let rawLog: unknown;
      try {
        rawLog = typeof d.data === "function" ? d.data() : undefined;
      } catch {
        rawLog = "(data() threw)";
      }
      console.warn("[timeTracking][parse failed]", { id: d.id, err, raw: rawLog });
    }
  }
  return mapped
    .filter((e) => entryCalendarDayInRange(e, fromYmd, toYmd))
    .sort(sortEntriesByStartedDesc);
}

/**
 * List time entries for a user in a given month.
 * One query per month; use for Daily Protocol calendar.
 * @param userId - User ID (MVP: current user; structure allows team view later)
 * @param year - Year
 * @param month - Month 1-12
 */
export async function listTimeEntriesForMonth(
  userId: string,
  year: number,
  month: number
): Promise<TimeEntryDoc[]> {
  const fromYmd = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toYmd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return listTimeEntries(userId, fromYmd, toYmd);
}

/**
 * Get total minutes for current user in a given month.
 */
export async function getMonthlyMinutes(userId: string, year: number, month: number): Promise<number> {
  const fromYmd = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toYmd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const entries = await listTimeEntries(userId, fromYmd, toYmd);
  return entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
}

export type ListTimeEntriesByProjectOpts = {
  /**
   * When set, used for the `userId` + `projectId` merge query.
   * Prefer AuthContext uid when `auth.currentUser` is briefly null after cold start (access already resolved).
   */
  forUserId?: string | null;
};

/** Log helper for LTE instrumentation — must not throw on exotic Firestore payloads. */
function ltePreviewRaw(raw: unknown): unknown {
  if (raw == null) return raw;
  const t = typeof raw;
  if (t !== "object") return t;
  if (Array.isArray(raw)) return { _type: "array", len: raw.length };
  try {
    const keys = Object.keys(raw as object);
    return { _keys: keys.slice(0, 40), _keyCount: keys.length };
  } catch (e) {
    return { _objectKeysFailed: String(e), _ctor: (raw as { constructor?: { name?: string } })?.constructor?.name };
  }
}

/**
 * List time entries for a single project within a date range (inclusive on local calendar days).
 * - Query by `projectId` (team view for owners/editors; rules-safe when allowed).
 * - Plus query by `userId` + date window merged in: fixes viewers / rule edge cases and stale cache
 *   on poor networks where project-scoped reads return empty even for own entries.
 */
export async function listTimeEntriesByProject(
  projectId: string,
  fromYmd: string,
  toYmd: string,
  opts?: ListTimeEntriesByProjectOpts
): Promise<TimeEntryDoc[]> {
  if (!projectId) return [];
  const pid = projectId.trim();

  const uid = (opts?.forUserId && String(opts.forUserId).trim()) || auth.currentUser?.uid;
  const merged = new Map<string, TimeEntryDoc>();
  const c = collection(db, paths.timeEntries());

  let snapProjSize = 0;
  let snapSelfSize = 0;
  let snapWideSize = 0;

  try {
    console.log("[LTE] projectId branch: start", { pid, fromYmd, toYmd });
    console.log("[LTE] projectId branch: before query()");
    const qProj = query(c, where("projectId", "==", pid), limit(MAX_TIME_ENTRIES_PER_PROJECT_READ));
    console.log("[LTE] projectId branch: before getDocsSmart");
    const snapProj = await getDocsTimeEntriesQuerySnap(qProj);
    console.log("[LTE] projectId branch: after getDocsSmart", {
      snapNull: snapProj == null,
      hasDocsProp: snapProj != null && typeof (snapProj as { docs?: unknown }).docs !== "undefined",
    });
    let docsProj: typeof snapProj.docs;
    try {
      docsProj = snapProj.docs;
      console.log("[LTE] projectId branch: read snap.docs ok", { len: docsProj?.length });
    } catch (e) {
      console.warn("[LTE] projectId branch: read snapProj.docs threw", e);
      throw e;
    }
    try {
      snapProjSize = docsProj.length;
      console.log("[LTE] projectId branch: snapProjSize", snapProjSize);
    } catch (e) {
      console.warn("[LTE] projectId branch: snapProj.docs.length threw", e);
      throw e;
    }

    console.log("[LTE BRANCH] before map projectId", docsProj.length);
    let acceptedProj = 0;
    let idxP = 0;
    for (const d of docsProj) {
      idxP += 1;
      console.log("[LTE DOC] projectId iter start", { idxP, len: docsProj.length });
      let docId = "(unknown)";
      try {
        docId = d.id;
        console.log("[LTE DOC] before data()", docId);
      } catch (e) {
        console.warn("[LTE DOC] d.id threw", { idxP, err: e });
        continue;
      }
      let raw: unknown;
      try {
        raw = d.data();
        console.log("[LTE DOC] after data()", docId, ltePreviewRaw(raw));
      } catch (err) {
        console.warn("[LTE DOC] data() failed", { id: docId, err });
        continue;
      }
      let parsed: TimeEntryDoc;
      try {
        console.log("[LTE DOC] before parse", docId);
        parsed = parseTimeEntryDoc({ id: docId, data: () => raw });
        console.log("[LTE DOC] after parse", docId, {
          id: parsed.id,
          mode: parsed.mode,
          durationMinutes: parsed.durationMinutes,
          startedAtHead: typeof parsed.startedAt === "string" ? parsed.startedAt.slice(0, 24) : parsed.startedAt,
        });
      } catch (err) {
        console.warn("[LTE DOC] parse failed", { id: docId, err, raw: ltePreviewRaw(raw) });
        continue;
      }
      try {
        console.log("[LTE DOC] before range check", docId);
        const inRange = entryCalendarDayInRange(parsed, fromYmd, toYmd);
        console.log("[LTE DOC] after range check", docId, inRange);
        if (inRange) {
          merged.set(parsed.id, parsed);
          acceptedProj += 1;
        }
      } catch (err) {
        console.warn("[LTE DOC] range or merge failed", { id: docId, err });
      }
    }
    console.log("[LTE BRANCH] after map projectId", { acceptedIntoMerge: acceptedProj, mergedSize: merged.size });
  } catch (err) {
    console.warn("[timeTracking] listTimeEntriesByProject(projectId):", err);
    // #region agent log
    postDebugIngest({
      hypothesisId: "T5-LTE",
      location: "timeTracking.ts:listTimeEntriesByProject",
      message: "projectId_query_branch_error",
      data: { err: err instanceof Error ? err.message : String(err) },
    });
    // #endregion
  }

  if (uid) {
    /**
     * Own rows for this project only (then filter by calendar range in memory).
     * Avoids `userId` + date window + `limit(1000)` across *all* projects, which could drop this
     * project's entries when the user has many timer rows elsewhere in the same window.
     */
    try {
      console.log("[LTE] userId+projectId branch: start", { uid: uid.slice(0, 8) + "…", pid });
      console.log("[LTE] userId+projectId branch: before query()");
      const qSelf = query(c, where("userId", "==", uid), where("projectId", "==", pid), limit(5000));
      console.log("[LTE] userId+projectId branch: before getDocsSmart");
      const snapSelf = await getDocsTimeEntriesQuerySnap(qSelf);
      console.log("[LTE] userId+projectId branch: after getDocsSmart");
      let docsSelf: typeof snapSelf.docs;
      try {
        docsSelf = snapSelf.docs;
        console.log("[LTE] userId+projectId branch: read snap.docs ok", { len: docsSelf?.length });
      } catch (e) {
        console.warn("[LTE] userId+projectId branch: read snapSelf.docs threw", e);
        throw e;
      }
      try {
        snapSelfSize = docsSelf.length;
        console.log("[LTE] userId+projectId branch: snapSelfSize", snapSelfSize);
      } catch (e) {
        console.warn("[LTE] userId+projectId branch: .docs.length threw", e);
        throw e;
      }

      console.log("[LTE BRANCH] before map userId+projectId", docsSelf.length);
      let acceptedSelf = 0;
      let idxS = 0;
      for (const d of docsSelf) {
        idxS += 1;
        console.log("[LTE DOC] userId+projectId iter start", { idxS, len: docsSelf.length });
        let docId = "(unknown)";
        try {
          docId = d.id;
          console.log("[LTE DOC] before data()", docId);
        } catch (e) {
          console.warn("[LTE DOC] d.id threw (self)", { idxS, err: e });
          continue;
        }
        let raw: unknown;
        try {
          raw = d.data();
          console.log("[LTE DOC] after data()", docId, ltePreviewRaw(raw));
        } catch (err) {
          console.warn("[LTE DOC] data() failed (self)", { id: docId, err });
          continue;
        }
        let parsed: TimeEntryDoc;
        try {
          console.log("[LTE DOC] before parse (self)", docId);
          parsed = parseTimeEntryDoc({ id: docId, data: () => raw });
          console.log("[LTE DOC] after parse (self)", docId, {
            id: parsed.id,
            mode: parsed.mode,
            projectId: parsed.projectId,
            durationMinutes: parsed.durationMinutes,
          });
        } catch (err) {
          console.warn("[LTE DOC] parse failed (self)", { id: docId, err, raw: ltePreviewRaw(raw) });
          continue;
        }
        try {
          console.log("[LTE DOC] before range check (self)", docId);
          const inRange = entryCalendarDayInRange(parsed, fromYmd, toYmd);
          console.log("[LTE DOC] after range check (self)", docId, inRange);
          if (inRange) {
            merged.set(parsed.id, parsed);
            acceptedSelf += 1;
          }
        } catch (err) {
          console.warn("[LTE DOC] range or merge failed (self)", { id: docId, err });
        }
      }
      console.log("[LTE BRANCH] after map userId+projectId", { acceptedIntoMerge: acceptedSelf, mergedSize: merged.size });
    } catch (err) {
      console.warn("[timeTracking] listTimeEntriesByProject(userId+projectId):", err);
      // #region agent log
      postDebugIngest({
        hypothesisId: "T5-LTE",
        location: "timeTracking.ts:listTimeEntriesByProject",
        message: "userId_projectId_query_branch_error",
        data: { err: err instanceof Error ? err.message : String(err) },
      });
      // #endregion
      try {
        console.log("[LTE] legacy userId+orderBy branch: start", { uid: uid.slice(0, 8) + "…", fromYmd, toYmd });
        const qLegacy = query(c, where("userId", "==", uid), orderBy("startedAt", "desc"), limit(6000));
        console.log("[LTE] legacy range branch: before getDocsSmart");
        const snapLegacy = await getDocsTimeEntriesQuerySnap(qLegacy);
        console.log("[LTE] legacy range branch: after getDocsSmart");
        let docsLeg: typeof snapLegacy.docs;
        try {
          docsLeg = snapLegacy.docs;
          console.log("[LTE] legacy range branch: read snap.docs ok", { len: docsLeg?.length });
        } catch (e) {
          console.warn("[LTE] legacy range branch: read snapLegacy.docs threw", e);
          throw e;
        }
        console.log("[LTE BRANCH] before map legacy", docsLeg.length);
        let acceptedLeg = 0;
        let idxL = 0;
        for (const d of docsLeg) {
          idxL += 1;
          console.log("[LTE DOC] legacy iter start", { idxL, len: docsLeg.length });
          let docId = "(unknown)";
          try {
            docId = d.id;
            console.log("[LTE DOC] before data() (legacy)", docId);
          } catch (e) {
            console.warn("[LTE DOC] d.id threw (legacy)", { idxL, err: e });
            continue;
          }
          let raw: unknown;
          try {
            raw = d.data();
            console.log("[LTE DOC] after data() (legacy)", docId, ltePreviewRaw(raw));
          } catch (err) {
            console.warn("[LTE DOC] data() failed (legacy)", { id: docId, err });
            continue;
          }
          let parsed: TimeEntryDoc;
          try {
            console.log("[LTE DOC] before parse (legacy)", docId);
            parsed = parseTimeEntryDoc({ id: docId, data: () => raw });
            console.log("[LTE DOC] after parse (legacy)", docId, {
              id: parsed.id,
              projectId: parsed.projectId,
              pidMatch: parsed.projectId === pid,
            });
          } catch (err) {
            console.warn("[LTE DOC] parse failed (legacy)", { id: docId, err, raw: ltePreviewRaw(raw) });
            continue;
          }
          try {
            console.log("[LTE DOC] before projectId filter (legacy)", docId, { parsedPid: parsed.projectId, pid });
            if (parsed.projectId !== pid) continue;
            console.log("[LTE DOC] before range check (legacy)", docId);
            const inRange = entryCalendarDayInRange(parsed, fromYmd, toYmd);
            console.log("[LTE DOC] after range check (legacy)", docId, inRange);
            if (inRange) {
              merged.set(parsed.id, parsed);
              acceptedLeg += 1;
            }
          } catch (err) {
            console.warn("[LTE DOC] filter/range/merge failed (legacy)", { id: docId, err });
          }
        }
        console.log("[LTE BRANCH] after map legacy", { acceptedIntoMerge: acceptedLeg, mergedSize: merged.size });
      } catch (err2) {
        console.warn("[timeTracking] listTimeEntriesByProject(userId legacy range):", err2);
      }
    }
  }

  /**
   * Last-resort A: `where userId == uid` only (single-field index). Filter project + calendar range in memory.
   * Avoids missing composite index on userId+projectId and picks rows even when `startedAt` is missing from range queries.
   */
  let fallbackUserRangeCount = 0;
  if (merged.size === 0 && uid) {
    try {
      const qWide = query(c, where("userId", "==", uid), limit(4000));
      const snapW = await getDocsTimeEntriesQuerySnap(qWide);
      snapWideSize = snapW.docs.length;
      for (const d of snapW.docs) {
        let raw: unknown;
        try {
          raw = d.data();
        } catch {
          continue;
        }
        let parsed: TimeEntryDoc;
        try {
          parsed = parseTimeEntryDoc({ id: d.id, data: () => raw });
        } catch {
          continue;
        }
        if (parsed.projectId !== pid) continue;
        if (!entryCalendarDayInRange(parsed, fromYmd, toYmd)) continue;
        merged.set(parsed.id, parsed);
      }
      if (__DEV__ && merged.size > 0) {
        console.warn("[timeTracking] listTimeEntriesByProject: filled via userId-only wide query", {
          snapWideSize,
          merged: merged.size,
        });
      }
    } catch (wideErr) {
      console.warn("[timeTracking] listTimeEntriesByProject user-only wide query failed:", wideErr);
    }

    /**
     * Last-resort B: own `userId` + `startedAt` window (needs userId+startedAt index), then this project.
     */
    if (merged.size === 0) {
      try {
        const byUser = await listTimeEntries(uid, fromYmd, toYmd, { limit: 3000 });
        for (const e of byUser) {
          if (e.projectId === pid) {
            merged.set(e.id, e);
          }
        }
        if (__DEV__ && merged.size > 0) {
          console.warn("[timeTracking] listTimeEntriesByProject: filled via user+startedAt fallback", {
            count: merged.size,
          });
        }
      } catch (fbErr) {
        console.warn("[timeTracking] listTimeEntriesByProject user-range fallback failed:", fbErr);
      }
    }
    fallbackUserRangeCount = merged.size;
  }

  const list = Array.from(merged.values());
  list.sort(sortEntriesByStartedDesc);
  if (__DEV__) {
    console.log("[listTimeEntriesByProject]", {
      pid,
      fromYmd,
      toYmd,
      authUid: auth.currentUser?.uid ?? "(null)",
      forUserId: opts?.forUserId ?? "(unset)",
      effectiveUid: uid ?? "(none)",
      snapProjSize,
      snapSelfSize,
      snapWideSize,
      fallbackUserRangeCount,
      mergedCount: list.length,
      sample: list.slice(0, 3).map((e) => ({
        id: e.id,
        durationMinutes: e.durationMinutes,
        mode: e.mode,
        date: e.date,
        startedAt: e.startedAt?.slice?.(0, 24),
      })),
    });
  }
  console.log("[PTS-LIST] listTimeEntriesByProject", {
    pidLen: pid.length,
    fromYmd,
    toYmd,
    hasAuthUid: !!auth.currentUser?.uid,
    hasForUserId: !!(opts?.forUserId && String(opts.forUserId).trim()),
    snapProjSize,
    snapSelfSize,
    snapWideSize,
    mergedCount: list.length,
  });
  // #region agent log
  postDebugIngest({
    hypothesisId: "T2-T3",
    location: "timeTracking.ts:listTimeEntriesByProject",
    message: "lte_result",
    data: {
      pidLen: pid.length,
      pidTail: pid.length > 6 ? pid.slice(-6) : pid,
      fromYmd,
      toYmd,
      snapProjSize,
      snapSelfSize,
      snapWideSize,
      mergedCount: list.length,
      fallbackFill: fallbackUserRangeCount,
      hasEffectiveUid: !!uid,
      hasForUserIdOpt: !!(opts?.forUserId && String(opts.forUserId).trim()),
      hasAuthUid: !!auth.currentUser?.uid,
      firstEntryDur: list[0]?.durationMinutes ?? null,
      firstEntryMode: list[0]?.mode ?? null,
    },
  });
  // #endregion
  return list;
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Get total minutes spent on a project (last 24 months, local calendar bounds).
 * Returns 0 if no entries or no access.
 * @param forUserId Optional — pass AuthContext uid when `auth.currentUser` may lag after resume.
 */
export async function getProjectTotalMinutes(projectId: string, forUserId?: string | null): Promise<number> {
  if (!projectId) return 0;
  const now = new Date();
  const toYmd = toLocalYmd(now);
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 24);
  const fromYmd = toLocalYmd(fromDate);
  const entries = await listTimeEntriesByProject(projectId, fromYmd, toYmd, { forUserId: forUserId ?? undefined });
  return entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
}

const IN_QUERY_CHUNK_SIZE = 10;

/**
 * List time entries for multiple projects within a date range.
 * Uses Firestore "in" query in chunks (max 10 per chunk) for better performance.
 * Firestore index: composite on (projectId, startedAt) for `in` + orderBy; calendar range is applied in memory.
 */
export async function listTimeEntriesForProjects(
  projectIds: string[],
  fromYmd: string,
  toYmd: string
): Promise<TimeEntryDoc[]> {
  if (!projectIds.length) return [];

  const c = collection(db, paths.timeEntries());
  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += IN_QUERY_CHUNK_SIZE) {
    chunks.push(projectIds.slice(i, i + IN_QUERY_CHUNK_SIZE));
  }

  const allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
  for (const chunk of chunks) {
    const q = query(c, where("projectId", "in", chunk), orderBy("startedAt", "desc"), limit(2500));
    const snap = await getDocsSmart(q, TIME_ENTRIES_READ_OPTS);
    allDocs.push(...snap.docs.map((d) => ({ id: d.id, data: d.data.bind(d) })));
  }

  const seen = new Set<string>();
  const unique = allDocs.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  const mapped: TimeEntryDoc[] = [];
  for (const d of unique) {
    try {
      mapped.push(parseTimeEntryDoc(d));
    } catch (err) {
      let raw: unknown;
      try {
        raw = typeof d.data === "function" ? d.data() : undefined;
      } catch {
        raw = "(data() threw)";
      }
      console.warn("[timeTracking][parse failed]", { id: d.id, err, raw });
    }
  }
  return mapped.filter((e) => entryCalendarDayInRange(e, fromYmd, toYmd));
}

/**
 * Get project IDs where the user can view team time (owner or editor).
 * Used for Daily protocol Team mode and AttendanceReport All/Team.
 */
export async function getProjectIdsWithTeamTimeAccess(userId: string): Promise<string[]> {
  if (!userId) return [];
  const { listMyProjects } = await import("./projects");
  const projects = await listMyProjects(userId);
  const ids: string[] = [];
  for (const p of projects) {
    const access = await fetchProjectAccess(p.id, userId, p.ownerId);
    if (access.isOwner || access.canWrite) {
      ids.push(p.id);
    }
  }
  return ids;
}
