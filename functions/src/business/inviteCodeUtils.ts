import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from "crypto";

export type OrgRole = "owner" | "admin" | "manager" | "worker" | "viewer";

export type InviteAssignableRole = "manager" | "worker" | "viewer";

const INVITE_ASSIGNABLE: InviteAssignableRole[] = ["manager", "worker", "viewer"];

export function normalizeInviteAssignableRole(raw: unknown): InviteAssignableRole {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (INVITE_ASSIGNABLE.includes(value as InviteAssignableRole)) {
    return value as InviteAssignableRole;
  }
  if (value === "member" || value === "client") return "worker";
  if (value === "admin") return "manager";
  throw new Error(`Invite role "${value || "empty"}" is not assignable.`);
}

/** Clamp stored invite role on redeem — never grant owner/admin via invite. */
export function clampInviteRoleOnRedeem(raw: unknown): InviteAssignableRole {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (INVITE_ASSIGNABLE.includes(value as InviteAssignableRole)) {
    return value as InviteAssignableRole;
  }
  if (value === "member" || value === "client") return "worker";
  if (value === "admin") return "manager";
  if (value === "owner") return "manager";
  return "worker";
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function joinHmacSecret(): string {
  const explicit = process.env.JOIN_CODE_HMAC_SECRET;
  if (typeof explicit === "string" && explicit.trim().length >= 8) {
    return explicit.trim();
  }
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  return `staveto-primary-invite|v1|${project || "unknown"}`;
}

export function stableJoinCodeForOrgAndRole(orgId: string, role: OrgRole): string {
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

export function primaryCompanyInviteDocId(role: OrgRole): string {
  return `primary_join_${role}`;
}

export function canReconstructInviteCode(
  type: string,
  inviteId: string,
  role: OrgRole
): boolean {
  const normalizedType = type.toLowerCase();
  if (normalizedType === "join_code" || normalizedType === "qr_code") {
    return inviteId === primaryCompanyInviteDocId(role);
  }
  return false;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(`${joinHmacSecret()}|invite-code-enc|v1`).digest();
}

/** Owner/admin-only retrieval — stored on invite doc at create time. */
export function encryptInviteCode(code: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptInviteCode(payload: string): string | null {
  try {
    const raw = Buffer.from(payload, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const key = encryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
