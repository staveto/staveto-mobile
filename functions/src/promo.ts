/**
 * DISABLED: Promo code unlocking violates Apple Guideline 3.1.1.
 * PRO entitlement must only be granted via In-App Purchase (RevenueCat).
 * This function is kept as a no-op stub to avoid breaking client calls.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";

export const redeemPromoCode = onCall(
  {
    region: "europe-west1",
    invoker: "public",
  },
  async () => {
    throw new HttpsError("failed-precondition", "PROMO_DISABLED");
  }
);
