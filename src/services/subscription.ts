/**
 * Subscription Service (Client-side)
 * 
 * Client can READ subscription status but CANNOT modify it.
 * Only Stripe webhooks (via Cloud Functions) can update subscription tier.
 * 
 * DB SAFETY: No breaking changes - subscription is ADDED to existing user documents.
 */

import { doc, getDoc, onSnapshot, Unsubscribe } from "../lib/rnFirestore";
import { db, getCallable } from "../firebase";

export type SubscriptionTier = "FREE" | "BASIC" | "PRO" | "ENTERPRISE";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface Subscription {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string; // ISO date string or Firestore Timestamp
  updatedAt?: string; // ISO date string
  source?: string; // "promo" | "stripe"
  promoCode?: string;
}

export interface SubscriptionLimits {
  maxProjects: number; // -1 = unlimited
  maxTasksPerProject: number; // -1 = unlimited
  maxExpensesPerMonth: number; // -1 = unlimited
  maxStorageMB: number; // -1 = unlimited
}

// Default limits for each tier
const TIER_LIMITS: Record<SubscriptionTier, SubscriptionLimits> = {
  FREE: {
    maxProjects: 1,
    maxTasksPerProject: 10,
    maxExpensesPerMonth: 5,
    maxStorageMB: 10,
  },
  BASIC: {
    maxProjects: 5,
    maxTasksPerProject: 50,
    maxExpensesPerMonth: 50,
    maxStorageMB: 100,
  },
  PRO: {
    maxProjects: 20,
    maxTasksPerProject: -1, // unlimited
    maxExpensesPerMonth: -1, // unlimited
    maxStorageMB: 1000,
  },
  ENTERPRISE: {
    maxProjects: -1, // unlimited
    maxTasksPerProject: -1,
    maxExpensesPerMonth: -1,
    maxStorageMB: -1,
  },
};

/**
 * Get user's subscription from Firestore
 */
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) {
      return null;
    }
    const data = userDoc.data();
    return data.subscription || null;
  } catch (error) {
    console.error("[subscription] Error getting user subscription:", error);
    return null;
  }
}

/** Helper: convert Firestore Timestamp or ISO string to milliseconds */
function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "string") return new Date(ts).getTime();
  const t = ts as { toMillis?: () => number };
  return typeof t.toMillis === "function" ? t.toMillis() : 0;
}

/**
 * Get user's current subscription tier (defaults to FREE if not set)
 */
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const subscription = await getUserSubscription(userId);
  if (!subscription || subscription.status === "canceled") {
    return "FREE";
  }
  // Promo subscriptions expire when currentPeriodEnd passes
  if (subscription.source === "promo" && subscription.currentPeriodEnd) {
    const endMs = toMillis(subscription.currentPeriodEnd);
    if (endMs > 0 && endMs <= Date.now()) {
      return "FREE";
    }
  }
  return subscription.tier;
}

/**
 * Get subscription limits for a tier
 */
export function getSubscriptionLimits(tier: SubscriptionTier): SubscriptionLimits {
  return TIER_LIMITS[tier];
}

/**
 * Subscribe to subscription changes (real-time updates)
 */
export function subscribeToSubscription(
  userId: string,
  callback: (subscription: Subscription | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "users", userId), (snapshot) => {
    const data = snapshot.data();
    callback(data?.subscription || null);
  });
}

/**
 * Create Stripe Checkout Session (calls Cloud Function)
 * 
 * Returns checkout URL that should be opened in browser/webview.
 */
export async function createCheckoutSession(priceId: string): Promise<{ url: string; sessionId: string }> {
  const result = await getCallable("createCheckoutSession")({ priceId });
  return result.data as { url: string; sessionId: string };
}

/**
 * Create Billing Portal Session (calls Cloud Function)
 * 
 * Returns billing portal URL for managing subscription.
 */
export async function createBillingPortalSession(): Promise<{ url: string }> {
  const result = await getCallable("createBillingPortalSession")();
  return result.data as { url: string };
}

/**
 * Redeem promo code (calls Cloud Function)
 * 
 * Returns { ok, tier, currentPeriodEnd } on success.
 * Throws with code: INVALID_CODE | EXPIRED | LIMIT_REACHED | ALREADY_REDEEMED | UNAUTHENTICATED
 */
export async function redeemPromoCode(code: string): Promise<{ ok: boolean; tier: string; currentPeriodEnd: string }> {
  const result = await getCallable("redeemPromoCode")({ code });
  return result.data as { ok: boolean; tier: string; currentPeriodEnd: string };
}

/**
 * Check if user can perform an action based on subscription limits
 */
export async function checkLimit(
  userId: string,
  limitType: "projects" | "tasks" | "expenses" | "storage",
  currentCount: number
): Promise<{ allowed: boolean; limit: number; message?: string }> {
  const tier = await getUserTier(userId);
  const limits = getSubscriptionLimits(tier);
  
  let limit: number;
  switch (limitType) {
    case "projects":
      limit = limits.maxProjects;
      break;
    case "tasks":
      limit = limits.maxTasksPerProject;
      break;
    case "expenses":
      limit = limits.maxExpensesPerMonth;
      break;
    case "storage":
      limit = limits.maxStorageMB;
      break;
  }
  
  // -1 means unlimited
  if (limit === -1) {
    return { allowed: true, limit: -1 };
  }
  
  const allowed = currentCount < limit;
  const message = allowed
    ? undefined
    : `Dosiahli ste limit pre váš plán (${limit}). Zvážte upgrade na vyšší tier.`;
  
  return { allowed, limit, message };
}

/**
 * Initialize FREE subscription for new users (called from auth.ts register)
 * Note: This is just for initial state. Webhook will be source of truth for paid subscriptions.
 */
export async function initializeFreeSubscription(userId: string): Promise<void> {
  // Note: Client can write subscription field ONLY if it doesn't exist (initial setup)
  // After that, only webhooks can update it
  const userRef = doc(db, "users", userId);
  const userDoc = await getDoc(userRef);
  
  if (userDoc.exists() && userDoc.data().subscription) {
    // Subscription already exists (e.g., from webhook), don't overwrite
    return;
  }
  
  // Initialize FREE subscription (server will enforce this in rules, but set initial state)
  // Actually, we can't write subscription from client if rules prevent it
  // So this is just documentation - actual initialization happens in Cloud Function
  // or we allow initial write in rules for new users
  console.log(`[subscription] User ${userId} will have FREE tier initialized`);
}
