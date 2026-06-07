import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { seatsForPlan } from "./orgPlanConfig";

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

type BackfillResult = {
  ok: true;
  updatedOrgIds: string[];
  skippedOrgIds: string[];
};

function isMissingString(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isEmptyObject(value: unknown): boolean {
  return !value || typeof value !== "object" || Object.keys(value as object).length === 0;
}

async function countActiveMembers(orgId: string): Promise<number> {
  const snap = await admin
    .firestore()
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .where("status", "==", "active")
    .get();
  return snap.size;
}

async function resolveOwnerEmail(ownerUid: string): Promise<string | null> {
  const userSnap = await admin.firestore().collection("users").doc(ownerUid).get();
  if (!userSnap.exists) return null;
  const data = userSnap.data() ?? {};
  const email =
    typeof data.email === "string"
      ? data.email.trim().toLowerCase()
      : typeof data.emailLower === "string"
        ? data.emailLower.trim().toLowerCase()
        : "";
  return email || null;
}

export async function backfillOrganizationDoc(
  orgId: string,
  orgData: FirebaseFirestore.DocumentData
): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  const name = typeof orgData.name === "string" ? orgData.name.trim() : "";
  const countryRaw =
    typeof orgData.countryCode === "string"
      ? orgData.countryCode
      : typeof orgData.country === "string"
        ? orgData.country
        : typeof orgData.profile?.country === "string"
          ? orgData.profile.country
          : typeof orgData.profile?.countryCode === "string"
            ? orgData.profile.countryCode
            : "";

  if (isMissingString(orgData.legalName) && name) {
    patch.legalName = name;
  }

  if (isMissingString(orgData.countryCode) && countryRaw) {
    patch.countryCode = String(countryRaw).trim().toUpperCase();
  }

  const planCode =
    typeof orgData.planCode === "string"
      ? orgData.planCode
      : typeof orgData.selectedPlan === "string"
        ? orgData.selectedPlan
        : null;

  if (isMissingString(orgData.planCode) && planCode) {
    patch.planCode = planCode;
  }
  if (isMissingString(orgData.selectedPlan) && planCode) {
    patch.selectedPlan = planCode;
  }

  if (isMissingString(orgData.billingEmail) && typeof orgData.ownerUid === "string") {
    const ownerEmail = await resolveOwnerEmail(orgData.ownerUid);
    if (ownerEmail) patch.billingEmail = ownerEmail;
  }

  if (orgData.billingAddress === undefined || orgData.billingAddress === null) {
    patch.billingAddress = {};
  } else if (isEmptyObject(orgData.billingAddress) && !("billingAddress" in patch)) {
    patch.billingAddress = {};
  }

  if (orgData.companyIdentifiers === undefined || orgData.companyIdentifiers === null) {
    patch.companyIdentifiers = {};
  }

  const source = typeof orgData.source === "string" ? orgData.source : "";
  const shouldEnableBusiness =
    source === "web_onboarding" ||
    orgData.businessEnabled === undefined ||
    orgData.businessEnabled === null;

  if (shouldEnableBusiness && orgData.businessEnabled !== true) {
    patch.businessEnabled = true;
  }

  if (isMissingString(orgData.status) && source === "web_onboarding") {
    patch.status = "trialing";
  }

  if (isMissingString(orgData.billingStatus)) {
    patch.billingStatus = "pending_payment";
  }

  const seatsDefault = planCode ? seatsForPlan(planCode) : 5;
  if (
    (typeof orgData.seatsLimit !== "number" || orgData.seatsLimit <= 0) &&
    seatsDefault > 0
  ) {
    patch.seatsLimit = seatsDefault;
    patch.seatLimit = seatsDefault;
  }

  if (typeof orgData.requestedSeats !== "number" || orgData.requestedSeats <= 0) {
    const limit =
      typeof patch.seatsLimit === "number"
        ? patch.seatsLimit
        : typeof orgData.seatsLimit === "number" && orgData.seatsLimit > 0
          ? orgData.seatsLimit
          : seatsDefault;
    patch.requestedSeats = limit;
  }

  if (typeof orgData.seatsUsed !== "number" || orgData.seatsUsed < 1) {
    patch.seatsUsed = await countActiveMembers(orgId);
  }

  if (!orgData.trialStartedAt && (patch.status === "trialing" || orgData.status === "trialing")) {
    patch.trialStartedAt = FieldValue.serverTimestamp();
  }

  if (!orgData.trialEndsAt && (patch.status === "trialing" || orgData.status === "trialing")) {
    patch.trialEndsAt = Timestamp.fromMillis(Date.now() + TRIAL_MS);
  } else if (
    orgData.trialStartedAt &&
    !orgData.trialEndsAt &&
    typeof orgData.trialStartedAt.toMillis === "function"
  ) {
    patch.trialEndsAt = Timestamp.fromMillis(orgData.trialStartedAt.toMillis() + TRIAL_MS);
  }

  if (Object.keys(patch).length === 0) return false;

  patch.updatedAt = FieldValue.serverTimestamp();
  await admin.firestore().collection("organizations").doc(orgId).set(patch, { merge: true });
  return true;
}

export const backfillBusinessOrgCompatibility = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<BackfillResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const data = (request.data ?? {}) as { orgId?: unknown };
    const targetOrgId = typeof data.orgId === "string" ? data.orgId.trim() : "";

    const updatedOrgIds: string[] = [];
    const skippedOrgIds: string[] = [];

    let orgDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

    if (targetOrgId) {
      const snap = await db.collection("organizations").doc(targetOrgId).get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      const orgData = snap.data() ?? {};
      if (orgData.ownerUid !== uid) {
        throw new HttpsError("permission-denied", "Only the organization owner can backfill.");
      }
      orgDocs = [snap as FirebaseFirestore.QueryDocumentSnapshot];
    } else {
      const owned = await db.collection("organizations").where("ownerUid", "==", uid).get();
      orgDocs = owned.docs;
    }

    for (const doc of orgDocs) {
      const changed = await backfillOrganizationDoc(doc.id, doc.data());
      if (changed) {
        updatedOrgIds.push(doc.id);
        console.log("[backfillBusinessOrgCompatibility] updated", doc.id);
      } else {
        skippedOrgIds.push(doc.id);
      }
    }

    return { ok: true, updatedOrgIds, skippedOrgIds };
  }
);
