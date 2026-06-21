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

/** Resolve org id from note metadata or linked project. */
export async function resolveFieldNoteOrgId(note: QuickNote): Promise<string | null> {
  const fromNote = note.orgId?.trim();
  if (fromNote) return fromNote;

  const projectId = note.sourceProjectId ?? note.suggestedProjectId ?? null;
  if (!projectId) return null;

  try {
    const { getProject } = await import("./projects");
    const project = await getProject(projectId);
    const fromProject = project?.orgId?.trim();
    return fromProject || null;
  } catch {
    return null;
  }
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
export async function publishSharedFieldNote(note: QuickNote): Promise<boolean> {
  if (!note.shareWithManager) return false;

  const orgId = await resolveFieldNoteOrgId(note);
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
  timeoutMs = PUBLISH_TIMEOUT_MS
): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      publishSharedFieldNote(note),
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
