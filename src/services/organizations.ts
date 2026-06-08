/**
 * Read-only data layer for Staveto Business organizations.
 *
 * PHASE 1 SCOPE
 * -------------
 * Read-only. NO create / update / delete is exposed here. All write paths
 * (provision org, change status / seats, activate Business) must go through
 * authenticated Cloud Functions with the `admin: true` custom claim
 * (Phase 5+). Direct client writes to server-only fields are blocked by the
 * Firestore rules diff proposed in docs/firestore-rules-business-phase1.md.
 *
 * INVARIANTS (see .cursor/rules/business-architecture.mdc)
 * --------------------------------------------------------
 * - This module MUST NOT read from / write to `AuthContext.orgId`.
 *   `AuthContext.orgId` is the solo namespace for B2C (=== fbUser.uid) and is
 *   intentionally separate from any Business org id, which will live in a
 *   later `BusinessContext.activeBusinessOrgId`.
 * - No existing B2C screen should import this file. It is meant to be wired
 *   in from Phase 2 (`BusinessContext`) onwards.
 */

import type { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import {
  collection,
  collectionGroup,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart } from "./firestoreSmartRead";
import { parseCustomPermissions, type BusinessPermissions } from "../lib/businessRolePermissions";
import { db, getAuth } from "../firebase";
import { paths } from "../lib/firestorePaths";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle of an organization licence (server-controlled).
 * - pending_payment: created, waiting for licence to be paid / activated
 * - active:          paid licence, Business surface unlocked for active members
 * - past_due:        licence renewal failed; grace period (still readable)
 * - suspended:       admin manually paused; no Business UI for members
 * - cancelled:       terminal state; orgs should be archived, not deleted
 *
 * Clients MUST NOT write this field; the Firestore rules diff in
 * docs/firestore-rules-business-phase1.md rejects any client mutation.
 */
export type OrgStatus =
  | "trialing"
  | "pending_payment"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

/**
 * Role of a user inside an organization. Pre-Business legacy `'member'`
 * value (seen on per-project members docs) is normalised to `'viewer'`.
 */
export type OrgRole = "owner" | "admin" | "manager" | "worker" | "viewer";

/** Membership lifecycle. Only `'active'` members count toward `seatsUsed`. */
export type MembershipStatus = "invited" | "pending" | "active" | "suspended" | "removed";

/**
 * `organizations/{orgId}` document.
 *
 * SERVER-ONLY fields (clients MUST NOT mutate; rules reject):
 * - status
 * - businessEnabled
 * - seatsLimit
 * - seatsUsed
 * - businessActivatedAt
 * - businessActivatedBy
 *
 * Owner/admin clients may edit only the `profile` sub-object plus `name`.
 */
export type OrganizationDoc = {
  id: string;
  /** Display name of the organization (editable by owner/admin). */
  name: string;
  /** Canonical legal name (web + mobile root field). */
  legalName?: string;
  billingEmail?: string;
  countryCode?: string;
  country?: string;
  contactName?: string | null;
  phone?: string | null;
  billingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    zip?: string;
    street?: string;
  };
  companyIdentifiers?: {
    registrationNumber?: string | null;
    taxId?: string | null;
    vatId?: string | null;
    vatNumber?: string | null;
  };
  source?: string;
  onboardingSource?: string;
  billingOwnerUid?: string;
  /** Auth uid of the user who created the org. Immutable. */
  ownerUid: string;
  /** Licence lifecycle — SERVER-ONLY. */
  status: OrgStatus;
  /** Master switch: is the Business surface unlocked for this org? SERVER-ONLY. */
  businessEnabled: boolean;
  /** Seats cap under this licence. SERVER-ONLY. */
  seatsLimit: number;
  /** Denormalised active-member count, maintained by CF. SERVER-ONLY. */
  seatsUsed: number;
  trialStartedAt?: FirebaseFirestoreTypes.Timestamp | string | null;
  trialEndsAt?: FirebaseFirestoreTypes.Timestamp | string | null;
  planCode?: string;
  billingPeriod?: string;
  activeBusinessOrderId?: string | null;
  /** When the Business surface was first activated. SERVER-ONLY. */
  businessActivatedAt?: FirebaseFirestoreTypes.Timestamp | string | null;
  /** uid of the admin/staff who flipped `businessEnabled`. SERVER-ONLY. */
  businessActivatedBy?: string | null;
  /** Free-form company profile, editable by owner/admin. */
  profile?: {
    legalName?: string;
    ico?: string;
    icDph?: string;
    dic?: string;
    countryCode?: string;
    addressText?: string;
    contactEmail?: string;
    contactPhone?: string;
    websiteUrl?: string;
  };
  createdAt?: FirebaseFirestoreTypes.Timestamp | string;
  updatedAt?: FirebaseFirestoreTypes.Timestamp | string;
};

