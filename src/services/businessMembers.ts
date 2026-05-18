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
    if (__DEV__) {
      console.log(`[businessMembers] listMembers: ${out.length} members for org ${orgId}`);
    }
    return out;
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
    return parseMembershipDoc(snap.id, orgId, data as Record<string, unknown>);
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
