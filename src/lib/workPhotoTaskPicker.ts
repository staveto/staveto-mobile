import { normalizeStatusValue } from "../helpers/taskStatusMapping";
import { formatPhaseNameForWorker } from "./formatPhaseNameForWorker";
import type { TaskDoc } from "../services/tasks";

export type WorkPhotoTaskStatusKind = "open" | "doing" | "done" | "blocked";

export function workPhotoTaskStatusKind(status: string | null | undefined): WorkPhotoTaskStatusKind {
  const n = normalizeStatusValue(status ?? "OPEN");
  if (n === "DONE") return "done";
  if (n === "DOING") return "doing";
  const upper = String(status ?? "").toUpperCase();
  if (upper.includes("BLOCK") || upper.includes("HOLD")) return "blocked";
  return "open";
}

export function isWorkPhotoTaskDone(task: Pick<TaskDoc, "status">): boolean {
  return workPhotoTaskStatusKind(task.status) === "done";
}

export function workPhotoStatusLabel(
  status: string | null | undefined,
  t: (key: string) => string
): string {
  const kind = workPhotoTaskStatusKind(status);
  if (kind === "done") return t("workPhoto.status.done");
  if (kind === "doing") return t("workPhoto.status.inProgress");
  if (kind === "blocked") return t("workPhoto.status.blocked");
  return t("workPhoto.status.open");
}

export function getRecommendedWorkPhotoTasks(
  tasks: TaskDoc[],
  opts: {
    userId?: string | null;
    activeTimerTaskId?: string | null;
    limit?: number;
  }
): TaskDoc[] {
  const limit = opts.limit ?? 5;
  const uid = opts.userId?.trim() ?? "";
  const timerTaskId = opts.activeTimerTaskId?.trim() ?? "";

  const openTasks = tasks.filter((task) => !isWorkPhotoTaskDone(task));
  const scored = openTasks.map((task) => {
    let score = 0;
    if (timerTaskId && task.id === timerTaskId) score += 100;
    if (uid && task.assigneeId === uid) score += 50;
    if (workPhotoTaskStatusKind(task.status) === "doing") score += 15;
    score -= (task.order ?? 0) * 0.01;
    return { task, score };
  });

  scored.sort((a, b) => b.score - a.score || (a.task.order ?? 0) - (b.task.order ?? 0));
  const picked: TaskDoc[] = [];
  const seen = new Set<string>();
  for (const { task } of scored) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    picked.push(task);
    if (picked.length >= limit) break;
  }
  return picked;
}

export type WorkPhotoTaskPhaseGroup = {
  phaseKey: string;
  phaseLabel: string;
  tasks: TaskDoc[];
};

export function groupWorkPhotoTasksByPhase(
  tasks: TaskDoc[],
  t: (key: string) => string
): WorkPhotoTaskPhaseGroup[] {
  const groups = new Map<string, WorkPhotoTaskPhaseGroup>();
  for (const task of tasks) {
    const rawPhase = task.phaseTitle?.trim() || task.phaseId?.trim() || "";
    const phaseLabel = formatPhaseNameForWorker(rawPhase, t);
    const phaseKey = rawPhase || phaseLabel;
    const existing = groups.get(phaseKey);
    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.set(phaseKey, { phaseKey, phaseLabel, tasks: [task] });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.phaseLabel.localeCompare(b.phaseLabel, undefined, { sensitivity: "base" })
  );
}

export function filterTasksBySearch(tasks: TaskDoc[], query: string): TaskDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((task) => {
    const hay = [task.title, task.phaseTitle, task.status, task.dueDate].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export type WorkPhotoFlowSelection =
  | { kind: "general" }
  | { kind: "task"; taskId: string; phaseId?: string | null };
