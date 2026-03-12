/**
 * Billing & entitlement logic for Staveto.
 * Single plan: 14-day trial, then €14.99/month (staveto_monthly_1499).
 * OCR/API limits enforced server-side.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

const PLAN_ID = "staveto_monthly_1499";
const TRIAL_DAYS = 14;

export type SubscriptionStatus = "trial" | "active" | "expired" | "none";

export interface EntitlementResult {
  entitlement: boolean;
  status: SubscriptionStatus;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStartAt: string | null;
  currentPeriodEndAt: string | null;
  planId: string;
  ocrUsed: number;
  ocrLimit: number;
  ocrCooldownSeconds: number;
  isTrial: boolean;
}

export interface OcrLimitsConfig {
  ocrTrialLimit: number;
  ocrMonthlyLimit: number;
  ocrCooldownSeconds: number;
}

const DEFAULT_LIMITS: OcrLimitsConfig = {
  ocrTrialLimit: 5,
  ocrMonthlyLimit: 30,
  ocrCooldownSeconds: 60,
};

export async function getLimitsConfig(db: admin.firestore.Firestore): Promise<OcrLimitsConfig> {
  const snap = await db.collection("config").doc("limits").get();
  if (!snap.exists) return DEFAULT_LIMITS;
  const d = snap.data() as Partial<OcrLimitsConfig>;
  return {
    ocrTrialLimit: typeof d?.ocrTrialLimit === "number" ? d.ocrTrialLimit : DEFAULT_LIMITS.ocrTrialLimit,
    ocrMonthlyLimit: typeof d?.ocrMonthlyLimit === "number" ? d.ocrMonthlyLimit : DEFAULT_LIMITS.ocrMonthlyLimit,
    ocrCooldownSeconds: typeof d?.ocrCooldownSeconds === "number" ? d.ocrCooldownSeconds : DEFAULT_LIMITS.ocrCooldownSeconds,
  };
}

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "string") return new Date(ts).getTime();
  const t = ts as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : 0;
}

export interface BillingStatus {
  status: "trial" | "active" | "expired";
  isPro: boolean;
  trialEndsAt: string | null;
  remainingTrialDays: number;
  currentPeriodEndAt: string | null;
}

/**
 * Ensure user has createdAt and trialEndsAt. Set once only.
 * trialEndsAt = createdAt + 14 days.
 */
