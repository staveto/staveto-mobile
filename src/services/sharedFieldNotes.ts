/**
 * Shared field notes (Schnellnotiz with "Mit Manager teilen") — org-visible for managers.
 * Path: organizations/{orgId}/fieldNotes/{noteId}
 */
import { getFirestore } from "../firebase";
import type { QuickNote, QuickNoteStatus } from "./quickNotes";

export type SharedFieldNoteDoc = {
  orgId: string;
  text: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  createdBy: string;
  createdByName: string | null;
  shareWithManager: true;
  status: QuickNoteStatus;
  sourceScreen: string;
  createdAt: string;
  updatedAt: string;
};

const PUBLISH_TIMEOUT_MS = 12_000;

function fieldNoteRef(orgId: string, noteId: string) {
  const db = getFirestore();
  if (!db) return null;
  return db.doc(`organizations/${orgId}/fieldNotes/${noteId}`);
}

export function buildSharedFieldNoteDoc(note: QuickNote, orgId: string): SharedFieldNoteDoc {
  const projectId = note.sourceProjectId ?? note.suggestedProjectId ?? null;
  const projectName = note.sourceProjectName ?? note.suggestedProjectName ?? null;
  return {
    orgId,
    text: note.text,
    projectId,
    projectName,
    taskId: note.taskId ?? null,
    createdBy: note.createdByUserId ?? "",
    createdByName: note.createdByName ?? null,
    shareWithManager: true,
    status: note.status,
    sourceScreen: note.sourceScreen,
    createdAt: note.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/** Resolve org id from note metadata, active org fallback, linked project, or org membership. */
export async function resolveFieldNoteOrgId(
  note: QuickNote,
  fallbackOrgId?: string | null
): Promise<string | null> {
  const fromNote = note.orgId?.trim();
  if (fromNote) return fromNote;

  const fallback = fallbackOrgId?.trim();
  if (fallback) return fallback;

  const projectId = note.sourceProjectId ?? note.suggestedProjectId ?? null;
  if (projectId) {
    const { getProject } = await import("./projects");
    try {
      const project = await getProject(projectId);
      const fromProject = project?.orgId?.trim();
      if (fromProject) return fromProject;
    } catch {
      /* fall through to membership lookup */
    }
  }

  // Fallbacks so a shared note can always reach the manager even without a
  // project or an active business workspace selected. Workers are active org
  // members, so their org id can be recovered from their profile / membership.
  const authorUid = note.createdByUserId?.trim();
  if (authorUid) {
    // 1) Single-doc read of the persisted active business org hint (rules-safe).
    try {
      const { readUserActiveBusinessOrgIdHint } = await import("./organizations");
      const hint = await readUserActiveBusinessOrgIdHint(authorUid);
      if (hint) return hint;
    } catch (e) {
      if (__DEV__) console.warn("[sharedFieldNotes] org hint lookup failed:", e);
    }

    // 2) Collection-group membership scan (used when the hint is missing).
    try {
      const { listMyMemberships } = await import("./organizations");
      const memberships = await listMyMemberships(authorUid);
      const activeOrgIds = [
        ...new Set(
          memberships
            .filter((m) => !m.status || m.status === "active")
            .map((m) => m.orgId?.trim())
            .filter((id): id is string => !!id)
        ),
      ];
      if (activeOrgIds.length === 1) return activeOrgIds[0];
    } catch (e) {
      if (__DEV__) console.warn("[sharedFieldNotes] membership orgId lookup failed:", e);
    }
  }

  return null;
}

async function upsertSharedFieldNote(orgId: string, note: QuickNote): Promise<void> {
  const ref = fieldNoteRef(orgId, note.id);
  if (!ref) throw new Error("Firestore unavailable");
  await ref.set(buildSharedFieldNoteDoc(note, orgId), { merge: true });
}

async function notifyOrgManagersOfFieldNote(args: {
  orgId: string;
  note: QuickNote;
  projectId: string | null;
  projectName: string | null;
}): Promise<void> {
  const creatorUid = args.note.createdByUserId ?? "";
  const creatorName = args.note.createdByName ?? null;
  const notified = new Set<string>();

  const { createFieldNoteSharedNotification } = await import("./notifications");

  const notifyUid = async (targetUid: string) => {
    if (!targetUid || targetUid === creatorUid || notified.has(targetUid)) return;
    await createFieldNoteSharedNotification({
      userId: targetUid,
      orgId: args.orgId,
      noteId: args.note.id,
      noteText: args.note.text,
      projectId: args.projectId,
      projectName: args.projectName,
      fromUserId: creatorUid,
      fromUserName: creatorName,
    });
    notified.add(targetUid);
  };

  try {
    const { getOrganization } = await import("./organizations");
    const org = await getOrganization(args.orgId);
    if (org?.ownerUid) await notifyUid(org.ownerUid);
  } catch (e) {
    if (__DEV__) console.warn("[sharedFieldNotes] org owner lookup failed:", e);
  }

  try {
    const { listMembers } = await import("./businessMembers");
    const members = await listMembers(args.orgId);
    for (const m of members) {
      const uid = (m.userId?.trim() || m.id?.trim()) ?? "";
      if (
        m.status === "active" &&
        (m.role === "owner" || m.role === "admin" || m.role === "manager") &&
        uid
      ) {
        await notifyUid(uid);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[sharedFieldNotes] listMembers failed:", e);
  }
}

/** Sync to Firestore + notify org managers. Returns true on successful Firestore write. */
export async function publishSharedFieldNote(
  note: QuickNote,
  fallbackOrgId?: string | null
): Promise<boolean> {
  if (!note.shareWithManager) return false;

  const orgId = await resolveFieldNoteOrgId(note, fallbackOrgId);
  if (!orgId) {
    if (__DEV__) console.warn("[sharedFieldNotes] missing orgId for shared note", note.id);
    return false;
  }

  const doc = buildSharedFieldNoteDoc(note, orgId);
  try {
    await upsertSharedFieldNote(orgId, note);
    await notifyOrgManagersOfFieldNote({
      orgId,
      note,
      projectId: doc.projectId,
      projectName: doc.projectName,
    });
    return true;
  } catch (e) {
    console.warn("[sharedFieldNotes] publish failed:", e);
    return false;
  }
}

export async function publishSharedFieldNoteWithTimeout(
  note: QuickNote,
  timeoutMs = PUBLISH_TIMEOUT_MS,
  fallbackOrgId?: string | null
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      publishSharedFieldNote(note, fallbackOrgId),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function syncSharedFieldNoteStatus(
  orgId: string,
  noteId: string,
  status: QuickNoteStatus
): Promise<void> {
  if (!orgId.trim() || !noteId.trim()) return;
  const ref = fieldNoteRef(orgId.trim(), noteId);
  if (!ref) return;
  try {
    await ref.set(
      {
        status,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (e) {
    if (__DEV__) console.warn("[sharedFieldNotes] status sync failed:", e);
  }
}
