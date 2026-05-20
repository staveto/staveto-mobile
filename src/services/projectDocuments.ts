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
import { getDocSmart, getDocsSmart, type SmartReadOptions } from "./firestoreSmartRead";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { isPlainObject } from "../utils/isPlainObject";
import type { ProjectDocument } from "../lib/types";
import * as attachmentsService from "./attachments";

export type ProjectDocumentDoc = {
  id: string;
  projectId: string;
  name: string;
  type: 'plan' | 'permit' | 'contract' | 'report' | 'other';
  description?: string;
  attachmentId: string;
  phaseId?: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt?: string;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectDocumentDoc | null {
  let d: Record<string, unknown>;
  try {
    const raw = docSnap.data();
    if (!isPlainObject(raw)) {
      if (__DEV__) console.warn(`[projectDocuments] toDoc: missing or invalid data for doc ${docSnap.id}`);
      return null;
    }
    d = raw;
  } catch (e) {
    if (__DEV__) console.warn(`[projectDocuments] toDoc: data() failed for ${docSnap.id}`, e);
    return null;
  }

  const convertTimestamp = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) {
      return ts.toDate().toISOString();
    }
    if (typeof ts === 'string') {
      return ts;
    }
    if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    name: (d.name as string) ?? "",
    type: (d.type as 'plan' | 'permit' | 'contract' | 'report' | 'other') ?? 'other',
    description: (d.description as string) ?? undefined,
    attachmentId: (d.attachmentId as string) ?? "",
    phaseId: (d.phaseId as string | null) ?? undefined,
    uploadedBy: (d.uploadedBy as string) ?? "",
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    updatedAt: convertTimestamp(d.updatedAt),
  };
}

export async function createProjectDocument(
  ownerId: string,
  projectId: string,
  data: {
    name: string;
    type: 'plan' | 'permit' | 'contract' | 'report' | 'other';
    description?: string;
    attachmentId: string; // Attachment must be uploaded first
    phaseId?: string | null;
  }
): Promise<ProjectDocumentDoc> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vytvorenie dokumentu.');
  }
  
  if (currentUser.uid !== ownerId) {
    throw new Error('Nemáte oprávnenie vytvoriť dokument.');
  }
  
  // Verify attachment exists
  try {
    const attachmentRef = doc(db, paths.projectAttachment(projectId, data.attachmentId));
    const attachmentSnap = await getDocSmart(attachmentRef);
    if (!attachmentSnap.exists()) {
      throw new Error('Príloha neexistuje.');
    }
  } catch (error: any) {
    throw new Error(`Chyba pri overovaní prílohy: ${error.message}`);
  }
  
  const c = collection(db, paths.projectDocuments(projectId));
  const ref = await addDoc(c, {
    ownerId,
    projectId,
    name: data.name.trim(),
    type: data.type,
    description: data.description?.trim() ?? null,
    attachmentId: data.attachmentId,
    phaseId: data.phaseId ?? null,
    uploadedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  console.log(`[projectDocuments] Created document ${ref.id} in project ${projectId}`);
  
  return {
    id: ref.id,
    projectId,
    name: data.name.trim(),
    type: data.type,
    description: data.description,
    attachmentId: data.attachmentId,
    phaseId: data.phaseId,
    uploadedBy: currentUser.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listProjectDocuments(
  projectId: string,
  readOpts?: SmartReadOptions
): Promise<ProjectDocumentDoc[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error("Musíte byť prihlásený na načítanie dokumentov.");
  }

  const c = collection(db, paths.projectDocuments(projectId));
  const snap = await getDocsSmart(c, readOpts);

  const list = snap.docs
    .map((d) => {
      try {
        return toDoc({ id: d.id, data: d.data.bind(d) });
      } catch (e) {
        if (__DEV__) console.warn(`[projectDocuments] listProjectDocuments: skip doc ${d.id}`, e);
        return null;
      }
    })
    .filter((x): x is ProjectDocumentDoc => x != null);
  list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return list;
}

export async function updateProjectDocument(
  projectId: string,
  documentId: string,
  data: {
    name?: string;
    type?: 'plan' | 'permit' | 'contract' | 'report' | 'other';
    description?: string;
    phaseId?: string | null;
  }
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na úpravu dokumentu.');
  }
  
  const updateData: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.type !== undefined) updateData.type = data.type;
  if (data.description !== undefined) updateData.description = data.description?.trim() ?? null;
  if (data.phaseId !== undefined) updateData.phaseId = data.phaseId ?? null;
  
  const ref = doc(db, paths.projectDocument(projectId, documentId));
  await updateDoc(ref, updateData);
  
  console.log(`[projectDocuments] Updated document ${documentId} in project ${projectId}`);
}

export async function deleteProjectDocument(projectId: string, documentId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vymazanie dokumentu.');
  }
  
  // Get document to delete attachment
  const docRef = doc(db, paths.projectDocument(projectId, documentId));
  const docSnap = await getDocSmart(docRef);
  
  if (docSnap.exists()) {
    const data = docSnap.data();
    if (!isPlainObject(data)) {
      console.warn(`[projectDocuments] deleteProjectDocument: invalid doc data for ${documentId}, skipping attachment cleanup`);
    } else {
      const attachmentId = typeof data.attachmentId === "string" ? data.attachmentId : "";

      if (attachmentId) {
        try {
          const attachmentRef = doc(db, paths.projectAttachment(projectId, attachmentId));
          const attachmentSnap = await getDocSmart(attachmentRef);
          if (attachmentSnap.exists()) {
            const attachmentRaw = attachmentSnap.data();
            const attachmentData = isPlainObject(attachmentRaw) ? attachmentRaw : {};
            const storagePath =
              typeof attachmentData.storagePath === "string" ? attachmentData.storagePath : "";
            if (storagePath) {
              await attachmentsService.deleteAttachment(projectId, attachmentId, storagePath);
            }
          }
        } catch (error: any) {
          console.error(`[projectDocuments] Error deleting attachment:`, error);
        }
      }
    }
  }
  
  // Delete document
  await deleteDoc(docRef);
  
  console.log(`[projectDocuments] Deleted document ${documentId} from project ${projectId}`);
}