/**
 * `organizations/{orgId}/members/{memberId}` document.
 *
 * Convention (Phase 5+): `memberId === userId` (Auth uid) once the invite is
 * claimed via Cloud Function. Pre-claim docs may use a generated id with
 * `userId` empty and `emailLower` set — Phase 1 readers tolerate that.
 */
export type MembershipDoc = {
  id: string;
  orgId: string;
  /** Auth uid of the member. Empty string for pending invites pre-claim. */
  userId: string;
  /** Denormalized email on the membership doc (read-only client). */
  email?: string;
  /** Lower-case email used during invite (defense-in-depth lookup). */
  emailLower?: string;
  /** Display name from invite / sync (read-only). */
  displayName?: string;
  /** Full name when stored separately (read-only). */
  name?: string;
  /** Phone when present on membership or merged from `users/{uid}` (read-only). */
  phoneNumber?: string;
  /** Role inside the org. Legacy `'member'` is normalised to `'viewer'`. */
  role: OrgRole;
  /** Lifecycle. Only `active` counts toward seats. */
  status: MembershipStatus;
  /** Denormalized from `organizations/{orgId}.name` when joining (esp. pending approval). */
  organizationName?: string;
  /** When this membership became active. */
  joinedAt?: FirebaseFirestoreTypes.Timestamp | string;
  /** When the underlying doc was first created (server timestamp). */
  addedAt?: FirebaseFirestoreTypes.Timestamp | string;
  /** Hourly rate in EUR — used by the (later) labour-cost report. */
  hourlyRateEur?: number;
  /** Optional permission overrides; missing keys fall back to role preset. */
  permissions?: Partial<BusinessPermissions>;
};

export type BusinessOrderDoc = {
  id: string;
  orgId: string;
  orderNumber: string;
  variableSymbol: string;
  paymentReference: string;
  status: string;
  planCode?: string;
  billingPeriod?: string;
  requestedSeats?: number;
  dueAt?: FirebaseFirestoreTypes.Timestamp | string | null;
  priceSnapshot?: {
    planCode?: string;
    planName?: string;
    billingPeriod?: string;
    seatsIncluded?: number;
    totalGross?: number;
    currency?: string;
  };
  paymentInstructions?: {
    method?: string;
    beneficiaryName?: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    currency?: string;
    amountGross?: number;
    variableSymbol?: string;
    paymentReference?: string;
    dueDays?: number;
  };
};

export type PreferredBusinessOrg = {
  org: OrganizationDoc;
  membership: MembershipDoc;
};

