import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getPlanPricing,
  normalizeBillingPeriod,
  normalizePlanCode,
  type BillingPeriod,
  type PlanCode,
} from "./pricing";

if (!admin.apps.length) {
  admin.initializeApp();
}

type UpdateBusinessOrderPlanInput = {
  orgId?: unknown;
  orderId?: unknown;
  planCode?: unknown;
  billingPeriod?: unknown;
};

type UpdateBusinessOrderPlanResult = {
  ok: true;
  planCode: PlanCode;
  billingPeriod: BillingPeriod;
  requestedSeats: number;
  priceSnapshot: {
    planCode: PlanCode;
    planName: string;
    billingPeriod: BillingPeriod;
    seatsIncluded: number;
    currency: "EUR";
    totalGross: number;
    pricingMode: "stripe_checkout";
    paymentProvider: "stripe";
  };
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function requireAuth(
  request: { auth?: { uid?: string } | null }
): { uid: string } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return { uid: request.auth.uid };
}

function assertOrderStatusAllowed(statusRaw: unknown): void {
  const status = asString(statusRaw).toLowerCase();
  if (status !== "pending_payment" && status !== "pending") {
    throw new HttpsError("failed-precondition", "Order plan can be changed only while pending.");
  }
}

export const updateBusinessOrderPlan = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<UpdateBusinessOrderPlanResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as UpdateBusinessOrderPlanInput;
    const orgId = asString(raw.orgId);
    const orderId = asString(raw.orderId);
    const planCode = normalizePlanCode(raw.planCode);
    const billingPeriod = normalizeBillingPeriod(raw.billingPeriod);

    if (!orgId) throw new HttpsError("invalid-argument", "orgId is required.");
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");
    if (!planCode) throw new HttpsError("invalid-argument", "planCode is invalid.");
    if (!billingPeriod) throw new HttpsError("invalid-argument", "billingPeriod is invalid.");

    const pricing = getPlanPricing(planCode, billingPeriod);
    const db = admin.firestore();
    const orgRef = db.collection("organizations").doc(orgId);
    const orderRef = db.collection("businessOrders").doc(orderId);

    await db.runTransaction(async (tx) => {
      const [orgSnap, orderSnap, memberSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(orderRef),
        tx.get(orgRef.collection("members").doc(actor.uid)),
      ]);
      if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
      if (!orderSnap.exists) throw new HttpsError("not-found", "Business order not found.");

      const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
      const order = (orderSnap.data() ?? {}) as Record<string, unknown>;
      if (asString(order.orgId) !== orgId) {
        throw new HttpsError("failed-precondition", "Order does not belong to organization.");
      }
      const isOwner = asString(org.ownerUid) === actor.uid;
      const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
      const role = asString(member.role).toLowerCase();
      const status = asString(member.status).toLowerCase();
      const isAllowedAdmin = status === "active" && (role === "owner" || role === "admin");
      if (!isOwner && !isAllowedAdmin) {
        throw new HttpsError("permission-denied", "Only owner/admin can update plan.");
      }

      assertOrderStatusAllowed(order.status);

      const now = admin.firestore.FieldValue.serverTimestamp();
      const priceSnapshot: UpdateBusinessOrderPlanResult["priceSnapshot"] = {
        planCode,
        planName: pricing.planName,
        billingPeriod,
        seatsIncluded: pricing.seatsIncluded,
        currency: "EUR",
        totalGross: pricing.totalGross,
        pricingMode: "stripe_checkout",
        paymentProvider: "stripe",
      };

      tx.update(orderRef, {
        planCode,
        billingPeriod,
        requestedSeats: pricing.seatsIncluded,
        priceSnapshot,
        "paymentInstructions.amountGross": pricing.totalGross,
        stripeCheckoutSessionId: null,
        updatedAt: now,
      });

      tx.update(orgRef, {
        planCode,
        billingPeriod,
        requestedSeats: pricing.seatsIncluded,
        seatsLimit: pricing.seatsIncluded,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      planCode,
      billingPeriod,
      requestedSeats: pricing.seatsIncluded,
      priceSnapshot: {
        planCode,
        planName: pricing.planName,
        billingPeriod,
        seatsIncluded: pricing.seatsIncluded,
        currency: "EUR",
        totalGross: pricing.totalGross,
        pricingMode: "stripe_checkout",
        paymentProvider: "stripe",
      },
    };
  }
);

