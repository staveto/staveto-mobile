import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type HomeQuickActionRole = "worker" | "teamleader" | "manager";

export type HomeQuickActionId =
  | "time"
  | "tasks"
  | "photo"
  | "problem"
  | "navigation"
  | "report"
  | "app"
  | "team"
  | "materials"
  | "tools"
  | "dashboard"
  | "planning"
  | "finance";

export type HomeQuickActionDef = {
  id: HomeQuickActionId;
  icon: ComponentProps<typeof Ionicons>["name"];
  labelKey: string;
  accent?: string;
};

export type HomeQuickActionRoleInput = {
  canAccessBusiness: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isManager: boolean;
  canViewBusinessDashboard: boolean;
};

export function resolveHomeQuickActionRole(input: HomeQuickActionRoleInput): HomeQuickActionRole {
  if (input.canViewBusinessDashboard || input.isOwner || input.isAdmin) {
    return "manager";
  }
  if (input.canAccessBusiness && input.isManager) {
    return "teamleader";
  }
  return "worker";
}

const WORKER_ACTIONS: HomeQuickActionDef[] = [
  { id: "time", icon: "time-outline", labelKey: "home.quickActions.time", accent: "#22c55e" },
  { id: "tasks", icon: "checkbox-outline", labelKey: "home.quickActions.tasks", accent: "#3b82f6" },
  { id: "photo", icon: "camera-outline", labelKey: "home.quickActions.photo", accent: "#8b5cf6" },
  { id: "problem", icon: "warning-outline", labelKey: "home.quickActions.problem", accent: "#ef4444" },
  { id: "navigation", icon: "navigate-outline", labelKey: "home.quickActions.navigation", accent: "#e06737" },
  { id: "report", icon: "document-text-outline", labelKey: "home.quickActions.report", accent: "#64748b" },
];

const TEAMLEADER_ACTIONS: HomeQuickActionDef[] = [
  { id: "team", icon: "people-outline", labelKey: "home.quickActions.team", accent: "#0ea5e9" },
  { id: "materials", icon: "cube-outline", labelKey: "home.quickActions.materials", accent: "#f59e0b" },
  { id: "tools", icon: "construct-outline", labelKey: "home.quickActions.tools", accent: "#6366f1" },
];

const MANAGER_ACTIONS: HomeQuickActionDef[] = [
  { id: "dashboard", icon: "grid-outline", labelKey: "home.quickActions.dashboard", accent: "#1D376A" },
  { id: "planning", icon: "calendar-outline", labelKey: "home.quickActions.planning", accent: "#0d9488" },
  { id: "finance", icon: "wallet-outline", labelKey: "home.quickActions.finance", accent: "#b45309" },
];

export function buildHomeQuickActions(role: HomeQuickActionRole): HomeQuickActionDef[] {
  if (role === "manager") {
    return [...WORKER_ACTIONS, ...MANAGER_ACTIONS];
  }
  if (role === "teamleader") {
    return [...WORKER_ACTIONS, ...TEAMLEADER_ACTIONS];
  }
  return WORKER_ACTIONS;
}

/** Field launcher: 5 quick actions + one tile to open the full home dashboard. */
export const HOME_LAUNCHER_ACTIONS: HomeQuickActionDef[] = [
  WORKER_ACTIONS[0],
  WORKER_ACTIONS[1],
  WORKER_ACTIONS[2],
  WORKER_ACTIONS[3],
  WORKER_ACTIONS[4],
  { id: "app", icon: "grid-outline", labelKey: "home.launcher.app", accent: "#1D376A" },
];
