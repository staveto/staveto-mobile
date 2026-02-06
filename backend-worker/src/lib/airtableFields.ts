/** Table a field constants pre Airtable – musia sedieť so schémou base. */
export const ORGS_TABLE = "Orgs";
export const USERS_TABLE = "Users";
export const PROJECTS_TABLE = "Projects";
export const TASKS_TABLE = "Tasks";

export const EMAIL_FIELD = "Email";
export const STATUS_FIELD = "Status";
export const ORG_FIELD = "Org";
export const PROJECT_FIELD = "Project";
export const ASSIGNEE_FIELD = "Assignee";
export const TITLE_FIELD = "Title";
export const DUE_DATE_FIELD = "DueDate";

/** Formula: započítať len záznamy patriace do danej org (linked record Org obsahuje orgId). */
export function orgFilterFormula(orgId: string): string {
  return `FIND("${orgId}", ARRAYJOIN({${ORG_FIELD}})) > 0`;
}

/** Formula: org + projekt (pre úlohy v projekte). */
export function orgAndProjectFilterFormula(orgId: string, projectId: string): string {
  return `AND(${orgFilterFormula(orgId)}, FIND("${projectId}", ARRAYJOIN({${PROJECT_FIELD}})) > 0)`;
}
