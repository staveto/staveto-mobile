import type { TaskDoc } from "../services/tasks";
import type { ProjectAccess } from "../hooks/useProjectAccess";

/** Matches web `canManageTaskPlanning` using mobile access resolution. */
export function canManageTaskPlanningFromAccess(
  access: Pick<ProjectAccess, "loading" | "isOwner" | "canWrite" | "sharedItems">
): boolean {
  if (access.loading) return false;
  if (access.isOwner) return true;
  if (!access.canWrite) return false;
  return access.sharedItems.tasks === true || access.sharedItems.phases === true;
}

/** Matches web `canWorkerToggleTaskStatus` — workers may only toggle unassigned or own tasks. */
export function canWorkerToggleTaskStatus(
  task: Pick<TaskDoc, "assigneeId">,
  userId: string,
  canManage: boolean
): boolean {
  if (canManage) return true;
  const assignee = task.assigneeId?.trim();
  return !assignee || assignee === userId;
}

/** Matches web `filterTasksForWorkerView` — crew sees unassigned + own tasks only. */
export function filterTasksForWorkerView<T extends Pick<TaskDoc, "assigneeId">>(
  tasks: T[],
  userId: string
): T[] {
  const uid = userId.trim();
  if (!uid) return [];
  return tasks.filter((task) => {
    const assignee = task.assigneeId?.trim();
    return !assignee || assignee === uid;
  });
}

export function countDoneTasks(tasks: Pick<TaskDoc, "status">[]): number {
  return tasks.filter((t) => (t.status ?? "OPEN").toUpperCase() === "DONE").length;
}
