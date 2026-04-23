/**
 * Projects tab UI helpers — active filters are **BUILD** and **TRADE** only.
 * Firestore may still store legacy `projectType` values; bucketing uses `projectTypeModel`.
 */

import type { ProjectDoc } from "../services/projects";
import { getActiveProductProjectType, type ProjectsTabTypeFilter } from "./projectTypeModel";

export type { ProjectsTabTypeFilter };

export type ProjectsTabListStatus = "ALL" | "ACTIVE" | "COMPLETED" | "ARCHIVED";

export const PROJECTS_TAB_TYPE_FILTERS: readonly ProjectsTabTypeFilter[] = ["ALL", "BUILD", "TRADE"] as const;

export const PROJECTS_TAB_LIST_STATUS: readonly ProjectsTabListStatus[] = [
  "ALL",
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
] as const;

type Translate = (key: string, params?: Record<string, string>) => string;

export function projectsTabJobKindChipLabel(t: Translate, filter: ProjectsTabTypeFilter): string {
  switch (filter) {
    case "ALL":
      return t("projectsTab.jobKind.all");
    case "BUILD":
      return t("projectsTab.jobKind.construction");
    case "TRADE":
      return t("projectsTab.jobKind.trade");
    default:
      return filter;
  }
}

type CardJobKindSource = Pick<ProjectDoc, "projectType" | "jobWorkflowKind" | "serviceMaintenanceScope">;

/** Readable job type on cards (not raw storage strings). */
export function projectsTabCardJobTypeLabel(t: Translate, project: CardJobKindSource): string {
  const active = getActiveProductProjectType({ projectType: project.projectType });
  if (active === "TRADE" && project.jobWorkflowKind === "SERVICE") {
    if (project.serviceMaintenanceScope === "PROPERTY") {
      return t("projectsTab.card.jobKind.propertyMaintenance");
    }
    if (project.serviceMaintenanceScope === "EQUIPMENT") {
      return t("projectsTab.card.jobKind.equipmentMaintenance");
    }
    return t("projectsTab.card.jobKind.service");
  }
  return active === "TRADE" ? t("projectsTab.card.jobKind.trade") : t("projectsTab.card.jobKind.construction");
}

export function projectsTabListStatusLabel(t: Translate, status: ProjectsTabListStatus): string {
  return t(`projectsTab.status.${status}`);
}
