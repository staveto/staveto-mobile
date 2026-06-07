export type PlanCode = "business_starter" | "business_team" | "business_company";
export type BillingPeriod = "monthly" | "yearly";

export type PlanPricing = {
  planCode: PlanCode;
  planName: string;
  seatsIncluded: number;
  monthly: number;
  yearly: number;
};

export const PLAN_CONFIGS: Record<PlanCode, PlanPricing> = {
  business_starter: {
    planCode: "business_starter",
    planName: "Business Starter",
    seatsIncluded: 5,
    monthly: 149,
    yearly: 1490,
  },
  business_team: {
    planCode: "business_team",
    planName: "Business Team",
    seatsIncluded: 15,
    monthly: 329,
    yearly: 3290,
  },
  business_company: {
    planCode: "business_company",
    planName: "Business Company",
    seatsIncluded: 30,
    monthly: 649,
    yearly: 6490,
  },
};

const STRIPE_PRICE_IDS: Record<PlanCode, Record<BillingPeriod, string>> = {
  business_starter: {
    monthly: "price_1TXHexJh70obdYQQZwNyBHM8",
    yearly: "price_1TXIGJJh70obdYQQib0xg0pt",
  },
  business_team: {
    monthly: "price_1TXHfkJh70obdYQQY92bPJfP",
    yearly: "price_1TXIGhJh70obdYQQvsuuRyG2",
  },
  business_company: {
    monthly: "price_1TXHggJh70obdYQQob4OzthD",
    yearly: "price_1TXIGyJh70obdYQQyXYzTKKe",
  },
};

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function normalizePlanCode(raw: unknown): PlanCode | null {
  const value = asString(raw).toLowerCase();
  if (value === "business_starter" || value === "business_team" || value === "business_company") {
    return value as PlanCode;
  }
  return null;
}

export function normalizeBillingPeriod(raw: unknown): BillingPeriod | null {
  const value = asString(raw).toLowerCase();
  if (value === "monthly" || value === "yearly") return value as BillingPeriod;
  return null;
}

export function getPlanPricing(planCode: PlanCode, billingPeriod: BillingPeriod): {
  planName: string;
  seatsIncluded: number;
  totalGross: number;
} {
  const row = PLAN_CONFIGS[planCode];
  return {
    planName: row.planName,
    seatsIncluded: row.seatsIncluded,
    totalGross: billingPeriod === "yearly" ? row.yearly : row.monthly,
  };
}

export function getStripePriceId(planCode: PlanCode, billingPeriod: BillingPeriod): string {
  return STRIPE_PRICE_IDS[planCode][billingPeriod];
}

