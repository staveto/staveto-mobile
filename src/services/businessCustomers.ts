/**
 * Organization-scoped customers (Staveto Business CRM).
 * Path: organizations/{orgId}/customers/{customerId}
 *
 * MUST NOT touch AuthContext.orgId — use activeBusinessOrgId from BusinessContext.
 */

import {
  addDoc,
  collection,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart } from "./firestoreSmartRead";
import { db, getAuth } from "../firebase";
import { paths } from "../lib/firestorePaths";

export type BusinessCustomer = {
  id: string;
  orgId: string;
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  archivedAt?: unknown | null;
};

export type BusinessCustomerInput = {
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

export type BusinessCustomerPatch = Partial<
  Pick<BusinessCustomer, "displayName" | "companyName" | "email" | "phone" | "address" | "notes">
>;

function requireSignedInUid(): string {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  return uid;
}

function trimOpt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function parseBusinessCustomer(
  customerId: string,
  orgId: string,
  raw: Record<string, unknown>
): BusinessCustomer | null {
  const displayName = trimOpt(raw.displayName);
  if (!displayName) return null;
  const createdBy = typeof raw.createdBy === "string" ? raw.createdBy : "";
  if (!createdBy) return null;

  return {
    id: customerId,
    orgId,
    displayName,
    companyName: trimOpt(raw.companyName),
    email: trimOpt(raw.email),
    phone: trimOpt(raw.phone),
    address: trimOpt(raw.address),
    notes: trimOpt(raw.notes),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdBy,
    archivedAt: raw.archivedAt ?? null,
  };
}

function isArchived(customer: BusinessCustomer): boolean {
  return customer.archivedAt != null && customer.archivedAt !== "";
}

function sortByDisplayName(a: BusinessCustomer, b: BusinessCustomer): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

export async function listBusinessCustomers(
  orgId: string,
  options?: { includeArchived?: boolean }
): Promise<BusinessCustomer[]> {
  if (typeof orgId !== "string" || orgId.trim().length === 0) return [];
  requireSignedInUid();

  const col = collection(db, paths.organizationCustomers(orgId));
  const q = query(col, orderBy("displayName"));
  const snap = await getDocsSmart(q);
  const includeArchived = options?.includeArchived === true;
  const out: BusinessCustomer[] = [];

  for (const d of snap.docs) {
    const raw = d.data();
    if (!raw || typeof raw !== "object") continue;
    const parsed = parseBusinessCustomer(d.id, orgId, raw as Record<string, unknown>);
    if (!parsed) continue;
    if (!includeArchived && isArchived(parsed)) continue;
    out.push(parsed);
  }

  out.sort(sortByDisplayName);
  if (__DEV__) {
    console.log(`[businessCustomers] listBusinessCustomers: ${out.length} for org ${orgId}`);
  }
  return out;
}

export async function getBusinessCustomer(
  orgId: string,
  customerId: string
): Promise<BusinessCustomer | null> {
  if (!orgId?.trim() || !customerId?.trim()) return null;
  requireSignedInUid();

  const ref = doc(db, paths.organizationCustomer(orgId, customerId));
  const snap = await getDocSmart(ref);
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (!raw || typeof raw !== "object") return null;
  return parseBusinessCustomer(customerId, orgId, raw as Record<string, unknown>);
}

export async function createBusinessCustomer(
  orgId: string,
  input: BusinessCustomerInput
): Promise<string> {
  const normalizedOrgId = orgId?.trim();
  if (!normalizedOrgId) throw new Error("Chýba identifikátor firmy.");
  const displayName = input.displayName?.trim();
  if (!displayName) throw new Error("Zadajte meno zákazníka.");

  const uid = requireSignedInUid();
  const payload: Record<string, unknown> = {
    displayName,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    archivedAt: null,
  };

  const companyName = trimOpt(input.companyName);
  const email = trimOpt(input.email);
  const phone = trimOpt(input.phone);
  const address = trimOpt(input.address);
  const notes = trimOpt(input.notes);
  if (companyName) payload.companyName = companyName;
  if (email) payload.email = email;
  if (phone) payload.phone = phone;
  if (address) payload.address = address;
  if (notes) payload.notes = notes;

  const col = collection(db, paths.organizationCustomers(normalizedOrgId));
  const ref = await addDoc(col, payload);
  if (__DEV__) {
    console.log(`[businessCustomers] createBusinessCustomer: ${ref.id} org=${normalizedOrgId}`);
  }
  return ref.id;
}

export async function updateBusinessCustomer(
  orgId: string,
  customerId: string,
  patch: BusinessCustomerPatch
): Promise<void> {
  if (!orgId?.trim() || !customerId?.trim()) throw new Error("Chýba zákazník alebo firma.");
  requireSignedInUid();

  const displayName = patch.displayName?.trim();
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (displayName !== undefined) {
    if (!displayName) throw new Error("Zadajte meno zákazníka.");
    updatePayload.displayName = displayName;
  }
  if (patch.companyName !== undefined) {
    const v = trimOpt(patch.companyName);
    updatePayload.companyName = v ?? null;
  }
  if (patch.email !== undefined) {
    const v = trimOpt(patch.email);
    updatePayload.email = v ?? null;
  }
  if (patch.phone !== undefined) {
    const v = trimOpt(patch.phone);
    updatePayload.phone = v ?? null;
  }
  if (patch.address !== undefined) {
    const v = trimOpt(patch.address);
    updatePayload.address = v ?? null;
  }
  if (patch.notes !== undefined) {
    const v = trimOpt(patch.notes);
    updatePayload.notes = v ?? null;
  }

  const ref = doc(db, paths.organizationCustomer(orgId, customerId));
  await updateDoc(ref, updatePayload);
}

export async function archiveBusinessCustomer(orgId: string, customerId: string): Promise<void> {
  if (!orgId?.trim() || !customerId?.trim()) throw new Error("Chýba zákazník alebo firma.");
  requireSignedInUid();

  const ref = doc(db, paths.organizationCustomer(orgId, customerId));
  await updateDoc(ref, {
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
