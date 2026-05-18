/**
 * Business organization members: reads from `organizations/{orgId}/members`,
 * plus `updateBusinessMemberRole` via authenticated Cloud Function (no direct
 * client writes to member docs for role changes).
 *
 * RELATIONSHIP TO `projectMembers.ts`
 * -----------------------------------
 * `projectMembers.ts` operates on `projects/{projectId}/members` (the legacy
 * per-project sharing API used by B2C). THIS file operates on
 * `organizations/{orgId}/members`, which is the Business / multi-tenant
 * collection. The two collections share the `members` segment name (and so
 * the same Firestore collection group) but live under different parents and
 * are governed by different rule paths.
 *
 * INVARIANTS (see .cursor/rules/business-architecture.mdc)
 * --------------------------------------------------------
 * - This module MUST NOT touch `AuthContext.orgId`.
 * - No existing B2C screen should import this file. It is wired in from
 *   Phase 2 (BusinessContext) onwards.
 */

import { collection, doc } from "../lib/rnFirestore";
import { getDocsSmart, getDocSmart } from "./firestoreSmartRead";
import { db, getAuth, getCallable } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { getMembership, parseMembershipDoc } from "./organizations";
import type { MembershipDoc, OrgRole } from "./organizations";

export type { MembershipDoc } from "./organizations";

type UserProfileHints = {
  displayName?: string;
  name?: string;
  email?: string;
  emailLower?: string;
  phoneNumber?: string;
};

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function mergeMemberWithUserHints(member: MembershipDoc, hints: UserProfileHints | null): MembershipDoc {
  if (!hints) return member;
  const emailLowerMerged =
    member.emailLower?.trim() ||
    hints.emailLower?.trim() ||
    hints.email?.trim().toLowerCase() ||
    undefined;
  return {
    ...member,
    displayName: member.displayName?.trim() || hints.displayName || undefined,
    name: member.name?.trim() || hints.name || undefined,
    email: member.email?.trim() || hints.email || undefined,
    emailLower: emailLowerMerged,
    phoneNumber: member.phoneNumber?.trim() || hints.phoneNumber || undefined,
  };
}

/** Merge `users/{uid}` public fields into memberships when `userId` is set (read-only). */
async function enrichMembershipsFromUserDocs(members: MembershipDoc[]): Promise<MembershipDoc[]> {
  const uids = [...new Set(members.map((m) => m.userId).filter((id) => id.length > 0))];
  if (uids.length === 0) return members;

  const profileByUid = new Map<string, UserProfileHints | null>();
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const ref = doc(db, "users", uid);
        const snap = await getDocSmart(ref);
        if (!snap.exists()) {
          profileByUid.set(uid, null);
          return;
        }
        const d = snap.data() as Record<string, unknown>;
        const firstName = trimStr(d.firstName);
        const lastName = trimStr(d.lastName);
        const composed =
          firstName || lastName ? `${firstName} ${lastName}`.trim() : undefined;
        const emailLower =
          trimStr(d.emailLower).toLowerCase() || (trimStr(d.email) ? trimStr(d.email).toLowerCase() : "");
        profileByUid.set(uid, {
          displayName: trimStr(d.displayName) || undefined,
          name: composed,
          email: trimStr(d.email) || undefined,
          emailLower: emailLower.length > 0 ? emailLower : undefined,
          phoneNumber: trimStr(d.phoneE164) || trimStr(d.phoneNumber) || undefined,
        });
      } catch (e) {
        if (isPermissionDenied(e)) {
          profileByUid.set(uid, null);
          return;
        }
        if (__DEV__) console.warn("[businessMembers] enrich user profile failed", uid, e);
        profileByUid.set(uid, null);
      }
    })
  );

  return members.map((m) => {
    if (!m.userId) return m;
    return mergeMemberWithUserHints(m, profileByUid.get(m.userId) ?? null);
  });
}

function emailLocalPart(mail: string): string {
  const m = mail.trim();
  const at = m.indexOf("@");
  return at > 0 ? m.slice(0, at) : m;
}

export type MembershipDisplayMeta = {
  /** Main headline (never a raw Firebase uid). */
  primary: string;
  /** Subline, usually email (may be empty). */
  secondary: string;
  initials: string;
  showInternalId: boolean;
  internalId: string;
};

function initialsFromSource(primarySource: string): string {
  const cleaned = primarySource.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0] ?? "";
    const b = parts[1][0] ?? "";
    return `${a}${b}`.toUpperCase() || "?";
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

/**
 * Human-readable lines for Business team UI. Never uses uid/doc id as the primary label.
 */
