import {
  collection,
  addDoc,
  query,
  where,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  serverTimestamp,
  firestoreTimestampFromDate,
} from "../lib/rnFirestore";
import { getDocsSmart } from "./firestoreSmartRead";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { firestoreValueToIsoString } from "../utils/date";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";
import { createExpenseAddedNotification } from "./notifications";
import type { ProjectExpense } from "../lib/types";
import { addProjectEvent, omitUndefinedFields } from "./projectEvents";
import { isPlainObject } from "../utils/isPlainObject";

export type ExpenseSource = 'MANUAL' | 'DOCUMENT';
export type ExpenseStatus = 'PROCESSING' | 'READY' | 'FAILED';
export type ExpenseCategory = 'MATERIAL' | 'WORK' | 'OTHER' | 'TRAVEL';

export type TravelExpenseData = {
  fromAddress: string;
  toAddress: string;
  distanceKm: number;
  ratePerKm: number;
  roundTrip: boolean;
  billableToClient?: boolean;
};

export type OcrStatus = "success" | "done" | "failed" | "limit" | "cancelled" | "pending";
export type UploadStatus = "pending" | "uploaded" | "failed";

export type ExpenseDoc = {
  id: string;
  projectId: string;
  title: string;
  amount: number | null; // null when status is PROCESSING
  currency: string;
  date: string; // ISO string
  note?: string;
  taskId?: string | null;
  phaseId?: string | null;
  attachmentId?: string | null;
  source: ExpenseSource;
  status: ExpenseStatus;
  category?: ExpenseCategory;
  supplierName?: string;
  supplierIco?: string;
  uploadStatus?: UploadStatus;
  filePath?: string;
  mimeType?: string;
  ocrStatus?: OcrStatus;
  ocrParsedAt?: string;
  ocrSupplierName?: string;
  ocrInvoiceNumber?: string;
  ocrIssueDate?: string;
  ocrTotalAmount?: number | null;
  ocrVatAmount?: number | null;
  ocrCurrency?: string;
  /** Structured OCR audit (parsed snapshot, enrichment meta, truncated raw text). */
  ocrAuditSnapshot?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  /** Travel (Jazda A→B) fields when category is TRAVEL */
  travel?: TravelExpenseData;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ExpenseDoc | null {
  let d: Record<string, unknown>;
  try {
    const raw = docSnap.data();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      if (__DEV__) console.warn(`[expenses] toDoc: document ${docSnap.id} has no/invalid data, skipping`);
      return null;
    }
    d = raw as Record<string, unknown>;
  } catch (e) {
    if (__DEV__) console.warn(`[expenses] toDoc: data() failed for ${docSnap.id}`, e);
    return null;
  }

  try {
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    title: (d.title as string) ?? "",
    amount: (d.amount as number | null) ?? null,
    currency: (d.currency as string) ?? "EUR",
    date: firestoreValueToIsoString(d.date) ?? new Date().toISOString(),
    note: (d.note as string) ?? undefined,
    taskId: (d.taskId as string | null) ?? undefined,
    phaseId: (d.phaseId as string | null) ?? undefined,
    attachmentId: (d.attachmentId as string | null) ?? undefined,
    source: (d.source as ExpenseSource) ?? 'MANUAL',
    status: (d.status as ExpenseStatus) ?? 'READY',
    category: (d.category as ExpenseCategory) ?? undefined,
    supplierName: (d.supplierName as string) ?? undefined,
    supplierIco: (d.supplierIco as string) ?? undefined,
    uploadStatus: (d.uploadStatus as UploadStatus) ?? undefined,
    filePath: (d.filePath as string) ?? undefined,
    mimeType: (d.mimeType as string) ?? undefined,
    ocrStatus: (d.ocrStatus as OcrStatus) ?? undefined,
    ocrParsedAt: firestoreValueToIsoString(d.ocrParsedAt),
    ocrSupplierName: (d.ocrSupplierName as string) ?? undefined,
    ocrInvoiceNumber: (d.ocrInvoiceNumber as string) ?? undefined,
    ocrIssueDate: (d.ocrIssueDate as string) ?? undefined,
    ocrTotalAmount: (d.ocrTotalAmount as number | null) ?? undefined,
    ocrVatAmount: (d.ocrVatAmount as number | null) ?? undefined,
    ocrCurrency: (d.ocrCurrency as string) ?? undefined,
    ocrAuditSnapshot:
      d.ocrAuditSnapshot != null && typeof d.ocrAuditSnapshot === "object" && !Array.isArray(d.ocrAuditSnapshot)
        ? (d.ocrAuditSnapshot as Record<string, unknown>)
        : undefined,
    createdAt: firestoreValueToIsoString(d.createdAt),
    updatedAt: firestoreValueToIsoString(d.updatedAt),
    travel: parseTravel(d.travel),
  };
  } catch (err) {
    if (__DEV__) console.warn(`[expenses] toDoc failed for doc ${docSnap.id}:`, err);
    return null;
  }
}

