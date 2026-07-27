/**
 * Workspace-scoped customers — aligned with staveto-office `lib/customers.ts`.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "../lib/rnFirestore";
import { db, getAuth } from "../firebase";

export type CustomerType = "person" | "company";

export type CustomerDoc = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: CustomerType;
  customerType?: CustomerType;
  companyName?: string;
  contactPersonName?: string;
  ico?: string;
  taxId?: string;
  vatId?: string;
  address?: string;
  addressText?: string;
  ownerId?: string;
  orgId?: string;
  workspaceType?: "personal" | "team";
  workspaceId?: string;
};

export type CreateCustomerInput = {
  name: string;
  email?: string;
  phone?: string;
  type: CustomerType;
  companyName?: string;
  contactPersonName?: string;
  ico?: string;
  taxId?: string;
  vatId?: string;
  address?: string;
  addressText?: string;
};

export type ProjectCustomerFields = {
  customerId?: string;
  customerName?: string;
  customerCompanyName?: string;
  customerContactPersonName?: string;
  customerEmail?: string;
  customerPhone?: string;
};

function toCustomerDoc(id: string, data: Record<string, unknown>): CustomerDoc {
  const type: CustomerType =
    data.customerType === "company" || data.type === "company" ? "company" : "person";
  const addressRaw =
    (typeof data.addressText === "string" ? data.addressText : undefined) ||
    (typeof data.address === "string" ? data.address : undefined);
  const vatRaw =
    (typeof data.vatId === "string" ? data.vatId : undefined) ||
    (typeof data.taxId === "string" ? data.taxId : undefined);

  return {
    id,
    name: String(data.name ?? "").trim(),
    email: data.email ? String(data.email).trim() : undefined,
    phone: data.phone ? String(data.phone).trim() : undefined,
    type,
    customerType:
      data.customerType === "company" || data.customerType === "person"
        ? data.customerType
        : type,
    companyName: data.companyName ? String(data.companyName).trim() : undefined,
    contactPersonName: data.contactPersonName
      ? String(data.contactPersonName).trim()
      : undefined,
    ico: data.ico ? String(data.ico).trim() : undefined,
    taxId: vatRaw ? String(vatRaw).trim() : undefined,
    vatId: vatRaw ? String(vatRaw).trim() : undefined,
    address: addressRaw ? String(addressRaw).trim() : undefined,
    addressText: addressRaw ? String(addressRaw).trim() : undefined,
    ownerId: data.ownerId ? String(data.ownerId) : undefined,
    orgId: data.orgId ? String(data.orgId) : undefined,
    workspaceType: data.workspaceType as CustomerDoc["workspaceType"],
    workspaceId: data.workspaceId ? String(data.workspaceId) : undefined,
  };
}

function normalizeKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function sortCustomersByName(list: CustomerDoc[]): CustomerDoc[] {
  return [...list].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function isMissingIndexError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  const message = String((err as { message?: string })?.message ?? "").toLowerCase();
  return (
    code === "failed-precondition" ||
    message.includes("index") ||
    message.includes("requires an index")
  );
}

async function queryCustomers(
  filters: Array<ReturnType<typeof where>>,
  withOrderBy: boolean
): Promise<CustomerDoc[]> {
  const customersRef = collection(db, "customers");
  const snap = await getDocs(
    withOrderBy
      ? query(customersRef, ...filters, orderBy("name", "asc"), limit(200))
      : query(customersRef, ...filters, limit(200))
  );
  return snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) =>
    toCustomerDoc(d.id, d.data())
  );
}

export function getCustomerDisplayName(c: CustomerDoc): string {
  if (c.type === "company" || c.customerType === "company") {
    return c.companyName?.trim() || c.name?.trim() || "";
  }
  return c.name?.trim() || "";
}

export function projectCustomerFieldsFromDoc(c: CustomerDoc): ProjectCustomerFields {
  const isCompany = c.type === "company" || c.customerType === "company";
  return {
    customerId: c.id,
    customerName: getCustomerDisplayName(c) || undefined,
    customerCompanyName: isCompany ? c.companyName?.trim() || c.name.trim() : undefined,
    customerContactPersonName: isCompany ? c.contactPersonName?.trim() : undefined,
    customerEmail: c.email,
    customerPhone: c.phone,
  };
}

export function projectCustomerFieldsFromNewInput(
  customerId: string,
  input: CreateCustomerInput
): ProjectCustomerFields {
  if (input.type === "company") {
    return {
      customerId,
      customerName: input.companyName?.trim() || input.name.trim(),
      customerCompanyName: input.companyName?.trim() || input.name.trim(),
      customerContactPersonName: input.contactPersonName?.trim(),
      customerEmail: input.email?.trim() || undefined,
      customerPhone: input.phone?.trim() || undefined,
    };
  }
  return {
    customerId,
    customerName: input.name.trim(),
    customerEmail: input.email?.trim() || undefined,
    customerPhone: input.phone?.trim() || undefined,
  };
}

/**
 * List customers for the signed-in user.
 * Personal workspace: ownerId == uid.
 * Company workspace: orgId == activeBusinessOrgId when provided.
 */
