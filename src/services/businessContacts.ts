/**
 * Organization-scoped contacts (Staveto Business CRM).
 * Path: organizations/{orgId}/contacts/{contactId}
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

export const BUSINESS_CONTACT_TYPES = [
  "customer",
  "supplier",
  "subcontractor",
  "architect",
  "authority",
  "other",
] as const;

export type BusinessContactType = (typeof BUSINESS_CONTACT_TYPES)[number];

export type BusinessContact = {
  id: string;
  orgId: string;
  displayName: string;
  companyName?: string;
  contactType: BusinessContactType;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  archivedAt?: unknown | null;
};

export type BusinessContactInput = {
  displayName: string;
  companyName?: string;
  contactType?: BusinessContactType;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

export type BusinessContactPatch = Partial<
  Pick<
    BusinessContact,
    "displayName" | "companyName" | "contactType" | "email" | "phone" | "address" | "notes"
  >
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

function normalizeContactType(raw: unknown): BusinessContactType {
  if (typeof raw === "string" && (BUSINESS_CONTACT_TYPES as readonly string[]).includes(raw)) {
    return raw as BusinessContactType;
  }
  return "customer";
}

function parseBusinessContact(
  contactId: string,
  orgId: string,
  raw: Record<string, unknown>
): BusinessContact | null {
  const displayName = trimOpt(raw.displayName);
  if (!displayName) return null;
  const createdBy = typeof raw.createdBy === "string" ? raw.createdBy : "";
  if (!createdBy) return null;

  return {
    id: contactId,
    orgId,
    displayName,
    companyName: trimOpt(raw.companyName),
    contactType: normalizeContactType(raw.contactType),
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

function isArchived(contact: BusinessContact): boolean {
  return contact.archivedAt != null && contact.archivedAt !== "";
}

function sortByDisplayName(a: BusinessContact, b: BusinessContact): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

export async function listBusinessContacts(
  orgId: string,
  options?: { includeArchived?: boolean; contactType?: BusinessContactType }
): Promise<BusinessContact[]> {
  if (typeof orgId !== "string" || orgId.trim().length === 0) return [];
  requireSignedInUid();

  const col = collection(db, paths.organizationContacts(orgId));
  const q = query(col, orderBy("displayName"));
  const snap = await getDocsSmart(q);
  const includeArchived = options?.includeArchived === true;
  const typeFilter = options?.contactType;
  const out: BusinessContact[] = [];

  for (const d of snap.docs) {
    const raw = d.data();
    if (!raw || typeof raw !== "object") continue;
    const parsed = parseBusinessContact(d.id, orgId, raw as Record<string, unknown>);
    if (!parsed) continue;
    if (!includeArchived && isArchived(parsed)) continue;
    if (typeFilter && parsed.contactType !== typeFilter) continue;
    out.push(parsed);
  }

  out.sort(sortByDisplayName);
  if (__DEV__) {
    console.log(`[businessContacts] listBusinessContacts: ${out.length} for org ${orgId}`);
  }
  return out;
}

export async function getBusinessContact(
  orgId: string,
  contactId: string
): Promise<BusinessContact | null> {
  if (!orgId?.trim() || !contactId?.trim()) return null;
  requireSignedInUid();

  const ref = doc(db, paths.organizationContact(orgId, contactId));
  const snap = await getDocSmart(ref);
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (!raw || typeof raw !== "object") return null;
  return parseBusinessContact(contactId, orgId, raw as Record<string, unknown>);
}

export async function createBusinessContact(
  orgId: string,
  input: BusinessContactInput
): Promise<string> {
  const normalizedOrgId = orgId?.trim();
  if (!normalizedOrgId) throw new Error("Chýba identifikátor firmy.");
  const displayName = input.displayName?.trim();
  if (!displayName) throw new Error("Zadajte meno kontaktu.");

  const uid = requireSignedInUid();
  const contactType = normalizeContactType(input.contactType ?? "customer");
  const payload: Record<string, unknown> = {
    displayName,
    contactType,
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

  const col = collection(db, paths.organizationContacts(normalizedOrgId));
  const ref = await addDoc(col, payload);
  if (__DEV__) {
    console.log(`[businessContacts] createBusinessContact: ${ref.id} org=${normalizedOrgId}`);
  }
  return ref.id;
}

export async function updateBusinessContact(
  orgId: string,
  contactId: string,
  patch: BusinessContactPatch
): Promise<void> {
  if (!orgId?.trim() || !contactId?.trim()) throw new Error("Chýba kontakt alebo firma.");
  requireSignedInUid();

  const displayName = patch.displayName?.trim();
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (displayName !== undefined) {
    if (!displayName) throw new Error("Zadajte meno kontaktu.");
    updatePayload.displayName = displayName;
  }
  if (patch.contactType !== undefined) {
    updatePayload.contactType = normalizeContactType(patch.contactType);
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

  const ref = doc(db, paths.organizationContact(orgId, contactId));
  await updateDoc(ref, updatePayload);
}

export async function archiveBusinessContact(orgId: string, contactId: string): Promise<void> {
  if (!orgId?.trim() || !contactId?.trim()) throw new Error("Chýba kontakt alebo firma.");
  requireSignedInUid();

  const ref = doc(db, paths.organizationContact(orgId, contactId));
  await updateDoc(ref, {
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
