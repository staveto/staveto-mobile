# Stripe Subscription Setup Guide

## Quick Start Checklist

- [ ] Create Stripe account and get API keys
- [ ] Create products (BASIC, PRO) in Stripe Dashboard
- [ ] Create recurring prices for each product
- [ ] Update `functions/src/config.ts` with Price IDs
- [ ] Set Stripe secret key in Firebase Functions config
- [ ] Deploy Cloud Functions
- [ ] Create webhook endpoint in Stripe Dashboard
- [ ] Set webhook secret in Firebase Functions config
- [ ] Update `src/screens/SubscriptionScreen.tsx` with Price IDs
- [ ] Test checkout flow with test card

## Detailed Steps

### 1. Stripe Dashboard Setup

1. **Create Products:**
   - Go to Stripe Dashboard → Products
   - Click "Add product"
   - **BASIC Plan:**
     - Name: "Základné predplatné"
     - Description: "Pre malé firmy a remeselníkov"
     - Pricing: Recurring, €9.99/month
     - Copy Price ID (e.g., `price_1234567890`)
   - **PRO Plan:**
     - Name: "Profesionálne predplatné"
     - Description: "Pre väčšie projekty a tímy"
     - Pricing: Recurring, €29.99/month
     - Copy Price ID (e.g., `price_0987654321`)

### 2. Update Code with Price IDs

**In `functions/src/config.ts`:**
```typescript
PRICE_ID_TO_TIER: {
  "price_YOUR_BASIC_PRICE_ID": "BASIC",
  "price_YOUR_PRO_PRICE_ID": "PRO",
}
```

**In `src/screens/SubscriptionScreen.tsx`:**
```typescript
const STRIPE_PRICE_IDS = {
  BASIC_MONTHLY: "price_YOUR_BASIC_PRICE_ID",
  PRO_MONTHLY: "price_YOUR_PRO_PRICE_ID",
};
```

### 3. Configure Firebase Functions

```bash
# Set Stripe secret key
firebase functions:config:set stripe.secret_key="sk_test_YOUR_SECRET_KEY"

# After creating webhook, set webhook secret
firebase functions:config:set stripe.webhook_secret="whsec_YOUR_WEBHOOK_SECRET"
```

### 4. Deploy Functions

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

### 5. Create Webhook Endpoint

1. After deploying, go to Stripe Dashboard → Webhooks
2. Add endpoint: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy webhook signing secret
5. Set in Firebase: `firebase functions:config:set stripe.webhook_secret="whsec_..."`

### 6. Test

1. Open app → Account → Predplatné
2. Click "Upgrade to BASIC" or "Upgrade to PRO"
3. Use test card: `4242 4242 4242 4242`
4. Complete checkout
5. Check Firestore `users/{uid}.subscription` - should update automatically

## Important Notes

- **Test Mode:** Use `sk_test_...` keys for development
- **Production:** Switch to `sk_live_...` keys before going live
- **Webhook Secret:** Different for test vs production webhooks
- **Price IDs:** Must match exactly between Stripe Dashboard and code
