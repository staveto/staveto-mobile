import * as admin from "firebase-admin";
import { createHash, randomBytes } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type OrgRole = "owner" | "admin" | "manager" | "worker" | "viewer";
type InviteType = "direct_email" | "join_code" | "qr_code";

type CreateBusinessInviteCodeInput = {
  orgId?: unknown;
  role?: unknown;
  emailLower?: unknown;
  expiresInHours?: unknown;
  maxUses?: unknown;
  requiresApproval?: unknown;
};

type CreateBusinessInviteCodeResult = {
  inviteId: string;
  code: string;
  deepLink: string;
  expiresAt: string | null;
  maxUses: number;
  requiresApproval: boolean;
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function asOptionalEmailLower(raw: unknown): string | null {
  const value = asString(raw).toLowerCase();
  return value || null;
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
  throw new HttpsError("invalid-argument", "role is invalid.");
}

function normalizeMaxUses(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return 1;
}

function normalizeExpiresInHours(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return 168;
}

function normalizeRequiresApproval(raw: unknown): boolean {
  return raw === true;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += chars[bytes[i] % chars.length];
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
    email: typeof request.auth.token?.email === "string" ? request.auth.token.email.toLowerCase() : null,
  };
}

export const createBusinessInviteCode = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<CreateBusinessInviteCodeResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as CreateBusinessInviteCodeInput;
    const orgId = asString(raw.orgId);
    const role = normalizeRole(raw.role);
    const emailLower = asOptionalEmailLower(raw.emailLower);
    const maxUses = normalizeMaxUses(raw.maxUses);
    const expiresInHours = normalizeExpiresInHours(raw.expiresInHours);
    const requiresApproval = normalizeRequiresApproval(raw.requiresApproval);

    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const memberRef = orgRef.collection("members").doc(actor.uid);
    const inviteRef = orgRef.collection("invites").doc();
    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const expiresAtDate = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const expiresAt = admin.firestore.Timestamp.fromDate(expiresAtDate);
    const inviteCode = generateInviteCode();
    const inviteType: InviteType = emailLower ? "direct_email" : "join_code";

    await db.runTransaction(async (tx) => {
      const [orgSnap, memberSnap] = await Promise.all([tx.get(orgRef), tx.get(memberRef)]);
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      const ownerUid = asString(org.ownerUid);
      const seatsLimitRaw = org.seatsLimit;
      const seatsUsedRaw = org.seatsUsed;
      const seatsLimit =
        typeof seatsLimitRaw === "number" && Number.isFinite(seatsLimitRaw) ? Math.floor(seatsLimitRaw) : 0;
      const seatsUsed =
        typeof seatsUsedRaw === "number" && Number.isFinite(seatsUsedRaw) ? Math.floor(seatsUsedRaw) : 0;

      let canManage = ownerUid === actor.uid;
      if (!canManage && memberSnap.exists) {
        const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
        const memberRole = asString(member.role).toLowerCase();
        const memberStatus = asString(member.status).toLowerCase();
        canManage =
          memberStatus === "active" && (memberRole === "owner" || memberRole === "admin");
      }
      if (!canManage) {
        throw new HttpsError("permission-denied", "Only owner/admin can create invites.");
      }

      if (seatsLimit > 0) {
        const freeSeats = Math.max(seatsLimit - seatsUsed, 0);
        if (!requiresApproval && maxUses > freeSeats) {
          throw new HttpsError(
            "failed-precondition",
            "Invite maxUses exceeds currently available seats."
          );
        }
      }

      tx.set(inviteRef, {
        orgId,
        codeHash: hashCode(inviteCode),
        codePrefix: inviteCode.slice(0, 4),
        createdByUid: actor.uid,
        createdByEmail: actor.email,
        createdAt: now,
        expiresAt,
        maxUses,
        usedCount: 0,
        status: "active",
        role,
        emailLower,
        requiresApproval,
        type: inviteType,
      });

      tx.set(auditRef, {
        action: "create_business_invite",
        orgId,
        inviteId: inviteRef.id,
        actorUid: actor.uid,
        actorEmail: actor.email,
        role,
        emailLower,
        requiresApproval,
        maxUses,
        createdAt: now,
        source: "create_business_invite_code_callable",
      });
    });

    return {
      inviteId: inviteRef.id,
      code: inviteCode,
      deepLink: `staveto://business/join?code=${encodeURIComponent(inviteCode)}`,
      expiresAt: expiresAtDate.toISOString(),
      maxUses,
      requiresApproval,
    };
  }
);
