import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  canReconstructInviteCode,
  stableJoinCodeForOrgAndRole,
  decryptInviteCode,
  hashCode,
  generateInviteCode,
  encryptInviteCode,
  type OrgRole,
} from "./inviteCodeUtils";

if (!admin.apps.length) {
  admin.initializeApp();
}

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function timestampToIso(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "object" && raw !== null && typeof (raw as { toDate?: () => Date }).toDate === "function") {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function requireAuth(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }
): { uid: string } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return { uid: request.auth.uid };
}

async function assertCanManageInvites(orgId: string, uid: string): Promise<void> {
  const db = admin.firestore();
  const orgRef = db.collection("organizations").doc(orgId);
  const memberRef = orgRef.collection("members").doc(uid);
  const [orgSnap, memberSnap] = await Promise.all([orgRef.get(), memberRef.get()]);
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
  let canManage = asString(org.ownerUid) === uid;
  if (!canManage && memberSnap.exists) {
    const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
    const memberRole = asString(member.role).toLowerCase();
    const memberStatus = asString(member.status).toLowerCase();
    canManage =
      memberStatus === "active" && (memberRole === "owner" || memberRole === "admin");
  }
  if (!canManage) {
    throw new HttpsError("permission-denied", "Only owner/admin can view invite codes.");
  }
}

function normalizeRole(raw: unknown): OrgRole {
  const value = asString(raw).toLowerCase();
  if (
    value === "owner" ||
    value === "admin" ||
    value === "manager" ||
    value === "worker" ||
    value === "viewer"
  ) {
    return value;
  }
  return "viewer";
}

function resolveInviteCode(
  orgId: string,
  inviteId: string,
  data: Record<string, unknown>
): string | null {
  const role = normalizeRole(data.role);
  const type = asString(data.type) || "join_code";

  if (canReconstructInviteCode(type, inviteId, role)) {
    return stableJoinCodeForOrgAndRole(orgId, role);
  }

  const codeEnc = asString(data.codeEnc);
  if (codeEnc) {
    return decryptInviteCode(codeEnc);
  }

  return null;
}

export type GetBusinessInviteDisplayResult = {
  inviteId: string;
  code: string;
  deepLink: string;
  webJoinUrl: string;
  expiresAt: string | null;
  maxUses: number;
  requiresApproval: boolean;
  emailLower: string | null;
  regenerated?: boolean;
};

export const getBusinessInviteDisplay = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<GetBusinessInviteDisplayResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as { orgId?: unknown; inviteId?: unknown; regenerate?: unknown };
    const orgId = asString(raw.orgId);
    const inviteId = asString(raw.inviteId);
    const regenerate = raw.regenerate === true;

    if (!orgId || !inviteId) {
      throw new HttpsError("invalid-argument", "orgId and inviteId are required.");
    }

    await assertCanManageInvites(orgId, actor.uid);

    const db = admin.firestore();
    const inviteRef = db.collection("organizations").doc(orgId).collection("invites").doc(inviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }

    const data = (inviteSnap.data() ?? {}) as Record<string, unknown>;
    const status = asString(data.status).toLowerCase();
    if (status !== "active") {
      throw new HttpsError("failed-precondition", "Invite is no longer active.");
    }

    let code = resolveInviteCode(orgId, inviteId, data);
    const hadCodeBeforeRegenerate = Boolean(code);

    if (!code && regenerate) {
      const type = asString(data.type) || "join_code";
      if (type === "join_code" || type === "qr_code") {
        throw new HttpsError(
          "failed-precondition",
          "Primary join codes cannot be regenerated. Revoke and create a new invite."
        );
      }

      code = generateInviteCode();
      const expectedHash = hashCode(code);
      const now = FieldValue.serverTimestamp();
      await db.runTransaction(async (tx) => {
        const lookupRef = db.collection("businessInviteLookup").doc(expectedHash);
        tx.set(inviteRef, {
          codeHash: expectedHash,
          codePrefix: code!.slice(0, 4),
          codeEnc: encryptInviteCode(code!),
          updatedAt: now,
        }, { merge: true });
        tx.set(lookupRef, { orgId, inviteId, updatedAt: now }, { merge: true });
      });
    }

    if (!code) {
      throw new HttpsError(
        "failed-precondition",
        "Invite code is not available. Regenerate the code or create a new invite."
      );
    }

    const maxUses =
      typeof data.maxUses === "number" && Number.isFinite(data.maxUses)
        ? Math.max(1, Math.floor(data.maxUses))
        : 1;

    return {
      inviteId,
      code,
      deepLink: `staveto://business/join?code=${encodeURIComponent(code)}`,
      webJoinUrl: `/join?code=${encodeURIComponent(code)}`,
      expiresAt: timestampToIso(data.expiresAt),
      maxUses,
      requiresApproval: data.requiresApproval === true,
      emailLower: asString(data.emailLower).toLowerCase() || null,
      regenerated: regenerate && !hadCodeBeforeRegenerate ? true : undefined,
    };
  }
);
