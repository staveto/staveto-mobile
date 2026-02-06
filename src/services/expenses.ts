import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";
import { createExpenseAddedNotification } from "./notifications";
import type { ProjectExpense } from "../lib/types";

export type ExpenseSource = 'MANUAL' | 'DOCUMENT';
export type ExpenseStatus = 'PROCESSING' | 'READY' | 'FAILED';
export type ExpenseCategory = 'MATERIAL' | 'WORK' | 'OTHER';

export type OcrStatus = "success" | "failed" | "limit" | "cancelled" | "pending";

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
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ExpenseDoc {
  const d = docSnap.data();
  
  const convertTimestamp = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) {
      return ts.toDate().toISOString();
    }
    if (typeof ts === 'string') {
      return ts;
    }
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    title: (d.title as string) ?? "",
    amount: (d.amount as number | null) ?? null,
    currency: (d.currency as string) ?? "EUR",
    date: convertTimestamp(d.date) ?? new Date().toISOString(),
    note: (d.note as string) ?? undefined,
    taskId: (d.taskId as string | null) ?? undefined,
    phaseId: (d.phaseId as string | null) ?? undefined,
    attachmentId: (d.attachmentId as string | null) ?? undefined,
    source: (d.source as ExpenseSource) ?? 'MANUAL',
    status: (d.status as ExpenseStatus) ?? 'READY',
    category: (d.category as ExpenseCategory) ?? undefined,
    supplierName: (d.supplierName as string) ?? undefined,
    ocrStatus: (d.ocrStatus as OcrStatus) ?? undefined,
    ocrParsedAt: convertTimestamp(d.ocrParsedAt),
    ocrSupplierName: (d.ocrSupplierName as string) ?? undefined,
    ocrInvoiceNumber: (d.ocrInvoiceNumber as string) ?? undefined,
    ocrIssueDate: (d.ocrIssueDate as string) ?? undefined,
    ocrTotalAmount: (d.ocrTotalAmount as number | null) ?? undefined,
    ocrVatAmount: (d.ocrVatAmount as number | null) ?? undefined,
    ocrCurrency: (d.ocrCurrency as string) ?? undefined,
    createdAt: convertTimestamp(d.createdAt),
    updatedAt: convertTimestamp(d.updatedAt),
  };
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
    ocrStatus?: OcrStatus;
    ocrParsedAt?: Date;
    ocrSupplierName?: string | null;
    ocrInvoiceNumber?: string | null;
    ocrIssueDate?: string | null;
    ocrTotalAmount?: number | null;
    ocrVatAmount?: number | null;
    ocrCurrency?: string | null;
  }
): Promise<ExpenseDoc> {
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
        try {
          const expenses = await listExpensesByProject(project.id);
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
  
  const c = collection(db, paths.projectExpenses(projectId));
  const ref = await addDoc(c, {
    ownerId,
    projectId,
    title: data.title.trim(),
    amount: data.amount,
    currency: data.currency ?? "EUR",
    date: data.date ? Timestamp.fromDate(data.date) : serverTimestamp(),
    note: data.note?.trim() ?? null,
    taskId: data.taskId ?? null,
    phaseId: data.phaseId ?? null,
    attachmentId: data.attachmentId ?? null,
    source: data.source ?? 'MANUAL',
    status: data.status ?? 'READY',
    category: data.category ?? null,
    supplierName: data.supplierName?.trim() ?? null,
    ocrStatus: data.ocrStatus ?? null,
    ocrParsedAt: data.ocrParsedAt ? Timestamp.fromDate(data.ocrParsedAt) : null,
    ocrSupplierName: data.ocrSupplierName ?? null,
    ocrInvoiceNumber: data.ocrInvoiceNumber ?? null,
    ocrIssueDate: data.ocrIssueDate ?? null,
    ocrTotalAmount: data.ocrTotalAmount ?? null,
    ocrVatAmount: data.ocrVatAmount ?? null,
    ocrCurrency: data.ocrCurrency ?? null,
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
  
  console.log(`[expenses] Created expense ${ref.id} in project ${projectId}`);
  
  return {
    id: ref.id,
    projectId,
    title: data.title.trim(),
    amount: data.amount,
    currency: data.currency ?? "EUR",
    date: data.date ? data.date.toISOString() : new Date().toISOString(),
    note: data.note,
    taskId: data.taskId,
    phaseId: data.phaseId,
    attachmentId: data.attachmentId,
    source: data.source ?? 'MANUAL',
    status: data.status ?? 'READY',
    category: data.category,
    supplierName: data.supplierName,
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
  const c = collection(db, paths.projectExpenses(projectId));
  const q = query(c, orderBy("date", "desc"));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
  return list;
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
    ocrStatus?: OcrStatus;
    ocrParsedAt?: Date | null;
    ocrSupplierName?: string | null;
    ocrInvoiceNumber?: string | null;
    ocrIssueDate?: string | null;
    ocrTotalAmount?: number | null;
    ocrVatAmount?: number | null;
    ocrCurrency?: string | null;
  }
): Promise<void> {
  const ref = doc(db, paths.projectExpense(projectId, expenseId));
  const updateData: any = {
    updatedAt: serverTimestamp(),
  };
  
  if (data.title !== undefined) updateData.title = data.title.trim();
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.date !== undefined) updateData.date = Timestamp.fromDate(data.date);
  if (data.note !== undefined) updateData.note = data.note?.trim() ?? null;
  if (data.taskId !== undefined) updateData.taskId = data.taskId ?? null;
  if (data.phaseId !== undefined) updateData.phaseId = data.phaseId ?? null;
  if (data.attachmentId !== undefined) updateData.attachmentId = data.attachmentId ?? null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.category !== undefined) updateData.category = data.category ?? null;
  if (data.supplierName !== undefined) updateData.supplierName = data.supplierName?.trim() ?? null;
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
