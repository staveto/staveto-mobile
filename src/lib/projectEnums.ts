/**
 * Project classification enums for engine + attributes.
 * Backward compatible: existing projects may have null for new fields.
 */

/** Engine type - determines project structure (phases, equipment, etc.) */
export type ProjectEngineType = "BUILD" | "TRADE" | "MAINTENANCE";

/** Legacy RESIDENTIAL maps to TRADE in UI. MANAGEMENT maps to BUILD. */
export type ProjectType = ProjectEngineType | "RESIDENTIAL" | "MANAGEMENT";

/** Work type attribute */
export type WorkType = "NEW_BUILD" | "RENOVATION" | "INSTALLATION" | "SERVICE";

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
