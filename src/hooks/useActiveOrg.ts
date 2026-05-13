import { useBusiness } from "../context/BusinessContext";

export function useActiveOrg() {
  const {
    activeBusinessOrgId,
    activeOrganization,
    activeMembership,
    loading,
    refreshActiveBusinessOrg,
  } = useBusiness();

  return {
    activeBusinessOrgId,
    activeOrganization,
    activeMembership,
    loading,
    refresh: refreshActiveBusinessOrg,
  };
}

