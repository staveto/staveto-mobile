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