function parseTravel(t: unknown): TravelExpenseData | undefined {
  if (!t || typeof t !== "object" || Array.isArray(t)) return undefined;
  const o = t as Record<string, unknown>;
  const from = o.fromAddress as string;
  const to = o.toAddress as string;
  const km = o.distanceKm as number;
  const rate = o.ratePerKm as number;
  const round = o.roundTrip as boolean;
  if (typeof from !== "string" || typeof to !== "string" || typeof km !== "number") return undefined;
  return {
    fromAddress: from,
    toAddress: to,
    distanceKm: km,
    ratePerKm: typeof rate === "number" ? rate : 0.2,
    roundTrip: !!round,
  };
}

/** Form / API may pass JS Date or Firestore Timestamp-like; avoid calling .getTime() on wrong shape. */
function coerceExpenseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "object") return null;
  const o = value as {
    getTime?: () => number;
    toDate?: () => Date;
    seconds?: unknown;
    nanoseconds?: unknown;
  };
  if (typeof o.seconds === "number") {
    const nanos = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
    const d = new Date(o.seconds * 1000 + nanos / 1e6);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof o.toDate === "function") {
    try {
      const d = o.toDate();
      if (d != null && typeof (d as Date).getTime === "function") {
        const ms = (d as Date).getTime();
        if (typeof ms === "number" && !Number.isNaN(ms)) return new Date(ms);
      }
    } catch {
      return null;
    }
  }
  if (typeof o.getTime === "function") {
    try {
      const ms = o.getTime();
      if (typeof ms === "number" && !Number.isNaN(ms)) return value as Date;
    } catch {
      return null;
    }
  }
  return null;
}

/** Safe for Firestore payload: never uses `unknown?.trim()` (non-strings can expose `trim` as non-callable). */
function nullableTrimmedString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value : String(value);
  const t = s.trim();
  return t.length === 0 ? null : t;
}

/** Only pass real finite Dates into Timestamp.fromDate (RN Firebase can throw TypeError otherwise). */
function safeExpenseDocumentDate(value: unknown) {
  const jsDate = coerceExpenseDate(value);
  if (jsDate != null && !Number.isNaN(jsDate.getTime())) {
    return firestoreTimestampFromDate(jsDate);
  }
  return serverTimestamp();
}

/** OCR may pass ISO strings, Firestore Timestamp, or invalid objects — never forward blindly to Timestamp.fromDate. */
function coerceOcrParsedAtForFirestore(value: unknown) {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : firestoreTimestampFromDate(value);
  }
  if (typeof value === "string") {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : firestoreTimestampFromDate(d);
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (value as { toDate: () => unknown }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return firestoreTimestampFromDate(d);
    } catch {
      return null;
    }
  }
  return null;
}

/** Plain map for Firestore (no JSON.stringify — avoids Hermes/bridge edge cases). */
function travelToFirestoreMap(t: TravelExpenseData): Record<string, unknown> {
  const o: Record<string, unknown> = {
    fromAddress: t.fromAddress,
    toAddress: t.toAddress,
    distanceKm: t.distanceKm,
    ratePerKm: t.ratePerKm,
    roundTrip: !!t.roundTrip,
  };
  if (typeof t.billableToClient === "boolean") {
    o.billableToClient = t.billableToClient;
  }
  /** RN Firebase rejects `undefined` in nested maps (native Object.assign / encode path). */
  return omitUndefinedFields(o) as Record<string, unknown>;
}

/** Only persist travel when the map is complete after stripping undefined. */
function normalizedTravelForFirestore(travel: unknown): Record<string, unknown> | null {
  if (travel == null || typeof travel !== "object" || Array.isArray(travel)) return null;
  const cleaned = travelToFirestoreMap(travel as TravelExpenseData);
  if (typeof cleaned.fromAddress !== "string" || !cleaned.fromAddress.trim()) return null;
  if (typeof cleaned.toAddress !== "string" || !cleaned.toAddress.trim()) return null;
  if (typeof cleaned.distanceKm !== "number" || !Number.isFinite(cleaned.distanceKm)) return null;
  return cleaned;
}

/** Firestore / RN bridge: finite numbers only; NaN/Infinity must not reach native write. */
function finiteNumberOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function isNativeFirestoreDocumentReference(v: unknown): boolean {
  try {
    const { firebase } = require("@react-native-firebase/app");
    return v instanceof firebase.firestore.DocumentReference;
  } catch {
    return false;
  }
}

function isNativeFirestoreFieldValue(v: unknown): boolean {
  try {
    const { firebase } = require("@react-native-firebase/app");
    return v instanceof firebase.firestore.FieldValue;
  } catch {
    return false;
  }
}

/** Do not descend into Timestamp / FieldValue when scanning for `undefined` (avoids false paths + native internals). */
function skipFirestoreSentinelsInUndefinedScan(v: unknown): boolean {
  return isFirestoreTimeOrSentinel(v) || isNativeFirestoreFieldValue(v);
}

