import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";

export type ProjectUpdateStatus = "pending" | "approved" | "ignored";

export type ProjectUpdateDoc = {
  id: string;
  projectId: string;
  supplierId?: string | null;
  status: ProjectUpdateStatus;
  messageText?: string | null;
  fromPhoneE164?: string | null;
  sourceMessageId?: string | null;
  media?: { storagePath: string; mimeType?: string; size?: number; fileName?: string }[];
  createdAt?: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
};

function toDoc(projectId: string, docSnap: { id: string; data: () => Record<string, unknown> }): ProjectUpdateDoc {
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
    projectId,
    supplierId: (d.supplierId as string | null) ?? undefined,
    status: (d.status as ProjectUpdateStatus) ?? "pending",
    messageText: (d.messageText as string | null) ?? undefined,
    fromPhoneE164: (d.fromPhoneE164 as string | null) ?? undefined,
    sourceMessageId: (d.sourceMessageId as string | null) ?? undefined,
    media: (d.media as ProjectUpdateDoc["media"]) ?? undefined,
    createdAt: toIso(d.createdAt),
    decidedBy: (d.decision?.decidedBy as string | null) ?? undefined,
    decidedAt: toIso(d.decision?.decidedAt),
  };
}

export async function listUpdates(projectId: string, status: ProjectUpdateStatus): Promise<ProjectUpdateDoc[]> {
  const q = query(collection(db, "projects", projectId, "updates"), where("status", "==", status));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toDoc(projectId, { id: d.id, data: d.data.bind(d) }));
}

export async function approveUpdate(projectId: string, updateId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  await updateDoc(doc(db, "projects", projectId, "updates", updateId), {
    status: "approved",
    decision: { decidedBy: uid ?? null, decidedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}

export async function ignoreUpdate(projectId: string, updateId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  await updateDoc(doc(db, "projects", projectId, "updates", updateId), {
    status: "ignored",
    decision: { decidedBy: uid ?? null, decidedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}
