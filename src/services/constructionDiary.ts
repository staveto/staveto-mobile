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
  getDoc,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { ConstructionDiaryEntry } from "../lib/types";
import { addProjectEvent } from "./projectEvents";

export type DiaryEntryDoc = {
  id: string;
  projectId: string;
  date: string; // ISO string
  weather?: string;
  workers?: string;
  workDescription: string;
  materials?: string;
  notes?: string;
  phaseId?: string | null;
  attachments?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): DiaryEntryDoc {
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
    date: convertTimestamp(d.date) ?? new Date().toISOString(),
    weather: (d.weather as string) ?? undefined,
    workers: (d.workers as string) ?? undefined,
    workDescription: (d.workDescription as string) ?? "",
    materials: (d.materials as string) ?? undefined,
    notes: (d.notes as string) ?? undefined,
    phaseId: (d.phaseId as string | null) ?? undefined,
    attachments: (d.attachments as string[]) ?? undefined,
    createdBy: (d.createdBy as string) ?? "",
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    updatedAt: convertTimestamp(d.updatedAt),
  };
}

export async function createDiaryEntry(
  ownerId: string,
  projectId: string,
  data: {
    date: Date;
    weather?: string;
    workers?: string;
    workDescription: string;
    materials?: string;
    notes?: string;
    phaseId?: string | null;
    attachments?: string[];
  }
): Promise<DiaryEntryDoc> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vytvorenie zápisu do denníka.');
  }
  
  if (currentUser.uid !== ownerId) {
    throw new Error('Nemáte oprávnenie vytvoriť zápis do denníka.');
  }
  
  const c = collection(db, paths.constructionDiary(projectId));
  const ref = await addDoc(c, {
    ownerId,
    projectId,
    date: Timestamp.fromDate(data.date),
    weather: data.weather ?? null,
    workers: data.workers ?? null,
    workDescription: data.workDescription.trim(),
    materials: data.materials ?? null,
    notes: data.notes?.trim() ?? null,
    phaseId: data.phaseId ?? null,
    attachments: data.attachments ?? [],
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await addProjectEvent(
      projectId,
      "diary_added",
      {},
      { kind: "diary", id: ref.id }
    );
  } catch (error) {
    console.warn("[constructionDiary] Failed to create project event:", error);
  }
  
  console.log(`[constructionDiary] Created entry ${ref.id} in project ${projectId}`);
  
  return {
    id: ref.id,
    projectId,
    date: data.date.toISOString(),
    weather: data.weather,
    workers: data.workers,
    workDescription: data.workDescription.trim(),
    materials: data.materials,
    notes: data.notes,
    phaseId: data.phaseId,
    attachments: data.attachments,
    createdBy: currentUser.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listDiaryEntries(projectId: string): Promise<DiaryEntryDoc[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na načítanie zápisov denníka.');
  }
  
  const c = collection(db, paths.constructionDiary(projectId));
  const q = query(c, orderBy("date", "desc"));
  const snap = await getDocs(q);
  
  return snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));
}

export async function updateDiaryEntry(
  projectId: string,
  entryId: string,
  data: {
    date?: Date;
    weather?: string;
    workers?: string;
    workDescription?: string;
    materials?: string;
    notes?: string;
    phaseId?: string | null;
    attachments?: string[];
  }
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na úpravu zápisu denníka.');
  }
  
  const updateData: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  
  if (data.date !== undefined) {
    updateData.date = Timestamp.fromDate(data.date);
  }
  if (data.weather !== undefined) updateData.weather = data.weather ?? null;
  if (data.workers !== undefined) updateData.workers = data.workers ?? null;
  if (data.workDescription !== undefined) updateData.workDescription = data.workDescription.trim();
  if (data.materials !== undefined) updateData.materials = data.materials ?? null;
  if (data.notes !== undefined) updateData.notes = data.notes?.trim() ?? null;
  if (data.phaseId !== undefined) updateData.phaseId = data.phaseId ?? null;
  if (data.attachments !== undefined) updateData.attachments = data.attachments ?? [];
  
  const ref = doc(db, paths.constructionDiaryEntry(projectId, entryId));
  await updateDoc(ref, updateData);
  
  console.log(`[constructionDiary] Updated entry ${entryId} in project ${projectId}`);
}

export async function deleteDiaryEntry(projectId: string, entryId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vymazanie zápisu denníka.');
  }
  
  const ref = doc(db, paths.constructionDiaryEntry(projectId, entryId));
  await deleteDoc(ref);
  
  console.log(`[constructionDiary] Deleted entry ${entryId} from project ${projectId}`);
}
