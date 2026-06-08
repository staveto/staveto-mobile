import type { OrganizationDoc } from "../services/organizations";

export type CompanyProfileCompletion = {
  isComplete: boolean;
  completionPercent: number;
  missingFields: string[];
};

type BillingAddressLike = {
  line1?: string;
  line2?: string;
  city?: string;
  zip?: string;
  street?: string;
};

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Root field first, nested `profile.*` fallback (web/mobile parity). */
export function readOrgLegalName(org: OrganizationDoc): string {
  if (nonEmpty(org.legalName)) return org.legalName!.trim();
  return org.profile?.legalName?.trim() ?? "";
}

export function readOrgBillingEmail(org: OrganizationDoc): string {
  if (nonEmpty(org.billingEmail)) return org.billingEmail!.trim();
  const profile = org.profile as { email?: string; contactEmail?: string } | undefined;
  if (profile && nonEmpty(profile.contactEmail)) return profile.contactEmail!.trim();
  if (profile && nonEmpty(profile.email)) return profile.email!.trim();
  return "";
}

export function readOrgCountryCode(org: OrganizationDoc): string {
  if (nonEmpty(org.countryCode)) return org.countryCode!.trim();
  if (nonEmpty(org.country)) return org.country!.trim();
  const profile = org.profile as { countryCode?: string; country?: string } | undefined;
  if (profile && nonEmpty(profile.countryCode)) return profile.countryCode!.trim();
  if (profile && nonEmpty(profile.country)) return profile.country!.trim();
  return "";
}

export function readOrgPhone(org: OrganizationDoc): string {
  if (nonEmpty(org.phone)) return org.phone!.trim();
  return org.profile?.contactPhone?.trim() ?? "";
}

export function readOrgContactName(org: OrganizationDoc): string {
  if (nonEmpty(org.contactName)) return org.contactName!.trim();
  return "";
}

export function readOrgBillingAddress(org: OrganizationDoc): BillingAddressLike | null {
  if (org.billingAddress && typeof org.billingAddress === "object") {
    return org.billingAddress as BillingAddressLike;
  }
  const addressText = org.profile?.addressText?.trim();
  if (addressText) {
    return { line1: addressText };
  }
  return null;
}

export function readOrgRegistrationNumber(org: OrganizationDoc): string {
  const ids = org.companyIdentifiers;
  if (ids && nonEmpty(ids.registrationNumber)) return ids.registrationNumber!.trim();
  return org.profile?.ico?.trim() ?? "";
}

export function formatOrgBillingAddress(org: OrganizationDoc): string {
  const address = readOrgBillingAddress(org);
  if (!address) return "";
  const parts = [
    address.line1?.trim() || address.street?.trim() || "",
    address.city?.trim() || "",
    address.zip?.trim() || "",
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Recommended billing/profile fields — missing values do not invalidate the org.
 */
export function getCompanyProfileCompletion(org: OrganizationDoc | null): CompanyProfileCompletion {
  if (!org) {
    return { isComplete: false, completionPercent: 0, missingFields: ["organization"] };
  }

  const checks: Array<{ key: string; ok: boolean }> = [
    { key: "legalName", ok: !!readOrgLegalName(org) },
    { key: "billingEmail", ok: !!readOrgBillingEmail(org) },
    { key: "countryCode", ok: !!readOrgCountryCode(org) },
  ];

  const address = readOrgBillingAddress(org);
  const streetOk =
    !!address &&
    (nonEmpty(address.line1) || nonEmpty(address.street));
  checks.push({ key: "billingAddress.street", ok: streetOk });
  checks.push({ key: "billingAddress.city", ok: !!address && nonEmpty(address.city) });

  const optionalChecks: Array<{ key: string; ok: boolean }> = [
    { key: "phone", ok: !!readOrgPhone(org) },
    { key: "contactName", ok: !!readOrgContactName(org) },
    { key: "companyIdentifiers.registrationNumber", ok: !!readOrgRegistrationNumber(org) },
  ];

  const all = [...checks, ...optionalChecks];
  const missingFields = all.filter((c) => !c.ok).map((c) => c.key);
  const requiredMissing = checks.filter((c) => !c.ok);
  const completed = all.filter((c) => c.ok).length;
  const completionPercent = Math.round((completed / all.length) * 100);

  return {
    isComplete: requiredMissing.length === 0,
    completionPercent,
    missingFields,
  };
}
