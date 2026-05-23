/**
 * Wizard step enums (work type, business mode, creation mode).
 * **Project storage types and engine mapping:** `projectTypeModel.ts` (single source of truth).
 */

export type {
  ProjectStorageType,
  ProjectType,
  ProjectTypeInput,
  ProjectEngineType,
  ProductProjectKind,
  ActiveProjectStorageType,
  HomeTypeFilterBucket,
  ProjectsTabTypeFilter,
} from "./projectTypeModel";

export {
  getProjectEngine,
  getEngineType,
  getActiveProductProjectType,
  isLegacyResidential,
  isKnownStorageType,
  isBuildLikeStorageType,
  isTradeLikeStorageType,
  isMaintenanceStorageType,
  isLegacyMaintenanceEquipmentHub,
  toProductKind,
  getHomeTypeFilterBucket,
  getProjectsTabTypeFilterBucket,
  matchesProjectsTabTypeFilter,
  shouldUseCountryCatalogTemplate,
  isProjectShownOnProjectsJobsTab,
  projectOverviewLoadsPhases,
  projectOverviewUsesPhaseGroupedTasks,
  projectOverviewLoadsDiary,
  projectOverviewLoadsDocuments,
  projectOverviewLoadsEquipmentAndServiceRules,
  projectOverviewIsTradeOrMaintenanceFlatTasks,
  getProblemsTitleContext,
  isSoloOwnerProjectRow,
  isSharedOrCollaborativeProjectRow,
} from "./projectTypeModel";

/** Work type – BUILD (construction) */
export type WorkTypeBuild = "NEW_BUILD" | "RENOVATION" | "INSTALLATION" | "SERVICE";

/** Work type – TRADE (Aufträge, craftsmen) */
export type WorkTypeTrade = "INSTALLATION" | "REPAIR" | "RENOVATION" | "DELIVERY";

/** Legacy wizard attribute — not a supported project type anymore; kept for old Firestore `workType`. */
export type MaintenanceScope = "FLEET" | "MACHINERY" | "PROPERTY" | "EQUIPMENT";

/** Work type attribute – union for storage (engine-specific at wizard) */
export type WorkType = WorkTypeBuild | WorkTypeTrade | MaintenanceScope;

/** Step 2 options per engine */
export const WORK_TYPES_BUILD: WorkTypeBuild[] = ["NEW_BUILD", "RENOVATION", "INSTALLATION", "SERVICE"];
export const WORK_TYPES_TRADE: WorkTypeTrade[] = ["INSTALLATION", "REPAIR", "RENOVATION", "DELIVERY"];
export const MAINTENANCE_SCOPES: MaintenanceScope[] = ["FLEET", "MACHINERY", "PROPERTY", "EQUIPMENT"];

/**
 * TRADE-only: distinguishes a normal contractor job from service/maintenance work.
 * Persisted on `projects.jobWorkflowKind` (optional; omit = treat as STANDARD for legacy docs).
 */
export type JobWorkflowKind = "STANDARD" | "SERVICE";

/**
 * When `jobWorkflowKind === SERVICE`: property vs equipment maintenance (not fleet/machinery in create wizard).
 * Subset of MaintenanceScope — stored as `projects.serviceMaintenanceScope`.
 */
export type ServiceMaintenanceScope = "PROPERTY" | "EQUIPMENT";

/** Business mode attribute */
export type BusinessMode = "DIRECT" | "SUBCONTRACT" | "INTERNAL";

/**
 * Creation mode attribute.
 * - `AI` (Suggested steps): wizard delegates to `CreateProjectAIFlow` (BUILD: AI plan).
 * - `MANUAL` (Quick start): empty workspace with the standard sections (To-do / Expenses / Notes).
 * - `TEMPLATE`: BUILD-only national catalog template.
 * - `CLONE`: reuse structure from an existing project the user can read; opens
 *   the source picker → reuses the existing `CloneProjectModal` flow.
 */
export type CreationMode = "AI" | "MANUAL" | "TEMPLATE" | "CLONE";

/**
 * Unified creation flow: what the user is creating (UI-only in Phase 1).
 * Passed to AI via `projectDetails` hints; not persisted until later phases.
 */
export type NewJobArchetype =
  | "service_inspection"
  | "customer_job"
  | "large_construction_project"
  | "own_build"
  | "internal_project";

export const NEW_JOB_ARCHETYPES: readonly NewJobArchetype[] = [
  "service_inspection",
  "customer_job",
  "large_construction_project",
  "own_build",
  "internal_project",
] as const;

/** Context string appended to AI `projectDetails` (no backend schema change). */
export function getNewJobArchetypeAiContextHint(archetype: NewJobArchetype): string {
  switch (archetype) {
    case "service_inspection":
      return (
        "Job archetype: service/inspection visit (diagnostics, repair, warranty, short on-site work). " +
        "Prefer a compact checklist: diagnosis, work steps, materials, safety, handover. " +
        "Avoid long multi-phase house construction unless the brief clearly requires it."
      );
    case "customer_job":
      return (
        "Job archetype: customer job for a client (may start with an offer before execution). " +
        "Structure for clear quoting and later execution; use phases or work packages suitable for client communication."
      );
    case "large_construction_project":
      return (
        "Job archetype: large construction (full house build, major renovation, long phased project). " +
        "Use a realistic phased construction sequence with coordination-friendly tasks."
      );
    case "own_build":
      return (
        "Job archetype: owner's own house build or renovation (not a subcontractor job for a client). " +
        "Homeowner-friendly phased plan; balance coordination and on-site execution tasks."
      );
    case "internal_project":
      return (
        "Job archetype: internal company work (preparation, inventory, admin, internal coordination). " +
        "Compact task groups; avoid client-facing offer or sales language."
      );
    default:
      return "";
  }
}

export function resolveInternalProjectTypeFromArchetype(archetype: NewJobArchetype): "BUILD" | "TRADE" {
  if (archetype === "large_construction_project" || archetype === "own_build") return "BUILD";
  return "TRADE";
}

export function resolveJobWorkflowKindFromArchetype(
  archetype: NewJobArchetype
): JobWorkflowKind | undefined {
  return archetype === "service_inspection" ? "SERVICE" : undefined;
}
