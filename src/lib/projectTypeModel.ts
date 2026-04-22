/**
 * Firestore may still store legacy `projects.projectType` values.
 * **Active product model (new writes & primary UX):** `BUILD` | `TRADE` only.
 *
 * Legacy storage (read compatibility, not for new projects):
 * - `MANAGEMENT` → treated as `BUILD`
 * - `RESIDENTIAL` → treated as `TRADE`
 * - `MAINTENANCE` + `jobsTabVisible === true` → treated as `TRADE` (flat job workspace)
 * - `MAINTENANCE` + `jobsTabVisible !== true` → legacy equipment/inventory hub (hidden from project lists;
 *   overview may still load project-scoped equipment rules for those IDs)
 */

/** Values that may still appear on `projects.projectType` in Firestore. */
export type LegacyProjectStorageType =
  | "BUILD"
  | "MANAGEMENT"
  | "TRADE"
  | "RESIDENTIAL"
  | "MAINTENANCE";

/** Persisted / product-facing type for new projects and normalized logic. */
export type ActiveProjectStorageType = "BUILD" | "TRADE";

/** Alias for all values that can appear in Firestore. */
export type ProjectStorageType = LegacyProjectStorageType;

/** @deprecated Prefer `ProjectStorageType` — kept for widespread imports as `ProjectType`. */
export type ProjectType = ProjectStorageType;

export type ProjectTypeInput = LegacyProjectStorageType | string | null | undefined;

/** Engine / UX coarse grouping — only two supported modes. */
export type ProjectEngineType = ActiveProjectStorageType;

/** Product bucket for analytics / copy (no `udrzba` — maintenance jobs are `zakazky`). */
export type ProductProjectKind = "stavba" | "zakazky";

const ALL_LEGACY: readonly LegacyProjectStorageType[] = [
  "BUILD",
  "MANAGEMENT",
  "TRADE",
  "RESIDENTIAL",
  "MAINTENANCE",
] as const;

export function isKnownStorageType(value: unknown): value is LegacyProjectStorageType {
  return typeof value === "string" && (ALL_LEGACY as readonly string[]).includes(value);
}

/** Legacy phased “construction management” — same engine as `BUILD`. */
export function isBuildLikeStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "BUILD" || projectType === "MANAGEMENT";
}

/** Trade-style / flat task layout (includes legacy residential + maintenance job workspaces). */
export function isTradeLikeStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "TRADE" || projectType === "RESIDENTIAL" || projectType === "MAINTENANCE";
}

/** Raw MAINTENANCE document (any). */
export function isMaintenanceStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "MAINTENANCE";
}

/**
 * Legacy MAINTENANCE projects used as equipment/inventory hubs (not job workspaces).
 * Kept for compatibility with `projects/{id}/equipment` and older flows — not an active product type.
 */
export function isLegacyMaintenanceEquipmentHub(project: {
  projectType?: ProjectTypeInput;
  jobsTabVisible?: boolean;
}): boolean {
  return project.projectType === "MAINTENANCE" && project.jobsTabVisible !== true;
}

/**
 * Active product type for filters, chips, and new work — always `BUILD` or `TRADE`.
 * Does not distinguish legacy hubs (use `isLegacyMaintenanceEquipmentHub` + list filters).
 */
export function getActiveProductProjectType(project: {
  projectType?: ProjectTypeInput;
  jobsTabVisible?: boolean;
}): ActiveProjectStorageType {
  const raw = project.projectType;
  if (raw === "BUILD" || raw === "MANAGEMENT") return "BUILD";
  return "TRADE";
}

export function getProjectEngine(projectType?: ProjectTypeInput): ProjectEngineType {
  if (!projectType) return "TRADE";
  if (projectType === "MANAGEMENT" || projectType === "BUILD") return "BUILD";
  return "TRADE";
}

/** @deprecated Prefer `getProjectEngine`. */
export function getEngineType(projectType?: ProjectTypeInput): ProjectEngineType {
  return getProjectEngine(projectType);
}

