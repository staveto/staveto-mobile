/** Mená tabuliek a stĺpcov v Airtable – musia sedieť so schémou base. */
export const TABLE_ORGS = "Orgs";
export const TABLE_USERS = "Users";
export const TABLE_PROJECTS = "Projects";
export const TABLE_TASKS = "Tasks";

export const USERS = {
  Email: "Email",
  FullName: "FullName",
  Status: "Status",
  Role: "Role",
  Org: "Org",
} as const;

export const PROJECTS = {
  Name: "Name",
  Org: "Org",
} as const;

export const TASKS = {
  Title: "Title",
  Status: "Status",
  Org: "Org",
  Project: "Project",
  Assignee: "Assignee",
} as const;

export const TASK_STATUS = ["OPEN", "DOING", "DONE", "BLOCKED", "SKIPPED"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export function normalizeTaskStatus(s: string): TaskStatus {
  const u = (s ?? "").toUpperCase();
  if (TASK_STATUS.includes(u as TaskStatus)) return u as TaskStatus;
  const map: Record<string, TaskStatus> = {
    TODO: "OPEN",
    OPEN: "OPEN",
    IN_PROGRESS: "DOING",
    DOING: "DOING",
    DONE: "DONE",
    BLOCKED: "BLOCKED",
    SKIPPED: "SKIPPED",
  };
  return map[u] ?? "OPEN";
}
