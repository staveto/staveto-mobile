import {
  collection,
  addDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from "../lib/rnFirestore";
import { db } from "../firebase";
import type { ContractorDoc } from "./contractors";

export type ProjectSupplierDoc = {
  id: string;
  contractorId: string;
  phoneE164: string;
  displayNameSnapshot: string;
  status: "active" | "inactive";
  createdAt?: string;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectSupplierDoc {
  const d = docSnap.data();
  const toIso = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    if (typeof ts === "object" && ts !== null && "toDate" in ts) {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  return {
    id: docSnap.id,
    contractorId: (d.contractorId as string) ?? "",
    phoneE164: (d.phoneE164 as string) ?? "",
    displayNameSnapshot: (d.displayNameSnapshot as string) ?? "",
    status: (d.status as "active" | "inactive") ?? "active",
    createdAt: toIso(d.createdAt),
  };
}

export async function listProjectSuppliers(projectId: string): Promise<ProjectSupplierDoc[]> {
  const q = query(collection(db, "projects", projectId, "suppliers"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
}

export async function addSupplierToProject(
  projectId: string,
  contractor: ContractorDoc
): Promise<ProjectSupplierDoc> {
  const ref = await addDoc(collection(db, "projects", projectId, "suppliers"), {
    contractorId: contractor.id,
    phoneE164: contractor.phoneE164,
    displayNameSnapshot: contractor.displayName,
    status: "active",
    createdAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    contractorId: contractor.id,
    phoneE164: contractor.phoneE164,
    displayNameSnapshot: contractor.displayName,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}
