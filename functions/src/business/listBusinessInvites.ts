import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  canReconstructInviteCode,
  stableJoinCodeForOrgAndRole,
  type OrgRole,
} from "./inviteCodeUtils";

if (!admin.apps.length) {
  admin.initializeApp();
}

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
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

export type BusinessInviteListItem = {
  inviteId: string;
  codePrefix: string | null;
  role: OrgRole;
  status: string;
  type: string;
  emailLower: string | null;
  requiresApproval: boolean;
  expiresAt: string | null;
  usedCount: number;
  maxUses: number;
  code: string | null;
  deepLink: string | null;
};

export const listBusinessInvites = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<{ invites: BusinessInviteListItem[] }> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as { orgId?: unknown };
    const orgId = asString(raw.orgId);
    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const memberRef = orgRef.collection("members").doc(actor.uid);

    const [orgSnap, memberSnap, invitesSnap] = await Promise.all([
      orgRef.get(),
      memberRef.get(),
      orgRef.collection("invites").where("status", "==", "active").get(),
    ]);

    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }

    const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
    let canManage = asString(org.ownerUid) === actor.uid;
    if (!canManage && memberSnap.exists) {
      const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
      const memberRole = asString(member.role).toLowerCase();
      const memberStatus = asString(member.status).toLowerCase();
      canManage =
        memberStatus === "active" && (memberRole === "owner" || memberRole === "admin");
    }
    if (!canManage) {
      throw new HttpsError("permission-denied", "Only owner/admin can list invites.");
    }

    const invites: BusinessInviteListItem[] = invitesSnap.docs.map((doc) => {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const role = normalizeRole(data.role);
      const type = asString(data.type) || "join_code";
      const inviteId = doc.id;
      let code: string | null = null;
      let deepLink: string | null = null;

      if (canReconstructInviteCode(type, inviteId, role)) {
        code = stableJoinCodeForOrgAndRole(orgId, role);
        deepLink = `staveto://business/join?code=${encodeURIComponent(code)}`;
      }

      const usedCount =
        typeof data.usedCount === "number" && Number.isFinite(data.usedCount)
          ? Math.max(0, Math.floor(data.usedCount))
          : 0;
      const maxUses =
        typeof data.maxUses === "number" && Number.isFinite(data.maxUses)
          ? Math.max(1, Math.floor(data.maxUses))
          : 1;

      return {
        inviteId,
        codePrefix: asString(data.codePrefix) || null,
        role,
        status: asString(data.status) || "active",
        type,
        emailLower: asString(data.emailLower).toLowerCase() || null,
        requiresApproval: data.requiresApproval === true,
        expiresAt: timestampToIso(data.expiresAt),
        usedCount,
        maxUses,
        code,
        deepLink,
      };
    });

    invites.sort((a, b) => {
      const aExp = a.expiresAt ?? "";
      const bExp = b.expiresAt ?? "";
      return aExp.localeCompare(bExp);
    });

    return { invites };
  }
);
