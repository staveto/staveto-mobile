/**
 * Single source of truth for Firestore `projects.projectType` and derived behavior.
 *
 * ## User-facing product types (SK UI — i18n `home.filter.type.*`, `projectType.*`)
 *
 * 1) **Stavba** (chip key often `management` in `home.filter.type.management`)
 *    - **Storage:** `BUILD` (wizard) or legacy `MANAGEMENT`
 *    - **Behavior:** phased project, catalog template when creation path uses it, documents module,
 *      problem categories like BUILD/MANAGEMENT in `problems.ts`.
 *    - `MANAGEMENT` is a **legacy alias** of the same build/phased engine as `BUILD`.
 *
 * 2) **Zákazky** (`trade` chip on Projects tab = TRADE + RESIDENTIAL storage)
 *    - **Storage:** `TRADE` or legacy `RESIDENTIAL`
 *    - **Behavior:** flat tasks, diary; Home may still show separate “Dom” filter for `RESIDENTIAL`.
 *
 * 3) **Údržba** (`maintenance`)
 *    - **Storage:** `MAINTENANCE` — equipment, service rules, flat tasks.
 *
 * ## Layers
 * - **Storage** — Firestore values (legacy preserved; never rewrite in client).
 * - **Engine** — `BUILD` | `TRADE` | `MAINTENANCE` for coarse grouping.
 * - **UI buckets** — Home vs Projects tab differ (see `getHomeTypeFilterBucket` vs `getProjectsTabTypeFilterBucket`).
 */

/** Values that may appear on `projects.projectType` in Firestore. */
export type ProjectStorageType = "BUILD" | "MANAGEMENT" | "TRADE" | "RESIDENTIAL" | "MAINTENANCE";

/** Coarse engine (not the only persisted type). */
export type ProjectEngineType = "BUILD" | "TRADE" | "MAINTENANCE";

/** Product bucket for docs / analytics (not a DB field). */
export type ProductProjectKind = "stavba" | "zakazky" | "udrzba";

/** @deprecated Prefer `ProjectStorageType`; widely imported as `ProjectType`. */
export type ProjectType = ProjectStorageType;

/** Raw `projectType` from Firestore / navigation — may be unknown strings until normalized. */
export type ProjectTypeInput = ProjectStorageType | string | null | undefined;

const ALL_STORAGE: readonly ProjectStorageType[] = [
  "BUILD",
  "MANAGEMENT",
  "TRADE",
  "RESIDENTIAL",
  "MAINTENANCE",
] as const;

export function isKnownStorageType(value: unknown): value is ProjectStorageType {
  return typeof value === "string" && (ALL_STORAGE as readonly string[]).includes(value);
}

/** Legacy phased “construction management” label — treat like `BUILD` everywhere. */
export function isBuildLikeStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "BUILD" || projectType === "MANAGEMENT";
}

/** Trade / simple jobs; `RESIDENTIAL` is legacy storage but trade-like in UI/engine. */
export function isTradeLikeStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "TRADE" || projectType === "RESIDENTIAL";
}

export function isMaintenanceStorageType(projectType?: ProjectTypeInput): boolean {
  return projectType === "MAINTENANCE";
}

/** Default `TRADE` when missing — matches historical `getEngineType`. */
export function getProjectEngine(projectType?: ProjectTypeInput): ProjectEngineType {
  if (!projectType) return "TRADE";
  if (projectType === "RESIDENTIAL") return "TRADE";
  if (projectType === "MANAGEMENT" || projectType === "BUILD") return "BUILD";
  if (projectType === "TRADE" || projectType === "MAINTENANCE") return projectType;
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
  if (isMaintenanceStorageType(projectType)) return "udrzba";
  if (isBuildLikeStorageType(projectType)) return "stavba";
  return "zakazky";
}

/** Home type filter: `MANAGEMENT` bucket = BUILD + MANAGEMENT + unknown. */
export type HomeTypeFilterBucket = "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "MAINTENANCE";

export function getHomeTypeFilterBucket(projectType?: ProjectTypeInput): HomeTypeFilterBucket {
  if (projectType === "MAINTENANCE") return "MAINTENANCE";
  if (projectType === "RESIDENTIAL") return "RESIDENTIAL";
  if (projectType === "TRADE") return "TRADE";
  return "MANAGEMENT";
}

/** Projects tab chips: TRADE chip includes both TRADE and RESIDENTIAL. */
export type ProjectsTabTypeFilter = "ALL" | "MANAGEMENT" | "TRADE" | "MAINTENANCE";

export function getProjectsTabTypeFilterBucket(
  projectType?: ProjectTypeInput
): Exclude<ProjectsTabTypeFilter, "ALL"> {
  if (projectType === "MAINTENANCE") return "MAINTENANCE";
  if (projectType === "RESIDENTIAL" || projectType === "TRADE") return "TRADE";
  return "MANAGEMENT";
}

export function matchesProjectsTabTypeFilter(
  projectType: ProjectTypeInput,
  selected: ProjectsTabTypeFilter
): boolean {
  if (selected === "ALL") return true;
  return getProjectsTabTypeFilterBucket(projectType) === selected;
}

/** Catalog template + phases/tasks on create (`ProjectsScreen` / `projectFactory`). */
export function shouldUseCountryCatalogTemplate(params: {
  selectedType: ProjectStorageType;
  creationMethod: "template" | "empty";
}): boolean {
  const { selectedType, creationMethod } = params;
  return selectedType === "BUILD" || (selectedType === "MANAGEMENT" && creationMethod === "template");
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

export function projectOverviewLoadsEquipmentAndServiceRules(projectType?: ProjectTypeInput): boolean {
  return isMaintenanceStorageType(projectType);
}

export function projectOverviewIsTradeOrMaintenanceFlatTasks(projectType?: ProjectTypeInput): boolean {
  return isTradeLikeStorageType(projectType) || isMaintenanceStorageType(projectType);
}

// --- Home / Projects “Moje” / “Zdieľané” (intent-revealing names; logic unchanged) ---

/** Solo owner row: not shared-to-me and no collaborators on project. */
export function isSoloOwnerProjectRow(p: { isSharedToMe?: boolean; sharedWithCount?: number | null }): boolean {
  return p.isSharedToMe !== true && (p.sharedWithCount ?? 0) === 0;
}

/** Invited member OR owner with team (shared count). */
export function isSharedOrCollaborativeProjectRow(p: { isSharedToMe?: boolean; sharedWithCount?: number | null }): boolean {
  return p.isSharedToMe === true || (p.sharedWithCount ?? 0) > 0;
}
