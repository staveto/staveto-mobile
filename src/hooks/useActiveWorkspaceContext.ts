import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveOrg } from "./useActiveOrg";
import { buildActiveWorkspaceContext } from "../lib/workspace/buildActiveWorkspaceContext";
import type { ActiveWorkspaceContext } from "../lib/workspace/workspaceContract";
import { getSoloWorkspaceDisplayName, SOLO_WORKSPACE_ID } from "../lib/workspace/workspaceContract";
import { readOrgCountryCode } from "../lib/companyProfileCompletion";
import type { OrganizationMarketInput } from "../lib/market/marketProfileContract";

export function useActiveWorkspaceContext(): ActiveWorkspaceContext & {
  soloDisplayName: string;
  isCompany: boolean;
} {
  const { user } = useAuth();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();

  const firstName = user?.firstName?.trim() || user?.name?.split(" ")[0]?.trim() || null;
  const isCompany = Boolean(activeBusinessOrgId?.trim());

  return useMemo(() => {
    const orgWithLegacy = activeOrganization as {
      companyName?: string;
      profile?: { legalName?: string; country?: string; countryCode?: string };
      countryCode?: string;
      country?: string;
      currency?: string;
      timezone?: string;
      locale?: string;
      defaultLanguage?: string;
      taxProfile?: OrganizationMarketInput["taxProfile"];
      legalProfile?: OrganizationMarketInput["legalProfile"];
      marketConfigVersion?: number;
    } | null;
    const legalName =
      typeof orgWithLegacy?.profile?.legalName === "string"
        ? orgWithLegacy.profile.legalName.trim()
        : null;
    const companyName =
      legalName ||
      (typeof orgWithLegacy?.companyName === "string" ? orgWithLegacy.companyName.trim() : "") ||
      activeOrganization?.name?.trim() ||
      null;

    const organizationProfile: OrganizationMarketInput | undefined =
      isCompany && activeOrganization
        ? {
            countryCode: orgWithLegacy?.countryCode ?? readOrgCountryCode(activeOrganization),
            country: orgWithLegacy?.country,
            currency: orgWithLegacy?.currency,
            timezone: orgWithLegacy?.timezone,
            locale: orgWithLegacy?.locale,
            defaultLanguage: orgWithLegacy?.defaultLanguage,
            taxProfile: orgWithLegacy?.taxProfile,
            legalProfile: orgWithLegacy?.legalProfile,
            marketConfigVersion: orgWithLegacy?.marketConfigVersion,
            profile: orgWithLegacy?.profile,
          }
        : undefined;

    const ctx = buildActiveWorkspaceContext({
      kind: isCompany ? "company" : "solo",
      workspaceId: isCompany ? activeBusinessOrgId!.trim() : SOLO_WORKSPACE_ID,
      role: (activeMembership?.role as ActiveWorkspaceContext["activeRole"]) ?? "owner",
      firstName,
      companyLegalName: legalName,
      companyName,
      userPreferredLanguage: user?.preferredLanguage ?? null,
      organizationProfile,
    });

    return {
      ...ctx,
      soloDisplayName: getSoloWorkspaceDisplayName(firstName),
      isCompany,
    };
  }, [
    activeBusinessOrgId,
    activeMembership?.role,
    activeOrganization,
    firstName,
    isCompany,
    user?.preferredLanguage,
  ]);
}
