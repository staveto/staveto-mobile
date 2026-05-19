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
import { collection, collectionGroup, doc, query, where } from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart } from "./firestoreSmartRead";
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
  billingEmail?: string;
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

  const seatsLimitRaw = data.seatsLimit;
  const seatsUsedRaw = data.seatsUsed;

  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    billingEmail: typeof data.billingEmail === "string" ? data.billingEmail : undefined,
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

function getOrgPriorityScore(org: OrganizationDoc): number {
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

export async function findPreferredBusinessOrgForUser(
  userId: string
): Promise<PreferredBusinessOrg | null> {
  if (!userId) return null;

  const orderOrgBoost = await fetchBillingOwnerOrderOrgSurfaceBoostsByOrgId(userId);

  const memberships = await listMyMemberships(userId);
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  if (activeMemberships.length === 0 && orderOrgBoost.size === 0) return null;

  type Cand = { org: OrganizationDoc; membership: MembershipDoc; score: number; freshness: number };
  const candByOrg = new Map<string, Cand>();

  const consider = (org: OrganizationDoc | null, membership: MembershipDoc | null) => {
    if (!org || !membership || membership.status !== "active") return;
    const base = getOrgPriorityScore(org);
    const boost = orderOrgBoost.get(org.id) ?? -1;
    const score = Math.max(base, boost);
    if (score < 0) return;
    const freshness = toMillis(org.updatedAt) ?? toMillis(org.createdAt) ?? 0;
    const prev = candByOrg.get(org.id);
    if (!prev || score > prev.score || (score === prev.score && freshness > prev.freshness)) {
      candByOrg.set(org.id, { org, membership, score, freshness });
    }
  };

  const orgRows = await Promise.all(
    activeMemberships.map(async (membership) => {
      const org = await getOrganization(membership.orgId);
      return { membership, org };
    })
  );
  for (const row of orgRows) {
    consider(row.org, row.membership);
  }

  for (const orgId of orderOrgBoost.keys()) {
    if (candByOrg.has(orgId)) continue;
    const membership = await getMembership(orgId, userId);
    const org = await getOrganization(orgId);
    consider(org, membership);
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
