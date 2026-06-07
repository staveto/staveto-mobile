export type BusinessPlanCode =
  | "business_starter"
  | "business_team"
  | "business_company"
  | "business_enterprise";

export const PLAN_SEATS: Record<string, number> = {
  business_starter: 5,
  business_team: 15,
  business_company: 30,
  business_enterprise: 100,
};

export const LEGACY_PLAN: Record<string, string> = {
  business_starter: "TEAM_5",
  business_team: "TEAM_15",
  business_company: "TEAM_30",
  business_enterprise: "TEAM_30",
};

export function seatsForPlan(planCode: string): number {
  return PLAN_SEATS[planCode] ?? 5;
}
