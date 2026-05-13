import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

type ActivateBusinessInput = {
  orgId?: unknown;
  seatsLimit?: unknown;
};

type ActivateBusinessResult =
  | {
      ok: true;
      status: "activated";
      orgId: string;
      seatsLimit: number;
    }
  | {
      ok: true;
      status: "already_active";
      orgId: string;
      seatsLimit: number;
      message?: string;
    };

function normalizeOrgId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeSeatsLimit(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw) || raw < 1) return null;
  return raw;
}

function requireAdminAuth(request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  if (request.auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin claim is required.");
  }
  return {
    uid: request.auth.uid,
    email: typeof request.auth.token?.email === "string" ? request.auth.token.email : null,
  };
}

export const adminActivateBusinessOrg = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<ActivateBusinessResult> => {
    const actor = requireAdminAuth(request);
    const data = (request.data ?? {}) as ActivateBusinessInput;
    const orgId = normalizeOrgId(data.orgId);
    const seatsLimit = normalizeSeatsLimit(data.seatsLimit);

    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }
    if (seatsLimit === null) {
      throw new HttpsError("invalid-argument", "seatsLimit must be an integer >= 1.");
    }

    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    let result: ActivateBusinessResult | null = null;

    await db.runTransaction(async (tx) => {
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }

      const raw = (orgSnap.data() ?? {}) as Record<string, unknown>;
      const currentStatus = typeof raw.status === "string" ? raw.status : "pending_payment";
      const currentBusinessEnabled = raw.businessEnabled === true;
      const currentSeatsLimit =
        typeof raw.seatsLimit === "number" && Number.isFinite(raw.seatsLimit) ? raw.seatsLimit : 0;
      const currentSeatsUsed =
        typeof raw.seatsUsed === "number" && Number.isFinite(raw.seatsUsed) ? raw.seatsUsed : 0;

      if (currentStatus === "active" && currentBusinessEnabled) {
        const message =
          currentSeatsLimit !== seatsLimit
            ? "Organization is already active. Seats limit changes will be handled by a separate callable."
            : undefined;
        result = {
          ok: true,
          status: "already_active",
          orgId,
          seatsLimit: currentSeatsLimit,
          ...(message ? { message } : {}),
        };
        return;
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const before = {
        status: currentStatus,
        businessEnabled: currentBusinessEnabled,
        seatsLimit: currentSeatsLimit,
        seatsUsed: currentSeatsUsed,
        businessActivatedAt: raw.businessActivatedAt ?? null,
        businessActivatedBy:
          typeof raw.businessActivatedBy === "string" ? raw.businessActivatedBy : null,
      };
      const after = {
        status: "active",
        businessEnabled: true,
        seatsLimit,
        seatsUsed: currentSeatsUsed,
        businessActivatedAt: "server_timestamp",
        businessActivatedBy: actor.uid,
      };

      tx.update(orgRef, {
        status: "active",
        businessEnabled: true,
        seatsLimit,
        businessActivatedAt: now,
        businessActivatedBy: actor.uid,
        updatedAt: now,
      });

      const auditRef = db.collection("adminActivityLogs").doc();
      tx.set(auditRef, {
        action: "activate_business_org",
        orgId,
        actorUid: actor.uid,
        actorEmail: actor.email,
        before,
        after,
        source: "admin_callable",
        createdAt: now,
      });

      result = {
        ok: true,
        status: "activated",
        orgId,
        seatsLimit,
      };
    });

    if (!result) {
      throw new HttpsError("internal", "Activation result missing.");
    }
    return result;
  }
);