/**
 * Every enumerable path where a value is strictly `undefined` (Firestore RN bridge rejects these).
 * Detects cycles as `path:<<cycle>>`.
 */
function findUndefinedPaths(value: unknown, path = "root", seen: WeakSet<object> = new WeakSet()): string[] {
  if (value === undefined) return [path];
  if (value === null) return [];
  if (typeof value !== "object") return [];
  if (seen.has(value as object)) return [`${path}:<<cycle>>`];
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUndefinedPaths(item, `${path}[${i}]`, seen));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    findUndefinedPaths(v, `${path}.${k}`, seen)
  );
}

/** Same as findUndefinedPaths but skips Timestamp / FieldValue subtrees (for full firestorePayload). */
function findUndefinedPathsFirestorePayload(value: unknown, path = "root", seen: WeakSet<object> = new WeakSet()): string[] {
  if (skipFirestoreSentinelsInUndefinedScan(value)) return [];
  if (value === undefined) return [path];
  if (value === null) return [];
  if (typeof value !== "object") return [];
  if (seen.has(value as object)) return [`${path}:<<cycle>>`];
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUndefinedPathsFirestorePayload(item, `${path}[${i}]`, seen));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    findUndefinedPathsFirestorePayload(v, `${path}.${k}`, seen)
  );
}

/** Values that often break RN Firebase serialization even when not `undefined`. */
function findSerializationRiskPaths(
  value: unknown,
  path = "root",
  seen: WeakSet<object> = new WeakSet()
): string[] {
  if (value === null || value === undefined) return [];
  const t = typeof value;
  if (t === "function") return [`${path}:function`];
  if (t === "symbol") return [`${path}:symbol`];
  if (t === "bigint") return [`${path}:bigint`];
  if (t !== "object") return [];
  if (skipFirestoreSentinelsInUndefinedScan(value)) return [];
  if (isNativeFirestoreDocumentReference(value)) return [`${path}:DocumentReference`];
  if (seen.has(value as object)) return [`${path}:<<cycle>>`];
  seen.add(value as object);
  if (value instanceof Date) return [`${path}:Date`];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSerializationRiskPaths(item, `${path}[${i}]`, seen));
  }
  if (isPlainObject(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      findSerializationRiskPaths(v, `${path}.${k}`, seen)
    );
  }
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? "?";
  return [`${path}:nonPlainObject(${ctor})`];
}

/** RN Firebase rejects `undefined` at any depth in maps/arrays — shallow omit is not enough. */
function deepFirestoreSanitize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (isNativeFirestoreDocumentReference(value)) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(deepFirestoreSanitize).filter((v) => v !== undefined);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      const nv = deepFirestoreSanitize(v);
      if (nv !== undefined) out[k] = nv;
    }
    return out;
  }
  // Class instances (e.g. accidental DocumentReference) — drop instead of passing to native encoder.
  return undefined;
}

/** Detect Timestamp / FieldValue-like objects — do not descend (avoids false undefined reports). */
function isFirestoreTimeOrSentinel(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.toMillis === "function" || typeof o.toDate === "function" || typeof o.seconds === "number";
}

/** List dot-paths to `undefined` in JSON-like trees (skips sentinels when `skip` returns true). */
function listUndefinedPaths(value: unknown, basePath: string, skip: (v: unknown) => boolean): string[] {
  if (skip(value)) return [];
  if (value === undefined) return [basePath];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => listUndefinedPaths(item, `${basePath}[${i}]`, skip));
  }
  const acc: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = `${basePath}.${k}`;
    if (v === undefined) acc.push(p);
    acc.push(...listUndefinedPaths(v, p, skip));
  }
  return acc;
}

/** Log-safe view of payload (no FieldValue/Timestamp serialization). */
function summarizeFirestorePayloadForLog(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "date" || k === "createdAt" || k === "updatedAt") {
      out[k] = isFirestoreTimeOrSentinel(v) ? `[${k}:Firestore sentinel]` : String(v);
      continue;
    }
    if (k === "attachments" && Array.isArray(v)) {
      out[k] = {
        count: v.length,
        undefinedPaths: listUndefinedPaths(v, "attachments", () => false),
        firstKeys: v[0] && isPlainObject(v[0]) ? Object.keys(v[0] as object) : [],
      };
      continue;
    }
    if (k === "receipt") {
      out[k] =
        v === null
          ? { kind: "null", undefinedPaths: [] }
          : {
              kind: "object",
              keys: isPlainObject(v) ? Object.keys(v as object) : [],
              undefinedPaths: listUndefinedPaths(v, "receipt", () => false),
            };
      continue;
    }
    if (k === "travel") {
      out[k] =
        v === null
          ? { kind: "null" }
          : { kind: "object", undefinedPaths: listUndefinedPaths(v, "travel", () => false) };
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Only keys written from ProjectOverview expense form — drops unknown/host fields before Firestore. */
const EXPENSE_ATTACHMENT_ALLOWED_KEYS = new Set([
  "mode",
  "attachmentId",
  "storagePath",
  "mimeType",
  "kind",
  "fileName",
  "isLinkedToExpense",
  "linkedExpenseId",
  "localUriLen",
  "uriLen",
]);

function pickAllowedExpenseAttachmentFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EXPENSE_ATTACHMENT_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) {
      out[k] = raw[k];
    }
  }
  return out;
}