export type CompanyProfileUpdatePayload = {
  name?: string;
  legalName?: string;
  billingEmail?: string;
  countryCode?: string;
  billingAddress?: {
    line1?: string;
    city?: string;
    zip?: string;
  };
  companyIdentifiers?: {
    registrationNumber?: string | null;
    taxId?: string | null;
    vatId?: string | null;
  };
  contactName?: string | null;
  phone?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Parsers (exported so businessMembers.ts can reuse without duplication)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<OrgStatus> = new Set<OrgStatus>([
  "trialing",
  "pending_payment",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

const VALID_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  "owner",
  "admin",
  "manager",
  "worker",
  "viewer",
]);

const VALID_MEMBERSHIP_STATUSES: ReadonlySet<MembershipStatus> = new Set<MembershipStatus>([
  "invited",
  "pending",
  "active",
  "suspended",
  "removed",
]);

/** Coerce a raw value into a known `OrgStatus`. Unknown → `pending_payment`. */
export function parseOrgStatus(raw: unknown): OrgStatus {
  if (typeof raw === "string" && (VALID_STATUSES as ReadonlySet<string>).has(raw)) {
    return raw as OrgStatus;
  }
  return "pending_payment";
}

/** Coerce a raw value into a known `OrgRole`. Legacy `'member'` → `'viewer'`. */
export function parseOrgRole(raw: unknown): OrgRole {
  if (typeof raw === "string" && (VALID_ROLES as ReadonlySet<string>).has(raw)) {
    return raw as OrgRole;
  }
  if (raw === "member") return "viewer";
  return "viewer";
}

/** Coerce a raw value into a known `MembershipStatus`. Unknown → `invited`. */
export function parseMembershipStatus(raw: unknown): MembershipStatus {
  if (
    typeof raw === "string" &&
    (VALID_MEMBERSHIP_STATUSES as ReadonlySet<string>).has(raw)
  ) {
    return raw as MembershipStatus;
  }
  return "invited";
}

/** Build an `OrganizationDoc` from a Firestore document payload. */
export function parseOrganizationDoc(
  id: string,
  data: Record<string, unknown>
): OrganizationDoc {
  const profileRaw =
    (data.profile as Record<string, unknown> | undefined) ?? undefined;
  const profile = profileRaw
    ? {
        legalName: typeof profileRaw.legalName === "string" ? profileRaw.legalName : undefined,
        ico: typeof profileRaw.ico === "string" ? profileRaw.ico : undefined,
        icDph: typeof profileRaw.icDph === "string" ? profileRaw.icDph : undefined,
        dic: typeof profileRaw.dic === "string" ? profileRaw.dic : undefined,
        countryCode:
          typeof profileRaw.countryCode === "string" ? profileRaw.countryCode : undefined,
        addressText:
          typeof profileRaw.addressText === "string" ? profileRaw.addressText : undefined,
        contactEmail:
          typeof profileRaw.contactEmail === "string" ? profileRaw.contactEmail : undefined,
        contactPhone:
          typeof profileRaw.contactPhone === "string" ? profileRaw.contactPhone : undefined,
        websiteUrl:
          typeof profileRaw.websiteUrl === "string" ? profileRaw.websiteUrl : undefined,
      }
    : undefined;

  const seatsLimitRaw = data.seatsLimit ?? data.seatLimit;
  const seatsUsedRaw = data.seatsUsed;

  const billingAddressRaw = data.billingAddress;
  const billingAddress =
    billingAddressRaw && typeof billingAddressRaw === "object"
      ? {
          line1:
            typeof (billingAddressRaw as Record<string, unknown>).line1 === "string"
              ? ((billingAddressRaw as Record<string, unknown>).line1 as string)
              : undefined,
          line2:
            typeof (billingAddressRaw as Record<string, unknown>).line2 === "string"
              ? ((billingAddressRaw as Record<string, unknown>).line2 as string)
              : undefined,
          city:
            typeof (billingAddressRaw as Record<string, unknown>).city === "string"
              ? ((billingAddressRaw as Record<string, unknown>).city as string)
              : undefined,
          zip:
            typeof (billingAddressRaw as Record<string, unknown>).zip === "string"
              ? ((billingAddressRaw as Record<string, unknown>).zip as string)
              : undefined,
          street:
            typeof (billingAddressRaw as Record<string, unknown>).street === "string"
              ? ((billingAddressRaw as Record<string, unknown>).street as string)
              : undefined,
        }
      : undefined;

  const companyIdentifiersRaw = data.companyIdentifiers;
  const companyIdentifiers =
    companyIdentifiersRaw && typeof companyIdentifiersRaw === "object"
      ? {
          registrationNumber:
            typeof (companyIdentifiersRaw as Record<string, unknown>).registrationNumber === "string"
              ? ((companyIdentifiersRaw as Record<string, unknown>).registrationNumber as string)
              : (companyIdentifiersRaw as Record<string, unknown>).registrationNumber === null
                ? null
                : undefined,
          taxId:
            typeof (companyIdentifiersRaw as Record<string, unknown>).taxId === "string"
              ? ((companyIdentifiersRaw as Record<string, unknown>).taxId as string)
              : (companyIdentifiersRaw as Record<string, unknown>).taxId === null
                ? null
                : undefined,
          vatId:
            typeof (companyIdentifiersRaw as Record<string, unknown>).vatId === "string"
              ? ((companyIdentifiersRaw as Record<string, unknown>).vatId as string)
              : (companyIdentifiersRaw as Record<string, unknown>).vatId === null
                ? null
                : undefined,
          vatNumber:
            typeof (companyIdentifiersRaw as Record<string, unknown>).vatNumber === "string"
              ? ((companyIdentifiersRaw as Record<string, unknown>).vatNumber as string)
              : undefined,
        }
      : undefined;

  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    legalName: typeof data.legalName === "string" ? data.legalName : undefined,
    billingEmail: typeof data.billingEmail === "string" ? data.billingEmail : undefined,
    countryCode: typeof data.countryCode === "string" ? data.countryCode : undefined,
    country: typeof data.country === "string" ? data.country : undefined,
    contactName:
      typeof data.contactName === "string"
        ? data.contactName
        : data.contactName === null
          ? null
          : undefined,
    phone:
      typeof data.phone === "string" ? data.phone : data.phone === null ? null : undefined,
    billingAddress,
    companyIdentifiers,
    source: typeof data.source === "string" ? data.source : undefined,
    onboardingSource: typeof data.onboardingSource === "string" ? data.onboardingSource : undefined,
    billingOwnerUid: typeof data.billingOwnerUid === "string" ? data.billingOwnerUid : undefined,
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
    status: parseOrgStatus(data.status),
    businessEnabled: data.businessEnabled === true,
    seatsLimit:
      typeof seatsLimitRaw === "number" && Number.isFinite(seatsLimitRaw) && seatsLimitRaw >= 0
        ? seatsLimitRaw
        : 0,
    seatsUsed:
      typeof seatsUsedRaw === "number" && Number.isFinite(seatsUsedRaw) && seatsUsedRaw >= 0
        ? seatsUsedRaw
        : 0,
    trialStartedAt:
      data.trialStartedAt === null
        ? null
        : (data.trialStartedAt as OrganizationDoc["trialStartedAt"]) ?? undefined,
    trialEndsAt:
      data.trialEndsAt === null
        ? null
        : (data.trialEndsAt as OrganizationDoc["trialEndsAt"]) ?? undefined,
    planCode: typeof data.planCode === "string" ? data.planCode : undefined,
    billingPeriod: typeof data.billingPeriod === "string" ? data.billingPeriod : undefined,
    activeBusinessOrderId:
      typeof data.activeBusinessOrderId === "string"
        ? data.activeBusinessOrderId
        : data.activeBusinessOrderId === null
        ? null
        : undefined,
    businessActivatedAt:
      data.businessActivatedAt === null
        ? null
        : (data.businessActivatedAt as OrganizationDoc["businessActivatedAt"]) ?? undefined,
    businessActivatedBy:
      typeof data.businessActivatedBy === "string"
        ? data.businessActivatedBy
        : data.businessActivatedBy === null
        ? null
        : undefined,
    profile,
    createdAt: (data.createdAt as OrganizationDoc["createdAt"]) ?? undefined,
    updatedAt: (data.updatedAt as OrganizationDoc["updatedAt"]) ?? undefined,
  };
}

