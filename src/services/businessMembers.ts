/**
 * Read-only data layer for members of a Staveto Business organization.
 *
 * PHASE 1 SCOPE
 * -------------
 * Read-only. NO invite / role change / removal / hourly-rate write here.
 * Those operations live behind authenticated Cloud Functions (Phase 5+) so
 * that seat limits and licence status can be enforced server-side.
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

import { collection } from "../lib/rnFirestore";
import { getDocsSmart } from "./firestoreSmartRead";
import { db, getAuth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { getMembership, parseMembershipDoc } from "./organizations";
import type { MembershipDoc } from "./organizations";

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
