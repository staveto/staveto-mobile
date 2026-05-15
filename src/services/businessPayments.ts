import { getCallable } from "../firebase";

export type CreateBusinessCheckoutSessionInput = {
  orgId: string;
  orderId: string;
};

export type CreateBusinessCheckoutSessionResult = {
  checkoutUrl: string;
};

export type UpdateBusinessOrderPlanInput = {
  orgId: string;
  orderId: string;
  planCode: "business_starter" | "business_team" | "business_company";
  billingPeriod: "monthly" | "yearly";
};

export type UpdateBusinessOrderPlanResult = {
  ok: true;
  planCode: "business_starter" | "business_team" | "business_company";
  billingPeriod: "monthly" | "yearly";
  requestedSeats: number;
  priceSnapshot: {
    planCode: "business_starter" | "business_team" | "business_company";
    planName: string;
    billingPeriod: "monthly" | "yearly";
    seatsIncluded: number;
    currency: "EUR";
    totalGross: number;
    pricingMode: "stripe_checkout";
    paymentProvider: "stripe";
  };
};

export async function createBusinessCheckoutSession(
  input: CreateBusinessCheckoutSessionInput
): Promise<CreateBusinessCheckoutSessionResult> {
  const callable = getCallable<CreateBusinessCheckoutSessionInput, { data?: CreateBusinessCheckoutSessionResult }>(
    "createBusinessCheckoutSession",
    { timeoutMs: 15000 }
  );
  const result = await callable(input);
  const data = (result as { data?: CreateBusinessCheckoutSessionResult })?.data;
  if (!data?.checkoutUrl) {
    throw new Error("Invalid checkout session response.");
  }
  return data;
}

export async function updateBusinessOrderPlan(
  input: UpdateBusinessOrderPlanInput
): Promise<UpdateBusinessOrderPlanResult> {
  const callable = getCallable<UpdateBusinessOrderPlanInput, { data?: UpdateBusinessOrderPlanResult }>(
    "updateBusinessOrderPlan",
    { timeoutMs: 15000 }
  );
  const result = await callable(input);
  const data = (result as { data?: UpdateBusinessOrderPlanResult })?.data;
  if (!data?.ok) {
    throw new Error("Invalid update plan response.");
  }
  return data;
}