export async function listCustomersForUser(opts?: {
  orgId?: string | null;
}): Promise<CustomerDoc[]> {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) return [];

  try {
    const orgId = opts?.orgId?.trim();
    if (orgId) {
      try {
        return await queryCustomers([where("orgId", "==", orgId)], true);
      } catch (err) {
        if (!isMissingIndexError(err)) throw err;
        return sortCustomersByName(await queryCustomers([where("orgId", "==", orgId)], false));
      }
    }

    try {
      return await queryCustomers([where("ownerId", "==", uid)], true);
    } catch (err) {
      if (!isMissingIndexError(err)) throw err;
      return sortCustomersByName(await queryCustomers([where("ownerId", "==", uid)], false));
    }
  } catch {
    return [];
  }
}

export async function getCustomer(customerId: string): Promise<CustomerDoc | null> {
  const snap = await getDoc(doc(db, "customers", customerId));
  return snap.exists()
    ? toCustomerDoc(snap.id, snap.data() as Record<string, unknown>)
    : null;
}

async function findDuplicateCustomer(
  list: CustomerDoc[],
  input: CreateCustomerInput
): Promise<CustomerDoc | null> {
  const nameKey = normalizeKey(input.name);
  const companyKey = normalizeKey(input.companyName);
  const emailKey = normalizeKey(input.email);
  const phoneKey = normalizeKey(input.phone)?.replace(/\s+/g, "");

  for (const c of list) {
    if (emailKey && normalizeKey(c.email) === emailKey) return c;
    if (phoneKey && normalizeKey(c.phone)?.replace(/\s+/g, "") === phoneKey) return c;
    if (companyKey && normalizeKey(c.companyName) === companyKey) return c;
    if (nameKey && normalizeKey(c.name) === nameKey) return c;
  }
  return null;
}

export async function createCustomer(
  input: CreateCustomerInput,
  opts?: { orgId?: string | null }
): Promise<string> {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený na vytvorenie kontaktu.");

  const name = input.name.trim();
  if (!name) throw new Error("Meno kontaktu je povinné.");
  if (input.type === "company" && !input.contactPersonName?.trim()) {
    throw new Error("Kontaktná osoba je povinná pre firmu.");
  }

  const existing = await listCustomersForUser(opts);
  const duplicate = await findDuplicateCustomer(existing, input);
  if (duplicate) return duplicate.id;

  const addressText = (input.addressText ?? input.address)?.trim() || null;
  const vatId = (input.vatId ?? input.taxId)?.trim() || null;
  const companyName =
    input.type === "company" ? input.companyName?.trim() || name : null;
  const contactPersonName =
    input.type === "company" ? input.contactPersonName?.trim() || null : null;

  const orgId = opts?.orgId?.trim() || null;
  const workspaceFields = orgId
    ? {
        ownerId: uid,
        orgId,
        workspaceType: "team" as const,
        workspaceId: orgId,
      }
    : {
        ownerId: uid,
        workspaceType: "personal" as const,
        workspaceId: uid,
      };

  const ref = await addDoc(collection(db, "customers"), {
    name,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    type: input.type,
    customerType: input.type,
    companyName,
    contactPersonName,
    ico: input.ico?.trim() || null,
    taxId: vatId,
    vatId,
    address: addressText,
    addressText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...workspaceFields,
  });

  return ref.id;
}
