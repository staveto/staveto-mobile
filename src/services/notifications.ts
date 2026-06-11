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
import { getExtraEnv } from "../lib/env";
import { safeFirestoreDocData } from "../lib/safeFirestoreDocData";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_DUE_TODAY"
  | "TASK_OVERDUE"
  | "PROJECT_ACTIVITY"
  | "PROJECT_CREATED"
  | "PROJECT_INVITED"
  | "PROJECT_ASSIGNED"
  | "PROBLEM_ASSIGNED"
  | "EXPENSE_ADDED"
  | "DIARY_ADDED"
  | "MEMBER_JOINED"
  | "MEMBER_LEFT"
  | "MEMBER_REMOVED"
  | "SYNC_ISSUE"
  | "TIME_TRACKING_STOPPED"
  | "BUSINESS_CHAT_MESSAGE";

export type NotificationSeverity = "info" | "warning" | "error";

/**
 * Max notifications fetched for inbox + unread badge count.
 * Must stay in sync: `listNotifications` default, `getUnreadCount`, and Notifications screen use the same value
 * so the tab badge (capped at 99 in `UnreadCountContext`) matches "Neprečítané (N)" on the list.
 */
export const USER_NOTIFICATION_QUERY_LIMIT = 99;

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
  orgId?: string | null;
  chatId?: string | null;
  chatTitle?: string | null;
  meta?: Record<string, unknown>;
  /** Deduplication key for TASK_ASSIGNED anti-spam (e.g. TASK_ASSIGNED_projectId_taskId_assigneeId) */
  dedupeKey?: string | null;
  /** Client timestamp for dedupe queries (reliable immediately; createdAt is serverTimestamp) */
  createdAtClient?: string | null;
  isLocal?: boolean;
  /** Firestore `updatedAt` when present (e.g. task-due upsert). */
  updatedAt?: string | null;
  /** Which raw field produced `createdAt` (debug). */
  createdAtSource?: "createdAt" | "createdAtClient" | "missing";
};

const LOCAL_KEY = "@staveto:local_notifications";
const PENDING_READ_KEY = "@staveto:pending_notification_reads";
/** Client-side read receipts: notificationId -> ISO read time. Survives reload until server doc shows readAt (fixes stale remote / merge / eventual consistency). */
const READ_RECEIPTS_KEY = "@staveto:notification_read_receipts_v1";
const READ_RECEIPTS_MAX = 400;

/** Prefix for notifications stored in users/{uid}/notifications (web office). */
export const OFFICE_USER_NOTIFICATION_ID_PREFIX = "office:";

const NOTIF_READ_DEBUG = (typeof __DEV__ !== "undefined" && __DEV__) || getExtraEnv("EXPO_PUBLIC_NOTIF_READ_DEBUG") === "1";

function notifReadLog(message: string, data?: Record<string, unknown>) {
  if (NOTIF_READ_DEBUG) {
    if (data) console.log(`[notifications:readDebug] ${message}`, data);
    else console.log(`[notifications:readDebug] ${message}`);
  }
}

const KNOWN_NOTIFICATION_TYPES: readonly NotificationType[] = [
  "TASK_ASSIGNED",
  "TASK_DUE_TODAY",
  "TASK_OVERDUE",
  "PROJECT_ACTIVITY",
  "PROJECT_CREATED",
  "PROJECT_INVITED",
  "PROJECT_ASSIGNED",
  "PROBLEM_ASSIGNED",
  "EXPENSE_ADDED",
  "DIARY_ADDED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "MEMBER_REMOVED",
  "SYNC_ISSUE",
  "TIME_TRACKING_STOPPED",
  "BUSINESS_CHAT_MESSAGE",
] as const;

