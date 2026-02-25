import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  updateDoc,
  orderBy,
  serverTimestamp,
  Timestamp,
  limit,
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";

export type ProblemStatus = "open" | "in_progress" | "fixed" | "verified" | "rejected";
export type ProblemPriority = "low" | "medium" | "high";

export type ProblemCategory =
  | "safety"
  | "quality"
  | "incomplete_work"
  | "damage"
  | "material_logistics"
  | "documentation"
  | "other";

export type ProblemPhoto = {
  path: string;
  downloadURL?: string;
  width?: number;
  height?: number;
};

export type ProblemDoc = {
  id: string;
  projectId: string;
  projectType: string;
  category: ProblemCategory;
  priority: ProblemPriority;
  status: ProblemStatus;
  /** Required title (1 sentence). Stored in shortDescription for backward compat. */
  shortDescription: string;
  /** Optional detail/note. */
  detail?: string | null;
  /** Required location (phase/area). */
  location?: string | null;
  /** When true, priority is forced to high. */
  blocksWork?: boolean | null;
  assigneeUid: string;
  assigneeName?: string;
  createdByUid: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  equipmentId?: string | null;
  equipmentName?: string | null;
  resolutionNote?: string | null;
  archivedAt?: string | null;
  archivedByUid?: string | null;
  photos: ProblemPhoto[];
  locationHint?: string | null;
  audit?: { lastStatusByUid?: string; lastStatusAt?: string };
  /** Attachment IDs (e.g. voice note) – same pattern as DiaryEntryDoc */
  attachments?: string[];
  /** @deprecated Use attachments[]. Kept for backward compatibility when reading. */
  audioAttachmentId?: string | null;
  /** @deprecated Use attachments[]. Kept for backward compatibility when reading. */
  audioUrl?: string | null;
  /** @deprecated Use attachments[]. Kept for backward compatibility when reading. */
  audioStoragePath?: string | null;
  audioDurationSec?: number | null;
};

function convertTimestamp(ts: unknown): string | undefined {
  if (!ts) return undefined;
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  if (typeof ts === "object" && ts !== null && "toDate" in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProblemDoc {
  const d = docSnap.data();
  const photosRaw = (d.photos as unknown[]) ?? [];
  const photos: ProblemPhoto[] = photosRaw.map((p: any) => ({
    path: p?.path ?? "",
    downloadURL: p?.downloadURL,
    width: p?.width,
    height: p?.height,
  }));
  return {
    id: docSnap.id,
    projectId: (d.projectId as string) ?? "",
    projectType: (d.projectType as string) ?? "",
    category: (d.category as ProblemCategory) ?? "other",
    priority: (d.priority as ProblemPriority) ?? "medium",
    status: (d.status as ProblemStatus) ?? "open",
    shortDescription: (d.shortDescription as string) ?? "",
    detail: (d.detail as string) ?? null,
    location: (d.location as string) ?? (d.locationHint as string) ?? null,
    blocksWork: (d.blocksWork as boolean) ?? null,
    assigneeUid: (d.assigneeUid as string) ?? "",
    assigneeName: (d.assigneeName as string) ?? undefined,
    createdByUid: (d.createdByUid as string) ?? "",
    createdByName: (d.createdByName as string) ?? undefined,
    createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
    updatedAt: convertTimestamp(d.updatedAt) ?? new Date().toISOString(),
    dueDate: convertTimestamp(d.dueDate) ?? (d.dueDate as string | null) ?? null,
    equipmentId: (d.equipmentId as string) ?? null,
    equipmentName: (d.equipmentName as string) ?? null,
    resolutionNote: (d.resolutionNote as string) ?? null,
    archivedAt: convertTimestamp(d.archivedAt) ?? (d.archivedAt as string | null) ?? null,
    archivedByUid: (d.archivedByUid as string) ?? null,
    photos,
    locationHint: (d.locationHint as string) ?? null,
    audit: d.audit as { lastStatusByUid?: string; lastStatusAt?: string } | undefined,
    attachments: (d.attachments as string[]) ?? undefined,
    audioAttachmentId: (d.audioAttachmentId as string) ?? null,
    audioUrl: (d.audioUrl as string) ?? null,
    audioStoragePath: (d.audioStoragePath as string) ?? null,
    audioDurationSec: typeof d.audioDurationSec === "number" ? d.audioDurationSec : null,
  };
}

/** Categories available per project type (stable keys stored in Firestore) */
export const PROBLEM_CATEGORIES_BY_PROJECT_TYPE: Record<string, ProblemCategory[]> = {
  BUILD: ["safety", "quality", "incomplete_work", "damage", "material_logistics", "documentation", "other"],
  MANAGEMENT: ["safety", "quality", "incomplete_work", "damage", "material_logistics", "documentation", "other"],
  RESIDENTIAL: ["quality", "incomplete_work", "damage", "material_logistics", "safety", "other"],
  TRADE: ["quality", "incomplete_work", "damage", "material_logistics", "other"],
  MAINTENANCE: ["safety", "quality", "incomplete_work", "damage", "material_logistics", "documentation", "other"],
};

const DEFAULT_CATEGORIES: ProblemCategory[] = [
  "safety",
  "quality",
  "incomplete_work",
  "damage",
  "material_logistics",
  "documentation",
  "other",
];

export function getCategoriesForProjectType(projectType: string): ProblemCategory[] {
  return PROBLEM_CATEGORIES_BY_PROJECT_TYPE[projectType] ?? DEFAULT_CATEGORIES;
}

export async function listProblems(
  projectId: string,
  filters?: {
    status?: ProblemStatus | ProblemStatus[];
    priority?: ProblemPriority;
    category?: ProblemCategory;
    assigneeUid?: string;
  }
): Promise<ProblemDoc[]> {
  const c = collection(db, paths.projectProblems(projectId));
  const q = query(c, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  let list = snap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) }));

  if (filters?.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    list = list.filter((p) => statuses.includes(p.status));
  }
  if (filters?.priority) {
    list = list.filter((p) => p.priority === filters.priority);
  }
  if (filters?.category) {
    list = list.filter((p) => p.category === filters.category);
  }
  if (filters?.assigneeUid) {
    list = list.filter((p) => p.assigneeUid === filters.assigneeUid);
  }

  return list;
}

