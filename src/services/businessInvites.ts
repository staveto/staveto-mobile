import { auth, getCallable } from "../firebase";

export type BusinessInviteRole = "owner" | "admin" | "manager" | "worker" | "viewer";
export type BusinessMemberStatus = "pending" | "active";

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

/** Callable `redeemBusinessInviteCode` — server-side membership + org wiring. */
export async function redeemBusinessInviteCode(
  input: RedeemBusinessInviteCodeInput
): Promise<RedeemBusinessInviteCodeResult> {
  ensureSignedIn();
  const call = getCallable<RedeemBusinessInviteCodeInput, { data?: unknown }>("redeemBusinessInviteCode", {
    timeoutMs: 15_000,
  });
  const res = await call(input);
  return parseRedeemResult((res as { data?: unknown })?.data ?? res);
}
