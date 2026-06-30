/**

 * Shared workspace contract (web + mobile must stay aligned).

 * Phase 1: logical model only — Firestore collections unchanged.

 */

import type {
  LegalProfile,
  MarketSource,
  OrganizationMarketInput,
  TaxProfile,
  UserMarketInput,
} from "../market/marketProfileContract";



/** Canonical solo workspace id (virtual until Phase 2). */

export const SOLO_WORKSPACE_ID = "personal";



/** users/{uid} field for cross-device active workspace persistence. */

export const ACTIVE_WORKSPACE_PROFILE_FIELD = "lastActiveWorkspaceId" as const;



/** Firestore organization-backed company workspace source marker. */

export const COMPANY_WORKSPACE_SOURCE = "organization" as const;



export type WorkspaceKind = "solo" | "company";



/** Product-facing workspace type. */

export type WorkspaceType = WorkspaceKind;



export type WorkspaceRole =

  | "owner"

  | "admin"

  | "manager"

  | "accountant"

  | "worker"

  | "client";



export type ActiveWorkspaceContext = {

  activeWorkspaceId: string;

  activeWorkspaceType: WorkspaceKind;

  activeWorkspaceName: string;

  activeRole: WorkspaceRole | "owner";

  activeCountryCode: string | null;

  activeCurrency: string;

  activeTimezone: string;

  activeLanguage: string | null;

  userPreferredLanguage: string | null;

  activeMarketSource: MarketSource;

  activeLocale: string | null;

  activeDefaultDocumentLanguage: string | null;

  activeTaxProfile: TaxProfile | null;

  activeLegalProfile: LegalProfile | null;

  marketConfigVersion: number;

  marketConfigWarnings: string[];

};



export function isCompanyWorkspaceKind(kind: WorkspaceKind | undefined): boolean {

  return kind === "company";

}



export function isCompanyWorkspaceType(

  type: "personal" | "company" | "team" | undefined

): boolean {

  return type === "company" || type === "team";

}



export function toWorkspaceKind(type: "personal" | "company" | "team" | undefined): WorkspaceKind {

  return isCompanyWorkspaceType(type) ? "company" : "solo";

}



/** Normalize legal/company names for duplicate detection (web + mobile must match). */

export function normalizeCompanyIdentityName(value: string | null | undefined): string {

  return (value ?? "")

    .trim()

    .toLowerCase()

    .replace(/[,]/g, " ")

    .replace(/\./g, " ")

    .replace(/\s+/g, " ")

    .replace(/\b(spol\s+s\s+r\s+o|s\s+r\s+o)\b/g, " sro ")

    .replace(/\s+/g, " ")

    .trim();

}



export function getSoloWorkspaceDisplayName(firstName?: string | null): string {

  const trimmed = firstName?.trim();

  if (trimmed) return `${trimmed} – moje zákazky`;

  return "Moje zákazky";

}



export function resolveWorkspaceDisplayName(input: {

  kind: WorkspaceKind;

  firstName?: string | null;

  legalName?: string | null;

  companyName?: string | null;

}): string {

  if (input.kind === "solo") {

    return getSoloWorkspaceDisplayName(input.firstName);

  }

  return input.legalName?.trim() || input.companyName?.trim() || "Firma";

}



export function workspaceIdForPersistence(input: {

  type: "personal" | "company";

  orgId?: string | null;

  id?: string;

}): string {

  if (input.type === "personal") return SOLO_WORKSPACE_ID;

  return input.orgId?.trim() || input.id?.trim() || SOLO_WORKSPACE_ID;

}



export function isSoloWorkspaceId(id: string | null | undefined): boolean {

  if (!id?.trim()) return false;

  return id.trim() === SOLO_WORKSPACE_ID;

}