/** Count problems with status open or in_progress (for badge) */
export async function countOpenProblems(projectId: string): Promise<number> {
  const c = collection(db, paths.projectProblems(projectId));
  const q = query(c, where("status", "in", ["open", "in_progress"]));
  const snap = await getDocs(q);
  return snap.size;
}

export async function getProblem(projectId: string, problemId: string): Promise<ProblemDoc | null> {
  const ref = doc(db, paths.projectProblem(projectId, problemId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toDoc({ id: snap.id, data: snap.data.bind(snap) });
}

export type CreateProblemInput = {
  projectId: string;
  projectType: string;
  category: ProblemCategory;
  priority: ProblemPriority;
  shortDescription: string;
  detail?: string | null;
  location?: string | null;
  blocksWork?: boolean | null;
  assigneeUid: string;
  assigneeName?: string;
  dueDate?: Date | string | null;
  equipmentId?: string | null;
  equipmentName?: string | null;
  photos?: ProblemPhoto[];
  attachments?: string[];
};

export async function createProblem(input: CreateProblemInput): Promise<ProblemDoc> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie problému.");
  }

  const c = collection(db, paths.projectProblems(input.projectId));
  const dueDateTs =
    input.dueDate instanceof Date
      ? Timestamp.fromDate(input.dueDate)
      : typeof input.dueDate === "string" && input.dueDate
      ? Timestamp.fromDate(new Date(input.dueDate))
      : null;

  const ref = await addDoc(c, {
    projectId: input.projectId,
    projectType: input.projectType,
    category: input.category,
    priority: input.priority,
    status: "open",
    shortDescription: input.shortDescription,
    detail: input.detail ?? null,
    location: input.location ?? null,
    blocksWork: input.blocksWork ?? null,
    assigneeUid: input.assigneeUid,
    assigneeName: input.assigneeName ?? null,
    createdByUid: currentUser.uid,
    createdByName: currentUser.displayName ?? currentUser.email ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    dueDate: dueDateTs,
    equipmentId: input.equipmentId ?? null,
    equipmentName: input.equipmentName ?? null,
    photos: input.photos ?? [],
    locationHint: input.location ?? null,
    attachments: input.attachments ?? [],
  });

  if (__DEV__) {
    console.log(`[problems] Created: ${ref.id}, projectId=${input.projectId}`);
  }

  const created = await getProblem(input.projectId, ref.id);
  if (!created) throw new Error("Problém sa nepodarilo načítať po vytvorení.");

  if (input.assigneeUid) {
    try {
      const { createProblemAssignedNotification } = await import("./notifications");
      await createProblemAssignedNotification({
        userId: input.assigneeUid,
        projectId: input.projectId,
        projectName: undefined,
        problemId: ref.id,
        problemTitle: input.shortDescription,
        fromUserId: currentUser.uid,
        fromUserName: currentUser.displayName ?? currentUser.email ?? null,
      });
    } catch (e) {
      console.warn("[problems] Failed to create assignee notification:", e);
    }
  }

  return created;
}

