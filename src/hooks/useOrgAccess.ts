import { useMemo } from "react";
import { useActiveOrg } from "./useActiveOrg";
import {
  getEffectivePermissions,
  type BusinessPermissions,
} from "../lib/businessRolePermissions";

function toMillis(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const maybeTimestamp = raw as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") {
      const parsed = maybeTimestamp.toDate().getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

export function useOrgAccess() {
  const { activeBusinessOrgId, activeMembership, activeOrganization } = useActiveOrg();

  return useMemo(() => {
    const role = activeMembership?.role ?? null;
    const status = activeMembership?.status ?? null;
    const orgStatus = activeOrganization?.status ?? null;
    const businessEnabled = activeOrganization?.businessEnabled === true;
    const seatsLimit = activeOrganization?.seatsLimit ?? 0;
    const seatsUsed = activeOrganization?.seatsUsed ?? 0;

    const isOwner = role === "owner";
    const isAdmin = role === "admin";
    const isManager = role === "manager";
    const isWorker = role === "worker";
    const isViewer = role === "viewer";
    const isActiveMember = status === "active";

    const permissions: BusinessPermissions = getEffectivePermissions(
      role ?? "viewer",
      activeMembership?.permissions
    );

    const trialEndsAtMs = toMillis(activeOrganization?.trialEndsAt);
    const trialActive =
      orgStatus === "trialing" ||
      (trialEndsAtMs !== null && trialEndsAtMs > Date.now());

    const hasActiveBusinessOrder =
      typeof activeOrganization?.activeBusinessOrderId === "string" &&
      activeOrganization.activeBusinessOrderId.trim().length > 0;

    const pendingCanAccess =
      orgStatus === "pending_payment" &&
      isActiveMember &&
      (trialActive || hasActiveBusinessOrder || businessEnabled);

    const statusAllowsDashboard =
      orgStatus === "active"
        ? businessEnabled
        : orgStatus === "trialing"
        ? trialActive
        : orgStatus === "pending_payment"
        ? pendingCanAccess
        : false;

    const orgGateOpen = !!activeBusinessOrgId && isActiveMember && statusAllowsDashboard;

    const canViewBusinessDashboard = orgGateOpen && (isOwner || permissions.canViewBusinessDashboard);

    const canAccessBusiness =
      !!activeBusinessOrgId &&
      isActiveMember &&
      orgStatus === "active" &&
      businessEnabled;

    const canAccessBusinessChat = orgGateOpen && (isOwner || permissions.canViewBusinessDashboard);

    const canViewContacts =
      orgGateOpen && (isOwner || isAdmin || permissions.canManageContacts || permissions.canViewBusinessDashboard);

    const canManageContacts =
      orgGateOpen && (isOwner || isAdmin || permissions.canManageContacts);

    const canViewBusinessMaterials =
      orgGateOpen &&
      (isOwner ||
        isAdmin ||
        permissions.canViewMaterialPrices ||
        permissions.canAddMaterial ||
        permissions.canViewBusinessKpis);

    const canManageTeam = orgGateOpen && (isOwner || permissions.canManageTeam);

    const canManageBilling = orgGateOpen && (isOwner || permissions.canManageBilling);

    const canCreateProject = isOwner || isAdmin || permissions.canCreateProject;

    const canViewAllProjects = isOwner || isAdmin || permissions.canViewAllProjects;

    const canViewAssignedProjects =
      isOwner || isAdmin || permissions.canViewAssignedProjects || permissions.canViewAllProjects;

    let dashboardBlockReason = "dashboard_allowed";
    if (!activeBusinessOrgId) {
      dashboardBlockReason = "missing_active_business_org_id";
    } else if (!isActiveMember) {
      dashboardBlockReason = `membership_not_active:${status ?? "none"}`;
    } else if (orgStatus === "suspended") {
      dashboardBlockReason = "org_suspended";
    } else if (orgStatus === "cancelled") {
      dashboardBlockReason = "org_cancelled";
    } else if (orgStatus === "active" && !businessEnabled) {
      dashboardBlockReason = "business_not_enabled";
    } else if (orgStatus === "trialing" && !trialActive) {
      dashboardBlockReason = "trial_expired";
    } else if (orgStatus === "pending_payment" && !pendingCanAccess) {
      dashboardBlockReason = "pending_payment_without_trial_access";
    } else if (orgStatus === "past_due") {
      dashboardBlockReason = "org_past_due";
    } else if (!statusAllowsDashboard) {
      dashboardBlockReason = `org_status_blocked:${orgStatus ?? "unknown"}`;
    } else if (!isOwner && !permissions.canViewBusinessDashboard) {
      dashboardBlockReason = "permissions_dashboard_denied";
    }

    return {
      role,
      status,
      permissions,
      isOwner,
      isAdmin,
      isManager,
      isWorker,
      isViewer,
      isActiveMember,
      businessEnabled,
      orgStatus,
      seatsLimit,
      seatsUsed,
      trialActive,
      hasActiveBusinessOrder,
      pendingCanAccess,
      statusAllowsDashboard,
      canViewBusinessDashboard,
      canAccessBusiness,
      canAccessBusinessChat,
      canViewContacts,
      canManageContacts,
      canViewBusinessMaterials,
      canManageTeam,
      canManageBilling,
      canCreateProject,
      canViewAllProjects,
      canViewAssignedProjects,
      canAddDailyReport: isOwner || permissions.canAddDailyReport,
      canAddPhotos: isOwner || permissions.canAddPhotos,
      canAddMaterial: isOwner || permissions.canAddMaterial,
      canViewMaterialPrices: isOwner || permissions.canViewMaterialPrices,
      canAddExpense: isOwner || permissions.canAddExpense,
      canViewProjectCosts: isOwner || permissions.canViewProjectCosts,
      canViewBusinessKpis: isOwner || permissions.canViewBusinessKpis,
      dashboardBlockReason,
    };
  }, [activeBusinessOrgId, activeMembership, activeOrganization]);
}