/** Build a `MembershipDoc` from a Firestore document payload. */
export function parseMembershipDoc(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): MembershipDoc {
  const userIdRaw = data.userId;
  const hourlyRaw = data.hourlyRateEur;
  const emailRaw = typeof data.email === "string" ? data.email.trim() : "";
  const emailLowerRaw =
    typeof data.emailLower === "string" ? data.emailLower.trim().toLowerCase() : "";
  const displayNameRaw = typeof data.displayName === "string" ? data.displayName.trim() : "";
  const nameRaw = typeof data.name === "string" ? data.name.trim() : "";
  const phoneRaw =
    typeof data.phoneNumber === "string"
      ? data.phoneNumber.trim()
      : typeof data.phoneE164 === "string"
        ? data.phoneE164.trim()
        : "";
  return {
    id,
    orgId,
    userId: typeof userIdRaw === "string" && userIdRaw.length > 0 ? userIdRaw : "",
    email: emailRaw.length > 0 ? emailRaw : undefined,
    emailLower: emailLowerRaw.length > 0 ? emailLowerRaw : undefined,
    displayName: displayNameRaw.length > 0 ? displayNameRaw : undefined,
    name: nameRaw.length > 0 ? nameRaw : undefined,
    phoneNumber: phoneRaw.length > 0 ? phoneRaw : undefined,
    role: parseOrgRole(data.role),
    status: parseMembershipStatus(data.status),
    joinedAt: (data.joinedAt as MembershipDoc["joinedAt"]) ?? undefined,
    addedAt: (data.addedAt as MembershipDoc["addedAt"]) ?? undefined,
    hourlyRateEur:
      typeof hourlyRaw === "number" && Number.isFinite(hourlyRaw) && hourlyRaw >= 0
        ? hourlyRaw
        : undefined,
    organizationName:
      typeof data.organizationName === "string" && data.organizationName.trim().length > 0
        ? data.organizationName.trim()
        : undefined,
    permissions: parseCustomPermissions(data.permissions),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only API
// ─────────────────────────────────────────────────────────────────────────────

function requireSignedInUid(): string {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid) {
    throw new Error("Musíte byť prihlásený.");
  }
  return uid;
}

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return code === "permission-denied" || code === "firestore/permission-denied";
}

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

