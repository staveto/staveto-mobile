import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type OrgRole = "owner" | "admin" | "manager" | "worker" | "viewer";

type UpdateBusinessMemberRoleInput = {
  orgId?: unknown;
  memberUid?: unknown;
  role?: unknown;
};

type UpdateBusinessMemberRoleResult = {
  ok: true;
  orgId: string;
  memberUid: string;
  role: OrgRole;
};

const VALID_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "manager", "worker", "viewer"]);

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeRole(raw: unknown): OrgRole {
  const v = asString(raw).toLowerCase();
  if (!VALID_ROLES.has(v)) {
    throw new HttpsError("invalid-argument", "role must be one of: owner, admin, manager, worker, viewer.");
  }
  return v as OrgRole;
}

function requireAuth(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }
): { uid: string; email: string | null } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return {
    uid: request.auth.uid,
    email: typeof request.auth.token?.email === "string" ? request.auth.token.email : null,
  };
}

function memberRole(data: Record<string, unknown>): string {
  return asString(data.role).toLowerCase();
}

function memberStatus(data: Record<string, unknown>): string {
  return asString(data.status).toLowerCase();
}

export const updateBusinessMemberRole = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<UpdateBusinessMemberRoleResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as UpdateBusinessMemberRoleInput;
    const orgId = asString(raw.orgId);
    const memberUid = asString(raw.memberUid);
    const newRole = normalizeRole(raw.role);

    if (!orgId || !memberUid) {
      throw new HttpsError("invalid-argument", "orgId and memberUid are required.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const actorMemberRef = orgRef.collection("members").doc(actor.uid);
    const targetMemberRef = orgRef.collection("members").doc(memberUid);
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
      const membersQuery = orgRef.collection("members").limit(500);
      const [orgSnap, actorMemberSnap, targetMemberSnap, allMembersSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(actorMemberRef),
        tx.get(targetMemberRef),
        tx.get(membersQuery),
      ]);

      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      if (!targetMemberSnap.exists) {
        throw new HttpsError("not-found", "Target member not found.");
      }
      if (!actorMemberSnap.exists) {
        throw new HttpsError("permission-denied", "You are not a member of this organization.");
      }

      const actorMember = (actorMemberSnap.data() ?? {}) as Record<string, unknown>;
      const actorRole = memberRole(actorMember);
      const actorStatus = memberStatus(actorMember);
      if (actorStatus !== "active") {
        throw new HttpsError("permission-denied", "Only active members can update roles.");
      }
      if (actorRole !== "owner" && actorRole !== "admin") {
        throw new HttpsError("permission-denied", "Only owner or admin can update member roles.");
      }

      const targetMember = (targetMemberSnap.data() ?? {}) as Record<string, unknown>;
      const targetStatus = memberStatus(targetMember);
      if (targetStatus === "removed") {
        throw new HttpsError("failed-precondition", "Cannot change role for a removed member.");
      }

      const oldRole = memberRole(targetMember) as OrgRole;
      if (!VALID_ROLES.has(oldRole)) {
        throw new HttpsError("failed-precondition", "Target member has an invalid role.");
      }

      if (oldRole === newRole) {
        return;
      }

      // Only membership owner may assign or demote owner role (strict).
      if ((oldRole === "owner" || newRole === "owner") && actorRole !== "owner") {
        throw new HttpsError("permission-denied", "Only an owner can assign or change the owner role.");
      }

      let activeOwnerCount = 0;
      for (const d of allMembersSnap.docs) {
        const m = (d.data() ?? {}) as Record<string, unknown>;
        if (memberRole(m) === "owner" && memberStatus(m) === "active") {
          activeOwnerCount += 1;
        }
      }

      // Last active owner cannot be demoted or reassigned away from owner.
      if (oldRole === "owner" && newRole !== "owner" && targetStatus === "active") {
        if (activeOwnerCount < 2) {
          throw new HttpsError(
            "failed-precondition",
            "Cannot change the last active owner to a non-owner role."
          );
        }
      }

      tx.update(targetMemberRef, {
        role: newRole,
        updatedAt: now,
        roleUpdatedAt: now,
        roleUpdatedByUid: actor.uid,
      });

      tx.set(auditRef, {
        action: "update_business_member_role",
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        targetUid: memberUid,
        oldRole,
        newRole,
        createdAt: now,
        source: "update_business_member_role_callable",
      });
    });

    return { ok: true, orgId, memberUid, role: newRole };
  }
);
