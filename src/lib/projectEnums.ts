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
  HomeTypeFilterBucket,
  ProjectsTabTypeFilter,
} from "./projectTypeModel";

export {
  getProjectEngine,
  getEngineType,
  isLegacyResidential,
  isKnownStorageType,
  isBuildLikeStorageType,
  isTradeLikeStorageType,
  isMaintenanceStorageType,
  toProductKind,
  getHomeTypeFilterBucket,
  getProjectsTabTypeFilterBucket,
  matchesProjectsTabTypeFilter,
  shouldUseCountryCatalogTemplate,
  projectOverviewLoadsPhases,
  projectOverviewUsesPhaseGroupedTasks,
  projectOverviewLoadsDiary,
  projectOverviewLoadsDocuments,
  projectOverviewLoadsEquipmentAndServiceRules,
  projectOverviewIsTradeOrMaintenanceFlatTasks,
  isSoloOwnerProjectRow,
  isSharedOrCollaborativeProjectRow,
} from "./projectTypeModel";

/** Work type – BUILD (construction) */
export type WorkTypeBuild = "NEW_BUILD" | "RENOVATION" | "INSTALLATION" | "SERVICE";

/** Work type – TRADE (Aufträge, craftsmen) */
export type WorkTypeTrade = "INSTALLATION" | "REPAIR" | "RENOVATION" | "DELIVERY";

/** Maintenance scope – MAINTENANCE (Wartung) */
export type MaintenanceScope = "FLEET" | "MACHINERY" | "PROPERTY" | "EQUIPMENT";

/** Work type attribute – union for storage (engine-specific at wizard) */
export type WorkType = WorkTypeBuild | WorkTypeTrade | MaintenanceScope;

/** Step 2 options per engine */
export const WORK_TYPES_BUILD: WorkTypeBuild[] = ["NEW_BUILD", "RENOVATION", "INSTALLATION", "SERVICE"];
export const WORK_TYPES_TRADE: WorkTypeTrade[] = ["INSTALLATION", "REPAIR", "RENOVATION", "DELIVERY"];
export const MAINTENANCE_SCOPES: MaintenanceScope[] = ["FLEET", "MACHINERY", "PROPERTY", "EQUIPMENT"];

/** Business mode attribute */
export type BusinessMode = "DIRECT" | "SUBCONTRACT" | "INTERNAL";

/** Creation mode attribute */
export type CreationMode = "AI" | "MANUAL" | "TEMPLATE";
