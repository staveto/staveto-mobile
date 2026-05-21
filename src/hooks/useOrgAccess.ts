import { useMemo } from "react";
import { useActiveOrg } from "./useActiveOrg";

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
      (trialActive || businessEnabled || hasActiveBusinessOrder);

    const statusAllowsDashboard =
      orgStatus === "active" || orgStatus === "trialing"
        ? businessEnabled
        : orgStatus === "pending_payment"
          ? pendingCanAccess
          : false;

    const canViewBusinessDashboard =
      !!activeBusinessOrgId && isActiveMember && statusAllowsDashboard;

    const canAccessBusiness =
      !!activeBusinessOrgId &&
      isActiveMember &&
      orgStatus === "active" &&
      businessEnabled;

    let dashboardBlockReason = "dashboard_allowed";
    if (!activeBusinessOrgId) {
      dashboardBlockReason = "missing_active_business_org_id";
    } else if (!isActiveMember) {
      dashboardBlockReason = `membership_not_active:${status ?? "none"}`;
    } else if (
      (orgStatus === "active" || orgStatus === "trialing") &&
      !businessEnabled
    ) {
      dashboardBlockReason = "business_not_enabled";
    } else if (orgStatus === "suspended") {
      dashboardBlockReason = "org_suspended";
    } else if (orgStatus === "cancelled") {
      dashboardBlockReason = "org_cancelled";
    } else if (orgStatus === "pending_payment" && !pendingCanAccess) {
      dashboardBlockReason = "pending_payment_without_trial_access";
    } else if (orgStatus === "past_due") {
      dashboardBlockReason = "org_past_due";
    } else if (!canViewBusinessDashboard) {
      dashboardBlockReason = `org_status_blocked:${orgStatus ?? "unknown"}`;
    }

    return {
      role,
      status,
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
      pendingCanAccess,
      canViewBusinessDashboard,
      canAccessBusiness,
      dashboardBlockReason,
    };
  }, [activeBusinessOrgId, activeMembership, activeOrganization]);
}
