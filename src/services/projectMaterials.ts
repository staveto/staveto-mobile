import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  getDoc,
} from "../lib/rnFirestore";
import { getDocsSmart, type SmartReadOptions } from "./firestoreSmartRead";
import { db, getAuth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { isPlainObject } from "../utils/isPlainObject";
import type {
  MaterialConfidence,
  MaterialSuggestionSource,
  MaterialSuggestionStatus,
  MaterialUnit,
} from "../lib/types";

export type MaterialSuggestionDoc = {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  suggestedQuantity?: number;
  unit?: MaterialUnit;
  estimatedUnitPrice?: number;
  estimatedTotalPrice?: number;
  currency: string;
  source: MaterialSuggestionSource;
  confidence?: MaterialConfidence;
  sourceDocumentId?: string;
  sourceNote?: string;
  phaseId?: string;
  taskId?: string;
  status: MaterialSuggestionStatus;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
};

export type ProjectMaterialDoc = {
  id: string;
  projectId: string;
  organizationId?: string;
  name: string;
  quantity: number;
  unit: MaterialUnit;
  unitPrice?: number;
  totalPrice?: number;
  currency: string;
  supplierName?: string;
  receiptUrl?: string;
  phaseId?: string;
  taskId?: string;
  usedByUserId?: string;
  usedByName?: string;
  usedAt: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
  sourceSuggestionId?: string;
};

export type MaterialTotals = {
  count: number;
  totalPrice: number;
  currency: string;
};

const MATERIAL_UNITS: MaterialUnit[] = ["pcs", "m", "m2", "kg", "l", "pack", "hour", "other"];

function convertTimestamp(ts: unknown): string | undefined {
  if (!ts) return undefined;
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function parseUnit(value: unknown): MaterialUnit | undefined {
  if (typeof value !== "string") return undefined;
  return (MATERIAL_UNITS as readonly string[]).includes(value) ? (value as MaterialUnit) : undefined;
}

function toSuggestionDoc(docSnap: { id: string; data: () => Record<string, unknown> }): MaterialSuggestionDoc | null {
  let d: Record<string, unknown>;
  try {
    const raw = docSnap.data();
    if (!isPlainObject(raw)) return null;
    d = raw;
  } catch {
    return null;
  }
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name) return null;
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    name,
    description: typeof d.description === "string" ? d.description : undefined,
    suggestedQuantity: typeof d.suggestedQuantity === "number" ? d.suggestedQuantity : undefined,
    unit: parseUnit(d.unit),
    estimatedUnitPrice: typeof d.estimatedUnitPrice === "number" ? d.estimatedUnitPrice : undefined,
    estimatedTotalPrice: typeof d.estimatedTotalPrice === "number" ? d.estimatedTotalPrice : undefined,
    currency: typeof d.currency === "string" ? d.currency : "EUR",
    source: d.source === "ai" ? "ai" : "manual",
    confidence:
      d.confidence === "low" || d.confidence === "medium" || d.confidence === "high"
        ? d.confidence
        : undefined,
    sourceDocumentId: typeof d.sourceDocumentId === "string" ? d.sourceDocumentId : undefined,
    sourceNote: typeof d.sourceNote === "string" ? d.sourceNote : undefined,
    phaseId: typeof d.phaseId === "string" ? d.phaseId : undefined,
    taskId: typeof d.taskId === "string" ? d.taskId : undefined,
    status:
      d.status === "accepted" || d.status === "rejected" ? d.status : "planned",
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    updatedAt: convertTimestamp(d.updatedAt),
    createdBy: (d.createdBy as string) ?? "",
  };
}

function toMaterialDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectMaterialDoc | null {
  let d: Record<string, unknown>;
  try {
    const raw = docSnap.data();
    if (!isPlainObject(raw)) return null;
    d = raw;
  } catch {
    return null;
  }
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const quantity = typeof d.quantity === "number" ? d.quantity : NaN;
  const unit = parseUnit(d.unit);
  if (!name || !Number.isFinite(quantity) || !unit) return null;
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    organizationId: typeof d.organizationId === "string" ? d.organizationId : undefined,
    name,
    quantity,
    unit,
    unitPrice: typeof d.unitPrice === "number" ? d.unitPrice : undefined,
    totalPrice: typeof d.totalPrice === "number" ? d.totalPrice : undefined,
    currency: typeof d.currency === "string" ? d.currency : "EUR",
    supplierName: typeof d.supplierName === "string" ? d.supplierName : undefined,
    receiptUrl: typeof d.receiptUrl === "string" ? d.receiptUrl : undefined,
    phaseId: typeof d.phaseId === "string" ? d.phaseId : undefined,
    taskId: typeof d.taskId === "string" ? d.taskId : undefined,
    usedByUserId: typeof d.usedByUserId === "string" ? d.usedByUserId : undefined,
    usedByName: typeof d.usedByName === "string" ? d.usedByName : undefined,
    usedAt: convertTimestamp(d.usedAt) ?? convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    notes: typeof d.notes === "string" ? d.notes : undefined,
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    updatedAt: convertTimestamp(d.updatedAt),
    createdBy: (d.createdBy as string) ?? "",
    sourceSuggestionId: typeof d.sourceSuggestionId === "string" ? d.sourceSuggestionId : undefined,
  };
}

function requireAuth(): string {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  return uid;
}

export function calculateMaterialTotals(materials: ProjectMaterialDoc[]): MaterialTotals {
  const currency = materials[0]?.currency ?? "EUR";
  const totalPrice = materials.reduce((sum, m) => sum + (m.totalPrice ?? 0), 0);
  return { count: materials.length, totalPrice, currency };
}

export async function listMaterialSuggestions(
  projectId: string,
  readOpts?: SmartReadOptions
): Promise<MaterialSuggestionDoc[]> {
  requireAuth();
  const c = collection(db, paths.projectMaterialSuggestions(projectId));
  const snap = await getDocsSmart(c, readOpts);
  const list = snap.docs
    .map((d) => toSuggestionDoc({ id: d.id, data: d.data.bind(d) }))
    .filter((x): x is MaterialSuggestionDoc => x != null);
  list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return list;
}

export type CreateMaterialSuggestionInput = {
  name: string;
  description?: string;
  suggestedQuantity?: number;
  unit?: MaterialUnit;
  estimatedUnitPrice?: number;
  estimatedTotalPrice?: number;
  currency?: string;
  source?: MaterialSuggestionSource;
  confidence?: MaterialConfidence;
  sourceDocumentId?: string;
  sourceNote?: string;
  phaseId?: string;
  taskId?: string;
};

