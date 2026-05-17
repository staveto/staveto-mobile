import { useMemo } from "react";
import { useBusiness } from "../context/BusinessContext";
import { BILLING_ORDER_SURFACE_BOOST_ACCESS_THRESHOLD } from "../services/organizations";
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
  const { billingOwnerOrderSurfaceBoostScore } = useBusiness();

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
    const trialIsValid = trialEndsAtMs !== null && trialEndsAtMs > Date.now();
    const hasActiveOrderLink = !!activeOrganization?.activeBusinessOrderId;
    const orderSurfaceAllowsPending =
      typeof billingOwnerOrderSurfaceBoostScore === "number" &&
      billingOwnerOrderSurfaceBoostScore >= BILLING_ORDER_SURFACE_BOOST_ACCESS_THRESHOLD;
    const pendingCanAccess =
      orgStatus === "pending_payment" &&
      (trialIsValid || businessEnabled || hasActiveOrderLink || orderSurfaceAllowsPending);
    const statusCanAccess = orgStatus === "active" || orgStatus === "trialing" || pendingCanAccess;

    const canAccessBusiness =
      !!activeBusinessOrgId &&
      isActiveMember &&
      statusCanAccess;

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
      trialIsValid,
      pendingCanAccess,
      canAccessBusiness,
    };
  }, [activeBusinessOrgId, activeMembership, activeOrganization, billingOwnerOrderSurfaceBoostScore]);
}