export function getMembershipDisplayMeta(
  member: MembershipDoc,
  t: (key: string, params?: Record<string, string>) => string,
  options?: {
    currentUserUid?: string | null;
    currentUserDisplayName?: string | null;
    currentUserEmail?: string | null;
  }
): MembershipDisplayMeta {
  const internalId = (member.userId || member.id || "").trim();
  const mail =
    (member.email?.trim() ||
      (member.emailLower?.includes("@") ? member.emailLower.trim() : "") ||
      "") ||
    "";
  const mailLowerOnly =
    !mail && member.emailLower?.trim()
      ? member.emailLower.includes("@")
        ? member.emailLower.trim()
        : member.emailLower.trim()
      : "";

  const effectiveMail = mail || mailLowerOnly;
  const localFromMail = effectiveMail ? emailLocalPart(effectiveMail) : "";

  const displayName = member.displayName?.trim() || "";
  const name = member.name?.trim() || "";

  let primary = "";
  if (displayName) primary = displayName;
  else if (name) primary = name;
  else if (localFromMail) primary = localFromMail;
  else if (effectiveMail) primary = effectiveMail;
  else if (options?.currentUserUid && member.userId === options.currentUserUid) {
    primary =
      (options.currentUserDisplayName ?? "").trim() ||
      (options.currentUserEmail ?? "").trim() ||
      "";
  }

  const fallback = t("business.team.memberFallback");
  const usedFallback = !primary;
  if (!primary) primary = fallback;

  let secondary = "";
  if (effectiveMail && primary !== effectiveMail) {
    secondary = effectiveMail;
  } else if (
    options?.currentUserUid &&
    member.userId === options.currentUserUid &&
    (options.currentUserEmail ?? "").trim() &&
    primary !== (options.currentUserEmail ?? "").trim()
  ) {
    secondary = (options.currentUserEmail ?? "").trim();
  }

  const initialsSource =
    displayName || name || localFromMail || effectiveMail || (usedFallback ? "" : primary);
  const initials = initialsFromSource(initialsSource || primary);

  return {
    primary,
    secondary,
    initials,
    showInternalId: usedFallback && internalId.length > 0,
    internalId,
  };
}

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

/**
 * List every member of an organization (admin / manager view).
 *
 * Firestore rule (`match /organizations/{orgId}/members/{memberId}`):
 * `allow read: if signedIn() && (uid() == memberId || isOrgMemberActive(orgId))`.
 * So any active member sees the whole list; non-members get permission-denied
 * and this helper returns `[]`.
 *
 * Returned docs are NOT sorted; callers should sort by role / name as needed.
 */
export async function listMembers(orgId: string): Promise<MembershipDoc[]> {
  if (typeof orgId !== "string" || orgId.trim().length === 0) return [];
  requireSignedInUid();
  try {
    const col = collection(db, paths.organizationMembers(orgId));
    const snap = await getDocsSmart(col);
    const out: MembershipDoc[] = [];
    for (const d of snap.docs) {
      const raw = d.data();
      if (!raw || typeof raw !== "object") continue;
      out.push(parseMembershipDoc(d.id, orgId, raw as Record<string, unknown>));
    }
    const enriched = await enrichMembershipsFromUserDocs(out);
    if (__DEV__) {
      console.log(`[businessMembers] listMembers: ${enriched.length} members for org ${orgId}`);
    }
    return enriched;
  } catch (error) {
    if (isPermissionDenied(error)) {
      if (__DEV__) {
        console.warn(
          "[businessMembers] listMembers: permission denied for org",
          orgId
        );
      }
      return [];
    }
    console.error("[businessMembers] listMembers error:", error);
    throw error;
  }
}

/**
 * Read a single org member doc. Thin wrapper around `getMembership` so that
 * org-centric call-sites (admin screens in Phase 5) read from a file with
 * an explicit `business*` name. Behaviour is identical.
 */
export async function getOrgMember(
  orgId: string,
  userId: string
): Promise<MembershipDoc | null> {
  return getMembership(orgId, userId);
}

/**
 * Read a membership document by its Firestore document id (may differ from
 * `userId` for some pending invite rows).
 */
export async function getOrgMemberByDocId(
  orgId: string,
  memberDocId: string
): Promise<MembershipDoc | null> {
  if (!orgId || !memberDocId) return null;
  requireSignedInUid();
  try {
    const ref = doc(db, "organizations", orgId, "members", memberDocId);
    const snap = await getDocSmart(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    const parsed = parseMembershipDoc(snap.id, orgId, data as Record<string, unknown>);
    const [enriched] = await enrichMembershipsFromUserDocs([parsed]);
    return enriched;
  } catch (error) {
    if (isPermissionDenied(error)) {
      return null;
    }
    console.error("[businessMembers] getOrgMemberByDocId error:", error);
    throw error;
  }
}

export type UpdateBusinessMemberRoleInput = {
  orgId: string;
  memberUid: string;
  role: OrgRole;
};

export type UpdateBusinessMemberRoleResult = {
  ok: true;
  orgId: string;
  memberUid: string;
  role: OrgRole;
};

/**
 * Updates `organizations/{orgId}/members/{memberUid}.role` via Cloud Function
 * (admin SDK); enforces owner/admin rules and last-owner protection server-side.
 */
export async function updateBusinessMemberRole(
  input: UpdateBusinessMemberRoleInput
): Promise<UpdateBusinessMemberRoleResult> {
  requireSignedInUid();
  const call = getCallable<UpdateBusinessMemberRoleInput, { data?: unknown }>(
    "updateBusinessMemberRole",
    { timeoutMs: 25000 }
  );
  const res = await call(input);
  const data = ((res as { data?: unknown })?.data ?? res) as Partial<UpdateBusinessMemberRoleResult>;
  if (data.ok !== true || typeof data.orgId !== "string" || typeof data.memberUid !== "string") {
    throw new Error("Invalid updateBusinessMemberRole response.");
  }
  return {
    ok: true,
    orgId: data.orgId,
    memberUid: data.memberUid,
    role: (data.role as OrgRole) ?? input.role,
  };
}
