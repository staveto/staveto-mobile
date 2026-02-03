/**
 * Role helper functions - READ-ONLY mapping from existing data structure
 * NO database changes - only reads existing fields
 */

import { colors } from "../theme";
import type { ProjectDoc } from "../services/projects";

export type RoleKey = "ADMIN" | "MANAGER" | "TRADE" | "UNKNOWN";
export type RoleLabel = "SPRÁVCA" | "STAVBYVEDÚCI" | "REMESLENÍK" | "NEZNÁMA ROLA";

/**
 * Normalize role key from existing project data structure
 * Reads from project.ownerId, project.members, or any existing role field
 * Returns normalized key for filtering/comparison
 * 
 * Role mapping based on projectType:
 * - BUILD/MANAGEMENT → STAVBYVEDÚCI (site manager)
 * - TRADE → REMESELNÍK (craftsman)
 * - RESIDENTIAL/MAINTENANCE → SPRÁVCA (administrator)
 */
export function normalizeRoleKey(
  project: ProjectDoc & { ownerId?: string },
  currentUserId: string
): RoleKey {
  // If user is not the owner, they might be a member (future feature)
  // For now, we only show projects where user is owner
  if (project.ownerId !== currentUserId) {
    // TODO: If members subcollection is loaded, check member role
    return "UNKNOWN";
  }

  // Determine role based on projectType
  // This is a UI-only mapping - no DB changes
  const projectType = project.projectType;
  
  if (projectType === "BUILD" || projectType === "MANAGEMENT") {
    // BUILD/MANAGEMENT projects → STAVBYVEDÚCI (site manager)
    return "MANAGER";
  }
  
  if (projectType === "TRADE") {
    // TRADE projects → REMESELNÍK (craftsman)
    return "TRADE";
  }
  
  if (projectType === "RESIDENTIAL" || projectType === "MAINTENANCE") {
    // RESIDENTIAL/MAINTENANCE projects → SPRÁVCA (administrator)
    return "ADMIN";
  }

  // Fallback: if projectType is missing or unknown, default to ADMIN (SPRÁVCA)
  if (__DEV__) {
    console.warn(
      `[role] Unknown projectType for project ${project.id}: ${projectType}. Defaulting to ADMIN.`
    );
  }
  return "ADMIN";
}

/**
 * Get user role label for display
 * Reads from existing project data structure (no mutations)
 */
export function getUserRoleLabel(
  project: ProjectDoc & { ownerId?: string },
  currentUserId: string
): RoleLabel {
  const roleKey = normalizeRoleKey(project, currentUserId);

  switch (roleKey) {
    case "ADMIN":
      return "SPRÁVCA";
    case "MANAGER":
      return "STAVBYVEDÚCI";
    case "TRADE":
      return "REMESLENÍK";
    default:
      if (__DEV__) {
        console.warn(
          `[role] Unknown role for project ${project.id}, user ${currentUserId}. ownerId=${project.ownerId}`
        );
      }
      return "NEZNÁMA ROLA";
  }
}

/**
 * Get role color for RoleChip
 */
export function getRoleColor(roleKey: RoleKey): string {
  switch (roleKey) {
    case "ADMIN":
      return colors.primary; // Orange/primary color
    case "MANAGER":
      return "#4CAF50"; // Green
    case "TRADE":
      return "#2196F3"; // Blue
    default:
      return colors.textMuted; // Grey
  }
}
