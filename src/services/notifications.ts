import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  doc,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
  writeBatch,
  getDoc,
  addDoc,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_DUE_TODAY"
  | "TASK_OVERDUE"
  | "PROJECT_ACTIVITY"
  | "PROJECT_CREATED"
  | "PROJECT_INVITED"
  | "PROBLEM_ASSIGNED"
  | "EXPENSE_ADDED"
  | "DIARY_ADDED"
  | "MEMBER_JOINED"
  | "MEMBER_LEFT"
  | "MEMBER_REMOVED"
  | "SYNC_ISSUE"
  | "TIME_TRACKING_STOPPED";

export type NotificationSeverity = "info" | "warning" | "error";

export type NotificationDoc = {
  id: string;
  userId: string;
  type: NotificationType;
  createdAt: string;
  readAt?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  dueDate?: string | null;
  problemId?: string | null;
  expenseId?: string | null;
  amount?: number | null;
  currency?: string | null;
  severity?: NotificationSeverity;
  deepLink?: { screen: string; params?: Record<string, unknown> };
  message?: string;
  fromUserId?: string | null;
  fromUserName?: string | null;
  /** @deprecated Use message. Kept for NotificationRow compat. */
  title?: string | null;
  /** @deprecated Use fromUserName. Kept for NotificationRow compat. */
  actorName?: string | null;
  /** @deprecated Inferred from type. Kept for NotificationRow compat. */
  entityType?: "task" | "project" | "expense" | "document" | "problem";
  meta?: Record<string, unknown>;
  /** Deduplication key for TASK_ASSIGNED anti-spam (e.g. TASK_ASSIGNED_projectId_taskId_assigneeId) */
  dedupeKey?: string | null;
  /** Client timestamp for dedupe queries (reliable immediately; createdAt is serverTimestamp) */
  createdAtClient?: string | null;
  isLocal?: boolean;
};

const LOCAL_KEY = "@staveto:local_notifications";
const PENDING_READ_KEY = "@staveto:pending_notification_reads";

function normalizeDocData(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): NotificationDoc {
  let raw: Record<string, unknown>;
  try {
    const fn = docSnap.data;
    raw = typeof fn === "function" ? normalizeDocData((fn as () => Record<string, unknown>)()) : {};
  } catch {
    raw = {};
  }
  const d = raw;

  const convertTimestamp = (ts: unknown): string | undefined => {
    if (ts == null) return undefined;
    try {
      if (ts instanceof Timestamp) {
        const d0 = ts.toDate();
        return d0 instanceof Date && !Number.isNaN(d0.getTime()) ? d0.toISOString() : undefined;
      }
      if (typeof ts === "string") {
        return ts;
      }
      if (typeof ts === "object" && ts !== null && "toDate" in ts && typeof (ts as { toDate?: () => unknown }).toDate === "function") {
        const d0 = (ts as { toDate: () => Date }).toDate();
        return d0 instanceof Date && !Number.isNaN(d0.getTime()) ? d0.toISOString() : undefined;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  const type = (d.type as NotificationType) ?? "PROJECT_ACTIVITY";
  const message = (d.message as string) ?? undefined;
  const fromUserName = (d.fromUserName as string) ?? undefined;
  const entityType = inferEntityType(type, d);

  const metaRaw = d.meta;
  const meta =
    metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)
      ? (metaRaw as Record<string, unknown>)
      : undefined;
  const taskIdFromMeta = meta?.taskId as string | undefined;
  const problemIdFromMeta = meta?.problemId as string | undefined;

  const rawDue = d.dueDate;
  let dueDateOut: string | null = null;
  if (rawDue != null) {
    if (typeof rawDue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDue)) {
      dueDateOut = rawDue;
    } else {
      const conv = convertTimestamp(rawDue);
      if (conv) {
        dueDateOut = conv.slice(0, 10);
      }
    }
  }

  const rawAmount = d.amount;
  let amountNum: number | null = null;
  if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) {
    amountNum = rawAmount;
  } else if (typeof rawAmount === "string" && rawAmount.trim() !== "") {
    const p = parseFloat(rawAmount.replace(",", "."));
    amountNum = Number.isFinite(p) ? p : null;
  }

  return {
    id: docSnap.id,
    userId: (d.userId as string) ?? "",
    type,
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    readAt: convertTimestamp(d.readAt) ?? null,
    projectId: (d.projectId as string) ?? null,
    projectName: (d.projectName as string) ?? null,
    taskId: (d.taskId as string) ?? taskIdFromMeta ?? null,
    problemId: (d.problemId as string) ?? problemIdFromMeta ?? null,
    taskTitle: (d.taskTitle as string) ?? null,
    dueDate: dueDateOut,
    expenseId: (d.expenseId as string) ?? null,
    amount: amountNum,
    currency: (d.currency as string) ?? "EUR",
    severity: (d.severity as NotificationSeverity) ?? "info",
    deepLink: (d.deepLink as { screen: string; params?: Record<string, unknown> }) ?? undefined,
    message,
    fromUserId: (d.fromUserId as string) ?? undefined,
    fromUserName,
    title: message ?? null,
    actorName: fromUserName ?? null,
    entityType,
    meta,
    dedupeKey: (d.dedupeKey as string) ?? null,
    createdAtClient: convertTimestamp(d.createdAtClient) ?? null,
  };
}