export function isTrialActive(org: OrganizationDoc): boolean {
  const ms = toMillis(org.trialEndsAt);
  return ms !== null && ms > Date.now();
}

export function isWebOnboardedOrg(org: OrganizationDoc): boolean {
  return org.source === "web_onboarding" || org.onboardingSource === "web";
}

export function synthesizeOwnerMembership(org: OrganizationDoc, userId: string): MembershipDoc {
  return {
    id: userId,
    orgId: org.id,
    userId,
    role: "owner",
    status: "active",
    organizationName: org.name,
  };
}

/**
 * Whether the org can be used as the active business workspace.
 * Missing billing/profile fields do not invalidate the org.
 */
export function isUsableBusinessOrg(
  org: OrganizationDoc | null,
  options?: { userId?: string; membership?: MembershipDoc | null }
): boolean {
  if (!org || !org.ownerUid) return false;

  const userId = options?.userId;
  const membership = options?.membership ?? null;
  const isOwner = !!userId && org.ownerUid === userId;
  const isActiveMember = membership?.status === "active";
  if (!isActiveMember && !isOwner) return false;

  const trialActive = isTrialActive(org) || org.status === "trialing";
  const webCreated = isWebOnboardedOrg(org);

  if (org.status === "suspended" || org.status === "cancelled") {
    return false;
  }
  if (org.status === "past_due") {
    return isOwner || webCreated;
  }
  if (org.status === "active") {
    return org.businessEnabled === true || trialActive || isOwner || webCreated;
  }
  if (org.status === "trialing") {
    return org.businessEnabled === true || trialActive || isOwner || webCreated;
  }
  if (org.status === "pending_payment") {
    return (
      org.businessEnabled === true ||
      trialActive ||
      isOwner ||
      webCreated ||
      (typeof org.activeBusinessOrderId === "string" && org.activeBusinessOrderId.trim().length > 0)
    );
  }
  return isOwner && (webCreated || trialActive);
}

export function isRecoverableBusinessOrg(
  org: OrganizationDoc | null,
  options?: { userId?: string; membership?: MembershipDoc | null }
): boolean {
  if (!org || !options?.userId) return false;
  const isOwner = org.ownerUid === options.userId;
  const hasMembership =
    options.membership?.status === "active" || (isOwner && !!org.ownerUid);
  if (!hasMembership) return false;
  if (isUsableBusinessOrg(org, options)) return true;
  return isOwner && (isWebOnboardedOrg(org) || isTrialActive(org));
}

function getOrgPriorityScore(org: OrganizationDoc, userId?: string): number {
  if (org.status === "active") return 300;
  if (org.status === "trialing") return 200;
  if (org.status === "pending_payment") {
    const trialEndsAtMs = toMillis(org.trialEndsAt);
    const trialOk = trialEndsAtMs !== null && trialEndsAtMs > Date.now();
    if (trialOk) return 100;
    // Match `useOrgAccess.pendingCanAccess`: org may be waiting on Stripe/bank while
    // `trialEndsAt` is missing or already passed, but checkout / licence flag still applies.
    if (org.businessEnabled === true) return 95;
    if (typeof org.activeBusinessOrderId === "string" && org.activeBusinessOrderId.trim().length > 0) {
      return 90;
    }
    if (userId && org.ownerUid === userId && isWebOnboardedOrg(org)) {
      return 85;
    }
  }
  if (userId && org.ownerUid === userId && isWebOnboardedOrg(org)) {
    return 80;
  }
  return -1;
}

/**
 * When the org document lags behind Stripe (common right after checkout), the
 * linked `businessOrders/{id}` row may still carry `stripeCheckoutSessionId` or
 * `paidAt` while `organizations/{orgId}` has no `activeBusinessOrderId` / trial.
 * Those signals are used only to pick a default active org and to mirror
 * `useOrgAccess.pendingCanAccess` while the org doc lags — active membership
 * is still required (`BusinessGate`).
 */
/** Minimum boost from `deriveBusinessOrderOrgSurfaceBoost` for checkout / paid rows. */
export const BILLING_ORDER_SURFACE_BOOST_ACCESS_THRESHOLD = 92;

function deriveBusinessOrderOrgSurfaceBoost(order: Record<string, unknown>): number {
  if (order.paidAt != null) return 110;
  const st = typeof order.status === "string" ? order.status.toLowerCase() : "";
  if (st === "paid" || st === "completed" || st === "fulfilled") return 108;
  if (
    typeof order.stripeCheckoutSessionId === "string" &&
    order.stripeCheckoutSessionId.trim().length > 0
  ) {
    return 92;
  }
  return -1;
}

