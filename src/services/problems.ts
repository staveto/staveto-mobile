import {
  collection,
  addDoc,
  query,
  getDoc,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart, type SmartReadOptions } from "./firestoreSmartRead";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { ProjectStorageType } from "../lib/projectTypeModel";

/** Map keys = Firestore `projects.projectType` (see `projectTypeModel.ProjectStorageType`). */

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
  /** GPS coordinates when reported with location enabled. */
  gpsLocation?: { lat: number; lng: number } | null;
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
  /** Set when the problem was escalated (priority forced high + owner/manager notified). */
  escalatedAt?: string | null;
  escalatedByUid?: string | null;
  escalationReason?: string | null;
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
  if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProblemDoc | null {
  const d = docSnap.data();
  if (!d || typeof d !== "object") {
    if (__DEV__) console.warn(`[problems] toDoc: document ${docSnap.id} has no/invalid data, skipping`);
    return null;
  }
  const photosRaw = (d.photos as unknown[]) ?? [];
  const photos: ProblemPhoto[] = Array.isArray(photosRaw)
    ? photosRaw.map((p: unknown) =>
        p && typeof p === "object"
          ? { path: String((p as { path?: string }).path ?? ""), downloadURL: (p as { downloadURL?: string }).downloadURL, width: (p as { width?: number }).width, height: (p as { height?: number }).height }
          : { path: "" }
      )
    : [];
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
    gpsLocation: (d.gpsLocation as { lat: number; lng: number }) ?? null,
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
    escalatedAt: convertTimestamp(d.escalatedAt) ?? (d.escalatedAt as string | null) ?? null,
    escalatedByUid: (d.escalatedByUid as string) ?? null,
    escalationReason: (d.escalationReason as string) ?? null,
    photos,
    locationHint: (d.locationHint as string) ?? null,
    audit:
      d.audit && typeof d.audit === "object"
        ? { lastStatusByUid: (d.audit as { lastStatusByUid?: string }).lastStatusByUid, lastStatusAt: (d.audit as { lastStatusAt?: string }).lastStatusAt }
        : undefined,
    attachments: (d.attachments as string[]) ?? undefined,
    audioAttachmentId: (d.audioAttachmentId as string) ?? null,
    audioUrl: (d.audioUrl as string) ?? null,
    audioStoragePath: (d.audioStoragePath as string) ?? null,
    audioDurationSec: typeof d.audioDurationSec === "number" ? d.audioDurationSec : null,
  };
}

/** Categories available per storage `projectType` (stable keys in Firestore). */
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

export function getCategoriesForProjectType(projectType: ProjectStorageType | string): ProblemCategory[] {
  return PROBLEM_CATEGORIES_BY_PROJECT_TYPE[projectType] ?? DEFAULT_CATEGORIES;
}

