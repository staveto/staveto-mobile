import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveOrg } from "./useActiveOrg";
import {
  evaluateCapabilities,
  type CapabilityInput,
  type CapabilityResult,
} from "../lib/capabilities";

export function useCapabilities(
  overrides?: Partial<CapabilityInput>
): CapabilityResult {
  const { user } = useAuth();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();

  return useMemo(() => {
    const input: CapabilityInput = {
      userSubscriptionTier: overrides?.userSubscriptionTier,
      userSubscriptionStatus: overrides?.userSubscriptionStatus,
      billingStatus: overrides?.billingStatus ?? user?.billing?.status ?? null,
      billingIsPro: overrides?.billingIsPro ?? user?.billing?.isPro ?? null,
      hasPersonalProEntitlement: overrides?.hasPersonalProEntitlement,
      planType: overrides?.planType,
      projectWorkspaceType: overrides?.projectWorkspaceType,
      projectOrgId: overrides?.projectOrgId,
      activeBusinessOrgId:
        overrides?.activeBusinessOrgId ?? activeBusinessOrgId ?? null,
      organizationStatus:
        overrides?.organizationStatus ?? activeOrganization?.status ?? null,
      organizationBusinessEnabled:
        overrides?.organizationBusinessEnabled ??
        activeOrganization?.businessEnabled ??
        null,
      membershipRole: overrides?.membershipRole ?? activeMembership?.role ?? null,
      membershipStatus:
        overrides?.membershipStatus ?? activeMembership?.status ?? null,
      projectCount: overrides?.projectCount,
      freeProjectLimit: overrides?.freeProjectLimit,
      legacyProject: overrides?.legacyProject,
    };

    return evaluateCapabilities(input);
  }, [
    overrides?.userSubscriptionTier,
    overrides?.userSubscriptionStatus,
    overrides?.billingStatus,
    overrides?.billingIsPro,
    overrides?.hasPersonalProEntitlement,
    overrides?.planType,
    overrides?.projectWorkspaceType,
    overrides?.projectOrgId,
    overrides?.activeBusinessOrgId,
    overrides?.organizationStatus,
    overrides?.organizationBusinessEnabled,
    overrides?.membershipRole,
    overrides?.membershipStatus,
    overrides?.projectCount,
    overrides?.freeProjectLimit,
    overrides?.legacyProject,
    user?.billing?.status,
    user?.billing?.isPro,
    activeBusinessOrgId,
    activeOrganization?.status,
    activeOrganization?.businessEnabled,
    activeMembership?.role,
    activeMembership?.status,
  ]);
}
