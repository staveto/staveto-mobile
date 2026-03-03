import { auth, getCallable } from "../firebase";

type ClaimInvitesResult = {
  claimedCount: number;
  projectIds: string[];
};

export type PendingInvite = {
  projectId: string;
  projectName: string;
  memberId: string;
  invitedBy?: string;
  invitedAt?: unknown;
  permissionLevel?: string;
  role?: string;
  sharedItems?: Record<string, boolean>;
  sharedPhaseIds?: string[];
  email?: string;
  name?: string;
};

type AcceptInviteResult = {
  ok: boolean;
  projectId?: string;
  already?: boolean;
  reason?: string;
};

type DeclineInviteResult = {
  ok: boolean;
};

async function ensureAuthAndCall<T>(
  callableName: string,
  data: Record<string, unknown>,
  parse: (res: unknown) => T,
  retryOnUnauth = false
): Promise<T> {
  const user = auth().currentUser;
  if (!user) {
    throw new Error("AUTH_NOT_READY");
  }
  const doCall = async () => {
    await user.getIdToken(true);
    const callable = getCallable(callableName);
    const res = await callable(data);
    return parse(res?.data);
  };
  try {
    return await doCall();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (retryOnUnauth && (code === "unauthenticated" || code === "UNAUTHENTICATED")) {
      if (__DEV__) console.log("[invites] UNAUTHENTICATED, retrying with fresh token...");
      await user.getIdToken(true);
      await new Promise((r) => setTimeout(r, 500));
      return await doCall();
    }
    throw err;
  }
}

const CLAIM_INVITES_TIMEOUT_MS = 2000;

export async function claimProjectInvites(): Promise<ClaimInvitesResult> {
  const empty: ClaimInvitesResult = { claimedCount: 0, projectIds: [] };
  const timeoutPromise = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("claimProjectInvites timeout")), CLAIM_INVITES_TIMEOUT_MS)
  );
  try {
    const data = await Promise.race([
      ensureAuthAndCall(
        "claimProjectInvites",
        {},
        (d) => (d ?? {}) as Partial<ClaimInvitesResult>,
        true
      ),
      timeoutPromise,
    ]);
    return {
      claimedCount: typeof data.claimedCount === "number" ? data.claimedCount : 0,
      projectIds: Array.isArray(data.projectIds) ? data.projectIds.filter((x): x is string => typeof x === "string") : [],
    };
  } catch (error) {
    if (__DEV__) console.warn("[invites] claimProjectInvites failed (non-blocking):", error);
    return empty;
  }
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  try {
    const data = await ensureAuthAndCall(
      "listPendingInvites",
      {},
      (d) => (d as { invites?: PendingInvite[] })?.invites ?? []
    );
    return (Array.isArray(data) ? data : []).filter(
      (i): i is PendingInvite =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as PendingInvite).projectId === "string"
    );
  } catch (error) {
    const msg = (error as { message?: string })?.message ?? String(error);
    console.warn("[invites] listPendingInvites failed:", msg, error);
    return [];
  }
}

export async function acceptProjectInvite(projectId: string): Promise<AcceptInviteResult> {
  const user = auth().currentUser;
  if (__DEV__ && user) {
    console.log("[invites] acceptProjectInvite: uid=", user.uid, "email=", user.email);
  }
  const data = await ensureAuthAndCall(
    "acceptProjectInvite",
    { projectId },
    (d) => (d ?? {}) as AcceptInviteResult,
    true
  );
  return {
    ok: data.ok === true,
    projectId: data.projectId,
    already: data.already,
    reason: data.reason,
  };
}

export async function declineProjectInvite(projectId: string): Promise<DeclineInviteResult> {
  const data = await ensureAuthAndCall(
    "declineProjectInvite",
    { projectId },
    (d) => (d ?? {}) as DeclineInviteResult
  );
  return { ok: data.ok === true };
}
