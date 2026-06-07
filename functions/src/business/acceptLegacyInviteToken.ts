import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { clampInviteRoleOnRedeem } from "./inviteCodeUtils";

if (!admin.apps.length) {
  admin.initializeApp();
}

type AcceptLegacyInviteTokenInput = {
  token?: unknown;
};

type AcceptLegacyInviteTokenResult = {
  orgId: string;
  role: string;
  alreadyMember?: boolean;
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function requireAuth(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }
): { uid: string; emailLower: string | null; displayName: string | null } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const email =
    typeof request.auth.token?.email === "string" ? request.auth.token.email.toLowerCase() : null;
  const displayName =
    typeof request.auth.token?.name === "string" ? request.auth.token.name.trim() : null;
  return { uid: request.auth.uid, emailLower: email, displayName: displayName || null };
}

export const acceptLegacyInviteToken = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<AcceptLegacyInviteTokenResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as AcceptLegacyInviteTokenInput;
    const token = asString(raw.token);
    if (!token || token.length < 32) {
      throw new HttpsError("invalid-argument", "token is required.");
    }

    const db = admin.firestore();
    const inviteQuery = await db
      .collection("invites")
      .where("token", "==", token)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (inviteQuery.empty) {
      throw new HttpsError("not-found", "Invite not found or already used.");
    }

    const inviteDoc = inviteQuery.docs[0];
    const inviteRef = inviteDoc.ref;
    const invite = (inviteDoc.data() ?? {}) as Record<string, unknown>;
    const orgId = asString(invite.orgId);
    if (!orgId) {
      throw new HttpsError("failed-precondition", "Invite has invalid organization.");
    }

    const inviteEmailLower = asString(invite.emailLower).toLowerCase();
    if (inviteEmailLower && actor.emailLower !== inviteEmailLower) {
      throw new HttpsError("permission-denied", "Invite is bound to a different email address.");
    }

    const role = clampInviteRoleOnRedeem(invite.role);
    const orgRef = db.collection("organizations").doc(orgId);
    const memberRef = orgRef.collection("members").doc(actor.uid);
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let alreadyMember = false;

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

      const inviteTx = (inviteSnap.data() ?? {}) as Record<string, unknown>;
      const inviteStatus = asString(inviteTx.status).toLowerCase();
      if (inviteStatus !== "pending") {
        throw new HttpsError("failed-precondition", "Invite is no longer pending.");
      }

      if (memberSnap.exists) {
        const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
        const currentStatus = asString(member.status).toLowerCase();
        if (currentStatus === "active" || currentStatus === "pending") {
          alreadyMember = true;
          tx.update(inviteRef, {
            status: "accepted",
            acceptedAt: now,
            acceptedByUid: actor.uid,
            updatedAt: now,
          });
          return;
        }
      }

      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      const organizationName =
        typeof org.name === "string" && org.name.trim().length > 0 ? org.name.trim().slice(0, 200) : "";

      tx.set(memberRef, {
        userId: actor.uid,
        uid: actor.uid,
        email: actor.emailLower,
        emailLower: actor.emailLower,
        displayName: actor.displayName,
        role,
        status: "active",
        joinedAt: now,
        invitedByUid: asString(inviteTx.invitedByUid) || null,
        inviteId: inviteRef.id,
        organizationName: organizationName || null,
        source: "legacy_token_invite",
        createdAt: now,
        updatedAt: now,
      });

      tx.update(inviteRef, {
        status: "accepted",
        acceptedAt: now,
        acceptedByUid: actor.uid,
        updatedAt: now,
      });

      tx.set(auditRef, {
        action: "accept_legacy_invite_token",
        orgId,
        inviteId: inviteRef.id,
        actorUid: actor.uid,
        actorEmail: actor.emailLower,
        role,
        createdAt: now,
        source: "accept_legacy_invite_token_callable",
      });
    });

    return {
      orgId,
      role,
      alreadyMember,
    };
  }
);