function inferEntityType(
  type: NotificationType,
  d: Record<string, unknown>
): "task" | "project" | "expense" | "document" | "problem" {
  if (!d || typeof d !== "object") return "project";
  if (d.entityType && ["task", "project", "expense", "document", "problem"].includes(d.entityType as string)) {
    return d.entityType as "task" | "project" | "expense" | "document" | "problem";
  }
  if (type.includes("TASK")) return "task";
  if (type === "PROBLEM_ASSIGNED") return "problem";
  if (type.includes("PROJECT") || type.includes("MEMBER")) return "project";
  if (type.includes("EXPENSE")) return "expense";
  return "project";
}

const parseDateOnly = (dateStr?: string | null) => {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => Number(p));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const getTaskDueType = (dueDate?: string | null): NotificationType | null => {
  const date = parseDateOnly(dueDate ?? undefined);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  if (date.getTime() === today.getTime()) return "TASK_DUE_TODAY";
  if (date.getTime() < today.getTime()) return "TASK_OVERDUE";
  return null;
};

async function loadLocalNotifications(): Promise<NotificationDoc[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is Record<string, unknown> => n != null && typeof n === "object" && !Array.isArray(n))
      .map((n) => ({ ...(n as unknown as NotificationDoc), isLocal: true }));
  } catch {
    return [];
  }
}

async function saveLocalNotifications(list: NotificationDoc[]): Promise<void> {
  const cleaned = list.map((n) => ({ ...n, isLocal: true }));
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(cleaned));
}

async function queuePendingRead(notificationId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_READ_KEY);
  const list = raw ? (JSON.parse(raw) as string[]) : [];
  if (!list.includes(notificationId)) list.push(notificationId);
  await AsyncStorage.setItem(PENDING_READ_KEY, JSON.stringify(list));
}

async function flushPendingReads(userId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_READ_KEY);
  if (!raw) return;
  const pending = JSON.parse(raw) as string[];
  if (!pending.length) return;
  const remaining: string[] = [];
  for (const id of pending) {
    try {
      const ref = doc(db, "notifications", id);
      await updateDoc(ref, { readAt: serverTimestamp() });
    } catch {
      remaining.push(id);
    }
  }
  await AsyncStorage.setItem(PENDING_READ_KEY, JSON.stringify(remaining));
}

/**
 * Returns count of unread notifications for the user.
 * Used for badge display (tab bar, drawer).
 */
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const list = await listNotifications(userId, { limitCount: 99 });
    return list.filter((n) => !n.readAt).length;
  } catch {
    return 0;
  }
}