const EXPENSE_RECEIPT_ALLOWED_KEYS = new Set(["ocrStatus", "supplierDraft"]);

function pickAllowedExpenseReceiptFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EXPENSE_RECEIPT_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) {
      out[k] = raw[k];
    }
  }
  return out;
}

/**
 * Firestore-safe: always an array of plain maps (single object input → one element).
 * Matches: Array.isArray(x) ? x : x ? [x] : []
 */
function normalizeAttachmentsForWrite(raw: unknown): Record<string, unknown>[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return list
    .filter((x) => x != null)
    .map((x) =>
      isPlainObject(x)
        ? (deepFirestoreSanitize(
            omitUndefinedFields(pickAllowedExpenseAttachmentFields(x as Record<string, unknown>))
          ) as Record<string, unknown>)
        : ({} as Record<string, unknown>)
    )
    .filter((o) => Object.keys(o).length > 0);
}

/** Firestore-safe: plain map or null (omit empty); deep-strips undefined. */
function normalizeReceiptForWrite(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) return null;
  const o = deepFirestoreSanitize(
    omitUndefinedFields(pickAllowedExpenseReceiptFields(raw as Record<string, unknown>))
  ) as Record<string, unknown>;
  return Object.keys(o).length ? o : null;
}

/** TEMP: classify addDoc failures for clearer Metro logs (remove when stable). */
function classifyCreateExpenseWriteError(err: unknown): {
  bucket: "js_payload" | "firestore_permission" | "firestore_invalid_data" | "firestore_other";
  code: string;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const msgLower = message.toLowerCase();
  if (
    name === "TypeError" ||
    name === "ReferenceError" ||
    msgLower.includes("cannot convert undefined") ||
    msgLower.includes("cannot read property")
  ) {
    return { bucket: "js_payload", code: name || "Error", message };
  }
  let code = "";
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e && typeof e === "object"; depth++) {
    const c = (e as { code?: string }).code;
    if (typeof c === "string" && c.length > 0) {
      code = c;
      break;
    }
    e = (e as { cause?: unknown }).cause ?? null;
  }
  const cLower = code.toLowerCase();
  if (
    cLower.includes("permission") ||
    msgLower.includes("permission-denied") ||
    msgLower.includes("missing or insufficient permissions")
  ) {
    return { bucket: "firestore_permission", code: code || "permission-denied", message };
  }
  if (
    cLower.includes("invalid-argument") ||
    cLower.includes("failed-precondition") ||
    cLower.includes("out-of-range") ||
    cLower.includes("already-exists") ||
    msgLower.includes("invalid data") ||
    msgLower.includes("property") && msgLower.includes("invalid")
  ) {
    return { bucket: "firestore_invalid_data", code: code || "invalid-argument", message };
  }
  if (code.length > 0) {
    return { bucket: "firestore_other", code, message };
  }
  return { bucket: "js_payload", code: name || "unknown", message };
}

/**
 * Create a new expense
 */