export type UpdateProblemInput = Partial<{
  category: ProblemCategory;
  priority: ProblemPriority;
  status: ProblemStatus;
  shortDescription: string;
  detail: string | null;
  location: string | null;
  blocksWork: boolean | null;
  assigneeUid: string;
  assigneeName: string;
  dueDate: Date | string | null;
  equipmentId: string | null;
  equipmentName: string | null;
  resolutionNote: string | null;
  archivedAt: Date | string | null;
  archivedByUid: string | null;
  photos: ProblemPhoto[];
  attachments: string[];
}>;

export async function updateProblem(
  projectId: string,
  problemId: string,
  input: UpdateProblemInput
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na úpravu problému.");
  }

  const ref = doc(db, paths.projectProblem(projectId, problemId));
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (input.category !== undefined) updates.category = input.category;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.detail !== undefined) updates.detail = input.detail;
  if (input.location !== undefined) updates.location = input.location;
  if (input.blocksWork !== undefined) updates.blocksWork = input.blocksWork;
  if (input.status !== undefined) {
    updates.status = input.status;
    updates.audit = {
      lastStatusByUid: currentUser.uid,
      lastStatusAt: new Date().toISOString(),
    };
  }
  if (input.shortDescription !== undefined) updates.shortDescription = input.shortDescription;
  if (input.assigneeUid !== undefined) updates.assigneeUid = input.assigneeUid;
  if (input.assigneeName !== undefined) updates.assigneeName = input.assigneeName;
  if (input.dueDate !== undefined) {
    updates.dueDate =
      input.dueDate instanceof Date
        ? Timestamp.fromDate(input.dueDate)
        : typeof input.dueDate === "string" && input.dueDate
        ? Timestamp.fromDate(new Date(input.dueDate))
        : null;
  }
  if (input.equipmentId !== undefined) updates.equipmentId = input.equipmentId;
  if (input.equipmentName !== undefined) updates.equipmentName = input.equipmentName;
  if (input.resolutionNote !== undefined) updates.resolutionNote = input.resolutionNote;
  if (input.archivedByUid !== undefined) updates.archivedByUid = input.archivedByUid;
  if (input.archivedAt !== undefined) {
    updates.archivedAt =
      input.archivedAt instanceof Date
        ? Timestamp.fromDate(input.archivedAt)
        : typeof input.archivedAt === "string" && input.archivedAt
        ? Timestamp.fromDate(new Date(input.archivedAt))
        : null;
  }
  if (input.photos !== undefined) updates.photos = input.photos;
  if (input.attachments !== undefined) updates.attachments = input.attachments;

  await updateDoc(ref, updates);

  if (input.assigneeUid !== undefined && input.assigneeUid) {
    try {
      const { createProblemAssignedNotification } = await import("./notifications");
      const problemSnap = await getDoc(ref);
      const shortDesc = problemSnap.exists() ? (problemSnap.data() as { shortDescription?: string }).shortDescription : undefined;
      await createProblemAssignedNotification({
        userId: input.assigneeUid,
        projectId,
        projectName: undefined,
        problemId,
        problemTitle: shortDesc ?? undefined,
        fromUserId: currentUser.uid,
        fromUserName: currentUser.displayName ?? currentUser.email ?? null,
      });
    } catch (e) {
      console.warn("[problems] Failed to create assignee notification:", e);
    }
  }

  if (__DEV__) {
    console.log(`[problems] Updated: ${problemId}, projectId=${projectId}`);
  }
}

export async function deleteProblem(projectId: string, problemId: string): Promise<void> {
  const ref = doc(db, paths.projectProblem(projectId, problemId));
  await deleteDoc(ref);
  if (__DEV__) {
    console.log(`[problems] Deleted: ${problemId}, projectId=${projectId}`);
  }
}

export type ProblemWithProject = ProblemDoc & { projectName?: string };

function normalizeDueDateToYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** List problems with dueDate in range [startYmd, endYmd] (inclusive) for user's projects. */
export async function listProblemsWithDueDateInRange(
  ownerId: string,
  startYmd: string,
  endYmd: string
): Promise<ProblemWithProject[]> {
  const { listMyProjects } = await import("./projects");
  const projects = await listMyProjects(ownerId);
  const allProblems: ProblemWithProject[] = [];
  for (const project of projects) {
    try {
      const list = await listProblems(project.id);
      for (const p of list) {
        const ymd = normalizeDueDateToYmd(p.dueDate);
        if (!ymd) continue;
        if (ymd >= startYmd && ymd <= endYmd) {
          allProblems.push({ ...p, projectName: project.name });
        }
      }
    } catch (e) {
      console.warn(`[problems] Failed to list for project ${project.id}:`, e);
    }
  }
  return allProblems;
}