export async function listNotifications(
  userId: string,
  opts?: { limitCount?: number }
): Promise<NotificationDoc[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na načítanie notifikácií.");
  }
  if (currentUser.uid !== userId) {
    throw new Error("Nemáte oprávnenie na načítanie týchto notifikácií.");
  }

  await flushPendingReads(userId);

  const c = collection(db, "notifications");
  const q = query(c, where("userId", "==", userId), orderBy("createdAt", "desc"), limit(opts?.limitCount ?? 50));
  const snap = await getDocs(q);
  const remote = snap.docs
    .map((d) => {
      try {
        return toDoc({ id: d.id, data: () => d.data() as Record<string, unknown> });
      } catch (e) {
        if (__DEV__) console.warn("[notifications] skip bad doc", d?.id, e);
        return null;
      }
    })
    .filter((n): n is NotificationDoc => n != null);
  const local = await loadLocalNotifications();
  const merged = [...local, ...remote].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
  return merged;
}

export async function markNotificationAsRead(notification: NotificationDoc): Promise<void> {
  if (notification.readAt) return;
  if (notification.isLocal) {
    const local = await loadLocalNotifications();
    const updated = local.map((n) =>
      n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n
    );
    await saveLocalNotifications(updated);
    return;
  }

  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na označenie notifikácie ako prečítanej.");
  }
  if (currentUser.uid !== notification.userId) {
    throw new Error("Nemáte oprávnenie na úpravu tejto notifikácie.");
  }
  try {
    const ref = doc(db, "notifications", notification.id);
    await updateDoc(ref, { readAt: serverTimestamp() });
  } catch {
    await queuePendingRead(notification.id);
  }
}

export async function markAllAsRead(userId: string, maxCount: number = 100): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na označenie notifikácií.");
  }
  if (currentUser.uid !== userId) {
    throw new Error("Nemáte oprávnenie na úpravu týchto notifikácií.");
  }

  const local = await loadLocalNotifications();
  const updatedLocal = local.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
  await saveLocalNotifications(updatedLocal);

  const c = collection(db, "notifications");
  const q = query(
    c,
    where("userId", "==", userId),
    where("readAt", "==", null),
    orderBy("createdAt", "desc"),
    limit(maxCount)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    batch.update(d.ref, { readAt: serverTimestamp() });
  });
  await batch.commit();
}

export async function upsertTaskDueNotification(data: {
  userId: string;
  taskId: string;
  taskTitle?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}): Promise<NotificationDoc | null> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const type = getTaskDueType(data.dueDate ?? null);
  if (!type) return null;

  const id = `task_${data.userId}_${data.taskId}_${type}`;
  const ref = doc(db, "notifications", id);
  const existing = await getDoc(ref);
  const dueTimestamp = data.dueDate ? Timestamp.fromDate(parseDateOnly(data.dueDate) ?? new Date()) : null;
  const payload = {
    userId: data.userId,
    type,
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    taskId: data.taskId,
    taskTitle: data.taskTitle ?? null,
    dueDate: dueTimestamp,
    severity: type === "TASK_OVERDUE" ? "warning" : "info" as const,
  };

  if (existing.exists()) {
    await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() });
    return toDoc({ id, data: () => ({ ...normalizeDocData(existing.data()), ...payload }) });
  }

  await setDoc(ref, {
    ...payload,
    createdAt: serverTimestamp(),
    readAt: null,
    expenseId: null,
    amount: null,
    currency: "EUR",
  });

  if (type === "TASK_OVERDUE") {
    const todayId = `task_${data.userId}_${data.taskId}_TASK_DUE_TODAY`;
    try {
      const todayRef = doc(db, "notifications", todayId);
      await updateDoc(todayRef, { readAt: serverTimestamp() });
    } catch {
      // ignore
    }
  }

  return {
    id,
    userId: data.userId,
    type,
    createdAt: new Date().toISOString(),
    readAt: null,
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    taskId: data.taskId,
    taskTitle: data.taskTitle ?? null,
    dueDate: data.dueDate ?? null,
    expenseId: null,
    amount: null,
    currency: "EUR",
    severity: type === "TASK_OVERDUE" ? "warning" : "info",
  };
}

export async function markTaskNotificationsRead(userId: string, taskId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) return;
  if (currentUser.uid !== userId) return;
  const ids = [
    `task_${userId}_${taskId}_TASK_DUE_TODAY`,
    `task_${userId}_${taskId}_TASK_OVERDUE`,
  ];
  for (const id of ids) {
    try {
      const ref = doc(db, "notifications", id);
      await updateDoc(ref, { readAt: serverTimestamp() });
    } catch {
      // ignore
    }
  }
}

