/**
 * Project classification enums for engine + attributes.
 * Backward compatible: existing projects may have null for new fields.
 */

/** Engine type - determines project structure (phases, equipment, etc.) */
export type ProjectEngineType = "BUILD" | "TRADE" | "MAINTENANCE";

/** Legacy RESIDENTIAL maps to TRADE in UI. MANAGEMENT maps to BUILD. */
export type ProjectType = ProjectEngineType | "RESIDENTIAL" | "MANAGEMENT";

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

/** Map project.type to engine for display/filtering */
export function getEngineType(projectType?: ProjectType | null): ProjectEngineType {
  if (!projectType) return "TRADE";
  if (projectType === "RESIDENTIAL") return "TRADE";
  if (projectType === "MANAGEMENT" || projectType === "BUILD") return "BUILD";
  if (projectType === "TRADE" || projectType === "MAINTENANCE") return projectType;
  return "TRADE";
}

/** Check if project is legacy RESIDENTIAL (show Legacy badge) */
export function isLegacyResidential(projectType?: ProjectType | null): boolean {
  return projectType === "RESIDENTIAL";
}
