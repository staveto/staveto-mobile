import * as admin from "firebase-admin";
import { createHash, createHmac, randomBytes } from "crypto";
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

/** Prefer `JOIN_CODE_HMAC_SECRET` in prod for stronger codes; fallback uses project id (public). */
function joinHmacSecret(): string {
  const explicit = process.env.JOIN_CODE_HMAC_SECRET;
  if (typeof explicit === "string" && explicit.trim().length >= 8) {
    return explicit.trim();
  }
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  return `staveto-primary-invite|v1|${project || "unknown"}`;
}

/**
 * One stable join code per (org, role) for the non-email flow. Plaintext is not stored;
 * it is recomputed here and must match the stored hash after the first write.
 */
function stableJoinCodeForOrgAndRole(orgId: string, role: OrgRole): string {
  const mac = createHmac("sha256", joinHmacSecret());
  mac.update(`v1|${orgId}|${role}`);
  const digest = mac.digest();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += chars[digest[i] % chars.length];
  }
  return out;
}

function primaryCompanyInviteDocId(role: OrgRole): string {
  return `primary_join_${role}`;
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
    const isDirectEmail = Boolean(emailLower);
    const inviteRef = isDirectEmail
      ? orgRef.collection("invites").doc()
      : orgRef.collection("invites").doc(primaryCompanyInviteDocId(role));
    const inviteCode = isDirectEmail ? generateInviteCode() : stableJoinCodeForOrgAndRole(orgId, role);
    const inviteType: InviteType = emailLower ? "direct_email" : "join_code";

    const auditRef = db.collection("adminActivityLogs").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    let resultExpiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    let resultMaxUses = maxUses;

    await db.runTransaction(async (tx) => {
      const [orgSnap, memberSnap, inviteSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(memberRef),
        tx.get(inviteRef),
      ]);
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

      const freeSeats = seatsLimit > 0 ? Math.max(seatsLimit - seatsUsed, 0) : 999999;
      let effectiveMaxUses = maxUses;
      let expiresAtDate = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      if (!isDirectEmail) {
        effectiveMaxUses = requiresApproval ? 999999 : Math.max(1, freeSeats);
        expiresAtDate = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
        if (seatsLimit > 0 && !requiresApproval && effectiveMaxUses > freeSeats) {
          throw new HttpsError(
            "failed-precondition",
            "Invite maxUses exceeds currently available seats."
          );
        }
      } else if (seatsLimit > 0) {
        if (!requiresApproval && maxUses > freeSeats) {
          throw new HttpsError(
            "failed-precondition",
            "Invite maxUses exceeds currently available seats."
          );
        }
      }

      const expiresAt = admin.firestore.Timestamp.fromDate(expiresAtDate);
      const expectedHash = hashCode(inviteCode);
      const existing = inviteSnap.exists ? ((inviteSnap.data() ?? {}) as Record<string, unknown>) : null;
      const existingUsed =
        typeof existing?.usedCount === "number" && Number.isFinite(existing.usedCount)
          ? Math.max(0, Math.floor(existing.usedCount))
          : 0;

      tx.set(inviteRef, {
        orgId,
        codeHash: expectedHash,
        codePrefix: inviteCode.slice(0, 4),
        createdByUid: actor.uid,
        createdByEmail: actor.email,
        createdAt: inviteSnap.exists ? (existing?.createdAt as unknown) ?? now : now,
        expiresAt,
        maxUses: effectiveMaxUses,
        usedCount: !isDirectEmail && inviteSnap.exists ? existingUsed : 0,
        status: "active",
        role,
        emailLower,
        requiresApproval,
        type: inviteType,
      });

      // O(1) redeem lookup — avoids collectionGroup("invites") + codeHash indexes.
      const lookupRef = db.collection("businessInviteLookup").doc(expectedHash);
      tx.set(lookupRef, {
        orgId,
        inviteId: inviteRef.id,
        updatedAt: now,
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
        maxUses: effectiveMaxUses,
        createdAt: now,
        source: "create_business_invite_code_callable",
      });

      resultExpiresAt = expiresAtDate;
      resultMaxUses = effectiveMaxUses;
    });

    return {
      inviteId: inviteRef.id,
      code: inviteCode,
      deepLink: `staveto://business/join?code=${encodeURIComponent(inviteCode)}`,
      expiresAt: resultExpiresAt.toISOString(),
      maxUses: resultMaxUses,
      requiresApproval,
    };
  }
);
