import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type OrgRole = "owner" | "admin" | "manager" | "worker" | "viewer";

type BusinessPermissionKey =
  | "canViewBusinessDashboard"
  | "canViewAllProjects"
  | "canViewAssignedProjects"
  | "canCreateProject"
  | "canEditProject"
  | "canAssignProjectMembers"
  | "canAddDailyReport"
  | "canEditOwnDailyReport"
  | "canApproveDailyReports"
  | "canAddPhotos"
  | "canAddMaterial"
  | "canViewMaterialPrices"
  | "canAddExpense"
  | "canViewProjectCosts"
  | "canManageContacts"
  | "canManageTeam"
  | "canViewBusinessKpis"
  | "canManageBilling";

const PERMISSION_KEYS: BusinessPermissionKey[] = [
  "canViewBusinessDashboard",
  "canViewAllProjects",
  "canViewAssignedProjects",
  "canCreateProject",
  "canEditProject",
  "canAssignProjectMembers",
  "canAddDailyReport",
  "canEditOwnDailyReport",
  "canApproveDailyReports",
  "canAddPhotos",
  "canAddMaterial",
  "canViewMaterialPrices",
  "canAddExpense",
  "canViewProjectCosts",
  "canManageContacts",
  "canManageTeam",
  "canViewBusinessKpis",
  "canManageBilling",
];

type UpdateBusinessMemberRoleInput = {
  orgId?: unknown;
  memberUid?: unknown;
  role?: unknown;
  permissions?: unknown;
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

function parsePermissions(raw: unknown): Record<string, boolean> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") {
    throw new HttpsError("invalid-argument", "permissions must be an object.");
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) {
    if (src[key] === undefined) continue;
    if (typeof src[key] !== "boolean") {
      throw new HttpsError("invalid-argument", `permissions.${key} must be a boolean.`);
    }
    out[key] = src[key] as boolean;
  }
  if (Object.keys(out).length === 0) {
    throw new HttpsError("invalid-argument", "permissions object is empty.");
  }
  return out;
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
    const parsedPermissions = parsePermissions(raw.permissions);

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

      const roleChanged = oldRole !== newRole;

      if (roleChanged) {
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

        if (oldRole === "owner" && newRole !== "owner" && targetStatus === "active") {
          if (activeOwnerCount < 2) {
            throw new HttpsError(
              "failed-precondition",
              "Cannot change the last active owner to a non-owner role."
            );
          }
        }
      }

      const patch: Record<string, unknown> = {
        updatedAt: now,
      };

      if (roleChanged) {
        patch.role = newRole;
        patch.roleUpdatedAt = now;
        patch.roleUpdatedByUid = actor.uid;
      }

      if (parsedPermissions) {
        if (newRole === "owner") {
          throw new HttpsError(
            "failed-precondition",
            "Owner permissions cannot be customized."
          );
        }
        patch.permissions = parsedPermissions;
        patch.permissionsUpdatedAt = now;
        patch.permissionsUpdatedByUid = actor.uid;
      }

      if (!roleChanged && !parsedPermissions) {
        return;
      }

      tx.update(targetMemberRef, patch);

      tx.set(auditRef, {
        action: roleChanged ? "update_business_member_role" : "update_business_member_permissions",
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        targetUid: memberUid,
        oldRole,
        newRole: roleChanged ? newRole : oldRole,
        permissionsUpdated: parsedPermissions != null,
        createdAt: now,
        source: "update_business_member_role_callable",
      });
    });

    return { ok: true, orgId, memberUid, role: newRole };
  }
);
