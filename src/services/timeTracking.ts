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
  getDocs,
} from "../lib/rnFirestore";
import firestore from "@react-native-firebase/firestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { getCurrentPositionSafe, requestLocationPermission, type GpsPoint } from "../lib/location";
import { cancelLegacyReminderIds, clearRunningTimerNotification, replaceRunningTimerNotification } from "./timerReminders";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import { createTimeTrackingStoppedNotification } from "./notifications";

const AUTO_STOP_HOURS = 12;

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
  createdAt?: string;
  updatedAt?: string;
};

function toIso(ts: unknown): string | undefined {
  if (!ts) return undefined;
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  if (typeof ts === "object" && ts !== null && "toDate" in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
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
  };
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
  const existing = await getActiveTimer();
  if (existing) throw new Error("Časovač už beží. Najprv ho zastavte.");
  await ensureCanWriteTime(projectId, uid, opts?.projectOwnerId ?? null);

  await requestLocationPermission();
  const gpsStart = await getCurrentPositionSafe();
  const startedAt = new Date().toISOString();
  const ownerIdSnapshot = opts?.projectOwnerId ?? null;

  const activeTimerPayload: ActiveTimer = {
    projectId,
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
  };

  const userRef = doc(db, paths.userDoc(uid));
  await updateDoc(userRef, {
    activeTimer: {
      projectId,
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

  await ensureCanWriteTime(active.projectId, uid, active.ownerIdSnapshot ?? null);

  const endedAt = new Date().toISOString();
  const startDate = new Date(active.startedAt).getTime();
  const endDate = new Date(endedAt).getTime();
  let durationMinutes = Math.round((endDate - startDate) / 60000);

  const flags: { reminded?: boolean; autoStopped?: boolean; lowAccuracy?: boolean } = {};
  if (active.gpsStart && active.gpsStart.accuracyM > 50) {
    flags.lowAccuracy = true;
  }

  await requestLocationPermission();
  const gpsEnd = await getCurrentPositionSafe();
  if (gpsEnd && gpsEnd.accuracyM > 50) {
    flags.lowAccuracy = true;
  }

  await cancelLegacyReminderIds(active.reminderIds ?? []);
  await clearRunningTimerNotification();

  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";

  const entryData = {
    projectId: active.projectId,
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const userRef = doc(db, paths.userDoc(uid));
  const newEntryRef = firestore().collection(paths.timeEntries()).doc();

  const entryId = await runTransaction<string>(async (transaction) => {
    transaction.set(newEntryRef, entryData);
    transaction.update(userRef, { activeTimer: firestore.FieldValue.delete() });
    return newEntryRef.id;
  });

  try {
    await createTimeTrackingStoppedNotification({
      userId: uid,
      projectId: active.projectId,
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
  await ensureCanWriteTime(projectId, uid, opts?.projectOwnerId ?? null);

  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";
  const startedAt = `${dateYmd}T00:00:00.000Z`;
  const endedAt = `${dateYmd}T00:00:00.000Z`;

  const entryData = {
    projectId,
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

  const elapsedMs = Date.now() - new Date(active.startedAt).getTime();
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  if (elapsedHours <= AUTO_STOP_HOURS) return null;

  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  await ensureCanWriteTime(active.projectId, uid, active.ownerIdSnapshot ?? null);

  const endedAt = new Date().toISOString();
  const durationMinutes = Math.round((new Date(endedAt).getTime() - new Date(active.startedAt).getTime()) / 60000);
  const userName = auth.currentUser?.displayName ?? auth.currentUser?.email ?? "User";

  const entryData = {
    projectId: active.projectId,
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const userRef = doc(db, paths.userDoc(uid));
  const newEntryRef = firestore().collection(paths.timeEntries()).doc();

  const entryId = await runTransaction<string>(async (transaction) => {
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

/**
 * List time entries for a user within a date range.
 * @param userId - Current user ID
 * @param fromYmd - Start date YYYY-MM-DD (inclusive)
 * @param toYmd - End date YYYY-MM-DD (inclusive)
 */
export async function listTimeEntries(
  userId: string,
  fromYmd: string,
  toYmd: string
): Promise<TimeEntryDoc[]> {
  if (!userId) return [];
  const fromIso = `${fromYmd}T00:00:00.000Z`;
  const endIso = `${toYmd}T23:59:59.999Z`;

  const c = collection(db, paths.timeEntries());
  const q = query(
    c,
    where("userId", "==", userId),
    where("startedAt", ">=", fromIso),
    where("startedAt", "<=", endIso),
    orderBy("startedAt", "desc"),
    limit(500)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => parseTimeEntryDoc({ id: d.id, data: d.data.bind(d) }));
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

/** Parse Firestore doc to TimeEntryDoc. */
function parseTimeEntryDoc(d: { id: string; data: () => Record<string, unknown> }): TimeEntryDoc {
  const data = d.data();
  const startedAt = toIso(data.startedAt) ?? (data.startedAt as string) ?? "";
  const endedAt = toIso(data.endedAt) ?? (data.endedAt as string) ?? "";
  return {
    id: d.id,
    projectId: (data.projectId as string) ?? "",
    projectNameSnapshot: (data.projectNameSnapshot as string) ?? "",
    userId: (data.userId as string) ?? "",
    userNameSnapshot: (data.userNameSnapshot as string) ?? "",
    startedAt,
    endedAt,
    durationMinutes: (data.durationMinutes as number) ?? 0,
    mode: (data.mode as "timer" | "manual") ?? "timer",
    date: data.date as string | undefined,
    note: (data.note as string) ?? undefined,
    gpsStart: data.gpsStart ?? null,
    gpsEnd: data.gpsEnd ?? null,
    flags: data.flags ?? undefined,
    phaseId: (data.phaseId as string) ?? undefined,
    phaseNameSnapshot: (data.phaseNameSnapshot as string) ?? undefined,
    taskId: (data.taskId as string) ?? undefined,
    taskTitleSnapshot: (data.taskTitleSnapshot as string) ?? undefined,
    createdAt: toIso(data.createdAt) ?? undefined,
    updatedAt: toIso(data.updatedAt) ?? undefined,
  } as TimeEntryDoc;
}

/**
 * List time entries for a single project within a date range.
 * Used when user can read team entries (owner/editor per Firestore rules).
 * Firestore index: composite on (projectId, startedAt) - Firestore will prompt to create if missing.
 */
export async function listTimeEntriesByProject(
  projectId: string,
  fromYmd: string,
  toYmd: string
): Promise<TimeEntryDoc[]> {
  if (!projectId) return [];
  const fromIso = `${fromYmd}T00:00:00.000Z`;
  const endIso = `${toYmd}T23:59:59.999Z`;

  const c = collection(db, paths.timeEntries());
  const q = query(
    c,
    where("projectId", "==", projectId),
    where("startedAt", ">=", fromIso),
    where("startedAt", "<=", endIso),
    orderBy("startedAt", "desc"),
    limit(500)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => parseTimeEntryDoc({ id: d.id, data: d.data.bind(d) }));
}

/**
 * Get total minutes spent on a project (last 24 months).
 * Returns 0 if no entries or no access.
 */
export async function getProjectTotalMinutes(projectId: string): Promise<number> {
  if (!projectId) return 0;
  const now = new Date();
  const toYmd = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 24);
  const fromYmd = fromDate.toISOString().slice(0, 10);
  const entries = await listTimeEntriesByProject(projectId, fromYmd, toYmd);
  return entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
}

const IN_QUERY_CHUNK_SIZE = 10;

/**
 * List time entries for multiple projects within a date range.
 * Uses Firestore "in" query in chunks (max 10 per chunk) for better performance.
 * Firestore index: composite on (projectId, startedAt) for "in" + range - Firestore will prompt if missing.
 */
export async function listTimeEntriesForProjects(
  projectIds: string[],
  fromYmd: string,
  toYmd: string
): Promise<TimeEntryDoc[]> {
  if (!projectIds.length) return [];
  const fromIso = `${fromYmd}T00:00:00.000Z`;
  const endIso = `${toYmd}T23:59:59.999Z`;

  const c = collection(db, paths.timeEntries());
  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += IN_QUERY_CHUNK_SIZE) {
    chunks.push(projectIds.slice(i, i + IN_QUERY_CHUNK_SIZE));
  }

  const allDocs: { id: string; data: () => Record<string, unknown> }[] = [];
  for (const chunk of chunks) {
    const q = query(
      c,
      where("projectId", "in", chunk),
      where("startedAt", ">=", fromIso),
      where("startedAt", "<=", endIso),
      orderBy("startedAt", "desc"),
      limit(500)
    );
    const snap = await getDocs(q);
    allDocs.push(...snap.docs.map((d) => ({ id: d.id, data: d.data.bind(d) })));
  }

  const seen = new Set<string>();
  const unique = allDocs.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  return unique.map((d) => parseTimeEntryDoc(d));
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
