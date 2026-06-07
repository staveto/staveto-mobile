import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { clampInviteRoleOnRedeem, type InviteAssignableRole } from "./inviteCodeUtils";
type MembershipStatus = "pending" | "active";

if (!admin.apps.length) {
  admin.initializeApp();
}

type RedeemBusinessInviteCodeInput = {
  code?: unknown;
};

type RedeemBusinessInviteCodeResult = {
  status: MembershipStatus;
  orgId: string;
  role: InviteAssignableRole;
  membershipId: string;
  requiresApproval: boolean;
  alreadyMember?: boolean;
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeRole(raw: unknown): InviteAssignableRole {
  return clampInviteRoleOnRedeem(raw);
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
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

function timestampToMillis(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const maybe = raw as { toMillis?: () => number };
    if (typeof maybe.toMillis === "function") {
      const parsed = maybe.toMillis();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

export const redeemBusinessInviteCode = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<RedeemBusinessInviteCodeResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as RedeemBusinessInviteCodeInput;
    const code = asString(raw.code).toUpperCase();
    if (!code) {
      throw new HttpsError("invalid-argument", "code is required.");
    }

    const db = admin.firestore();
    const digest = hashCode(code);

    const lookupRef = db.collection("businessInviteLookup").doc(digest);
    const lookupSnap = await lookupRef.get();

    let inviteRef: admin.firestore.DocumentReference;
    let invitePreview: Record<string, unknown>;

    if (lookupSnap.exists) {
      const lu = (lookupSnap.data() ?? {}) as Record<string, unknown>;
      const oid = asString(lu.orgId);
      const iid = asString(lu.inviteId);
      if (!oid || !iid) {
        throw new HttpsError("not-found", "Invite code is invalid.");
      }
      inviteRef = db.collection("organizations").doc(oid).collection("invites").doc(iid);
      const invSnap = await inviteRef.get();
      if (!invSnap.exists) {
        throw new HttpsError("not-found", "Invite code is invalid.");
      }
      invitePreview = (invSnap.data() ?? {}) as Record<string, unknown>;
      const previewOrgId = asString(invitePreview.orgId);
      if (previewOrgId && previewOrgId !== oid) {
        throw new HttpsError("failed-precondition", "Invite organization mismatch.");
      }
    } else {
      let inviteSnap;
      try {
        inviteSnap = await db
          .collectionGroup("invites")
          .where("codeHash", "==", digest)
          .limit(10)
          .get();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[redeemBusinessInviteCode] collectionGroup invite lookup failed:", msg);
        if (/index|FAILED_PRECONDITION|failed[_-]precondition/i.test(msg)) {
          throw new HttpsError(
            "not-found",
            "Invite code is invalid or out of date. Ask the company admin to open the company code once in Business (refreshes the invite)."
          );
        }
        throw new HttpsError("internal", `Invite lookup failed: ${msg}`);
      }
      const orgInviteDocs = inviteSnap.docs.filter(
        (d) => d.ref.path.startsWith("organizations/") && d.ref.path.includes("/invites/")
      );
      if (orgInviteDocs.length === 0) {
        throw new HttpsError(
          "not-found",
          "Invite code is invalid or out of date. Ask the company admin to open the company code once in Business."
        );
      }
      const d0 = orgInviteDocs[0];
      inviteRef = d0.ref;
      invitePreview = (d0.data() ?? {}) as Record<string, unknown>;
    }

    const orgId = asString(invitePreview.orgId);
    if (!orgId) {
      throw new HttpsError("failed-precondition", "Invite has invalid organization.");
    }

    const role = normalizeRole(invitePreview.role);
    const requiresApproval = invitePreview.requiresApproval === true;
    const membershipStatus: MembershipStatus = requiresApproval ? "pending" : "active";
    const inviteId = inviteRef.id;
    const orgRef = db.collection("organizations").doc(orgId);
    const memberRef = orgRef.collection("members").doc(actor.uid);
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let alreadyMember = false;
    let transactionStatus: MembershipStatus = membershipStatus;

    await db.runTransaction(async (tx) => {
      const [orgSnap, membershipSnap, inviteTxSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(memberRef),
        tx.get(inviteRef),
      ]);
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      if (!inviteTxSnap.exists) {
        throw new HttpsError("not-found", "Invite not found.");
      }

      const inviteTx = (inviteTxSnap.data() ?? {}) as Record<string, unknown>;
      const inviteOrgId = asString(inviteTx.orgId);
      if (inviteOrgId && inviteOrgId !== orgId) {
        throw new HttpsError("failed-precondition", "Invite organization mismatch.");
      }
      const usedTx =
        typeof inviteTx.usedCount === "number" && Number.isFinite(inviteTx.usedCount)
          ? Math.max(0, Math.floor(inviteTx.usedCount))
          : 0;
      const maxTx =
        typeof inviteTx.maxUses === "number" && Number.isFinite(inviteTx.maxUses)
          ? Math.max(1, Math.floor(inviteTx.maxUses))
          : 1;

      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      const organizationName =
        typeof org.name === "string" && org.name.trim().length > 0 ? org.name.trim().slice(0, 200) : "";
      const seatsLimit =
        typeof org.seatsLimit === "number" && Number.isFinite(org.seatsLimit)
          ? Math.floor(org.seatsLimit)
          : 0;
      const seatsUsed =
        typeof org.seatsUsed === "number" && Number.isFinite(org.seatsUsed)
          ? Math.floor(org.seatsUsed)
          : 0;
      let membershipSource = asString(inviteTx.type).toLowerCase();
      if (membershipSource !== "qr_code" && membershipSource !== "direct_email") {
        membershipSource = "invite_code";
      }

      if (membershipSnap.exists) {
        const member = (membershipSnap.data() ?? {}) as Record<string, unknown>;
        const currentStatus = asString(member.status).toLowerCase();
        if (currentStatus === "active" || currentStatus === "pending") {
          alreadyMember = true;
          transactionStatus = currentStatus as MembershipStatus;
          tx.set(auditRef, {
            action: "business_invite_redeem_already_member",
            orgId,
            inviteId,
            actorUid: actor.uid,
            actorEmail: actor.emailLower,
            status: transactionStatus,
            createdAt: now,
            source: "redeem_business_invite_code_callable",
          });
          return;
        }
      }

      const inviteTxStatus = asString(inviteTx.status).toLowerCase();
      if (inviteTxStatus !== "active") {
        throw new HttpsError("failed-precondition", "Invite is no longer active.");
      }
      const expiresTx = timestampToMillis(inviteTx.expiresAt);
      if (expiresTx !== null && expiresTx <= Date.now()) {
        throw new HttpsError("failed-precondition", "Invite has expired.");
      }
      if (usedTx >= maxTx) {
        throw new HttpsError("failed-precondition", "Invite reached maximum uses.");
      }
      const inviteEmailLower = asString(inviteTx.emailLower).toLowerCase();
      if (inviteEmailLower && actor.emailLower !== inviteEmailLower) {
        throw new HttpsError("permission-denied", "Invite is bound to a different email address.");
      }
      if (!requiresApproval && seatsLimit > 0 && seatsUsed >= seatsLimit) {
        throw new HttpsError("failed-precondition", "No available seats left.");
      }

      if (membershipSnap.exists) {
        tx.set(
          memberRef,
          {
            userId: actor.uid,
            uid: actor.uid,
            email: actor.emailLower,
            emailLower: actor.emailLower,
            displayName: actor.displayName,
            role,
            status: membershipStatus,
            joinedAt: membershipStatus === "active" ? now : null,
            requestedAt: now,
            invitedByUid: asString(inviteTx.createdByUid) || null,
            inviteId,
            organizationName: organizationName || null,
            source: membershipSource,
            updatedAt: now,
          },
          { merge: true }
        );
      } else {
        tx.set(memberRef, {
          userId: actor.uid,
          uid: actor.uid,
          email: actor.emailLower,
          emailLower: actor.emailLower,
          displayName: actor.displayName,
          role,
          status: membershipStatus,
          joinedAt: membershipStatus === "active" ? now : null,
          requestedAt: now,
          invitedByUid: asString(inviteTx.createdByUid) || null,
          inviteId,
          organizationName: organizationName || null,
          source: membershipSource,
          createdAt: now,
          updatedAt: now,
        });
      }
      transactionStatus = membershipStatus;

      const nextUsedCount = usedTx + 1;
      const inviteUpdate: Record<string, unknown> = {
        usedCount: nextUsedCount,
        updatedAt: now,
      };
      if (nextUsedCount >= maxTx) {
        inviteUpdate.status = "expired";
      }
      tx.update(inviteRef, inviteUpdate);

      if (!requiresApproval && transactionStatus === "active") {
        tx.update(orgRef, {
          seatsUsed: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });
      }

      tx.set(auditRef, {
        action: "redeem_business_invite",
        orgId,
        inviteId,
        actorUid: actor.uid,
        actorEmail: actor.emailLower,
        role,
        status: transactionStatus,
        createdAt: now,
        source: "redeem_business_invite_code_callable",
      });
    });

    return {
      status: transactionStatus,
      orgId,
      role,
      membershipId: memberRef.id,
      requiresApproval,
      alreadyMember,
    };
  }
);