/** Per-org boost for the signed-in billing owner (empty map on permission denied). */
export async function fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId(
  userId: string
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const currentUid = requireSignedInUid();
  if (currentUid !== userId) return out;
  try {
    const q = query(collection(db, "businessOrders"), where("billingOwnerUid", "==", userId));
    const snap = await getDocsSmart(q);
    for (const d of snap.docs) {
      const data = d.data();
      if (!data || typeof data !== "object") continue;
      const row = data as Record<string, unknown>;
      const orgId = typeof row.orgId === "string" ? row.orgId.trim() : "";
      if (!orgId) continue;
      const boost = deriveBusinessOrderOrgSurfaceBoost(row);
      if (boost < 0) continue;
      out.set(orgId, Math.max(out.get(orgId) ?? 0, boost));
    }
  } catch (e) {
    if (isPermissionDenied(e)) {
      if (__DEV__) {
        console.warn("[organizations] fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId: permission denied");
      }
      return out;
    }
    console.error("[organizations] fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId error:", e);
    throw e;
  }
  return out;
}

/**
 * Read a single organization document.
 *
 * Returns `null` when the org doesn't exist OR the caller is not allowed to
 * read it (Firestore rule: `signedIn() && isOrgMemberActive(orgId)`). The
 * permission-denied case is intentionally swallowed and logged because the
 * caller can't tell "doesn't exist" from "not allowed" anyway.
 */
export async function getOrganization(orgId: string): Promise<OrganizationDoc | null> {
  if (typeof orgId !== "string" || orgId.trim().length === 0) return null;
  requireSignedInUid();
  try {
    const ref = doc(db, paths.organization(orgId));
    const snap = await getDocSmart(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    return parseOrganizationDoc(snap.id, data as Record<string, unknown>);
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn("[organizations] getOrganization: permission denied for org", orgId);
      }
      return null;
    }
    console.error("[organizations] getOrganization error:", error);
    throw error;
  }
}

/**
 * Read the membership doc for (orgId, userId).
 *
 * Firestore rule allows a user to read their own membership
 * (`uid() == memberId`) even when they're not yet "active". That makes this
 * helper safe to call from the (Phase 2) BusinessContext during startup to
 * decide which orgs to surface to the user.
 *
 * Convention: `memberId === userId` once the invite has been claimed.
 */
export async function getMembership(
  orgId: string,
  userId: string
): Promise<MembershipDoc | null> {
  if (!orgId || !userId) return null;
  requireSignedInUid();
  try {
    const ref = doc(db, paths.organizationMember(orgId, userId));
    const snap = await getDocSmart(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    return parseMembershipDoc(snap.id, orgId, data as Record<string, unknown>);
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn("[organizations] getMembership: permission denied", { orgId, userId });
      }
      return null;
    }
    console.error("[organizations] getMembership error:", error);
    throw error;
  }
}

/**
 * Resolves membership by `organizations/{orgId}/members/{uid}` first, then
 * falls back to collection-group lookup when the doc id is not the auth uid.
 */
export async function resolveMembershipForUser(
  orgId: string,
  userId: string
): Promise<MembershipDoc | null> {
  const direct = await getMembership(orgId, userId);
  if (direct) return direct;
  const memberships = await listMyMemberships(userId);
  return memberships.find((row) => row.orgId === orgId) ?? null;
}

export async function getBusinessOrder(orderId: string): Promise<BusinessOrderDoc | null> {
  if (typeof orderId !== "string" || orderId.trim().length === 0) return null;
  requireSignedInUid();
  try {
    const ref = doc(db, `businessOrders/${orderId}`);
    const snap = await getDocSmart(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    const row = data as Record<string, unknown>;
    return {
      id: snap.id,
      orgId: typeof row.orgId === "string" ? row.orgId : "",
      orderNumber: typeof row.orderNumber === "string" ? row.orderNumber : "",
      variableSymbol: typeof row.variableSymbol === "string" ? row.variableSymbol : "",
      paymentReference: typeof row.paymentReference === "string" ? row.paymentReference : "",
      status: typeof row.status === "string" ? row.status : "pending_payment",
      planCode: typeof row.planCode === "string" ? row.planCode : undefined,
      billingPeriod: typeof row.billingPeriod === "string" ? row.billingPeriod : undefined,
      requestedSeats: typeof row.requestedSeats === "number" ? row.requestedSeats : undefined,
      dueAt:
        row.dueAt === null
          ? null
          : (row.dueAt as BusinessOrderDoc["dueAt"]) ?? undefined,
      priceSnapshot:
        row.priceSnapshot && typeof row.priceSnapshot === "object"
          ? (row.priceSnapshot as BusinessOrderDoc["priceSnapshot"])
          : undefined,
      paymentInstructions:
        row.paymentInstructions && typeof row.paymentInstructions === "object"
          ? (row.paymentInstructions as BusinessOrderDoc["paymentInstructions"])
          : undefined,
    };
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn("[organizations] getBusinessOrder: permission denied for order", orderId);
      }
      return null;
    }
    console.error("[organizations] getBusinessOrder error:", error);
    throw error;
  }
}

