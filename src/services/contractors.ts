import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  query,
  Timestamp,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { normalizePhone } from "../lib/phone";

export type ContractorDoc = {
  id: string;
  displayName: string;
  phoneE164: string;
  phoneRaw?: string;
  email?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ContractorDoc {
  const d = docSnap.data();
  const toIso = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  return {
    id: docSnap.id,
    displayName: (d.displayName as string) ?? "",
    phoneE164: (d.phoneE164 as string) ?? "",
    phoneRaw: (d.phoneRaw as string) ?? undefined,
    email: (d.email as string) ?? undefined,
    note: (d.note as string) ?? undefined,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

function contractorsPath(uid: string) {
  return collection(db, "users", uid, "contractors");
}

export async function listContractors(uid: string): Promise<ContractorDoc[]> {
  const q = query(contractorsPath(uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
}

export async function getContractor(uid: string, contractorId: string): Promise<ContractorDoc | null> {
  const snap = await getDoc(doc(db, "users", uid, "contractors", contractorId));
  return snap.exists() ? toDoc({ id: snap.id, data: snap.data.bind(snap) }) : null;
}

export async function createContractor(
  data: { displayName: string; phone: string; email?: string; note?: string },
  defaultRegion: string
): Promise<ContractorDoc> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const phoneE164 = normalizePhone(data.phone, defaultRegion);
  const ref = await addDoc(contractorsPath(uid), {
    displayName: data.displayName.trim(),
    phoneE164,
    phoneRaw: data.phone.trim(),
    email: data.email?.trim() ?? null,
    note: data.note?.trim() ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    displayName: data.displayName.trim(),
    phoneE164,
    phoneRaw: data.phone.trim(),
    email: data.email?.trim(),
    note: data.note?.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateContractor(
  contractorId: string,
  data: { displayName?: string; phone?: string; email?: string; note?: string },
  defaultRegion: string
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (data.displayName !== undefined) update.displayName = data.displayName.trim();
  if (data.phone !== undefined) {
    update.phoneRaw = data.phone.trim();
    update.phoneE164 = normalizePhone(data.phone, defaultRegion);
  }
  if (data.email !== undefined) update.email = data.email?.trim() ?? null;
  if (data.note !== undefined) update.note = data.note?.trim() ?? null;
  await updateDoc(doc(db, "users", uid, "contractors", contractorId), update);
}

export async function deleteContractor(contractorId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  await deleteDoc(doc(db, "users", uid, "contractors", contractorId));
}
