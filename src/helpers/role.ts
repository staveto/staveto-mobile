/**
 * Role helper functions - READ-ONLY mapping from existing data structure
 * NO database changes - only reads existing fields
 */

import { colors } from "../theme";
import type { ProjectDoc } from "../services/projects";
import {
  getActiveProductProjectType,
  isLegacyMaintenanceEquipmentHub,
} from "../lib/projectTypeModel";

export type RoleKey = "ADMIN" | "MANAGER" | "TRADE" | "UNKNOWN";
export type RoleLabel = "SPRÁVCA" | "STAVBYVEDÚCI" | "REMESLENÍK" | "NEZNÁMA ROLA";

/**
 * Normalize role key from existing project data structure
 * Reads from project.ownerId, project.members, or any existing role field
 * Returns normalized key for filtering/comparison
 * 
 * Role mapping (active product types BUILD / TRADE; legacy docs normalized in logic):
 * - BUILD → STAVBYVEDÚCI (site manager)
 * - TRADE → REMESELNÍK (craftsman)
 * - Legacy MAINTENANCE equipment hub → SPRÁVCA (administrator)
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

  if (isLegacyMaintenanceEquipmentHub(project)) {
    return "ADMIN";
  }

  const active = getActiveProductProjectType(project);
  if (active === "BUILD") return "MANAGER";
  return "TRADE";
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
