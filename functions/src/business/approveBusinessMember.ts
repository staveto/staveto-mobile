import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type ApproveBusinessMemberInput = {
  orgId?: unknown;
  userId?: unknown;
};

type ApproveBusinessMemberResult = {
  ok: true;
  orgId: string;
  userId: string;
  status: "active";
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

export const approveBusinessMember = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<ApproveBusinessMemberResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as ApproveBusinessMemberInput;
    const orgId = asString(raw.orgId);
    const userId = asString(raw.userId);
    if (!orgId || !userId) {
      throw new HttpsError("invalid-argument", "orgId and userId are required.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const actorMemberRef = orgRef.collection("members").doc(actor.uid);
    const targetMemberRef = orgRef.collection("members").doc(userId);
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (tx) => {
      const [orgSnap, actorMemberSnap, targetMemberSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(actorMemberRef),
        tx.get(targetMemberRef),
      ]);
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      if (!targetMemberSnap.exists) {
        throw new HttpsError("not-found", "Target member not found.");
      }

      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      let canApprove = asString(org.ownerUid) === actor.uid;
      if (!canApprove && actorMemberSnap.exists) {
        const actorMember = (actorMemberSnap.data() ?? {}) as Record<string, unknown>;
        const role = asString(actorMember.role).toLowerCase();
        const status = asString(actorMember.status).toLowerCase();
        canApprove =
          status === "active" && (role === "owner" || role === "admin");
      }
      if (!canApprove) {
        throw new HttpsError("permission-denied", "Only owner/admin can approve members.");
      }

      const targetMember = (targetMemberSnap.data() ?? {}) as Record<string, unknown>;
      const targetStatus = asString(targetMember.status).toLowerCase();
      if (targetStatus === "active") {
        return;
      }
      if (targetStatus !== "pending") {
        throw new HttpsError("failed-precondition", "Only pending members can be approved.");
      }

      const seatsLimit =
        typeof org.seatsLimit === "number" && Number.isFinite(org.seatsLimit)
          ? Math.floor(org.seatsLimit)
          : 0;
      const seatsUsed =
        typeof org.seatsUsed === "number" && Number.isFinite(org.seatsUsed)
          ? Math.floor(org.seatsUsed)
          : 0;
      if (seatsLimit > 0 && seatsUsed >= seatsLimit) {
        throw new HttpsError("failed-precondition", "No available seats left.");
      }

      tx.update(targetMemberRef, {
        status: "active",
        joinedAt: now,
        updatedAt: now,
      });
      tx.update(orgRef, {
        seatsUsed: admin.firestore.FieldValue.increment(1),
        updatedAt: now,
      });
      tx.set(auditRef, {
        action: "approve_business_member",
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        targetUserId: userId,
        createdAt: now,
        source: "approve_business_member_callable",
      });
    });

    return {
      ok: true,
      orgId,
      userId,
      status: "active",
    };
  }
);
