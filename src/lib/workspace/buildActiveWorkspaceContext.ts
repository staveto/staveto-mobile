import type { ActiveWorkspaceContext } from "./workspaceContract";
import {
  resolveWorkspaceDisplayName,
  workspaceIdForPersistence,
  type WorkspaceRole,
} from "./workspaceContract";
import type { OrganizationMarketInput, UserMarketInput } from "../market/marketProfileContract";
import { resolveActiveMarketProfile } from "../market/resolveActiveMarketProfile";

export type MobileWorkspaceInput = {
  kind: "solo" | "company";
  workspaceId: string;
  role?: WorkspaceRole | "owner";
  firstName?: string | null;
  companyLegalName?: string | null;
  companyName?: string | null;
  userPreferredLanguage?: string | null;
  /** Legacy solo country — never used for company workspace resolution. */
  userPrimaryCountry?: string | null;
  userTimezone?: string | null;
  userProfile?: UserMarketInput | null;
  organizationProfile?: OrganizationMarketInput | null;
};

function buildUserMarketInput(input: MobileWorkspaceInput): UserMarketInput {
  return {
    ...(input.userProfile ?? {}),
    preferredLanguage: input.userPreferredLanguage ?? input.userProfile?.preferredLanguage,
    primaryCountry: input.userProfile?.primaryCountry ?? input.userPrimaryCountry ?? null,
    timezone: input.userTimezone ?? input.userProfile?.timezone ?? null,
  };
}

export function buildActiveWorkspaceContext(input: MobileWorkspaceInput): ActiveWorkspaceContext {
  const kind = input.kind;
  const userProfile = buildUserMarketInput(input);

  const market = resolveActiveMarketProfile({
    activeWorkspaceType: kind,
    userProfile,
    organizationProfile: kind === "company" ? input.organizationProfile ?? null : null,
    userPreferredLanguage: input.userPreferredLanguage ?? userProfile.preferredLanguage ?? null,
    userTimezone: input.userTimezone ?? userProfile.timezone ?? null,
  });

  const documentLanguage = market.activeDefaultDocumentLanguage;

  const activeWorkspaceName = resolveWorkspaceDisplayName({
    kind,
    firstName: input.firstName,
    legalName: input.companyLegalName,
    companyName: input.companyName,
  });

  return {
    activeWorkspaceId: workspaceIdForPersistence({
      type: kind === "company" ? "company" : "personal",
      orgId: kind === "company" ? input.workspaceId : undefined,
      id: input.workspaceId,
    }),
    activeWorkspaceType: kind,
    activeWorkspaceName,
    activeRole: input.role ?? "owner",
    activeCountryCode: market.activeCountryCode,
    activeCurrency: market.activeCurrency,
    activeTimezone: market.activeTimezone,
    activeLanguage: documentLanguage,
    userPreferredLanguage: input.userPreferredLanguage?.trim() || null,
    activeMarketSource: market.activeMarketSource,
    activeLocale: market.activeLocale,
    activeDefaultDocumentLanguage: documentLanguage,
    activeTaxProfile: market.activeTaxProfile,
    activeLegalProfile: market.activeLegalProfile,
    marketConfigVersion: market.marketConfigVersion,
    marketConfigWarnings: market.marketConfigWarnings,
  };
}