export async function createExpense(
  ownerId: string,
  projectId: string,
  data: {
    title: string;
    amount: number | null;
    currency?: string;
    date?: Date;
    note?: string;
    taskId?: string | null;
    phaseId?: string | null;
    attachmentId?: string | null;
    source?: ExpenseSource;
    status?: ExpenseStatus;
    category?: ExpenseCategory;
    supplierName?: string;
    supplierIco?: string;
    uploadStatus?: UploadStatus;
    filePath?: string | null;
    mimeType?: string | null;
    ocrStatus?: OcrStatus;
    ocrParsedAt?: Date;
    ocrSupplierName?: string | null;
    ocrInvoiceNumber?: string | null;
    ocrIssueDate?: string | null;
    ocrTotalAmount?: number | null;
    ocrVatAmount?: number | null;
    ocrCurrency?: string | null;
    travel?: TravelExpenseData | null;
    /** Client attachment summary (preupload/local); stored as sanitized array of maps. */
    attachments?: unknown;
    /** Optional receipt/OCR summary map; stored as null or plain object without undefined. */
    receipt?: unknown;
  }
): Promise<ExpenseDoc> {
  try {
    console.log("[createExpense] input", JSON.stringify(data, null, 2));
    console.log(
      "[createExpense] attachments type",
      typeof (data as { attachments?: unknown }).attachments,
      Array.isArray((data as { attachments?: unknown }).attachments)
    );
    console.log(
      "[createExpense] receipt type",
      typeof (data as { receipt?: unknown }).receipt,
      Array.isArray((data as { receipt?: unknown }).receipt)
    );
    const tr = data.travel;
    console.log(
      "[createExpense] travel",
      tr === null ? "null" : tr === undefined ? "undefined" : typeof tr,
      Array.isArray(tr)
    );
  } catch (e) {
    console.warn("[createExpense] debug log failed:", e);
  }

  const currentUser = auth.currentUser;
  // Check subscription limit before creating expense
  if (currentUser?.uid) {
    try {
      // Count expenses for current month across all projects
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      // Get all projects for this user
      const { listMyProjects } = await import("./projects");
      const projects = await listMyProjects(currentUser.uid);
      
      let monthlyExpenseCount = 0;
      for (const project of projects) {
        const pid = project?.id?.trim();
        if (!pid) {
          if (__DEV__) console.warn("[expenses] createExpense: skip project with missing id in limit count", project);
          continue;
        }
        try {
          const expenses = await listExpensesByProject(pid);
          const monthlyExpenses = expenses.filter((exp) => {
            if (!exp.date || exp.status !== "READY") return false;
            const expenseDate = new Date(exp.date);
            return expenseDate >= firstDayOfMonth;
          });
          monthlyExpenseCount += monthlyExpenses.length;
        } catch (error) {
          // Skip projects with expense loading errors
        }
      }
      
      const limitCheck = await checkLimit(currentUser.uid, "expenses", monthlyExpenseCount);
      
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.message || `Dosiahli ste limit výdavkov pre váš plán (${limitCheck.limit} mesačne). Zvážte upgrade na vyšší tier.`);
      }
    } catch (error: any) {
      // If limit check fails, throw error (don't create expense)
      if (error.message && error.message.includes("limit")) {
        throw error;
      }
      // If it's a different error, log but allow creation (server will enforce)
      console.warn("[expenses] Subscription limit check failed, allowing creation (server will enforce):", error);
    }
  }

  console.log(
    "[createExpense][TEMP] undefined paths in input",
    findUndefinedPaths(data as unknown as Record<string, unknown>, "input")
  );
  const inputSerializationRisks = findSerializationRiskPaths(data as unknown as Record<string, unknown>, "input");
  if (inputSerializationRisks.length > 0) {
    console.log("[createExpense][TEMP] serialization risks in input", inputSerializationRisks);
  }

  let travelPayload: Record<string, unknown> | null = null;
  try {
    console.log("[createExpense][TEMP] stage: normalize travel — start");
    travelPayload = normalizedTravelForFirestore(data.travel);
    console.log("[createExpense][TEMP] stage: normalize travel — ok", {
      travelKind: travelPayload === null ? "null" : "object",
    });
  } catch (e) {
    console.error("[createExpense][TEMP] stage: normalize travel — threw", e);
    throw e;
  }
  console.log(
    "[createExpense][TEMP] undefined paths in travelPayload",
    travelPayload === null ? [] : findUndefinedPaths(travelPayload, "travelPayload")
  );

  let attachmentsForWrite: Record<string, unknown>[] = [];
  try {
    console.log("[createExpense][TEMP] stage: normalize attachments — start");
    attachmentsForWrite = normalizeAttachmentsForWrite(
      (data as { attachments?: unknown }).attachments
    );
    console.log("[createExpense][TEMP] stage: normalize attachments — ok", {
      attachmentsCount: attachmentsForWrite.length,
    });
  } catch (e) {
    console.error("[createExpense][TEMP] stage: normalize attachments — threw", e);
    throw e;
  }
  console.log(
    "[createExpense][TEMP] undefined paths in attachmentsForWrite",
    findUndefinedPaths(attachmentsForWrite, "attachmentsForWrite")
  );
  const attSerializationRisks = findSerializationRiskPaths(attachmentsForWrite, "attachmentsForWrite");
  if (attSerializationRisks.length > 0) {
    console.log("[createExpense][TEMP] serialization risks in attachmentsForWrite", attSerializationRisks);
  }

  let receiptForWrite: Record<string, unknown> | null = null;
  try {
    console.log("[createExpense][TEMP] stage: normalize receipt — start");
    receiptForWrite = normalizeReceiptForWrite((data as { receipt?: unknown }).receipt);
    console.log("[createExpense][TEMP] stage: normalize receipt — ok", {
      receiptKind: receiptForWrite === null ? "null" : "object",
    });
  } catch (e) {
    console.error("[createExpense][TEMP] stage: normalize receipt — threw", e);
    throw e;
  }
  console.log(
    "[createExpense][TEMP] undefined paths in receiptForWrite",
    receiptForWrite === null ? [] : findUndefinedPaths(receiptForWrite, "receiptForWrite")
  );
  const receiptSerializationRisks =
    receiptForWrite === null ? [] : findSerializationRiskPaths(receiptForWrite, "receiptForWrite");
  if (receiptSerializationRisks.length > 0) {
    console.log("[createExpense][TEMP] serialization risks in receiptForWrite", receiptSerializationRisks);
  }

  const c = collection(db, paths.projectExpenses(projectId));
  // Do not run Object.entries-based sanitizers on this payload: FieldValue (serverTimestamp)
  // is often non-enumerable and would be dropped, breaking the native RN Firebase bridge.
  let firestorePayload: Record<string, unknown>;
  try {
    console.log("[createExpense][TEMP] stage: build firestore payload — start");
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before base (ids, title, amount, currency, date)");
      // firestorePayload is one object literal — no ...spread of helper blocks. Failure here is almost always date/timestamp.
      console.log("[createExpense][TEMP] payload build: baseRefs", {
        ownerId,
        projectId,
        dataDate: data.date,
        dataDateType: data.date == null ? String(data.date) : typeof data.date,
      });
    }
    const safeDate = safeExpenseDocumentDate(data.date);
    const titleForWrite = (typeof data.title === "string" ? data.title : String(data.title ?? "")).trim();
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before file/upload block");
    }
    const uploadStatusForWrite = data.uploadStatus !== undefined && data.uploadStatus !== null ? data.uploadStatus : null;
    const filePathForWrite = data.filePath ?? null;
    const mimeTypeForWrite = data.mimeType ?? null;
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before OCR block");
    }
    const ocrStatusForWrite = data.ocrStatus !== undefined && data.ocrStatus !== null ? data.ocrStatus : null;
    const ocrParsedAtForWrite = coerceOcrParsedAtForFirestore(data.ocrParsedAt);
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before supplier block");
    }
    const supplierNameForWrite = nullableTrimmedString(data.supplierName);
    const supplierIcoForWrite = nullableTrimmedString(data.supplierIco);
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before phase block");
    }
    const phaseIdForWrite = data.phaseId !== undefined && data.phaseId !== null ? data.phaseId : null;
    const taskIdForWrite = data.taskId !== undefined && data.taskId !== null ? data.taskId : null;
    if (__DEV__) {
      console.log("[createExpense][TEMP] payload build: before receipt/attachments + timestamps");
    }
    const noteForWrite = nullableTrimmedString(data.note);
    firestorePayload = {
      ownerId,
      projectId,
      title: titleForWrite,
      amount: finiteNumberOrNull(data.amount),
      currency: data.currency ?? "EUR",
      date: safeDate,
      note: noteForWrite,
      taskId: taskIdForWrite,
      phaseId: phaseIdForWrite,
      attachmentId: data.attachmentId ?? null,
      source: data.source ?? "MANUAL",
      status: data.status ?? "READY",
      category: data.category !== undefined && data.category !== null ? data.category : null,
      supplierName: supplierNameForWrite,
      supplierIco: supplierIcoForWrite,
      uploadStatus: uploadStatusForWrite,
      filePath: filePathForWrite,
      mimeType: mimeTypeForWrite,
      ocrStatus: ocrStatusForWrite,
      ocrParsedAt: ocrParsedAtForWrite,
      ocrSupplierName: data.ocrSupplierName ?? null,
      ocrInvoiceNumber: data.ocrInvoiceNumber ?? null,
      ocrIssueDate: data.ocrIssueDate ?? null,
      ocrTotalAmount: finiteNumberOrNull(data.ocrTotalAmount),
      ocrVatAmount: finiteNumberOrNull(data.ocrVatAmount),
      ocrCurrency: data.ocrCurrency ?? null,
      travel: travelPayload,
      attachments: attachmentsForWrite,
      receipt: receiptForWrite,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    console.log("[createExpense][TEMP] stage: build firestore payload — ok");
  } catch (e) {
    console.error("[createExpense][TEMP] stage: build firestore payload — threw", e);
    throw e;
  }

  const payloadShapeLog = {
    attachmentsCount: attachmentsForWrite.length,
    receiptKind: receiptForWrite === null ? "null" : "object",
    travelKind: travelPayload === null ? "null" : "object",
  };
  const topUndefinedPaths = findUndefinedPathsFirestorePayload(firestorePayload, "firestorePayload");
  console.log("[createExpense][TEMP] undefined paths in firestorePayload", topUndefinedPaths);
  const firestoreSerializationRisks = findSerializationRiskPaths(firestorePayload, "firestorePayload");
  if (firestoreSerializationRisks.length > 0) {
    console.log("[createExpense][TEMP] serialization risks in firestorePayload", firestoreSerializationRisks);
  }
  console.log("[createExpense][TEMP] addDoc_before", {
    outcome: "attempt",
    projectId,
    ...payloadShapeLog,
    topUndefinedPaths,
    payloadSummary: summarizeFirestorePayloadForLog(firestorePayload as unknown as Record<string, unknown>),
  });

  let ref: { id: string };
  try {
    console.log("[createExpense][TEMP] stage: addDoc — start");
    ref = await addDoc(c, firestorePayload as FirebaseFirestore.DocumentData);
    console.log("[createExpense][TEMP] stage: addDoc — ok", { expenseId: ref.id });
  } catch (addErr) {
    console.error("[createExpense][TEMP] stage: addDoc — threw", addErr);
    console.error(
      "[createExpense][TEMP] undefined paths in firestorePayload (at failure)",
      findUndefinedPathsFirestorePayload(firestorePayload, "firestorePayload")
    );
    const classified = classifyCreateExpenseWriteError(addErr);
    const msg = addErr instanceof Error ? addErr.message : String(addErr);
    const isLikelyJsPayload =
      classified.bucket === "js_payload" ||
      msg.toLowerCase().includes("cannot convert undefined");
    if (isLikelyJsPayload) {
      console.warn("[createExpense][TEMP] isolation_probe: addDoc with receipt=null, attachments=[]", { projectId });
      try {
        const probePayload = {
          ...(firestorePayload as unknown as Record<string, unknown>),
          receipt: null,
          attachments: [],
        };
        const probeRef = await addDoc(c, probePayload as typeof firestorePayload);
        try {
          await deleteDoc(probeRef as Parameters<typeof deleteDoc>[0]);
        } catch (delErr) {
          console.warn("[createExpense][TEMP] isolation_probe: failed to delete probe doc", {
            probeExpenseId: probeRef.id,
            msg: delErr instanceof Error ? delErr.message : String(delErr),
          });
        }
        console.warn(
          "[createExpense][TEMP] isolation_probe SUCCEEDED then deleted probe — original failure likely receipt and/or attachments[] (or fields correlated with them)"
        );
      } catch (probeErr) {
        console.warn("[createExpense][TEMP] isolation_probe FAILED — cause is not receipt/attachments alone", {
          probeMsg: probeErr instanceof Error ? probeErr.message : String(probeErr),
        });
      }
    }
    console.error("[createExpense][TEMP] addDoc_failed", {
      outcome: "failure",
      failureBucket: classified.bucket,
      failureCode: classified.code,
      failureMessage: classified.message,
      ...payloadShapeLog,
      topUndefinedPaths,
      hint:
        classified.bucket === "js_payload"
          ? "Likely undefined/non-serializable value in JS payload before native write."
          : classified.bucket === "firestore_permission"
            ? "Firestore security rules rejected this write."
            : classified.bucket === "firestore_invalid_data"
              ? "Firestore rejected document shape or field types."
              : "Other Firestore error; see failureCode.",
    });
    throw addErr;
  }

  console.log("[createExpense][TEMP] addDoc_after", {
    outcome: "success",
    expenseId: ref.id,
    ...payloadShapeLog,
  });

  if (currentUser?.uid) {
    try {
      const { getProject } = await import("./projects");
      const project = await getProject(projectId);
      await createExpenseAddedNotification({
        userId: ownerId,
        projectId,
        projectName: project?.name ?? null,
        expenseId: ref.id,
        amount: data.amount ?? null,
        currency: data.currency ?? "EUR",
      });
    } catch (error) {
      console.warn("[expenses] Failed to create notification:", error);
    }
  }

  try {
    await addProjectEvent(
      projectId,
      "expense_added",
      {
        ...(data.amount != null ? { amount: data.amount } : {}),
        currency: data.currency ?? "EUR",
      },
      { kind: "expense", id: ref.id }
    );
  } catch (error) {
    console.warn("[expenses] Failed to create project event:", error);
  }

  console.log(`[expenses] Created expense ${ref.id} in project ${projectId}`);

  const returnDate = coerceExpenseDate(data.date);
  const dateIso =
    returnDate != null && !Number.isNaN(returnDate.getTime())
      ? returnDate.toISOString()
      : new Date().toISOString();

  return {
    id: ref.id,
    projectId,
    title: data.title.trim(),
    amount: data.amount ?? null,
    currency: data.currency ?? "EUR",
    date: dateIso,
    note: data.note,
    taskId: data.taskId,
    phaseId: data.phaseId,
    attachmentId: data.attachmentId,
    source: data.source ?? 'MANUAL',
    status: data.status ?? 'READY',
    category: data.category,
    supplierName: data.supplierName,
    supplierIco: data.supplierIco,
    uploadStatus: data.uploadStatus ?? undefined,
    filePath: data.filePath ?? undefined,
    mimeType: data.mimeType ?? undefined,
    ocrStatus: data.ocrStatus ?? undefined,
    ocrParsedAt: data.ocrParsedAt ? data.ocrParsedAt.toISOString() : undefined,
    ocrSupplierName: data.ocrSupplierName ?? undefined,
    ocrInvoiceNumber: data.ocrInvoiceNumber ?? undefined,
    ocrIssueDate: data.ocrIssueDate ?? undefined,
    ocrTotalAmount: data.ocrTotalAmount ?? undefined,
    ocrVatAmount: data.ocrVatAmount ?? undefined,
    ocrCurrency: data.ocrCurrency ?? undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * List all expenses for a project
 */
export async function listExpensesByProject(projectId: string): Promise<ExpenseDoc[]> {
  const pid = typeof projectId === "string" ? projectId.trim() : "";
  if (!pid) {
    if (__DEV__) console.warn("[expenses] listExpensesByProject: empty projectId, returning []");
    return [];
  }
  const c = collection(db, paths.projectExpenses(pid));
  const q = query(c, orderBy("date", "desc"));
  try {
    const snap = await getDocsSmart(q);
    const list = snap.docs
      .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }))
      .filter((e): e is ExpenseDoc => e != null);
    return list;
  } catch (error: any) {
    const code = String(error?.code ?? "");
    if (code === "permission-denied" || code.includes("permission-denied")) {
      return [];
    }
    throw error;
  }
}

