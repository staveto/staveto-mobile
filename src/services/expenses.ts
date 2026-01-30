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
} from "firebase/firestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { ProjectExpense } from "../lib/types";

export type ExpenseDoc = {
  id: string;
  projectId: string;
  title: string;
  amount: number;
  currency: string;
  date: string; // ISO string
  note?: string;
  taskId?: string | null;
  phaseId?: string | null;
  attachmentId?: string | null;
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
    amount: (d.amount as number) ?? 0,
    currency: (d.currency as string) ?? "EUR",
    date: convertTimestamp(d.date) ?? new Date().toISOString(),
    note: (d.note as string) ?? undefined,
    taskId: (d.taskId as string | null) ?? undefined,
    phaseId: (d.phaseId as string | null) ?? undefined,
    attachmentId: (d.attachmentId as string | null) ?? undefined,
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
    amount: number;
    currency?: string;
    date?: Date;
    note?: string;
    taskId?: string | null;
    phaseId?: string | null;
    attachmentId?: string | null;
  }
): Promise<ExpenseDoc> {
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
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
    amount?: number;
    currency?: string;
    date?: Date;
    note?: string;
    taskId?: string | null;
    phaseId?: string | null;
    attachmentId?: string | null;
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