/**
 * List every membership belonging to `userId` across all organizations.
 *
 * Implementation: collectionGroup query on `members` filtered by `userId`.
 * The same collectionGroup name is reused by `projects/{pid}/members`; we
 * filter those out client-side via `ref.path` so this stays org-only.
 *
 * Security:
 * - Firestore evaluates the read rule per-document. For
 *   `organizations/{orgId}/members/{memberId}` the rule requires
 *   `uid() == memberId` OR active membership — both pass for the caller's
 *   own docs.
 * - For `projects/{pid}/members` the rule requires owner/member access; we
 *   would either pass or get filtered out via permission-denied at the
 *   query level. To stay defensive, we accept a partial denial as `[]` and
 *   log a warning.
 *
 * This helper intentionally only supports `userId === auth.currentUser.uid`.
 * Listing other users' memberships must go through a Cloud Function (later).
 */
export async function listMyMemberships(userId: string): Promise<MembershipDoc[]> {
  if (!userId) return [];
  const currentUid = requireSignedInUid();
  if (currentUid !== userId) {
    if (__DEV__) {
      console.warn(
        "[organizations] listMyMemberships called for a foreign user; refusing"
      );
    }
    return [];
  }
  try {
    const group = collectionGroup(db, "members");
    const q = query(group, where("userId", "==", userId));
    const snap = await getDocsSmart(q);
    const out: MembershipDoc[] = [];
    for (const d of snap.docs) {
      // ref.path example: "organizations/{orgId}/members/{memberId}"
      const path = d.ref.path;
      if (!path.startsWith("organizations/")) continue;
      const parts = path.split("/");
      const orgId = parts[1];
      if (!orgId) continue;
      const raw = d.data();
      if (!raw || typeof raw !== "object") continue;
      out.push(parseMembershipDoc(d.id, orgId, raw as Record<string, unknown>));
    }
    if (__DEV__) {
      console.log(
        `[organizations] listMyMemberships: ${out.length} org memberships for ${userId}`
      );
    }
    return out;
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn(
          "[organizations] listMyMemberships: collectionGroup denied; returning []"
        );
      }
      return [];
    }
    console.error("[organizations] listMyMemberships error:", error);
    throw error;
  }
}

export async function readUserActiveBusinessOrgIdHint(userId: string): Promise<string | null> {
  if (!userId) return null;
  const currentUid = requireSignedInUid();
  if (currentUid !== userId) return null;
  try {
    const ref = doc(db, paths.userDoc(userId));
    const snap = await getDocSmart(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    const hint = typeof data.activeBusinessOrgId === "string" ? data.activeBusinessOrgId.trim() : "";
    return hint.length > 0 ? hint : null;
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn("[organizations] readUserActiveBusinessOrgIdHint: permission denied");
      }
      return null;
    }
    console.error("[organizations] readUserActiveBusinessOrgIdHint error:", error);
    throw error;
  }
}

export async function listOrganizationsOwnedByUser(userId: string): Promise<OrganizationDoc[]> {
  if (!userId) return [];
  const currentUid = requireSignedInUid();
  if (currentUid !== userId) return [];
  try {
    const q = query(collection(db, "organizations"), where("ownerUid", "==", userId));
    const snap = await getDocsSmart(q);
    const out: OrganizationDoc[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (!data || typeof data !== "object") continue;
      out.push(parseOrganizationDoc(d.id, data as Record<string, unknown>));
    }
    if (__DEV__) {
      console.log(`[organizations] listOrganizationsOwnedByUser: ${out.length} orgs for ${userId}`);
    }
    return out;
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn("[organizations] listOrganizationsOwnedByUser: permission denied");
      }
      return [];
    }
    console.error("[organizations] listOrganizationsOwnedByUser error:", error);
    throw error;
  }
}

