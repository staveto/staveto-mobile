/**
 * Absence management — vacation, sick leave, doctor visits, personal/unpaid leave.
 *
 * Architectural rule: absences are NOT time entries.
 * They live in their own top-level `absences` collection and never get mixed
 * into `timeEntries`, project costing, or labour-hour reports.
 *
 * Owners (solo organizations where orgId === userId) and org admins have their
 * own requests auto-approved. Regular members create `pending` requests that
 * require manual approval (Phase 3).
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "../lib/rnFirestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { firestoreValueToIsoString, ymdToDate, toYmd } from "../utils/date";

export type AbsenceType =
  | "vacation"
  | "sick"
  | "doctor"
  | "unpaid"
  | "personal";

export type AbsenceStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type AbsenceHalfDay = "AM" | "PM";

export type AbsenceAttachment = {
  storagePath: string;
  mimeType: string;
};

export type AbsenceDoc = {
  id: string;
  orgId: string;
  userId: string;
  userNameSnapshot: string;

  type: AbsenceType;
  status: AbsenceStatus;

  /** YYYY-MM-DD inclusive */
  startDate: string;
  /** YYYY-MM-DD inclusive */
  endDate: string;

  halfDayStart?: AbsenceHalfDay | null;
  halfDayEnd?: AbsenceHalfDay | null;

  hoursPerDay?: number;
  note?: string;

  attachments?: AbsenceAttachment[];

  requestedBy: string;
  requestedAt: string;

  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;

  createdAt: string;
  updatedAt: string;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertYmd(value: string, field: string): void {
  if (!YMD_RE.test(value)) {
    throw new Error(`absences.${field}: invalid YYYY-MM-DD: ${value}`);
  }
}

/** Returns true if endDate (YMD) is on/after startDate (YMD). String compare works for YYYY-MM-DD. */
function isRangeValid(startYmd: string, endYmd: string): boolean {
  return endYmd >= startYmd;
}

/**
 * Owner heuristic for Phase 1.
 * In Staveto today, AuthContext sets `orgId = fbUser.uid` for solo accounts,
 * so a user is an "owner of their own org" when those values match.
 * Org-admin auto-approval (real B2B orgs) will land in Phase 3 — service.requestAbsence
 * still receives `isOwnerOrManager` so callers can pass any future role flag.
 */
export function isSoloOwner(userId: string, orgId: string): boolean {
  return userId === orgId;
}

function normalizeHalfDay(value: unknown): AbsenceHalfDay | null {
  if (value === "AM" || value === "PM") return value;
  return null;
}

function normalizeType(value: unknown): AbsenceType {
  switch (value) {
    case "vacation":
    case "sick":
    case "doctor":
    case "unpaid":
    case "personal":
      return value;
    default:
      return "vacation";
  }
}

function normalizeStatus(value: unknown): AbsenceStatus {
  switch (value) {
    case "pending":
    case "approved":
    case "rejected":
    case "cancelled":
      return value;
    default:
      return "pending";
  }
}

function snapshotToDoc(snap: { id: string; data: () => Record<string, unknown> }): AbsenceDoc | null {
  const d = snap.data();
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const startDate = (d.startDate as string) ?? "";
  const endDate = (d.endDate as string) ?? "";
  if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) return null;
  const attachmentsRaw = d.attachments;
  const attachments = Array.isArray(attachmentsRaw)
    ? attachmentsRaw
        .map((a) => (a && typeof a === "object" ? a as AbsenceAttachment : null))
        .filter((a): a is AbsenceAttachment => !!a && typeof a.storagePath === "string" && typeof a.mimeType === "string")
    : undefined;
  return {
    id: snap.id,
    orgId: (d.orgId as string) ?? "",
    userId: (d.userId as string) ?? "",
    userNameSnapshot: (d.userNameSnapshot as string) ?? "",
    type: normalizeType(d.type),
    status: normalizeStatus(d.status),
    startDate,
    endDate,
    halfDayStart: normalizeHalfDay(d.halfDayStart),
    halfDayEnd: normalizeHalfDay(d.halfDayEnd),
    hoursPerDay: typeof d.hoursPerDay === "number" ? (d.hoursPerDay as number) : undefined,
    note: typeof d.note === "string" ? (d.note as string) : undefined,
    attachments,
    requestedBy: (d.requestedBy as string) ?? "",
    requestedAt: firestoreValueToIsoString(d.requestedAt) ?? "",
    approvedBy: (d.approvedBy as string | null | undefined) ?? null,
    approvedAt: firestoreValueToIsoString(d.approvedAt) ?? null,
    rejectedReason: (d.rejectedReason as string | null | undefined) ?? null,
    createdAt: firestoreValueToIsoString(d.createdAt) ?? "",
    updatedAt: firestoreValueToIsoString(d.updatedAt) ?? "",
  };
}