export async function ensureTrialInitialized(
  db: admin.firestore.Firestore,
  userRef: admin.firestore.DocumentReference,
  data: Record<string, unknown> | undefined
): Promise<void> {
  const updates: Record<string, unknown> = {};
  let hasCreatedAt = !!data?.createdAt;
  let hasTrialEndsAt = !!(data?.trialEndsAt ?? data?.trialEndAt);

  if (!hasCreatedAt) {
    updates.createdAt = admin.firestore.FieldValue.serverTimestamp();
    hasCreatedAt = true;
  }

  if (!hasTrialEndsAt) {
    let createdAtMs = toMillis(data?.createdAt);
    if (createdAtMs === 0) {
      const reRead = await userRef.get();
      const reData = reRead.data();
      createdAtMs = toMillis(reData?.createdAt) || Date.now();
    }
    const trialEnd = new Date(createdAtMs + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    updates.trialEndsAt = admin.firestore.Timestamp.fromDate(trialEnd);
    updates.trialEndAt = admin.firestore.Timestamp.fromDate(trialEnd);
    if (!data?.subscriptionStatus && !data?.subscription) {
      updates.subscriptionStatus = "trial";
    }
    hasTrialEndsAt = true;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await userRef.set(updates, { merge: true });
  }
}

/** Derive entitlement from user doc data (no I/O). Supports trialEndsAt, trialEndAt, isPro, subscription (IAP only, no promo). */
function deriveEntitlementFromUserData(userData: Record<string, unknown> | undefined): {
  entitlement: boolean;
  status: SubscriptionStatus;
  isTrial: boolean;
  periodKey: string;
} {
  if (!userData) {
    return { entitlement: false, status: "none", isTrial: false, periodKey: "" };
  }
  let status = userData.subscriptionStatus as SubscriptionStatus | undefined;
  const trialEndAt = userData.trialEndsAt ?? userData.trialEndAt;
  let currentPeriodEndAt = userData.currentPeriodEndAt;
  let isPro = !!(userData.isPro as boolean);
  const oldSub = userData.subscription as Record<string, unknown> | undefined;

  // Pro from IAP (RevenueCat) subscription only – no promo (Apple 3.1.1)
  if (oldSub) {
    const tier = oldSub.tier as string | undefined;
    const subStatus = oldSub.status as string | undefined;
    const periodEnd = oldSub.currentPeriodEnd;
    const hasValidPro =
      (tier === "PRO" || tier === "BASIC" || tier === "ENTERPRISE") &&
      (subStatus === "active" || subStatus === "trialing") &&
      periodEnd && toMillis(periodEnd) > Date.now();
    if (hasValidPro) {
      status = "active";
      currentPeriodEndAt = periodEnd;
      isPro = true;
    }
  }
  if (!status) status = "none";

  const now = Date.now();
  const periodEndMs = toMillis(currentPeriodEndAt);
  const trialEndMs = toMillis(trialEndAt);

  let entitlement = false;
  let isTrial = false;
  let effectiveStatus = status;
  if (isPro && periodEndMs > now) {
    effectiveStatus = "active";
    entitlement = true;
  } else if (trialEndMs > now) {
    effectiveStatus = "trial";
    entitlement = true;
    isTrial = true;
  } else {
    effectiveStatus = "expired";
  }

  const periodKey = effectiveStatus === "trial" ? "trial" : new Date().toISOString().slice(0, 7);
  return { entitlement, status: effectiveStatus, isTrial, periodKey };
}

/**
 * Compute entitlement from user document. Initializes trial if user has no billing fields.
 */
export async function computeEntitlement(db: admin.firestore.Firestore, uid: string): Promise<EntitlementResult> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return {
      entitlement: false,
      status: "none",
      trialStartAt: null,
      trialEndAt: null,
      currentPeriodStartAt: null,
      currentPeriodEndAt: null,
      planId: PLAN_ID,
      ocrUsed: 0,
      ocrLimit: 0,
      ocrCooldownSeconds: 60,
      isTrial: false,
    };
  }

  const userData = userSnap.data() as Record<string, unknown>;
  await ensureTrialInitialized(db, userRef, userData);
  const limits = await getLimitsConfig(db);

  const reSnap = await userRef.get();
  const data = reSnap.exists ? (reSnap.data() as Record<string, unknown>) : userData;

  let status = data.subscriptionStatus as SubscriptionStatus | undefined;
  let trialStartAt = data.trialStartAt;
  let trialEndAt = data.trialEndsAt ?? data.trialEndAt;
  let currentPeriodStartAt = data.currentPeriodStartAt;
  let currentPeriodEndAt = data.currentPeriodEndAt;
  let planId = (data.planId as string) ?? PLAN_ID;

  const oldSub = data.subscription as Record<string, unknown> | undefined;
  // Pro from IAP (RevenueCat) only – no promo (Apple 3.1.1)
  if (oldSub) {
    const tier = oldSub.tier as string | undefined;
    const subStatus = oldSub.status as string | undefined;
    const periodEnd = oldSub.currentPeriodEnd;
    const hasValidPro =
      (tier === "PRO" || tier === "BASIC" || tier === "ENTERPRISE") &&
      (subStatus === "active" || subStatus === "trialing") &&
      periodEnd && toMillis(periodEnd) > Date.now();
    if (hasValidPro) {
      status = "active";
      currentPeriodEndAt = periodEnd;
      planId = PLAN_ID;
    } else if (!status) {
      if (tier === "PRO" || tier === "BASIC" || tier === "ENTERPRISE") {
        if (subStatus === "active" || subStatus === "trialing") {
          const endMs = toMillis(periodEnd);
          if (!periodEnd || endMs > Date.now()) {
            status = "active";
            currentPeriodEndAt = periodEnd;
            planId = PLAN_ID;
          } else status = "expired";
        } else status = "expired";
      }
    }
  }

  if (!status && !oldSub) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await userRef.set(
      {
        subscriptionStatus: "trial",
        trialStartAt: admin.firestore.Timestamp.fromDate(now),
        trialEndAt: admin.firestore.Timestamp.fromDate(trialEnd),
        planId: PLAN_ID,
        entitlement: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    status = "trial";
    trialStartAt = admin.firestore.Timestamp.fromDate(now);
    trialEndAt = admin.firestore.Timestamp.fromDate(trialEnd);
  } else if (!status) status = "none";

  let entitlement = false;
  let isTrial = false;
  const now = Date.now();
  if (status === "trial") {
    const endMs = toMillis(trialEndAt);
    entitlement = endMs > now;
    isTrial = entitlement;
  } else if (status === "active") {
    const endMs = toMillis(currentPeriodEndAt);
    entitlement = !currentPeriodEndAt || endMs > now;
  }

  const periodKey = status === "trial" ? "trial" : new Date().toISOString().slice(0, 7);
  const usageRef = db.collection("users").doc(uid).collection("usage").doc(periodKey);
  const usageSnap = await usageRef.get();
  const usageData = usageSnap.exists ? (usageSnap.data() as { ocrUsed?: number }) : {};
  const ocrUsed = typeof usageData.ocrUsed === "number" ? usageData.ocrUsed : 0;
  const ocrLimit = isTrial ? limits.ocrTrialLimit : limits.ocrMonthlyLimit;

  return {
    entitlement,
    status: entitlement ? status : "expired",
    trialStartAt: trialStartAt ? new Date(toMillis(trialStartAt)).toISOString() : null,
    trialEndAt: trialEndAt ? new Date(toMillis(trialEndAt)).toISOString() : null,
    currentPeriodStartAt: currentPeriodStartAt ? new Date(toMillis(currentPeriodStartAt)).toISOString() : null,
    currentPeriodEndAt: currentPeriodEndAt ? new Date(toMillis(currentPeriodEndAt)).toISOString() : null,
    planId,
    ocrUsed,
    ocrLimit,
    ocrCooldownSeconds: limits.ocrCooldownSeconds,
    isTrial,
  };
}