/** Firestore `type` may be missing or wrong shape — never call string methods on non-strings. */
function normalizeNotificationType(raw: unknown): NotificationType {
  if (typeof raw === "string" && (KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(raw)) {
    return raw as NotificationType;
  }
  return "PROJECT_ACTIVITY";
}

function normalizeDocData(raw: unknown): Record<string, unknown> {
  return safeFirestoreDocData(raw);
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object") {
    const anyV = v as { toNumber?: () => unknown; toString?: () => unknown };
    if (typeof anyV.toNumber === "function") {
      const n = anyV.toNumber();
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    }
    // Long-like fallback
    if (typeof anyV.toString === "function") {
      const s = anyV.toString();
      if (typeof s === "string" && s.trim() !== "") {
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
    }
  }
  return null;
}

/** Normalize Firestore Timestamp / RNFB Timestamp-like values into ISO string. Returns null when not parseable. */
export function convertTimelikeToIso(ts: unknown): string | null {
  if (ts == null) return null;
  try {
    if (ts instanceof Date) {
      return !Number.isNaN(ts.getTime()) ? ts.toISOString() : null;
    }
    if (typeof ts === "string") {
      const s = ts.trim();
      if (!s) return null;
      const ms = Date.parse(s);
      if (!Number.isFinite(ms)) return null;
      return new Date(ms).toISOString();
    }
    if (typeof ts === "number" && Number.isFinite(ts)) {
      const d0 = new Date(ts > 1e12 ? ts : ts * 1000);
      return !Number.isNaN(d0.getTime()) ? d0.toISOString() : null;
    }
    if (ts instanceof Timestamp) {
      const d0 = ts.toDate();
      return d0 instanceof Date && !Number.isNaN(d0.getTime()) ? d0.toISOString() : null;
    }
    if (typeof ts === "object" && ts !== null) {
      const anyTs = ts as {
        toDate?: () => unknown;
        toMillis?: () => unknown;
        seconds?: unknown;
        nanoseconds?: unknown;
        _seconds?: unknown;
        _nanoseconds?: unknown;
      };
      if (typeof anyTs.toDate === "function") {
        const d0 = anyTs.toDate();
        if (d0 instanceof Date && !Number.isNaN(d0.getTime())) return d0.toISOString();
      }
      if (typeof anyTs.toMillis === "function") {
        const msV = anyTs.toMillis();
        const msN = coerceFiniteNumber(msV);
        if (msN != null) {
          const d0 = new Date(msN);
          return !Number.isNaN(d0.getTime()) ? d0.toISOString() : null;
        }
      }
      const secN = coerceFiniteNumber(anyTs.seconds ?? anyTs._seconds);
      if (secN != null) {
        const nanoN = coerceFiniteNumber(anyTs.nanoseconds ?? anyTs._nanoseconds) ?? 0;
        const d0 = new Date(secN * 1000 + nanoN / 1e6);
        return !Number.isNaN(d0.getTime()) ? d0.toISOString() : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** True if Firestore `readAt` should be treated as read (handles Timestamp, ISO string, millis). */
export function hasMeaningfulReadAt(raw: unknown): boolean {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return false;
    const ms = Date.parse(s);
    return Number.isFinite(ms);
  }
  return convertTimelikeToIso(raw) != null;
}

async function loadReadReceipts(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(READ_RECEIPTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveReadReceipts(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(READ_RECEIPTS_KEY, JSON.stringify(map));
}

/** Remember that this notification was read on this device until server snapshot shows readAt. */
export async function recordReadReceipt(notificationId: string, readAtIso: string): Promise<void> {
  const m = await loadReadReceipts();
  m[notificationId] = readAtIso;
  const entries = Object.entries(m).sort((a, b) => a[1].localeCompare(b[1]));
  while (entries.length > READ_RECEIPTS_MAX) entries.shift();
  await saveReadReceipts(Object.fromEntries(entries));
  notifReadLog("recordReadReceipt", { id: notificationId, readAtIso });
}

async function clearReadReceipt(notificationId: string): Promise<void> {
  const m = await loadReadReceipts();
  if (!m[notificationId]) return;
  delete m[notificationId];
  await saveReadReceipts(m);
  notifReadLog("clearReadReceipt", { id: notificationId });
}

/** Apply local receipts on top of remote rows; drop receipts when server already has readAt. */
function applyReadReceiptsToRemoteList(
  remote: NotificationDoc[],
  receipts: Record<string, string>
): { list: NotificationDoc[]; receiptIdsToClear: string[]; appliedIds: string[] } {
  const receiptIdsToClear: string[] = [];
  const applied: string[] = [];
  const list = remote.map((n) => {
    const localIso = receipts[n.id];
    if (!localIso) return n;
    if (hasMeaningfulReadAt(n.readAt)) {
      receiptIdsToClear.push(n.id);
      return n;
    }
    applied.push(n.id);
    notifReadLog("applyReadReceipt overlay (remote unread, client read)", { id: n.id, localIso });
    return { ...n, readAt: localIso };
  });
  if (applied.length) {
    console.log("[notifications][receipts] overlay_applied", { count: applied.length, idsHead: applied.slice(0, 20) });
  }
  return { list, receiptIdsToClear, appliedIds: applied };
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

  const type = normalizeNotificationType(d.type);
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
      const conv = convertTimelikeToIso(rawDue);
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

  const createdFromServer = convertTimelikeToIso(d.createdAt);
  const createdFromClient = convertTimelikeToIso(d.createdAtClient);
  let createdAtSource: "createdAt" | "createdAtClient" | "missing" = "missing";
  let createdAtIso = "";
  if (createdFromServer) {
    createdAtIso = createdFromServer;
    createdAtSource = "createdAt";
  } else if (createdFromClient) {
    createdAtIso = createdFromClient;
    createdAtSource = "createdAtClient";
  }

  return {
    id: docSnap.id,
    userId: (d.userId as string) ?? "",
    type,
    createdAt: createdAtIso,
    createdAtSource,
    readAt: (() => {
      const iso = convertTimelikeToIso(d.readAt);
      return iso && String(iso).trim() !== "" ? iso : null;
    })(),
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
    orgId: typeof d.orgId === "string" ? d.orgId : (meta?.orgId as string | undefined) ?? null,
    chatId: typeof d.chatId === "string" ? d.chatId : (meta?.chatId as string | undefined) ?? null,
    chatTitle:
      typeof d.chatTitle === "string"
        ? d.chatTitle
        : (meta?.chatTitle as string | undefined) ?? null,
    meta,
    dedupeKey: (d.dedupeKey as string) ?? null,
    createdAtClient: convertTimelikeToIso(d.createdAtClient) ?? null,
    updatedAt: convertTimelikeToIso(d.updatedAt) ?? null,
  };
}

async function listOfficeUserNotifications(userId: string, limitCount: number): Promise<NotificationDoc[]> {
  const mapOfficeDocs = (
    docs: Array<{ id: string; data: () => Record<string, unknown> }>
  ): NotificationDoc[] =>
    docs
      .map((d) => {
        try {
          const raw = normalizeDocData(d.data());
          const typeRaw = raw.type;
          let type: NotificationType = "PROJECT_ACTIVITY";
          if (typeRaw === "PROJECT_ASSIGNED") type = "PROJECT_ASSIGNED";
          else if (typeRaw === "PROJECT_INVITED") type = "PROJECT_INVITED";
          else if (typeof typeRaw === "string" && (KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(typeRaw)) {
            type = typeRaw as NotificationType;
          }

          const createdAt = convertTimelikeToIso(raw.createdAt) ?? "";
          const isRead = raw.read === true;
          const assignedBy =
            typeof raw.assignedBy === "string"
              ? raw.assignedBy
              : typeof raw.invitedByUid === "string"
                ? raw.invitedByUid
                : undefined;
          const assignedByName =
            typeof raw.assignedByName === "string"
              ? raw.assignedByName
              : typeof raw.invitedByName === "string"
                ? raw.invitedByName
                : undefined;

          const fromUserId =
            typeof raw.fromUserId === "string"
              ? raw.fromUserId
              : assignedBy ?? null;
          const fromUserNameResolved =
            typeof raw.fromUserName === "string"
              ? raw.fromUserName
              : assignedByName ?? null;

          return {
            id: `${OFFICE_USER_NOTIFICATION_ID_PREFIX}${d.id}`,
            userId,
            type,
            createdAt,
            createdAtSource: createdAt ? "createdAt" : "missing",
            readAt: isRead
              ? (convertTimelikeToIso(raw.updatedAt) ?? createdAt) || new Date().toISOString()
              : null,
            projectId: typeof raw.projectId === "string" ? raw.projectId : null,
            projectName: typeof raw.projectName === "string" ? raw.projectName : null,
            taskId: typeof raw.taskId === "string" ? raw.taskId : null,
            taskTitle: typeof raw.taskName === "string" ? raw.taskName : null,
            problemId: null,
            dueDate: null,
            expenseId: null,
            amount: null,
            currency: "EUR",
            severity: "info" as NotificationSeverity,
            message: typeof raw.message === "string" ? raw.message : undefined,
            fromUserId,
            fromUserName: fromUserNameResolved,
            title: null,
            actorName: fromUserNameResolved,
            entityType: type === "BUSINESS_CHAT_MESSAGE" ? undefined : ("project" as const),
            orgId: typeof raw.orgId === "string" ? raw.orgId : null,
            chatId: typeof raw.chatId === "string" ? raw.chatId : null,
            chatTitle: typeof raw.chatTitle === "string" ? raw.chatTitle : null,
            meta:
              typeof raw.orgId === "string" || typeof raw.chatId === "string"
                ? {
                    orgId: raw.orgId,
                    chatId: raw.chatId,
                    chatType: raw.chatType,
                    chatTitle: raw.chatTitle,
                  }
                : undefined,
            dedupeKey: null,
            createdAtClient: null,
            updatedAt: convertTimelikeToIso(raw.updatedAt) ?? null,
          } satisfies NotificationDoc;
        } catch (e) {
          if (__DEV__) console.warn("[notifications] skip bad office doc", d?.id, e);
          return null;
        }
      })
      .filter((n): n is NotificationDoc => n != null);

  try {
    const q = query(
      collection(db, "users", userId, "notifications"),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return mapOfficeDocs(snap.docs);
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    const msg = (error as { message?: string })?.message ?? "";
    const isPermDenied =
      code === "permission-denied" ||
      code === "firestore/permission-denied" ||
      msg.includes("permission-denied");
    if (__DEV__) {
      console.warn("[notifications] listOfficeUserNotifications ordered query failed:", error);
    }
    if (!isPermDenied) return [];

    try {
      const snap = await getDocs(collection(db, "users", userId, "notifications"));
      const rows = mapOfficeDocs(snap.docs);
      return rows
        .sort((a, b) => {
          const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
          const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
          return bMs - aMs;
        })
        .slice(0, limitCount);
    } catch (fallbackError) {
      if (__DEV__) {
        console.warn("[notifications] listOfficeUserNotifications fallback failed:", fallbackError);
      }
      return [];
    }
  }
}

function inferEntityType(
  type: NotificationType,
  d: Record<string, unknown>
): "task" | "project" | "expense" | "document" | "problem" {
  if (!d || typeof d !== "object") return "project";
  if (d.entityType && ["task", "project", "expense", "document", "problem"].includes(d.entityType as string)) {
    return d.entityType as "task" | "project" | "expense" | "document" | "problem";
  }
  const t = typeof type === "string" ? type : "";
  if (t.includes("TASK")) return "task";
  if (t === "PROBLEM_ASSIGNED") return "problem";
  if (t.includes("PROJECT") || t.includes("MEMBER")) return "project";
  if (t.includes("EXPENSE")) return "expense";
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

async function queuePendingRead(notificationId: string, reason: string): Promise<void> {
  let list: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(PENDING_READ_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    list = [];
  }
  const newlyAdded = !list.includes(notificationId);
  if (newlyAdded) list.push(notificationId);
  await AsyncStorage.setItem(PENDING_READ_KEY, JSON.stringify(list));
  if (newlyAdded) {
    console.warn("[notifications:diag] queuePendingRead enqueue", { id: notificationId, reason });
  } else {
    console.log("[notifications:diag] queuePendingRead already in queue", { id: notificationId, reason });
  }
}

async function readPendingReadQueue(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(PENDING_READ_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

/** Writes `readAt` on an existing `notifications/{id}` doc; throws if both strategies fail. */
async function persistReadAtOnNotificationDoc(ref: ReturnType<typeof doc>, logId: string): Promise<void> {
  try {
    await updateDoc(ref, { readAt: serverTimestamp() });
    console.log("[notifications:diag] persistReadAt updateDoc success", { id: logId });
  } catch (e1) {
    const reason1 = e1 instanceof Error ? e1.message : String(e1);
    console.warn("[notifications:diag] persistReadAt updateDoc fail, try setDoc merge", {
      id: logId,
      reason: reason1,
    });
    try {
      await setDoc(ref, { readAt: serverTimestamp() }, { merge: true });
      console.log("[notifications:diag] persistReadAt setDoc merge success", { id: logId });
    } catch (e2) {
      const reason2 = e2 instanceof Error ? e2.message : String(e2);
      console.warn("[notifications:diag] persistReadAt setDoc merge fail", { id: logId, reason: reason2 });
      throw e2;
    }
  }
}

async function flushPendingReads(userId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_READ_KEY);
  if (!raw) return;
  let pending: string[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    pending = Array.isArray(parsed) ? (parsed as unknown[]).filter((x): x is string => typeof x === "string") : [];
  } catch (e) {
    notifReadLog("flushPendingReads corrupt queue — clearing", { rawLen: raw.length, err: e instanceof Error ? e.message : String(e) });
    await AsyncStorage.removeItem(PENDING_READ_KEY);
    return;
  }
  if (!pending.length) return;
  console.log("[notifications:diag] flushPendingReads start", {
    userId,
    count: pending.length,
    ids: pending.slice(0, 20),
  });
  const remaining: string[] = [];
  for (const id of pending) {
    try {
      const ref = doc(db, "notifications", id);
      await persistReadAtOnNotificationDoc(ref, id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[notifications:diag] flushPendingReads item fail (keeping in queue)", { id, reason });
      remaining.push(id);
    }
  }
  await AsyncStorage.setItem(PENDING_READ_KEY, JSON.stringify(remaining));
  console.log("[notifications:diag] flushPendingReads done", {
    remaining: remaining.length,
    remainingIds: remaining.slice(0, 20),
  });
  notifReadLog("flushPendingReads done", {
    attempted: pending.length,
    remaining: remaining.length,
    remainingIds: remaining.slice(0, 24),
  });
}

/**
 * Returns count of unread notifications for the user.
 * Used for badge display (tab bar, drawer).
 */
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const list = await listNotifications(userId, { limitCount: USER_NOTIFICATION_QUERY_LIMIT });
    return list.filter((n) => !hasMeaningfulReadAt(n.readAt)).length;
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

  const limitCount = opts?.limitCount ?? USER_NOTIFICATION_QUERY_LIMIT;
  const c = collection(db, "notifications");
  const q = query(
    c,
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  const [snap, officeRows] = await Promise.all([
    getDocs(q),
    listOfficeUserNotifications(userId, limitCount),
  ]);
  const rootRemote = snap.docs
    .map((d) => {
      try {
        return toDoc({ id: d.id, data: () => d.data() as Record<string, unknown> });
      } catch (e) {
        if (__DEV__) console.warn("[notifications] skip bad doc", d?.id, e);
        return null;
      }
    })
    .filter((n): n is NotificationDoc => n != null);

  const remote = [...rootRemote, ...officeRows]
    .sort((a, b) => {
      const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bMs - aMs;
    })
    .slice(0, limitCount);

  if (NOTIF_READ_DEBUG) {
    const remoteUnread = remote.filter((n) => !hasMeaningfulReadAt(n.readAt)).map((n) => n.id);
    const remoteRead = remote.filter((n) => hasMeaningfulReadAt(n.readAt)).map((n) => n.id);
    console.log("[notifications][list] remote_loaded", {
      total: remote.length,
      readCount: remoteRead.length,
      unreadCount: remoteUnread.length,
      unreadIdsHead: remoteUnread.slice(0, 12),
    });
  }

  // Dev self-check: prove converters work for ISO + seconds/nanos (runs once per JS session).
  if (__DEV__ && !(globalThis as any).__stavetoNotifTsSelfCheckDone) {
    (globalThis as any).__stavetoNotifTsSelfCheckDone = true;
    const isoSample = "2026-04-25T14:24:13.128Z";
    const tsSample = { seconds: 1777127100, nanoseconds: 344000000 };
    console.log("[notifications][tsSelfCheck]", {
      isoSample,
      convertIso: convertTimelikeToIso(isoSample),
      hasIso: hasMeaningfulReadAt(isoSample),
      tsSample,
      convertTs: convertTimelikeToIso(tsSample),
      hasTs: hasMeaningfulReadAt(tsSample),
    });
  }

  const receipts = await loadReadReceipts();
  const { list: remoteWithReceipts, receiptIdsToClear, appliedIds: receiptAppliedIds } = applyReadReceiptsToRemoteList(
    remote,
    receipts
  );
  for (const id of receiptIdsToClear) {
    await clearReadReceipt(id);
  }

  if (__DEV__) {
    const limit = Math.min(30, snap.docs.length);
    for (let i = 0; i < limit; i++) {
      const d = snap.docs[i]!;
      const raw = d.data() as Record<string, unknown>;
      let parsed: NotificationDoc | null = null;
      try {
        parsed = toDoc({ id: d.id, data: () => raw });
      } catch {
        parsed = null;
      }
      const rawReadAt = raw.readAt;
      const rawCreatedAt = raw.createdAt;
      const normReadAt = convertTimelikeToIso(rawReadAt) ?? null;
      const normCreatedAt = convertTimelikeToIso(rawCreatedAt) ?? null;
      console.log("[notifications:debug]", {
        id: d.id,
        rawCreatedAt,
        normalizedCreatedAt: normCreatedAt,
        rawCreatedAtClient: raw.createdAtClient,
        rawReadAt,
        normalizedReadAt: normReadAt,
        rawUpdatedAt: raw.updatedAt,
        parsedCreatedAt: parsed?.createdAt ?? null,
        createdAtSource: parsed?.createdAtSource ?? null,
        unreadDecision: parsed ? !hasMeaningfulReadAt(parsed.readAt) : null,
      });
    }
  }

  const local = await loadLocalNotifications();
  const merged = mergeRemoteAndLocalNotifications(remoteWithReceipts, local);

  const receiptOverlayCount = receiptAppliedIds.length;
  notifReadLog("listNotifications after merge", {
    remoteCount: remote.length,
    receiptOverlayCount,
    mergedCount: merged.length,
    idsHead: merged.slice(0, 20).map((n) => n.id),
    unreadIdsHead: merged.filter((n) => !hasMeaningfulReadAt(n.readAt)).slice(0, 15).map((n) => n.id),
  });

  /** IDs still in queue after flush = writes that failed; treat as read in UI until retry succeeds. */
  const pendingAfterFlush = await readPendingReadQueue();
  const pendingSet = new Set(pendingAfterFlush);
  const mergedWithPendingRead =
    pendingSet.size === 0
      ? merged
      : merged.map((n) =>
          pendingSet.has(n.id) && !hasMeaningfulReadAt(n.readAt)
            ? { ...n, readAt: new Date().toISOString() }
            : n
        );
  if (pendingSet.size > 0) {
    console.log("[notifications][pending] overlay_applied", {
      pendingCount: pendingSet.size,
      sampleIds: pendingAfterFlush.slice(0, 12),
    });
  }

  if (NOTIF_READ_DEBUG && pendingAfterFlush.length) {
    const forcedIds = mergedWithPendingRead
      .filter((n) => pendingSet.has(n.id) && hasMeaningfulReadAt(n.readAt))
      .map((n) => n.id);
    console.log("[notifications][list] pending_forced_read", { count: forcedIds.length, idsHead: forcedIds.slice(0, 20) });
  }

  if (__DEV__) {
    if (pendingAfterFlush.length) {
      for (const id of pendingAfterFlush.slice(0, 8)) {
        const serverDoc = snap.docs.find((x) => x.id === id);
        const rawRead = serverDoc ? (serverDoc.data() as Record<string, unknown>).readAt : undefined;
        const mergedRow = mergedWithPendingRead.find((m) => m.id === id);
        console.log("[notifications:listAfterMerge]", {
          id,
          pendingStill: true,
          rawReadAtOnServer: rawRead ?? "(absent)",
          mergedParsedReadAt: mergedRow?.readAt ?? null,
          mergeWouldShowUnread: mergedRow ? !hasMeaningfulReadAt(mergedRow.readAt) : true,
        });
      }
    }
  }

  const sessionUid = auth.currentUser?.uid;
  if (!sessionUid) return mergedWithPendingRead;
  const inboxOnly = mergedWithPendingRead.filter((n) => n.userId === sessionUid);
  if (__DEV__ && inboxOnly.length !== mergedWithPendingRead.length) {
    console.warn("[notifications] dropped notifications not owned by current user", {
      sessionUid,
      dropped: mergedWithPendingRead.length - inboxOnly.length,
    });
  }

  if (NOTIF_READ_DEBUG) {
    const finalUnread = inboxOnly.filter((n) => !hasMeaningfulReadAt(n.readAt)).map((n) => n.id);
    console.log("[notifications][list] final_unread", {
      total: inboxOnly.length,
      unreadCount: finalUnread.length,
      unreadIdsHead: finalUnread.slice(0, 15),
      receiptOverlayCount,
      pendingOverlayCount: pendingAfterFlush.length,
    });

    const TRACE_IDS = new Set(["OFZIMopXmgtQ3p3KPWPO", "iLAf4UrU30nQ7r6vX9yJ"]);
    for (const id of TRACE_IDS) {
      const rawDoc = snap.docs.find((d) => d.id === id);
      const rawData = rawDoc ? (rawDoc.data() as Record<string, unknown>) : null;
      const rawReadAt = rawData ? rawData.readAt : undefined;
      console.log("[notifications][trace][A] raw_remote", {
        id,
        rawReadAt: rawReadAt ?? "(absent)",
        normalizedReadAt: convertTimelikeToIso(rawReadAt),
        hasMeaningfulRaw: hasMeaningfulReadAt(rawReadAt),
      });
      const afterReceipts = remoteWithReceipts.find((n) => n.id === id);
      console.log("[notifications][trace][B] after_receipts", {
        id,
        readAt: afterReceipts?.readAt ?? "(missing row)",
        typeOfReadAt: afterReceipts ? typeof afterReceipts.readAt : "(n/a)",
        hasMeaningful: afterReceipts ? hasMeaningfulReadAt(afterReceipts.readAt) : "(n/a)",
        receiptApplied: receiptAppliedIds.includes(id),
      });
      const afterMerge = merged.find((n) => n.id === id);
      console.log("[notifications][trace][C] after_merge", {
        id,
        readAt: afterMerge?.readAt ?? "(missing row)",
        typeOfReadAt: afterMerge ? typeof afterMerge.readAt : "(n/a)",
        hasMeaningful: afterMerge ? hasMeaningfulReadAt(afterMerge.readAt) : "(n/a)",
      });
      const afterPending = mergedWithPendingRead.find((n) => n.id === id);
      console.log("[notifications][trace][D] after_pending", {
        id,
        readAt: afterPending?.readAt ?? "(missing row)",
        typeOfReadAt: afterPending ? typeof afterPending.readAt : "(n/a)",
        hasMeaningful: afterPending ? hasMeaningfulReadAt(afterPending.readAt) : "(n/a)",
        pendingForced: pendingSet.has(id),
      });
      const finalRow = inboxOnly.find((n) => n.id === id);
      console.log("[notifications][trace][E] final_returned", {
        id,
        readAt: finalRow?.readAt ?? "(missing row)",
        typeOfReadAt: finalRow ? typeof finalRow.readAt : "(n/a)",
        hasMeaningful: finalRow ? hasMeaningfulReadAt(finalRow.readAt) : "(n/a)",
      });
    }
  }
  return inboxOnly;
}

const notificationSortKey = (n: NotificationDoc) => {
  if (!n.createdAt) return 0;
  const t = new Date(n.createdAt).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Dedupe by id: prefer an entry with readAt set; avoids duplicate rows and stale remote unread overwriting local/read receipt. */
function mergeRemoteAndLocalNotifications(remote: NotificationDoc[], local: NotificationDoc[]): NotificationDoc[] {
  const pickBetter = (a: NotificationDoc, b: NotificationDoc): NotificationDoc => {
    const aRead = hasMeaningfulReadAt(a.readAt);
    const bRead = hasMeaningfulReadAt(b.readAt);
    if (aRead !== bRead) return aRead ? a : b;
    if (aRead && bRead) {
      const ta = new Date(String(a.readAt)).getTime();
      const tb = new Date(String(b.readAt)).getTime();
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta >= tb ? a : b;
    }
    return notificationSortKey(a) >= notificationSortKey(b) ? a : b;
  };
  const byId = new Map<string, NotificationDoc>();
  for (const r of remote) {
    byId.set(r.id, r);
  }
  for (const loc of local) {
    const ex = byId.get(loc.id);
    if (!ex) {
      byId.set(loc.id, loc);
    } else {
      byId.set(loc.id, pickBetter(ex, loc));
    }
  }
  return Array.from(byId.values()).sort((a, b) => notificationSortKey(b) - notificationSortKey(a));
}

/**
 * Marks one notification read in Firestore (or local AsyncStorage for isLocal).
 * @returns true if the inbox should treat the item as read: persisted on server, already read on server,
 *   saved locally, or **queued for retry with a client read receipt** (reload stays read until Firestore catches up).
 * @returns false only if neither server nor durable local fallback (receipt + pending queue) could be applied.
 */
export async function markNotificationAsRead(notification: NotificationDoc): Promise<boolean> {
  if (notification.isLocal) {
    const local = await loadLocalNotifications();
    const updated = local.map((n) =>
      n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n
    );
    await saveLocalNotifications(updated);
    return true;
  }

  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na označenie notifikácie ako prečítanej.");
  }
  const ownerUid = (notification.userId ?? "").trim();
  if (!ownerUid || ownerUid !== currentUser.uid) {
    throw new Error("Nemáte oprávnenie na úpravu tejto notifikácie.");
  }

  const readAtBefore = notification.readAt ?? null;

  if (notification.id.startsWith(OFFICE_USER_NOTIFICATION_ID_PREFIX)) {
    const officeId = notification.id.slice(OFFICE_USER_NOTIFICATION_ID_PREFIX.length);
    const officeRef = doc(db, "users", currentUser.uid, "notifications", officeId);
    notifReadLog("markNotificationAsRead office user subcollection", { id: notification.id, officeId });
    try {
      await updateDoc(officeRef, { read: true });
      return true;
    } catch (e) {
      if (receiptRecorded) return true;
      throw e;
    }
  }

  const ref = doc(db, "notifications", notification.id);
  notifReadLog("markNotificationAsRead start", { id: notification.id, readAtBefore });

  /**
   * Always record a local read receipt at the start of a read attempt.
   * This bridges eventual consistency / stale snapshots even when the server write succeeds.
   * Do NOT clear it on success; `listNotifications` will clear it once server returns a real readAt.
   */
  const readNow = new Date().toISOString();
  let receiptRecorded = false;
  try {
    await recordReadReceipt(notification.id, readNow);
    receiptRecorded = true;
  } catch (receiptErr) {
    notifReadLog("markNotificationAsRead recordReadReceipt failed (non-fatal)", {
      id: notification.id,
      err: receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
    });
  }
  if (NOTIF_READ_DEBUG) {
    console.log("[notifications][markRead] receipt_recorded", {
      id: notification.id,
      readAtBefore,
      readNow,
      receiptRecorded,
    });
  }

  // Client may already show optimistic readAt while server still has null — must not skip the write.
  if (notification.readAt) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const rawRa = (snap.data() as Record<string, unknown> | undefined)?.readAt;
        if (hasMeaningfulReadAt(rawRa)) {
          const readAtAfter = convertTimelikeToIso(rawRa) ?? null;
          notifReadLog("markNotificationAsRead server already read — skip write", {
            id: notification.id,
            readAtBefore,
            readAtAfter,
          });
          console.log("[notifications][markRead] server_already_has_readAt", { id: notification.id, readAtAfter });
          return true;
        }
      }
    } catch (e) {
      console.warn("[notifications:diag] markNotificationAsRead getDoc check failed, will persist", {
        id: notification.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    await persistReadAtOnNotificationDoc(ref, notification.id);
    notifReadLog("markNotificationAsRead remote write OK", { id: notification.id, readAtBefore });
    console.log("[notifications][markRead] remote_persist_ok", { id: notification.id, readAtBefore, receiptRecorded });
    return true;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    let queued = false;
    try {
      await queuePendingRead(notification.id, reason);
      queued = true;
    } catch (queueErr) {
      notifReadLog("markNotificationAsRead queuePendingRead failed — caller may rollback UI", {
        id: notification.id,
        err: queueErr instanceof Error ? queueErr.message : String(queueErr),
      });
      console.warn("[notifications][markRead] remote_persist_failed_not_queued", {
        id: notification.id,
        reason,
        receiptRecorded,
      });
      // Only safe to claim "read" if we have a durable local receipt.
      return receiptRecorded;
    }
    notifReadLog("markNotificationAsRead remote write FAILED — receipt + pending queue", {
      id: notification.id,
      readAtBefore,
      readAtAfterClient: readNow,
      remoteWriteOk: false,
      queued,
      reason,
    });
    console.warn("[notifications][markRead] remote_persist_failed_queued", {
      id: notification.id,
      reason,
      receiptRecorded,
      queued,
    });
    return true;
  }
}

export async function markAllAsRead(userId: string, maxCount: number = USER_NOTIFICATION_QUERY_LIMIT): Promise<void> {
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
  const q = query(c, where("userId", "==", userId), orderBy("createdAt", "desc"), limit(maxCount));
  const snap = await getDocs(q);
  const unreadDocs = snap.docs.filter((d) => {
    const ra = (d.data() as Record<string, unknown>).readAt;
    return !hasMeaningfulReadAt(ra);
  });
  if (unreadDocs.length === 0) return;
  const ids = unreadDocs.map((d) => d.id);

  // Record receipts for all targeted IDs up-front (best effort).
  const readNow = new Date().toISOString();
  let receiptsRecorded = 0;
  await Promise.all(
    ids.map(async (id) => {
      try {
        await recordReadReceipt(id, readNow);
        receiptsRecorded++;
      } catch {
        // best effort; do not fail the whole operation
      }
    })
  );
  console.log("[notifications][markAllRead] receipts_recorded", {
    targeted: ids.length,
    receiptsRecorded,
    idsHead: ids.slice(0, 20),
    readNow,
  });

  const batch = writeBatch(db);
  unreadDocs.forEach((d) => {
    batch.set(d.ref, { readAt: serverTimestamp() }, { merge: true });
  });
  try {
    await batch.commit();
    console.log("[notifications][markAllRead] remote_batch_ok", { targeted: ids.length, receiptsRecorded });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notifReadLog("markAllAsRead batch failed — recording receipts + queue", { count: ids.length, reason: msg });
    for (const id of ids) {
      try {
        await queuePendingRead(id, `markAllAsRead: ${msg}`);
      } catch {
        /* best effort */
      }
    }
    console.warn("[notifications][markAllRead] remote_batch_failed_queued", { targeted: ids.length, receiptsRecorded, reason: msg });
    throw e;
  }
}

export async function upsertTaskDueNotification(data: {
  userId: string;
  taskId: string;
  taskTitle?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  /** Extra routing context (e.g. user-owned equipment service tasks). */
  meta?: Record<string, unknown>;
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
  const payload: Record<string, unknown> = {
    userId: data.userId,
    type,
    projectId: data.projectId ?? null,
    projectName: data.projectName ?? null,
    taskId: data.taskId,
    taskTitle: data.taskTitle ?? null,
    dueDate: dueTimestamp,
    severity: type === "TASK_OVERDUE" ? "warning" : "info",
  };
  if (data.meta && typeof data.meta === "object") {
    payload.meta = data.meta;
  }

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
  } as Record<string, unknown>);

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
  const readNow = new Date().toISOString();
  for (const id of ids) {
    const ref = doc(db, "notifications", id);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        console.log("[notifications:diag] markTaskNotificationsRead skip (no doc)", { id });
        continue;
      }
      // Receipt first: keep UI stable across reload even if next snapshot is stale.
      try {
        await recordReadReceipt(id, readNow);
        console.log("[notifications][markTaskRead] receipt_recorded", { id, readNow });
      } catch (e) {
        console.warn("[notifications][markTaskRead] receipt_record_failed", { id, reason: e instanceof Error ? e.message : String(e) });
      }
      await persistReadAtOnNotificationDoc(ref, id);
      console.log("[notifications][markTaskRead] remote_persist_ok", { id });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn("[notifications:diag] markTaskNotificationsRead persist fail", { id, reason });
      try {
        await queuePendingRead(id, `markTaskNotificationsRead: ${reason}`);
      } catch (queueErr) {
        console.warn("[notifications:diag] markTaskNotificationsRead queuePendingRead fail", {
          id,
          reason: queueErr instanceof Error ? queueErr.message : String(queueErr),
        });
      }
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
