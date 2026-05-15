import { auth, getCallable } from "../firebase";

export type BusinessInviteRole = "owner" | "admin" | "manager" | "worker" | "viewer";
export type BusinessInviteType = "direct_email" | "join_code" | "qr_code";
export type BusinessInviteStatus = "active" | "expired" | "revoked";
export type BusinessMemberStatus = "pending" | "active";

export type CreateBusinessInviteCodeInput = {
  orgId: string;
  role: BusinessInviteRole;
  emailLower?: string | null;
  expiresInHours?: number;
  maxUses?: number;
  requiresApproval?: boolean;
};

export type CreateBusinessInviteCodeResult = {
  inviteId: string;
  code: string;
  deepLink: string;
  expiresAt: string | null;
  maxUses: number;
  requiresApproval: boolean;
};

export type RedeemBusinessInviteCodeInput = {
  code: string;
};

export type RedeemBusinessInviteCodeResult = {
  status: BusinessMemberStatus;
  orgId: string;
  role: BusinessInviteRole;
  membershipId: string;
  requiresApproval: boolean;
  alreadyMember?: boolean;
};

export type ApproveBusinessMemberInput = {
  orgId: string;
  userId: string;
};

export type ApproveBusinessMemberResult = {
  ok: true;
  orgId: string;
  userId: string;
  status: "active";
};

export type RevokeBusinessInviteInput = {
  orgId: string;
  inviteId: string;
};

export type RevokeBusinessInviteResult = {
  ok: true;
  inviteId: string;
  status: "revoked";
};

function parseCreateInviteResult(raw: unknown): CreateBusinessInviteCodeResult {
  const data = (raw ?? {}) as Partial<CreateBusinessInviteCodeResult>;
  if (typeof data.inviteId !== "string" || typeof data.code !== "string" || typeof data.deepLink !== "string") {
    throw new Error("Invalid createBusinessInviteCode response.");
  }
  return {
    inviteId: data.inviteId,
    code: data.code,
    deepLink: data.deepLink,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
    maxUses: typeof data.maxUses === "number" ? data.maxUses : 1,
    requiresApproval: data.requiresApproval === true,
  };
}

function parseRedeemResult(raw: unknown): RedeemBusinessInviteCodeResult {
  const data = (raw ?? {}) as Partial<RedeemBusinessInviteCodeResult>;
  if (
    typeof data.status !== "string" ||
    typeof data.orgId !== "string" ||
    typeof data.role !== "string" ||
    typeof data.membershipId !== "string"
  ) {
    throw new Error("Invalid redeemBusinessInviteCode response.");
  }
  return {
    status: data.status as BusinessMemberStatus,
    orgId: data.orgId,
    role: data.role as BusinessInviteRole,
    membershipId: data.membershipId,
    requiresApproval: data.requiresApproval === true,
  };
}

function ensureSignedIn(): void {
  if (!auth().currentUser) {
    throw new Error("AUTH_NOT_READY");
  }
}

export async function createBusinessInviteCode(
  input: CreateBusinessInviteCodeInput
): Promise<CreateBusinessInviteCodeResult> {
  ensureSignedIn();
  const call = getCallable<CreateBusinessInviteCodeInput, { data?: unknown }>("createBusinessInviteCode");
  const res = await call(input);
  return parseCreateInviteResult((res as { data?: unknown })?.data ?? res);
}

export async function redeemBusinessInviteCode(
  input: RedeemBusinessInviteCodeInput
): Promise<RedeemBusinessInviteCodeResult> {
  ensureSignedIn();
  const call = getCallable<RedeemBusinessInviteCodeInput, { data?: unknown }>("redeemBusinessInviteCode");
  const res = await call(input);
  return parseRedeemResult((res as { data?: unknown })?.data ?? res);
}

export async function approveBusinessMember(
  input: ApproveBusinessMemberInput
): Promise<ApproveBusinessMemberResult> {
  ensureSignedIn();
  const call = getCallable<ApproveBusinessMemberInput, { data?: unknown }>("approveBusinessMember");
  const res = await call(input);
  const data = ((res as { data?: unknown })?.data ?? res) as Partial<ApproveBusinessMemberResult>;
  if (data.ok !== true || typeof data.orgId !== "string" || typeof data.userId !== "string") {
    throw new Error("Invalid approveBusinessMember response.");
  }
  return { ok: true, orgId: data.orgId, userId: data.userId, status: "active" };
}

export async function revokeBusinessInvite(
  input: RevokeBusinessInviteInput
): Promise<RevokeBusinessInviteResult> {
  ensureSignedIn();
  const call = getCallable<RevokeBusinessInviteInput, { data?: unknown }>("revokeBusinessInvite");
  const res = await call(input);
  const data = ((res as { data?: unknown })?.data ?? res) as Partial<RevokeBusinessInviteResult>;
  if (data.ok !== true || typeof data.inviteId !== "string") {
    throw new Error("Invalid revokeBusinessInvite response.");
  }
  return { ok: true, inviteId: data.inviteId, status: "revoked" };
}