export interface OcrGateResult {
  allowed: boolean;
  errorCode?: "ENTITLEMENT_REQUIRED" | "LIMIT_REACHED" | "COOLDOWN" | "ALREADY_PROCESSED";
  cooldownSeconds?: number;
}

/**
 * Check and consume OCR credit. Must run inside transaction.
 */
export function checkAndConsumeOcrCreditSync(
  userData: Record<string, unknown> | undefined,
  usageData: { ocrUsed?: number; lastOcrAt?: unknown; requestIds?: string[] } | undefined,
  limits: OcrLimitsConfig,
  requestId: string
): OcrGateResult {
  const derived = deriveEntitlementFromUserData(userData);
  if (!derived.entitlement) {
    return { allowed: false, errorCode: "ENTITLEMENT_REQUIRED" };
  }

  const ocrUsed = typeof usageData?.ocrUsed === "number" ? usageData.ocrUsed : 0;
  const requestIds: string[] = Array.isArray(usageData?.requestIds) ? usageData.requestIds : [];
  const lastOcrAt = usageData?.lastOcrAt;
  const ocrLimit = derived.isTrial ? limits.ocrTrialLimit : limits.ocrMonthlyLimit;

  if (requestIds.includes(requestId)) return { allowed: true };
  if (ocrUsed >= ocrLimit) return { allowed: false, errorCode: "LIMIT_REACHED" };

  const lastMs = toMillis(lastOcrAt);
  const cooldownMs = limits.ocrCooldownSeconds * 1000;
  if (lastMs > 0 && Date.now() - lastMs < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (Date.now() - lastMs)) / 1000);
    return { allowed: false, errorCode: "COOLDOWN", cooldownSeconds: remaining };
  }
  return { allowed: true };
}

/** Get periodKey from user data. */
export function getPeriodKey(userData: Record<string, unknown> | undefined): string {
  const d = deriveEntitlementFromUserData(userData);
  return d.periodKey || new Date().toISOString().slice(0, 7);
}

/**
 * Compute billing status from user document. Ensures trial is initialized.
 */
export async function computeBillingStatus(
  db: admin.firestore.Firestore,
  uid: string
): Promise<BillingStatus> {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return {
      status: "expired",
      isPro: false,
      trialEndsAt: null,
      remainingTrialDays: 0,
      currentPeriodEndAt: null,
    };
  }

  const userData = userSnap.data() as Record<string, unknown>;
  await ensureTrialInitialized(db, userRef, userData);

  const reSnap = await userRef.get();
  const data = reSnap.exists ? (reSnap.data() as Record<string, unknown>) : {};
  const now = Date.now();

  // PRO only via IAP (RevenueCat) – no promo (Apple 3.1.1)
  let isPro = !!(data.isPro as boolean);
  let periodEndMs = toMillis(data.currentPeriodEndAt);
  const oldSub = data.subscription as Record<string, unknown> | undefined;
  if (oldSub && (oldSub.tier === "PRO" || oldSub.tier === "BASIC" || oldSub.tier === "ENTERPRISE") && (oldSub.status === "active" || oldSub.status === "trialing")) {
    const endMs = toMillis(oldSub.currentPeriodEnd);
    if (endMs > now) {
      isPro = true;
      periodEndMs = endMs;
    }
  }

  const trialEndMs = toMillis(data.trialEndsAt ?? data.trialEndAt);

  let status: "trial" | "active" | "expired";
  if (isPro && periodEndMs > now) {
    status = "active";
  } else if (trialEndMs > now) {
    status = "trial";
  } else {
    status = "expired";
  }

  const remainingTrialDays =
    status === "trial"
      ? Math.max(0, Math.ceil((trialEndMs - now) / (24 * 60 * 60 * 1000)))
      : 0;

  const currentPeriodEndAt =
    periodEndMs > 0 ? new Date(periodEndMs).toISOString() : (data.currentPeriodEndAt ? new Date(toMillis(data.currentPeriodEndAt)).toISOString() : null);

  return {
    status,
    isPro,
    trialEndsAt: data.trialEndsAt ?? data.trialEndAt
      ? new Date(toMillis(data.trialEndsAt ?? data.trialEndAt)).toISOString()
      : null,
    remainingTrialDays,
    currentPeriodEndAt,
  };
}

/** Callable: returns billing status for the current user. */
export const getBillingStatus = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
    }
    const db = admin.firestore();
    return computeBillingStatus(db, request.auth.uid);
  }
);

/** Callable: returns entitlement + usage for the current user. */
export const checkEntitlement = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
    }
    const db = admin.firestore();
    const result = await computeEntitlement(db, request.auth.uid);
    return result;
  }
);
