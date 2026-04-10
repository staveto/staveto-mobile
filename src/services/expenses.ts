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
  Timestamp,
} from "../lib/rnFirestore";
import { getDocsSmart } from "./firestoreSmartRead";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { firestoreValueToIsoString } from "../utils/date";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";
import { createExpenseAddedNotification } from "./notifications";
import type { ProjectExpense } from "../lib/types";
import { addProjectEvent } from "./projectEvents";

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
  return o;
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
    travel?: TravelExpenseData;
    /** Optional metadata (debug / future); not written to Firestore unless mapped */
    attachments?: unknown;
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
    console.log("[createExpense] travel type", typeof data.travel, Array.isArray(data.travel));
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

  const jsDate = coerceExpenseDate(data.date);
  const safeDate = jsDate != null ? Timestamp.fromDate(jsDate) : serverTimestamp();
  const travelPayload =
    data.travel == null ? null : travelToFirestoreMap(data.travel);

  const c = collection(db, paths.projectExpenses(projectId));
  // Do not run Object.entries-based sanitizers on this payload: FieldValue (serverTimestamp)
  // is often non-enumerable and would be dropped, breaking the native RN Firebase bridge.
  const ref = await addDoc(c, {
    ownerId,
    projectId,
    title: data.title.trim(),
    amount: data.amount,
    currency: data.currency ?? "EUR",
    date: safeDate,
    note: data.note?.trim() ?? null,
    taskId: data.taskId ?? null,
    phaseId: data.phaseId ?? null,
    attachmentId: data.attachmentId ?? null,
    source: data.source ?? "MANUAL",
    status: data.status ?? "READY",
    category: data.category ?? null,
    supplierName: data.supplierName?.trim() ?? null,
    supplierIco: data.supplierIco?.trim() ?? null,
    uploadStatus: data.uploadStatus ?? null,
    filePath: data.filePath ?? null,
    mimeType: data.mimeType ?? null,
    ocrStatus: data.ocrStatus ?? null,
    ocrParsedAt: data.ocrParsedAt ? Timestamp.fromDate(data.ocrParsedAt) : null,
    ocrSupplierName: data.ocrSupplierName ?? null,
    ocrInvoiceNumber: data.ocrInvoiceNumber ?? null,
    ocrIssueDate: data.ocrIssueDate ?? null,
    ocrTotalAmount: data.ocrTotalAmount ?? null,
    ocrVatAmount: data.ocrVatAmount ?? null,
    ocrCurrency: data.ocrCurrency ?? null,
    travel: travelPayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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
    amount: data.amount,
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
      data.date && !Number.isNaN(data.date.getTime()) ? Timestamp.fromDate(data.date) : null;
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
    updateData.ocrParsedAt = data.ocrParsedAt ? Timestamp.fromDate(data.ocrParsedAt) : null;
  }
  if (data.ocrSupplierName !== undefined) updateData.ocrSupplierName = data.ocrSupplierName ?? null;
  if (data.ocrInvoiceNumber !== undefined) updateData.ocrInvoiceNumber = data.ocrInvoiceNumber ?? null;
  if (data.ocrIssueDate !== undefined) updateData.ocrIssueDate = data.ocrIssueDate ?? null;
  if (data.ocrTotalAmount !== undefined) updateData.ocrTotalAmount = data.ocrTotalAmount ?? null;
  if (data.ocrVatAmount !== undefined) updateData.ocrVatAmount = data.ocrVatAmount ?? null;
  if (data.ocrCurrency !== undefined) updateData.ocrCurrency = data.ocrCurrency ?? null;
  if (data.travel !== undefined) {
    updateData.travel = data.travel == null ? null : travelToFirestoreMap(data.travel);
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