export async function createExpenseAddedNotification(data: {
  userId: string;
  projectId?: string | null;
  projectName?: string | null;
  expenseId: string;
  amount?: number | null;
  currency?: string | null;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  await addDoc(c, {
    userId: data.userId,
    type: "EXPENSE_ADDED",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    expenseId: data.expenseId,
    amount: data.amount ?? null,
    currency: data.currency ?? "EUR",
    severity: "info",
  });
}

export async function createDiaryAddedNotification(data: {
  userId: string;
  projectId: string;
  projectName?: string | null;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  await addDoc(c, {
    userId: data.userId,
    type: "DIARY_ADDED",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    deepLink: {
      screen: "ProjectOverview",
      params: { projectId: data.projectId, openDiaryModal: true },
    },
    severity: "info",
  });
}

export async function createTimeTrackingStoppedNotification(data: {
  userId: string;
  projectId: string;
  projectName: string;
  durationMinutes: number;
  timeEntryId?: string;
}): Promise<{ id: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const h = Math.floor(data.durationMinutes / 60);
  const m = data.durationMinutes % 60;
  const durationStr = h > 0 ? `${h}h ${m}min` : `${m} min`;

  const c = collection(db, "notifications");
  const ref = await addDoc(c, {
    userId: data.userId,
    type: "TIME_TRACKING_STOPPED",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    message: durationStr,
    severity: "info",
    meta: { durationMinutes: data.durationMinutes, timeEntryId: data.timeEntryId ?? null },
  });
  return { id: ref.id };
}

export async function createProjectCreatedNotification(data: {
  userId: string;
  projectId: string;
  projectName: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  await addDoc(c, {
    userId: data.userId,
    type: "PROJECT_CREATED",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    severity: "info",
  });
}

export type CreateNotificationInput = {
  userId: string;
  type?: NotificationType;
  projectId?: string | null;
  projectName?: string | null;
  message?: string;
  fromUserId?: string;
  fromUserName?: string;
  /** @deprecated Use message */
  title?: string;
  entityType?: string;
  entityId?: string;
  eventType?: string;
  actorId?: string;
  actorName?: string;
};

/**
 * Generic notification creator. Writes to flat notifications collection.
 * Caller must be authenticated. Recipient (userId) can be any user (e.g. project owner).
 */
export async function createNotification(data: CreateNotificationInput): Promise<{ id: string }> {
  if (!auth.currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  const ref = await addDoc(c, {
    userId: data.userId,
    type: data.type ?? "PROJECT_ACTIVITY",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    message: data.message ?? data.title ?? null,
    fromUserId: data.fromUserId ?? null,
    fromUserName: data.fromUserName ?? null,
    severity: "info",
  });
  return { id: ref.id };
}

export async function createTaskAssignedNotification(data: {
  userId: string;
  projectId: string;
  taskId: string;
  taskTitle?: string | null;
  projectName?: string | null;
  message?: string;
  fromUserId?: string;
  fromUserName?: string;
}): Promise<{ id: string } | null> {
  if (!auth.currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }

  const dedupeKey = `TASK_ASSIGNED_${data.projectId}_${data.taskId}_${data.userId}`;
  const cutoff = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));

  const c = collection(db, "notifications");
  const dedupeQ = query(
    c,
    where("userId", "==", data.userId),
    where("dedupeKey", "==", dedupeKey),
    where("createdAtClient", ">", cutoff),
    orderBy("createdAtClient", "desc"),
    limit(1)
  );
  const dedupeSnap = await getDocs(dedupeQ);
  if (!dedupeSnap.empty) {
    return null;
  }

  const nowClient = Timestamp.now();
  const ref = await addDoc(c, {
    userId: data.userId,
    type: "TASK_ASSIGNED",
    projectId: data.projectId,
    taskId: data.taskId,
    taskTitle: data.taskTitle ?? null,
    projectName: data.projectName ?? null,
    message: data.message ?? `Bola ti priradená úloha${data.taskTitle ? ` "${data.taskTitle}"` : ""}.`,
    fromUserId: data.fromUserId ?? null,
    fromUserName: data.fromUserName ?? null,
    meta: { taskId: data.taskId },
    entityType: "task",
    dedupeKey,
    createdAtClient: nowClient,
    createdAt: serverTimestamp(),
    readAt: null,
    severity: "info",
  });
  return { id: ref.id };
}

export async function createProblemAssignedNotification(data: {
  userId: string;
  projectId: string;
  projectName?: string | null;
  problemId: string;
  problemTitle?: string | null;
  message?: string;
  fromUserId?: string;
  fromUserName?: string;
}): Promise<{ id: string } | null> {
  if (!auth.currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (data.userId === auth.currentUser.uid) return null; // Don't notify self

  const c = collection(db, "notifications");
  const ref = await addDoc(c, {
    userId: data.userId,
    type: "PROBLEM_ASSIGNED",
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    message: data.message ?? (data.problemTitle ? `Bola ti priradená úloha: ${data.problemTitle}` : "Bola ti priradená úloha."),
    fromUserId: data.fromUserId ?? auth.currentUser.uid,
    fromUserName: data.fromUserName ?? auth.currentUser.displayName ?? auth.currentUser.email ?? null,
    meta: { problemId: data.problemId, projectId: data.projectId },
    entityType: "problem",
    deepLink: {
      screen: "ProblemDetail",
      params: { projectId: data.projectId, problemId: data.problemId },
    },
    createdAt: serverTimestamp(),
    readAt: null,
    severity: "info",
  });
  return { id: ref.id };
}

export async function createMemberLifecycleNotification(data: {
  userId: string;
  type: "MEMBER_JOINED" | "MEMBER_LEFT" | "MEMBER_REMOVED";
  projectId: string;
  projectName?: string | null;
  message: string;
  fromUserId?: string;
  fromUserName?: string;
}): Promise<{ id: string }> {
  if (!auth.currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  const ref = await addDoc(c, {
    userId: data.userId,
    type: data.type,
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    message: data.message,
    severity: "info",
  });
  return { id: ref.id };
}

export async function createProjectActivityNotification(data: {
  userId: string;
  projectId: string;
  projectName?: string | null;
  message?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie notifikácie.");
  }
  if (currentUser.uid !== data.userId) {
    throw new Error("Nemáte oprávnenie na vytvorenie notifikácie.");
  }

  const c = collection(db, "notifications");
  await addDoc(c, {
    userId: data.userId,
    type: "PROJECT_ACTIVITY",
    createdAt: serverTimestamp(),
    readAt: null,
    projectId: data.projectId,
    projectName: data.projectName ?? null,
    message: data.message ?? null,
    severity: "info",
  });
}

export async function recordSyncIssue(message: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) return;
  const local = await loadLocalNotifications();
  const newItem: NotificationDoc = {
    id: `local_sync_${Date.now()}`,
    userId: currentUser.uid,
    type: "SYNC_ISSUE",
    createdAt: new Date().toISOString(),
    readAt: null,
    severity: "error",
    message,
    isLocal: true,
  };
  await saveLocalNotifications([newItem, ...local]);
}

/**
 * One-off self-check: write + read a test notification for current user.
 * Logs clear success/failure and surfaces Firestore errors.
 */
export async function runNotificationsSelfCheck(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    console.error("[notifications:self-check] No authenticated user.");
    return;
  }

  try {
    console.log("[notifications:self-check] Writing test notification...");
    const created = await createNotification({
      userId: currentUser.uid,
      entityType: "project",
      entityId: "self-check",
      eventType: "comment_added",
      title: "Test notifikácia",
      message: "Self-check test: read/write permissions.",
      actorId: currentUser.uid,
      actorName: currentUser.displayName ?? currentUser.email ?? undefined,
    });

    console.log("[notifications:self-check] Created:", created.id);
    console.log("[notifications:self-check] Reading notifications...");
    const list = await listNotifications(currentUser.uid, { limitCount: 5 });
    const found = list.some((n) => n.id === created.id);
    console.log(`[notifications:self-check] Read OK: ${found ? "FOUND" : "NOT FOUND"}`);
  } catch (error: any) {
    console.error("[notifications:self-check] Failed:", error?.message ?? error);
  }
}