/**
 * Update an expense
 */
export async function updateExpense(
  projectId: string,
  expenseId: string,
  data: {
    title?: string;
    amount?: number | null;
    currency?: string;
    date?: Date;
    note?: string;
    taskId?: string | null;
    phaseId?: string | null;
    attachmentId?: string | null;
    status?: ExpenseStatus;
    category?: ExpenseCategory;
    supplierName?: string;
    supplierIco?: string;
    uploadStatus?: UploadStatus;
    filePath?: string | null;
    mimeType?: string | null;
    ocrStatus?: OcrStatus;
    ocrParsedAt?: Date | null;
    ocrSupplierName?: string | null;
    ocrInvoiceNumber?: string | null;
    ocrIssueDate?: string | null;
    ocrTotalAmount?: number | null;
    ocrVatAmount?: number | null;
    ocrCurrency?: string | null;
    travel?: TravelExpenseData;
    ocrAuditSnapshot?: Record<string, unknown> | null;
  }
): Promise<void> {
  const ref = doc(db, paths.projectExpense(projectId, expenseId));
  const updateData: any = {
    updatedAt: serverTimestamp(),
  };
  
  if (data.title !== undefined) updateData.title = data.title.trim();
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.date !== undefined) {
    updateData.date =
      data.date && !Number.isNaN(data.date.getTime()) ? firestoreTimestampFromDate(data.date) : null;
  }
  if (data.note !== undefined) updateData.note = data.note?.trim() ?? null;
  if (data.taskId !== undefined) updateData.taskId = data.taskId ?? null;
  if (data.phaseId !== undefined) updateData.phaseId = data.phaseId ?? null;
  if (data.attachmentId !== undefined) updateData.attachmentId = data.attachmentId ?? null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.category !== undefined) updateData.category = data.category ?? null;
  if (data.supplierName !== undefined) updateData.supplierName = data.supplierName?.trim() ?? null;
  if (data.supplierIco !== undefined) updateData.supplierIco = data.supplierIco?.trim() ?? null;
  if (data.uploadStatus !== undefined) updateData.uploadStatus = data.uploadStatus ?? null;
  if (data.filePath !== undefined) updateData.filePath = data.filePath ?? null;
  if (data.mimeType !== undefined) updateData.mimeType = data.mimeType ?? null;
  if (data.ocrStatus !== undefined) updateData.ocrStatus = data.ocrStatus ?? null;
  if (data.ocrParsedAt !== undefined) {
    updateData.ocrParsedAt = coerceOcrParsedAtForFirestore(data.ocrParsedAt);
  }
  if (data.ocrSupplierName !== undefined) updateData.ocrSupplierName = data.ocrSupplierName ?? null;
  if (data.ocrInvoiceNumber !== undefined) updateData.ocrInvoiceNumber = data.ocrInvoiceNumber ?? null;
  if (data.ocrIssueDate !== undefined) updateData.ocrIssueDate = data.ocrIssueDate ?? null;
  if (data.ocrTotalAmount !== undefined) updateData.ocrTotalAmount = data.ocrTotalAmount ?? null;
  if (data.ocrVatAmount !== undefined) updateData.ocrVatAmount = data.ocrVatAmount ?? null;
  if (data.ocrCurrency !== undefined) updateData.ocrCurrency = data.ocrCurrency ?? null;
  if (data.travel !== undefined) {
    updateData.travel =
      data.travel == null ? null : normalizedTravelForFirestore(data.travel);
  }
  if (data.ocrAuditSnapshot !== undefined) {
    updateData.ocrAuditSnapshot = data.ocrAuditSnapshot ?? null;
  }

  for (const k of Object.keys(updateData)) {
    if (updateData[k] === undefined) delete updateData[k];
  }

  await updateDoc(ref, updateData);
  console.log(`[expenses] Updated expense ${expenseId} in project ${projectId}`);
}

/**
 * Delete an expense
 */
export async function deleteExpense(
  projectId: string,
  expenseId: string
): Promise<void> {
  const ref = doc(db, paths.projectExpense(projectId, expenseId));
  await deleteDoc(ref);
  console.log(`[expenses] Deleted expense ${expenseId} from project ${projectId}`);
}