export type RequestAbsenceInput = {
  orgId: string;
  userId: string;
  userNameSnapshot: string;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  halfDayStart?: AbsenceHalfDay | null;
  halfDayEnd?: AbsenceHalfDay | null;
  hoursPerDay?: number;
  note?: string;
  attachments?: AbsenceAttachment[];
  /** Owner / org-admin → status defaults to "approved", otherwise "pending". */
  isOwnerOrManager?: boolean;
};

/** Create a new absence request. Returns the new doc id. */
export async function requestAbsence(input: RequestAbsenceInput): Promise<string> {
  const {
    orgId,
    userId,
    userNameSnapshot,
    type,
    startDate,
    endDate,
    halfDayStart = null,
    halfDayEnd = null,
    hoursPerDay,
    note,
    attachments,
    isOwnerOrManager,
  } = input;

  if (!orgId) throw new Error("absences.requestAbsence: orgId is required");
  if (!userId) throw new Error("absences.requestAbsence: userId is required");
  assertYmd(startDate, "startDate");
  assertYmd(endDate, "endDate");
  if (!isRangeValid(startDate, endDate)) {
    throw new Error("absences.requestAbsence: endDate must be >= startDate");
  }

  const autoApprove = isOwnerOrManager ?? isSoloOwner(userId, orgId);
  const status: AbsenceStatus = autoApprove ? "approved" : "pending";
  const now = serverTimestamp();

  const payload: Record<string, unknown> = {
    orgId,
    userId,
    userNameSnapshot: userNameSnapshot ?? "",
    type,
    status,
    startDate,
    endDate,
    halfDayStart: halfDayStart ?? null,
    halfDayEnd: halfDayEnd ?? null,
    requestedBy: userId,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
    approvedBy: autoApprove ? userId : null,
    approvedAt: autoApprove ? now : null,
    rejectedReason: null,
  };
  if (typeof hoursPerDay === "number") payload.hoursPerDay = hoursPerDay;
  if (note && note.trim()) payload.note = note.trim();
  if (attachments && attachments.length > 0) payload.attachments = attachments;

  const ref = await addDoc(collection(db, paths.absences()), payload);
  return ref.id;
}

export type UpdateAbsenceDatesInput = {
  startDate: string;
  endDate: string;
  halfDayStart?: AbsenceHalfDay | null;
  halfDayEnd?: AbsenceHalfDay | null;
  /** Owner / org-admin keep `approved` after date change. Members fall back to `pending`. */
  isOwnerOrManager?: boolean;
};

export type UpdateAbsenceDatesResult = {
  reverted: boolean;
};

/**
 * Update absence date range. If the absence was already approved and the editor
 * is not owner/manager, status reverts to "pending" so the manager can re-approve.
 */
export async function updateAbsenceDates(
  absenceId: string,
  changes: UpdateAbsenceDatesInput
): Promise<UpdateAbsenceDatesResult> {
  const { startDate, endDate, halfDayStart, halfDayEnd, isOwnerOrManager } = changes;
  assertYmd(startDate, "startDate");
  assertYmd(endDate, "endDate");
  if (!isRangeValid(startDate, endDate)) {
    throw new Error("absences.updateAbsenceDates: endDate must be >= startDate");
  }

  const ref = doc(db, paths.absence(absenceId));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("absences.updateAbsenceDates: not found");
  const current = snapshotToDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });
  if (!current) throw new Error("absences.updateAbsenceDates: invalid doc");
  if (current.status === "rejected" || current.status === "cancelled") {
    throw new Error("absences.updateAbsenceDates: cannot edit rejected/cancelled");
  }

  const shouldRevert = current.status === "approved" && !isOwnerOrManager;
  const updates: Record<string, unknown> = {
    startDate,
    endDate,
    halfDayStart: halfDayStart ?? null,
    halfDayEnd: halfDayEnd ?? null,
    updatedAt: serverTimestamp(),
  };
  if (shouldRevert) {
    updates.status = "pending";
    updates.approvedBy = null;
    updates.approvedAt = null;
  }
  await updateDoc(ref, updates);
  return { reverted: shouldRevert };
}

export type UpdateAbsenceDetailsInput = {
  type?: AbsenceType;
  hoursPerDay?: number | null;
  note?: string | null;
};