export async function createMaterialSuggestion(
  projectId: string,
  input: CreateMaterialSuggestionInput
): Promise<MaterialSuggestionDoc> {
  const uid = requireAuth();
  const name = input.name.trim();
  if (!name) throw new Error("Názov materiálu je povinný.");

  const c = collection(db, paths.projectMaterialSuggestions(projectId));
  const ref = await addDoc(c, {
    projectId,
    name,
    description: input.description?.trim() ?? null,
    suggestedQuantity: input.suggestedQuantity ?? null,
    unit: input.unit ?? null,
    estimatedUnitPrice: input.estimatedUnitPrice ?? null,
    estimatedTotalPrice: input.estimatedTotalPrice ?? null,
    currency: input.currency?.trim() || "EUR",
    source: input.source ?? "manual",
    confidence: input.confidence ?? null,
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceNote: input.sourceNote?.trim() ?? null,
    phaseId: input.phaseId ?? null,
    taskId: input.taskId ?? null,
    status: "planned",
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return {
    id: ref.id,
    projectId,
    name,
    description: input.description,
    suggestedQuantity: input.suggestedQuantity,
    unit: input.unit,
    estimatedUnitPrice: input.estimatedUnitPrice,
    estimatedTotalPrice: input.estimatedTotalPrice,
    currency: input.currency?.trim() || "EUR",
    source: input.source ?? "manual",
    confidence: input.confidence,
    sourceDocumentId: input.sourceDocumentId,
    sourceNote: input.sourceNote,
    phaseId: input.phaseId,
    taskId: input.taskId,
    status: "planned",
    createdBy: uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateMaterialSuggestion(
  projectId: string,
  suggestionId: string,
  patch: Partial<CreateMaterialSuggestionInput> & { status?: MaterialSuggestionStatus }
): Promise<void> {
  requireAuth();
  const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.description !== undefined) updateData.description = patch.description?.trim() ?? null;
  if (patch.suggestedQuantity !== undefined) updateData.suggestedQuantity = patch.suggestedQuantity ?? null;
  if (patch.unit !== undefined) updateData.unit = patch.unit ?? null;
  if (patch.estimatedUnitPrice !== undefined) updateData.estimatedUnitPrice = patch.estimatedUnitPrice ?? null;
  if (patch.estimatedTotalPrice !== undefined) updateData.estimatedTotalPrice = patch.estimatedTotalPrice ?? null;
  if (patch.currency !== undefined) updateData.currency = patch.currency?.trim() || "EUR";
  if (patch.confidence !== undefined) updateData.confidence = patch.confidence ?? null;
  if (patch.sourceNote !== undefined) updateData.sourceNote = patch.sourceNote?.trim() ?? null;
  if (patch.status !== undefined) updateData.status = patch.status;
  const ref = doc(db, paths.projectMaterialSuggestion(projectId, suggestionId));
  await updateDoc(ref, updateData);
}

export async function rejectMaterialSuggestion(projectId: string, suggestionId: string): Promise<void> {
  await updateMaterialSuggestion(projectId, suggestionId, { status: "rejected" });
}

/** Mark suggestion accepted after user confirms used material entry. */
export async function acceptMaterialSuggestion(projectId: string, suggestionId: string): Promise<void> {
  await updateMaterialSuggestion(projectId, suggestionId, { status: "accepted" });
}

export async function listProjectMaterials(
  projectId: string,
  readOpts?: SmartReadOptions
): Promise<ProjectMaterialDoc[]> {
  requireAuth();
  const c = collection(db, paths.projectMaterials(projectId));
  const snap = await getDocsSmart(c, readOpts);
  const list = snap.docs
    .map((d) => toMaterialDoc({ id: d.id, data: d.data.bind(d) }))
    .filter((x): x is ProjectMaterialDoc => x != null);
  list.sort((a, b) => (b.usedAt ?? "").localeCompare(a.usedAt ?? ""));
  return list;
}

export type CreateProjectMaterialInput = {
  name: string;
  quantity: number;
  unit: MaterialUnit;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  supplierName?: string;
  receiptUrl?: string;
  phaseId?: string;
  taskId?: string;
  usedAt?: Date;
  notes?: string;
  organizationId?: string;
  sourceSuggestionId?: string;
};

export async function createProjectMaterial(
  projectId: string,
  input: CreateProjectMaterialInput
): Promise<ProjectMaterialDoc> {
  const uid = requireAuth();
  const name = input.name.trim();
  if (!name) throw new Error("Názov materiálu je povinný.");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Množstvo musí byť kladné číslo.");
  }

  const unitPrice = input.unitPrice;
  const totalPrice =
    input.totalPrice ??
    (unitPrice != null && Number.isFinite(unitPrice) ? unitPrice * input.quantity : undefined);
  const usedAt = input.usedAt ?? new Date();
  const currentUser = getAuth()?.currentUser;
  const displayName = currentUser?.displayName ?? currentUser?.email ?? undefined;

  const c = collection(db, paths.projectMaterials(projectId));
  const ref = await addDoc(c, {
    projectId,
    organizationId: input.organizationId ?? null,
    name,
    quantity: input.quantity,
    unit: input.unit,
    unitPrice: unitPrice ?? null,
    totalPrice: totalPrice ?? null,
    currency: input.currency?.trim() || "EUR",
    supplierName: input.supplierName?.trim() ?? null,
    receiptUrl: input.receiptUrl?.trim() ?? null,
    phaseId: input.phaseId ?? null,
    taskId: input.taskId ?? null,
    usedByUserId: uid,
    usedByName: displayName ?? null,
    usedAt: Timestamp.fromDate(usedAt),
    notes: input.notes?.trim() ?? null,
    sourceSuggestionId: input.sourceSuggestionId ?? null,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (input.sourceSuggestionId) {
    try {
      await acceptMaterialSuggestion(projectId, input.sourceSuggestionId);
    } catch (e) {
      if (__DEV__) console.warn("[projectMaterials] accept suggestion after create failed", e);
    }
  }

  return {
    id: ref.id,
    projectId,
    organizationId: input.organizationId,
    name,
    quantity: input.quantity,
    unit: input.unit,
    unitPrice,
    totalPrice,
    currency: input.currency?.trim() || "EUR",
    supplierName: input.supplierName,
    receiptUrl: input.receiptUrl,
    phaseId: input.phaseId,
    taskId: input.taskId,
    usedByUserId: uid,
    usedByName: displayName,
    usedAt: usedAt.toISOString(),
    notes: input.notes,
    createdBy: uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceSuggestionId: input.sourceSuggestionId,
  };
}

export async function updateProjectMaterial(
  projectId: string,
  materialId: string,
  patch: Partial<CreateProjectMaterialInput>
): Promise<void> {
  requireAuth();
  const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.quantity !== undefined) updateData.quantity = patch.quantity;
  if (patch.unit !== undefined) updateData.unit = patch.unit;
  if (patch.unitPrice !== undefined) updateData.unitPrice = patch.unitPrice ?? null;
  if (patch.totalPrice !== undefined) {
    updateData.totalPrice = patch.totalPrice ?? null;
  } else if (patch.quantity !== undefined || patch.unitPrice !== undefined) {
    const snap = await getDoc(doc(db, paths.projectMaterial(projectId, materialId)));
    if (snap.exists()) {
      const d = snap.data();
      const qty = patch.quantity ?? (typeof d?.quantity === "number" ? d.quantity : 0);
      const price = patch.unitPrice ?? (typeof d?.unitPrice === "number" ? d.unitPrice : undefined);
      if (price != null) updateData.totalPrice = qty * price;
    }
  }
  if (patch.currency !== undefined) updateData.currency = patch.currency?.trim() || "EUR";
  if (patch.supplierName !== undefined) updateData.supplierName = patch.supplierName?.trim() ?? null;
  if (patch.receiptUrl !== undefined) updateData.receiptUrl = patch.receiptUrl?.trim() ?? null;
  if (patch.notes !== undefined) updateData.notes = patch.notes?.trim() ?? null;
  if (patch.usedAt !== undefined) updateData.usedAt = Timestamp.fromDate(patch.usedAt);
  const ref = doc(db, paths.projectMaterial(projectId, materialId));
  await updateDoc(ref, updateData);
}

export async function deleteProjectMaterial(projectId: string, materialId: string): Promise<void> {
  requireAuth();
  await deleteDoc(doc(db, paths.projectMaterial(projectId, materialId)));
}

const EXPENSE_ATTACHMENT_NOTE_PREFIX = "expense_attachment:";

/** Count existing material rows linked to an expense attachment (dedup guard). */
export async function findExistingMaterialNamesForAttachment(
  projectId: string,
  attachmentId: string
): Promise<{ suggestionCount: number; materialCount: number; suggestionNames: Set<string>; materialNames: Set<string> }> {
  requireAuth();
  const aid = attachmentId.trim();
  const [suggestions, materials] = await Promise.all([
    listMaterialSuggestions(projectId),
    listProjectMaterials(projectId),
  ]);
  const linkedSuggestions = suggestions.filter((s) => s.sourceDocumentId === aid);
  const linkedMaterials = materials.filter(
    (m) => m.notes?.includes(`${EXPENSE_ATTACHMENT_NOTE_PREFIX}${aid}`) ?? false
  );
  return {
    suggestionCount: linkedSuggestions.length,
    materialCount: linkedMaterials.length,
    suggestionNames: new Set(linkedSuggestions.map((s) => s.name.trim().toLowerCase())),
    materialNames: new Set(linkedMaterials.map((m) => m.name.trim().toLowerCase())),
  };
}

export { MATERIAL_UNITS };
