import { useMemo } from "react";
import { useActiveOrg } from "./useActiveOrg";
import {
  getEffectivePermissions,
  type BusinessPermissions,
} from "../lib/businessRolePermissions";
import { isWebOnboardedOrg, isTrialActive } from "../services/organizations";

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

    const trialActive =
      orgStatus === "trialing" ||
      (activeOrganization ? isTrialActive(activeOrganization) : false);

    const webOnboarded = activeOrganization ? isWebOnboardedOrg(activeOrganization) : false;
    const ownsOrg =
      !!activeOrganization?.ownerUid &&
      (activeMembership?.userId === activeOrganization.ownerUid || isOwner);

    const hasActiveBusinessOrder =
      typeof activeOrganization?.activeBusinessOrderId === "string" &&
      activeOrganization.activeBusinessOrderId.trim().length > 0;

    const pendingCanAccess =
      orgStatus === "pending_payment" &&
      isActiveMember &&
      (trialActive || hasActiveBusinessOrder || businessEnabled);

    const statusAllowsDashboard =
      orgStatus === "active"
        ? businessEnabled || webOnboarded || ownsOrg
        : orgStatus === "trialing"
        ? trialActive || webOnboarded || ownsOrg
        : orgStatus === "pending_payment"
        ? pendingCanAccess || webOnboarded || ownsOrg
        : false;

    const orgGateOpen = !!activeBusinessOrgId && isActiveMember && statusAllowsDashboard;

    const canViewBusinessDashboard = orgGateOpen && (isOwner || permissions.canViewBusinessDashboard);

    const canAccessBusiness =
      !!activeBusinessOrgId && isActiveMember && orgGateOpen;

    /** Team chat: all active org members (workers included). Viewers may read; write is gated in chat UI + Firestore. */
    const canAccessBusinessChat = canAccessBusiness;

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

    /** B2C solo users may create projects; active business members need role permission. */
    const canCreateProject = !orgGateOpen
      ? true
      : isOwner || isAdmin || isManager || permissions.canCreateProject;

    const canViewAllProjects = isOwner || isAdmin || isManager || permissions.canViewAllProjects;

    const canViewAssignedProjects =
      isOwner || isAdmin || isManager || permissions.canViewAssignedProjects || permissions.canViewAllProjects;

    const restrictsToAssignedProjectsOnly =
      !!activeBusinessOrgId &&
      isActiveMember &&
      !canViewAllProjects &&
      (isWorker || isViewer);

    let dashboardBlockReason = "dashboard_allowed";
    if (!activeBusinessOrgId) {
      dashboardBlockReason = "missing_active_business_org_id";
    } else if (!isActiveMember) {
      dashboardBlockReason = `membership_not_active:${status ?? "none"}`;
    } else if (orgStatus === "suspended") {
      dashboardBlockReason = "org_suspended";
    } else if (orgStatus === "cancelled") {
      dashboardBlockReason = "org_cancelled";
    } else if (orgStatus === "active" && !businessEnabled && !webOnboarded && !ownsOrg) {
      dashboardBlockReason = "business_not_enabled";
    } else if (orgStatus === "trialing" && !trialActive && !webOnboarded && !ownsOrg) {
      dashboardBlockReason = "trial_expired";
    } else if (orgStatus === "pending_payment" && !pendingCanAccess && !webOnboarded && !ownsOrg) {
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
      restrictsToAssignedProjectsOnly,
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
