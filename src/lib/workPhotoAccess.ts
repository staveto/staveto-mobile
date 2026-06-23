import { auth } from "../firebase";
import {
  fetchProjectAccess,
  resolveCanWriteTimeForProject,
  resolveCanReportProblemForProject,
  type ProjectAccess,
} from "../hooks/useProjectAccess";
import { isUserAssignedOnProject } from "../lib/projectAssignment";
import { getProject } from "../services/projects";
import { getTaskById, listTasksByProject } from "../services/tasks";
import * as timeTracking from "../services/timeTracking";
import { doc, getDoc } from "../lib/rnFirestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { healProjectAccessForCurrentUser } from "../services/projects";

export type WorkPhotoPermissionResult = {
  allowed: boolean;
  reason?: "not_assigned" | "no_access" | "not_signed_in";
};

/**
 * Resolves whether the current user may upload a work photo to a project/task.
 * Mirrors Firebase Storage rules + field workflow (timer, diary, org crew).
 */
export async function resolveCanUploadWorkPhoto(
  projectId: string,
  opts?: {
    taskId?: string | null;
    projectOwnerId?: string | null;
    access?: ProjectAccess;
    healFirst?: boolean;
    activeTimerProjectId?: string | null;
  }
): Promise<WorkPhotoPermissionResult> {
  const uid = auth.currentUser?.uid?.trim() ?? "";
  if (!uid) return { allowed: false, reason: "not_signed_in" };

  if (opts?.healFirst !== false) {
    try {
      await healProjectAccessForCurrentUser(projectId);
    } catch {
      /* best effort */
    }
  }

  const access =
    opts?.access ??
    (await fetchProjectAccess(projectId, uid, opts?.projectOwnerId ?? undefined));

  if (access.canWritePhotos || access.isOwner || access.canWrite) {
    return { allowed: true };
  }

  if (access.canWriteTime || access.canReportProblem || access.canWriteDiary) {
    return { allowed: true };
  }

  const timerProjectId =
    opts?.activeTimerProjectId?.trim() ||
    (await timeTracking.getActiveTimer().catch(() => null))?.projectId?.trim() ||
    "";
  if (timerProjectId && timerProjectId === projectId) {
    return { allowed: true };
  }

  if (await resolveCanWriteTimeForProject(projectId, uid, opts?.projectOwnerId ?? null)) {
    return { allowed: true };
  }

  if (await resolveCanReportProblemForProject(projectId, uid, opts?.projectOwnerId ?? null)) {
    return { allowed: true };
  }

  const project = await getProject(projectId);
  if (project && isUserAssignedOnProject(project as unknown as Record<string, unknown>, uid)) {
    return { allowed: true };
  }

  const taskId = opts?.taskId?.trim();
  if (taskId) {
    if (await isUserAssignedToTask(projectId, taskId, uid)) {
      return { allowed: true };
    }
  } else {
    try {
      const tasks = await listTasksByProject(projectId);
      if (tasks.some((t) => t.assigneeId === uid && t.isActive !== false)) {
        return { allowed: true };
      }
    } catch {
      /* ignore */
    }
  }

  if (access.isMember && access.canReadDiary) {
    return { allowed: true };
  }

  return { allowed: false, reason: "not_assigned" };
}

async function isUserAssignedToTask(projectId: string, taskId: string, uid: string): Promise<boolean> {
  const task = await getTaskById(projectId, taskId);
  if (task?.assigneeId === uid) return true;
  try {
    const snap = await getDoc(doc(db, paths.projectTask(projectId, taskId)));
    if (!snap.exists()) return false;
    const d = snap.data() as Record<string, unknown>;
    const userIds = d.assignedUserIds;
    if (Array.isArray(userIds) && userIds.includes(uid)) return true;
    const memberIds = d.assignedMemberIds;
    if (Array.isArray(memberIds) && memberIds.includes(uid)) return true;
  } catch {
    /* ignore */
  }
  return false;
}
