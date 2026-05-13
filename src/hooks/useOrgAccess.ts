import { useMemo } from "react";
import { useActiveOrg } from "./useActiveOrg";

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

    const canAccessBusiness =
      !!activeBusinessOrgId &&
      isActiveMember &&
      orgStatus === "active" &&
      businessEnabled;

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
      canAccessBusiness,
    };
  }, [activeBusinessOrgId, activeMembership, activeOrganization]);
}