/** Update non-date fields. Does not change status or revert approval. */
export async function updateAbsenceDetails(
  absenceId: string,
  changes: UpdateAbsenceDetailsInput
): Promise<void> {
  const ref = doc(db, paths.absence(absenceId));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("absences.updateAbsenceDetails: not found");
  const current = snapshotToDoc({ id: snap.id, data: () => snap.data() as Record<string, unknown> });
  if (!current) throw new Error("absences.updateAbsenceDetails: invalid doc");
  if (current.status === "rejected" || current.status === "cancelled") {
    throw new Error("absences.updateAbsenceDetails: cannot edit rejected/cancelled");
  }

  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (changes.type) updates.type = changes.type;
  if (changes.hoursPerDay === null) {
    updates.hoursPerDay = null;
  } else if (typeof changes.hoursPerDay === "number") {
    updates.hoursPerDay = changes.hoursPerDay;
  }
  if (changes.note === null) {
    updates.note = null;
  } else if (typeof changes.note === "string") {
    const trimmed = changes.note.trim();
    updates.note = trimmed.length > 0 ? trimmed : null;
  }
  await updateDoc(ref, updates);
}

/** Mark absence as cancelled (soft delete). */
export async function cancelAbsence(absenceId: string): Promise<void> {
  const ref = doc(db, paths.absence(absenceId));
  await updateDoc(ref, {
    status: "cancelled" as AbsenceStatus,
    updatedAt: serverTimestamp(),
  });
}

/** List absences for a single user overlapping [fromYmd, toYmd]. */
export async function listAbsencesForUser(
  userId: string,
  fromYmd: string,
  toYmd: string
): Promise<AbsenceDoc[]> {
  if (!userId) return [];
  assertYmd(fromYmd, "fromYmd");
  assertYmd(toYmd, "toYmd");
  // We query by userId + range on startDate, then post-filter for endDate >= fromYmd
  // (Firestore can't combine two inequality filters on different fields).
  const q = query(
    collection(db, paths.absences()),
    where("userId", "==", userId),
    where("startDate", "<=", toYmd),
    orderBy("startDate", "desc")
  );
  const snap = await getDocs(q);
  const results: AbsenceDoc[] = [];
  snap.forEach((s: { id: string; data: () => Record<string, unknown> }) => {
    const a = snapshotToDoc(s);
    if (!a) return;
    if (a.endDate >= fromYmd) results.push(a);
  });
  return results;
}

/** List absences for an entire org overlapping [fromYmd, toYmd]. Used by approvers / team calendar. */
export async function listAbsencesForOrg(
  orgId: string,
  fromYmd: string,
  toYmd: string
): Promise<AbsenceDoc[]> {
  if (!orgId) return [];
  assertYmd(fromYmd, "fromYmd");
  assertYmd(toYmd, "toYmd");
  const q = query(
    collection(db, paths.absences()),
    where("orgId", "==", orgId),
    where("startDate", "<=", toYmd),
    orderBy("startDate", "desc")
  );
  const snap = await getDocs(q);
  const results: AbsenceDoc[] = [];
  snap.forEach((s: { id: string; data: () => Record<string, unknown> }) => {
    const a = snapshotToDoc(s);
    if (!a) return;
    if (a.endDate >= fromYmd) results.push(a);
  });
  return results;
}

/** Inclusive list of YYYY-MM-DD between absence.startDate and absence.endDate. */
export function expandAbsenceToYmds(absence: Pick<AbsenceDoc, "startDate" | "endDate">): string[] {
  const start = ymdToDate(absence.startDate);
  const end = ymdToDate(absence.endDate);
  if (!start || !end) return [];
  const out: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur.getTime() <= end.getTime()) {
    out.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
    if (out.length > 366) break; // safety
  }
  return out;
}

/** Map of YYYY-MM-DD → list of absences active on that day. Cancelled/rejected are excluded. */
export function getAbsencesMapByYmd(absences: AbsenceDoc[]): Map<string, AbsenceDoc[]> {
  const map = new Map<string, AbsenceDoc[]>();
  for (const a of absences) {
    if (a.status === "cancelled" || a.status === "rejected") continue;
    for (const ymd of expandAbsenceToYmds(a)) {
      const arr = map.get(ymd) ?? [];
      arr.push(a);
      map.set(ymd, arr);
    }
  }
  return map;
}

/** First active absence for the user that covers `ymd`, or null. */
export async function getAbsenceForUserOnDate(userId: string, ymd: string): Promise<AbsenceDoc | null> {
  assertYmd(ymd, "ymd");
  const list = await listAbsencesForUser(userId, ymd, ymd);
  for (const a of list) {
    if (a.status === "cancelled" || a.status === "rejected") continue;
    if (a.startDate <= ymd && a.endDate >= ymd) return a;
  }
  return null;
}
