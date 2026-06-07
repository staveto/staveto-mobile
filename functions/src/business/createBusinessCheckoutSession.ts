import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getStripePriceId,
  normalizeBillingPeriod,
  normalizePlanCode,
  type BillingPeriod,
  type PlanCode,
} from "./pricing";

if (!admin.apps.length) {
  admin.initializeApp();
}

type CreateBusinessCheckoutSessionInput = {
  orgId?: unknown;
  orderId?: unknown;
};

type CreateBusinessCheckoutSessionResult = {
  checkoutUrl: string;
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function requireAuth(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }
): { uid: string } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return { uid: request.auth.uid };
}

async function assertCanManageOrg(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  actorUid: string
): Promise<Record<string, unknown>> {
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const org = (orgSnap.data() ?? {}) as Record<string, unknown>;
  if (org.ownerUid === actorUid) return org;

  const memberSnap = await orgRef.collection("members").doc(actorUid).get();
  if (!memberSnap.exists) {
    throw new HttpsError("permission-denied", "Only owner/admin can create checkout.");
  }
  const member = (memberSnap.data() ?? {}) as Record<string, unknown>;
  const role = asString(member.role).toLowerCase();
  const status = asString(member.status).toLowerCase();
  const roleAllowed = role === "owner" || role === "admin";
  if (!roleAllowed || status !== "active") {
    throw new HttpsError("permission-denied", "Only active owner/admin can create checkout.");
  }
  return org;
}

function resolveOrderPlan(order: Record<string, unknown>): { planCode: PlanCode; billingPeriod: BillingPeriod } {
  const orderPlanCodeRaw = order.planCode;
  const orderBillingPeriodRaw = order.billingPeriod;
  const snapshot =
    order.priceSnapshot && typeof order.priceSnapshot === "object"
      ? (order.priceSnapshot as Record<string, unknown>)
      : null;
  const snapshotPlanCodeRaw = snapshot?.planCode;
  const snapshotBillingPeriodRaw = snapshot?.billingPeriod;

  const rawPlanCode =
    typeof orderPlanCodeRaw === "string" && orderPlanCodeRaw.trim().length > 0
      ? orderPlanCodeRaw
      : snapshotPlanCodeRaw;
  const rawBillingPeriod =
    typeof orderBillingPeriodRaw === "string" && orderBillingPeriodRaw.trim().length > 0
      ? orderBillingPeriodRaw
      : snapshotBillingPeriodRaw;

  const plainPlan = asString(rawPlanCode).toLowerCase();
  const plainPeriod = asString(rawBillingPeriod).toLowerCase();
  if (plainPlan === "business" || plainPeriod === "manual") {
    throw new HttpsError("failed-precondition", "Najprv vyberte konkrétny Business plán.");
  }

  const planCode = normalizePlanCode(rawPlanCode);
  const billingPeriod = normalizeBillingPeriod(rawBillingPeriod);
  if (!planCode || !billingPeriod) {
    throw new HttpsError("failed-precondition", "Najprv vyberte konkrétny Business plán.");
  }
  return { planCode, billingPeriod };
}

function assertOrderStatusAllowed(statusRaw: unknown): void {
  const status = asString(statusRaw).toLowerCase();
  const allowed = new Set(["pending_payment", "pending", "trialing"]);
  if (!allowed.has(status)) {
    throw new HttpsError("failed-precondition", "Order is not eligible for online payment.");
  }
}

function buildStripeBody(input: {
  priceId: string;
  customerEmail?: string;
  orderId: string;
  orgId: string;
  ownerUid: string;
  orderNumber: string;
  planCode: PlanCode;
  billingPeriod: BillingPeriod;
}): URLSearchParams {
  const p = new URLSearchParams();
  p.append("mode", "subscription");
  p.append("line_items[0][price]", input.priceId);
  p.append("line_items[0][quantity]", "1");
  p.append("client_reference_id", input.orderId);
  p.append(
    "success_url",
    `staveto://business/payment-success?session_id={CHECKOUT_SESSION_ID}&orderId=${encodeURIComponent(
      input.orderId
    )}`
  );
  p.append(
    "cancel_url",
    `staveto://business/payment-cancelled?orderId=${encodeURIComponent(input.orderId)}`
  );
  if (input.customerEmail) {
    p.append("customer_email", input.customerEmail);
  }

  const metadata: Record<string, string> = {
    orgId: input.orgId,
    orderId: input.orderId,
    ownerUid: input.ownerUid,
    orderNumber: input.orderNumber,
    planCode: input.planCode,
    billingPeriod: input.billingPeriod,
  };
  for (const [key, value] of Object.entries(metadata)) {
    p.append(`metadata[${key}]`, value);
    p.append(`subscription_data[metadata][${key}]`, value);
  }
  return p;
}

export const createBusinessCheckoutSession = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request): Promise<CreateBusinessCheckoutSessionResult> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as CreateBusinessCheckoutSessionInput;
    const orgId = asString(raw.orgId);
    const orderId = asString(raw.orderId);
    if (!orgId) throw new HttpsError("invalid-argument", "orgId is required.");
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");

    const db = admin.firestore();
    const org = await assertCanManageOrg(db, orgId, actor.uid);

    const orderRef = db.collection("businessOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Business order not found.");
    }
    const order = (orderSnap.data() ?? {}) as Record<string, unknown>;
    if (asString(order.orgId) !== orgId) {
      throw new HttpsError("failed-precondition", "Order does not belong to organization.");
    }
    assertOrderStatusAllowed(order.status);

    const { planCode, billingPeriod } = resolveOrderPlan(order);
    const stripePriceId = getStripePriceId(planCode, billingPeriod);
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      throw new HttpsError("internal", "Stripe secret is not configured.");
    }

    const customerEmail = asString(order.billingEmail) || asString(org.billingEmail) || undefined;
    const body = buildStripeBody({
      priceId: stripePriceId,
      customerEmail,
      orderId,
      orgId,
      ownerUid: asString(org.ownerUid) || actor.uid,
      orderNumber: asString(order.orderNumber) || orderId,
      planCode,
      billingPeriod,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const payload = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!response.ok || !payload.url || !payload.id) {
      const msg = payload.error?.message || "Stripe checkout session creation failed.";
      throw new HttpsError("internal", msg);
    }

    await orderRef.update({
      stripeCheckoutSessionId: payload.id,
      stripeCheckoutCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { checkoutUrl: payload.url };
  }
);