export async function updateOrganizationCompanyProfile(
  orgId: string,
  payload: CompanyProfileUpdatePayload
): Promise<void> {
  if (!orgId) throw new Error("Chýba ID organizácie.");
  requireSignedInUid();
  const update: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (typeof payload.name === "string") update.name = payload.name.trim();
  if (typeof payload.legalName === "string") update.legalName = payload.legalName.trim();
  if (typeof payload.billingEmail === "string") update.billingEmail = payload.billingEmail.trim();
  if (typeof payload.countryCode === "string") {
    const cc = payload.countryCode.trim().toUpperCase();
    update.countryCode = cc;
    update.country = cc;
  }
  if (payload.billingAddress) {
    update.billingAddress = {
      line1: payload.billingAddress.line1?.trim() ?? "",
      city: payload.billingAddress.city?.trim() ?? "",
      zip: payload.billingAddress.zip?.trim() ?? "",
    };
  }
  if (payload.companyIdentifiers) {
    update.companyIdentifiers = {
      registrationNumber: payload.companyIdentifiers.registrationNumber ?? null,
      taxId: payload.companyIdentifiers.taxId ?? null,
      vatId: payload.companyIdentifiers.vatId ?? null,
    };
  }
  if (payload.contactName !== undefined) {
    update.contactName = payload.contactName?.trim() || null;
  }
  if (payload.phone !== undefined) {
    update.phone = payload.phone?.trim() || null;
  }

  const ref = doc(db, paths.organization(orgId));
  await updateDoc(ref, update);
}

export async function findPreferredBusinessOrgForUser(
  userId: string
): Promise<PreferredBusinessOrg | null> {
  if (!userId) return null;

  const [orderOrgBoost, memberships, ownedOrgs, profileOrgHint] = await Promise.all([
    fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId(userId),
    listMyMemberships(userId),
    listOrganizationsOwnedByUser(userId),
    readUserActiveBusinessOrgIdHint(userId),
  ]);

  type Cand = { org: OrganizationDoc; membership: MembershipDoc; score: number; freshness: number };
  const candByOrg = new Map<string, Cand>();
  const membershipByOrgId = new Map<string, MembershipDoc>();
  for (const membership of memberships) {
    membershipByOrgId.set(membership.orgId, membership);
  }

  const resolveMembership = async (
    org: OrganizationDoc
  ): Promise<MembershipDoc | null> => {
    const cached = membershipByOrgId.get(org.id);
    if (cached?.status === "active") return cached;
    const resolved = await resolveMembershipForUser(org.id, userId);
    if (resolved?.status === "active") return resolved;
    if (org.ownerUid === userId) return synthesizeOwnerMembership(org, userId);
    return resolved;
  };

  const consider = async (org: OrganizationDoc | null, membership: MembershipDoc | null) => {
    if (!org || !membership) return;
    const activeOrOwner =
      membership.status === "active" || (org.ownerUid === userId && membership.role === "owner");
    if (!activeOrOwner) return;
    if (!isUsableBusinessOrg(org, { userId, membership })) return;

    const base = getOrgPriorityScore(org, userId);
    const boost = orderOrgBoost.get(org.id) ?? -1;
    const score = Math.max(base, boost);
    if (score < 0) return;

    const freshness = toMillis(org.updatedAt) ?? toMillis(org.createdAt) ?? 0;
    const prev = candByOrg.get(org.id);
    if (!prev || score > prev.score || (score === prev.score && freshness > prev.freshness)) {
      candByOrg.set(org.id, { org, membership, score, freshness });
    }
  };

  if (profileOrgHint) {
    const org = await getOrganization(profileOrgHint);
    const membership = org ? await resolveMembership(org) : null;
    await consider(org, membership);
  }

  for (const membership of memberships.filter((row) => row.status === "active")) {
    const org = await getOrganization(membership.orgId);
    await consider(org, membership);
  }

  for (const org of ownedOrgs) {
    const membership = await resolveMembership(org);
    await consider(org, membership);
  }

  for (const orgId of orderOrgBoost.keys()) {
    if (candByOrg.has(orgId)) continue;
    const org = await getOrganization(orgId);
    const membership = org ? await resolveMembership(org) : null;
    await consider(org, membership);
  }

  let best: Cand | null = null;
  for (const c of candByOrg.values()) {
    if (!best || c.score > best.score || (c.score === best.score && c.freshness > best.freshness)) {
      best = c;
    }
  }

  if (!best) return null;
  return { org: best.org, membership: best.membership };
}
