/**
 * Free trial helpers for Staveto billing.
 * Uses server billing status (trialEndsAt, status).
 */

export type BillingStatus = {
  status: "trial" | "active" | "expired";
  isPro: boolean;
  trialEndsAt: string | null;
  remainingTrialDays: number;
  currentPeriodEndAt: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Get remaining trial days from trialEndsAt (ISO string or ms).
 */
export function getRemainingTrialDays(trialEndsAt: string | number | null | undefined): number {
  if (!trialEndsAt) return 0;
  const ms = typeof trialEndsAt === "string" ? new Date(trialEndsAt).getTime() : trialEndsAt;
  if (isNaN(ms) || ms <= 0) return 0;
  const now = Date.now();
  if (ms <= now) return 0;
  return Math.ceil((ms - now) / MS_PER_DAY);
}

/**
 * Check if trial is still active based on billing status.
 */
export function isTrialActive(billing: BillingStatus | null | undefined): boolean {
  if (!billing) return false;
  return billing.status === "trial" && billing.remainingTrialDays > 0;
}

/**
 * Require Pro or valid trial before OCR/export/advanced actions.
 * Returns true if user can proceed, false if paywall should be shown.
 */
export function requireProOrTrialValid(billing: BillingStatus | null | undefined): boolean {
  if (!billing) return false;
  if (billing.isPro) return true;
  if (billing.status === "trial" && billing.remainingTrialDays > 0) return true;
  return false;
}
