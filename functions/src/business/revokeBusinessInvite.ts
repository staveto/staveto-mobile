import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type RevokeBusinessInviteInput = {
  orgId?: unknown;
  inviteId?: unknown;
};

type RevokeBusinessInviteResult = {
  ok: true;
  inviteId: string;
  status: "revoked";
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
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

export const revokeBusinessInvite = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<RevokeBusinessInviteResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as RevokeBusinessInviteInput;
    const orgId = asString(raw.orgId);
    const inviteId = asString(raw.inviteId);
    if (!orgId || !inviteId) {
      throw new HttpsError("invalid-argument", "orgId and inviteId are required.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const memberRef = orgRef.collection("members").doc(actor.uid);
    const inviteRef = orgRef.collection("invites").doc(inviteId);
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
      const [orgSnap, memberSnap, inviteSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(memberRef),
        tx.get(inviteRef),
      ]);
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      if (!inviteSnap.exists) {
        throw new HttpsError("not-found", "Invite not found.");
      }

      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      let canRevoke = asString(org.ownerUid) === actor.uid;
      if (!canRevoke && memberSnap.exists) {
        const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
        const role = asString(member.role).toLowerCase();
        const status = asString(member.status).toLowerCase();
        canRevoke = status === "active" && (role === "owner" || role === "admin");
      }
      if (!canRevoke) {
        throw new HttpsError("permission-denied", "Only owner/admin can revoke invites.");
      }

      tx.update(inviteRef, {
        status: "revoked",
        revokedAt: now,
        revokedByUid: actor.uid,
        updatedAt: now,
      });
      tx.set(auditRef, {
        action: "revoke_business_invite",
        orgId,
        inviteId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        createdAt: now,
        source: "revoke_business_invite_callable",
      });
    });

    return {
      ok: true,
      inviteId,
      status: "revoked",
    };
  }
);