export function isLegacyResidential(projectType?: ProjectTypeInput): boolean {
  return projectType === "RESIDENTIAL";
}

export function toProductKind(projectType?: ProjectTypeInput): ProductProjectKind {
  if (isBuildLikeStorageType(projectType)) return "stavba";
  return "zakazky";
}

/** Home / Projects type filter — only `BUILD` and `TRADE` buckets. */
export type HomeTypeFilterBucket = ActiveProjectStorageType;

export function getHomeTypeFilterBucket(projectType?: ProjectTypeInput): HomeTypeFilterBucket {
  return getProjectEngine(projectType);
}

/** Projects tab chips — `BUILD` (stavba) vs `TRADE` (jobs). */
export type ProjectsTabTypeFilter = "ALL" | "BUILD" | "TRADE";

export function getProjectsTabTypeFilterBucket(projectType?: ProjectTypeInput): ActiveProjectStorageType {
  return getActiveProductProjectType({ projectType });
}

export function matchesProjectsTabTypeFilter(
  projectType: ProjectTypeInput,
  selected: ProjectsTabTypeFilter
): boolean {
  if (selected === "ALL") return true;
  return getProjectsTabTypeFilterBucket(projectType) === selected;
}

export function isProjectShownOnProjectsJobsTab(project: {
  projectType?: ProjectTypeInput;
  jobsTabVisible?: boolean;
}): boolean {
  if (project.jobsTabVisible === false) return false;
  if (isLegacyMaintenanceEquipmentHub(project)) return false;
  return true;
}

export function shouldUseCountryCatalogTemplate(params: {
  selectedType: ProjectStorageType;
  creationMethod: "template" | "empty";
}): boolean {
  const { selectedType, creationMethod } = params;
  return selectedType === "BUILD" && creationMethod === "template";
}

// --- ProjectOverview ---

export function projectOverviewLoadsPhases(projectType?: ProjectTypeInput): boolean {
  return isBuildLikeStorageType(projectType);
}

export function projectOverviewUsesPhaseGroupedTasks(projectType?: ProjectTypeInput): boolean {
  return isBuildLikeStorageType(projectType);
}

export function projectOverviewLoadsDiary(projectType?: ProjectTypeInput): boolean {
  return (
    isBuildLikeStorageType(projectType) ||
    isTradeLikeStorageType(projectType) ||
    isMaintenanceStorageType(projectType)
  );
}

export function projectOverviewLoadsDocuments(projectType?: ProjectTypeInput): boolean {
  return isBuildLikeStorageType(projectType);
}

/** Project-scoped equipment + service rules (legacy MAINTENANCE hubs only). */
export function projectOverviewLoadsEquipmentAndServiceRules(project: {
  projectType?: ProjectTypeInput;
  jobsTabVisible?: boolean;
}): boolean {
  return isLegacyMaintenanceEquipmentHub(project);
}

export function projectOverviewIsTradeOrMaintenanceFlatTasks(projectType?: ProjectTypeInput): boolean {
  return isTradeLikeStorageType(projectType);
}

/** Title key group for Problems list / dashboard (legacy MAINTENANCE hub keeps “poruchy”). */
export function getProblemsTitleContext(project: {
  projectType?: ProjectTypeInput;
  jobsTabVisible?: boolean;
}): "maintenanceHub" | "tradeLike" | "buildLike" {
  if (isLegacyMaintenanceEquipmentHub(project)) return "maintenanceHub";
  if (isBuildLikeStorageType(project.projectType)) return "buildLike";
  return "tradeLike";
}

export function isSoloOwnerProjectRow(p: { isSharedToMe?: boolean; sharedWithCount?: number | null }): boolean {
  return p.isSharedToMe !== true && (p.sharedWithCount ?? 0) === 0;
}

export function isSharedOrCollaborativeProjectRow(p: {
  isSharedToMe?: boolean;
  sharedWithCount?: number | null;
}): boolean {
  return p.isSharedToMe === true || (p.sharedWithCount ?? 0) > 0;
}