function sortProblemsByCreatedAtDesc(list: ProblemDoc[]): ProblemDoc[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

export async function listProblems(
  projectId: string,
  filters?: {
    status?: ProblemStatus | ProblemStatus[];
    priority?: ProblemPriority;
    category?: ProblemCategory;
    assigneeUid?: string;
  },
  readOpts?: SmartReadOptions
): Promise<ProblemDoc[]> {
  const c = collection(db, paths.projectProblems(projectId));
  /** No `orderBy("createdAt")` here: Firestore omits docs missing that field, so counts vs list diverged. */
  const q = query(c);
  const snap = await getDocsSmart(q, readOpts);
  let list = snap.docs
    .map((d) => {
      try {
        return toDoc({ id: d.id, data: d.data.bind(d) });
      } catch (err) {
        if (__DEV__) console.warn(`[problems] toDoc failed for doc ${d.id}:`, err);
        return null;
      }
    })
    .filter((p): p is ProblemDoc => p != null);

  list = sortProblemsByCreatedAtDesc(list);

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

/**
 * Count problems shown as "open" on the project badge: open or in_progress, not archived.
 * Uses the same document set as `listProblems` (no orderBy-only exclusion of legacy rows).
 */
export async function countOpenProblems(projectId: string): Promise<number> {
  const c = collection(db, paths.projectProblems(projectId));
  const snap = await getDocsSmart(query(c));
  let n = 0;
  for (const d of snap.docs) {
    const p = toDoc({ id: d.id, data: d.data.bind(d) });
    if (!p || p.archivedAt) continue;
    if (p.status === "open" || p.status === "in_progress") n += 1;
  }
  return n;
}

export async function getProblem(projectId: string, problemId: string): Promise<ProblemDoc | null> {
  const ref = doc(db, paths.projectProblem(projectId, problemId));
  const snap = await getDocSmart(ref);
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
  gpsLocation?: { lat: number; lng: number } | null;
  blocksWork?: boolean | null;
  assigneeUid: string;
  assigneeName?: string;
  dueDate?: Date | string | null;
  equipmentId?: string | null;
  equipmentName?: string | null;
  photos?: ProblemPhoto[];
  attachments?: string[];
};

/**
 * Resolve Firebase uid from org membership (legacy docs may use doc id only).
 */
function resolveOrgMemberUid(member: { id: string; userId: string }): string {
  const uid = member.userId?.trim();
  if (uid) return uid;
  const docId = member.id?.trim();
  if (docId && !docId.includes("@")) return docId;
  return "";
}

/**
 * Fan out a problem notification to the business org's owner / admins / managers
 * so the office manager sees it on web + mobile — not only the literal project
 * `ownerId`. Best-effort: reads org members (graceful on permission denial) and
 * skips anyone already in `notified` or the actor themselves.
 */
async function notifyOrgManagersOfProblem(args: {
  projectData: Record<string, unknown>;
  projectId: string;
  projectName: string | null;
  problemId: string;
  problemTitle: string | null;
  creatorUid: string;
  creatorName: string | null;
  escalated?: boolean;
  notified: Set<string>;
}): Promise<void> {
  const orgId =
    (typeof args.projectData.orgId === "string" && args.projectData.orgId.trim()) ||
    (typeof args.projectData.workspaceId === "string" && args.projectData.workspaceId.trim()) ||
    "";
  if (!orgId) return;

  const { createProblemReportedNotification } = await import("./notifications");

  const notifyUid = async (targetUid: string) => {
    if (!targetUid || targetUid === args.creatorUid || args.notified.has(targetUid)) return;
    await createProblemReportedNotification({
      userId: targetUid,
      projectId: args.projectId,
      projectName: args.projectName,
      problemId: args.problemId,
      problemTitle: args.problemTitle,
      fromUserId: args.creatorUid,
      fromUserName: args.creatorName,
      escalated: args.escalated === true,
    });
    args.notified.add(targetUid);
  };

  try {
    const { getOrganization } = await import("./organizations");
    const org = await getOrganization(orgId);
    if (org?.ownerUid) {
      await notifyUid(org.ownerUid);
    }
  } catch (e) {
    console.warn("[problems] notifyOrgManagersOfProblem org owner lookup failed", e);
  }

  try {
    const { listMembers } = await import("./businessMembers");
    const members = await listMembers(orgId);
    for (const m of members) {
      const uid = resolveOrgMemberUid(m);
      if (
        m.status === "active" &&
        (m.role === "owner" || m.role === "admin" || m.role === "manager") &&
        uid
      ) {
        await notifyUid(uid);
      }
    }
  } catch (e) {
    console.warn("[problems] notifyOrgManagersOfProblem listMembers failed", e);
  }
}

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
    gpsLocation: input.gpsLocation ?? null,
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

  try {
    const projectSnap = await getDocSmart(doc(db, "projects", input.projectId));
    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    const ownerId = typeof projectData.ownerId === "string" ? projectData.ownerId : null;
    const projectName = typeof projectData.name === "string" ? projectData.name : null;
    const creatorUid = currentUser.uid;
    const creatorName = currentUser.displayName ?? currentUser.email ?? null;
    const notified = new Set<string>();

    const { createProblemAssignedNotification, createProblemReportedNotification } = await import(
      "./notifications"
    );

    if (input.assigneeUid && input.assigneeUid !== creatorUid) {
      await createProblemAssignedNotification({
        userId: input.assigneeUid,
        projectId: input.projectId,
        projectName,
        problemId: ref.id,
        problemTitle: input.shortDescription,
        fromUserId: creatorUid,
        fromUserName: creatorName,
      });
      notified.add(input.assigneeUid);
    }

    if (ownerId && ownerId !== creatorUid && !notified.has(ownerId)) {
      await createProblemReportedNotification({
        userId: ownerId,
        projectId: input.projectId,
        projectName,
        problemId: ref.id,
        problemTitle: input.shortDescription,
        fromUserId: creatorUid,
        fromUserName: creatorName,
      });
      notified.add(ownerId);
    }

    await notifyOrgManagersOfProblem({
      projectData,
      projectId: input.projectId,
      projectName,
      problemId: ref.id,
      problemTitle: input.shortDescription,
      creatorUid,
      creatorName,
      notified,
    });
  } catch (e) {
    console.warn("[problems] Failed to create problem notifications:", e);
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
  gpsLocation: { lat: number; lng: number } | null;
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
  if (input.gpsLocation !== undefined) updates.gpsLocation = input.gpsLocation;
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
  endYmd: string,
  readOpts?: SmartReadOptions
): Promise<ProblemWithProject[]> {
  const { listMyProjects } = await import("./projects");
  const projects = await listMyProjects(ownerId);
  const allProblems: ProblemWithProject[] = [];
  for (const project of projects) {
    try {
      const list = await listProblems(project.id, undefined, readOpts);
      for (const p of list) {
        if (p.archivedAt) continue;
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

export type ProblemHubFilters = {
  status?: ProblemStatus | ProblemStatus[];
  priority?: ProblemPriority;
  includeArchived?: boolean;
};

/**
 * Global "Problems" hub feed: aggregates problems across all the user's projects
 * (owned + shared/assigned), tagged with project name + type. Same source set as
 * `listProblems` per project, so counts and badges stay consistent.
 */
export async function listAllMyProblems(
  ownerId: string,
  filters?: ProblemHubFilters,
  readOpts?: SmartReadOptions
): Promise<ProblemWithProject[]> {
  const { listMyProjects } = await import("./projects");
  const projects = await listMyProjects(ownerId);
  const statuses = filters?.status
    ? Array.isArray(filters.status)
      ? filters.status
      : [filters.status]
    : null;

  const all: ProblemWithProject[] = [];
  for (const project of projects) {
    try {
      const list = await listProblems(project.id, undefined, readOpts);
      for (const p of list) {
        if (!filters?.includeArchived && p.archivedAt) continue;
        if (statuses && !statuses.includes(p.status)) continue;
        if (filters?.priority && p.priority !== filters.priority) continue;
        all.push({ ...p, projectName: project.name, projectType: project.projectType ?? p.projectType });
      }
    } catch (e) {
      console.warn(`[problems] Failed to list for project ${project.id}:`, e);
    }
  }

  return sortProblemsByCreatedAtDesc(all) as ProblemWithProject[];
}

/** Count of open/in_progress problems across all the user's projects (hub badge). */
export async function countAllMyOpenProblems(ownerId: string): Promise<number> {
  const list = await listAllMyProblems(ownerId, { status: ["open", "in_progress"] });
  return list.length;
}

/**
 * Escalate a problem: force priority to high, stamp escalation metadata, and notify
 * the project owner (and assignee if different from the actor). Consistent across all
 * project types — escalation is part of the unified Problems process.
 */
export async function escalateProblem(
  projectId: string,
  problemId: string,
  reason?: string | null
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na eskaláciu problému.");
  }

  const ref = doc(db, paths.projectProblem(projectId, problemId));
  await updateDoc(ref, {
    priority: "high",
    escalatedAt: serverTimestamp(),
    escalatedByUid: currentUser.uid,
    escalationReason: reason?.trim() || null,
    updatedAt: serverTimestamp(),
  });

  try {
    const problem = await getProblem(projectId, problemId);
    const projectSnap = await getDocSmart(doc(db, "projects", projectId));
    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    const ownerId = typeof projectData.ownerId === "string" ? projectData.ownerId : null;
    const projectName = typeof projectData.name === "string" ? projectData.name : null;
    const title = problem?.shortDescription ?? null;
    const actorName = currentUser.displayName ?? currentUser.email ?? null;
    const notified = new Set<string>([currentUser.uid]);

    const { createProblemReportedNotification } = await import("./notifications");

    if (ownerId && !notified.has(ownerId)) {
      await createProblemReportedNotification({
        userId: ownerId,
        projectId,
        projectName,
        problemId,
        problemTitle: title,
        fromUserId: currentUser.uid,
        fromUserName: actorName,
        escalated: true,
      });
      notified.add(ownerId);
    }

    if (problem?.assigneeUid && !notified.has(problem.assigneeUid)) {
      await createProblemReportedNotification({
        userId: problem.assigneeUid,
        projectId,
        projectName,
        problemId,
        problemTitle: title,
        fromUserId: currentUser.uid,
        fromUserName: actorName,
        escalated: true,
      });
      notified.add(problem.assigneeUid);
    }

    await notifyOrgManagersOfProblem({
      projectData,
      projectId,
      projectName,
      problemId,
      problemTitle: title,
      creatorUid: currentUser.uid,
      creatorName: actorName,
      escalated: true,
      notified,
    });
  } catch (e) {
    console.warn("[problems] Failed to send escalation notifications:", e);
  }

  if (__DEV__) {
    console.log(`[problems] Escalated: ${problemId}, projectId=${projectId}`);
  }
}
