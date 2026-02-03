/**
 * Stripe Configuration
 * 
 * Maps Stripe Price IDs to subscription tiers.
 * IMPORTANT: Keep this in sync with Stripe Dashboard.
 * 
 * To get your Price IDs:
 * 1. Go to Stripe Dashboard → Products
 * 2. Create products for BASIC and PRO
 * 3. Create recurring prices (monthly/yearly)
 * 4. Copy the price_xxx IDs and update below
 */

export const STRIPE_CONFIG = {
  // Stripe Secret Key (set via: firebase functions:config:set stripe.secret_key="sk_test_...")
  // Access via: functions.config().stripe.secret_key
  // Or use environment variables in Firebase Functions (recommended)
  
  // Price ID to Tier mapping
  // TODO: Replace these with your actual Stripe Price IDs after creating products
  PRICE_ID_TO_TIER: {
    // Example Price IDs - REPLACE WITH YOUR ACTUAL STRIPE PRICE IDs
    // "price_basic_monthly": "BASIC",
    // "price_basic_yearly": "BASIC",
    // "price_pro_monthly": "PRO",
    // "price_pro_yearly": "PRO",
  },
  
  // Webhook Secret (set via: firebase functions:config:set stripe.webhook_secret="whsec_...")
  // This is provided when you create a webhook endpoint in Stripe Dashboard
  
  // Deep link URLs for success/cancel (update with your app's scheme)
  SUCCESS_URL: "staveto://subscription-success",
  CANCEL_URL: "staveto://subscription-cancel",
  
  // Fallback web URLs if deep links fail
  SUCCESS_URL_WEB: "https://staveto.app/subscription-success",
  CANCEL_URL_WEB: "https://staveto.app/subscription-cancel",
};

export type SubscriptionTier = "FREE" | "BASIC" | "PRO" | "ENTERPRISE";

export function getTierFromPriceId(priceId: string): SubscriptionTier {
  return STRIPE_CONFIG.PRICE_ID_TO_TIER[priceId as keyof typeof STRIPE_CONFIG.PRICE_ID_TO_TIER] as SubscriptionTier || "FREE";
}
