# Complete Stripe Subscription Setup Guide

## 🎯 Overview

This guide walks you through setting up Stripe subscriptions for Staveto app with **server-side enforcement**. All subscription updates happen via Stripe webhooks - clients cannot modify subscription tiers.

## ✅ Security Confirmation

**Client cannot modify subscription tier; only webhook/server updates Firestore.**

- ✅ Firestore rules prevent client writes to `subscription` field
- ✅ Only Cloud Functions (webhook handler) can write subscription
- ✅ All subscription status comes from Stripe webhooks
- ✅ Client can only read subscription status for UI display

## 📋 Prerequisites

1. Firebase project with Functions enabled
2. Stripe account (test mode for development)
3. Node.js 18+ installed
4. Firebase CLI installed: `npm install -g firebase-tools`
5. Stripe CLI installed (for local webhook testing): https://stripe.com/docs/stripe-cli

## 🔧 Step-by-Step Setup

### Step 1: Install Functions Dependencies

```bash
cd functions
npm install
```

### Step 2: Create Stripe Products and Prices

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Products
2. Click "Add product"

**BASIC Plan:**
- Name: "Základné predplatné"
- Description: "Pre malé firmy a remeselníkov"
- Pricing: Recurring
- Price: €9.99/month
- Billing period: Monthly
- Click "Save product"
- **Copy the Price ID** (starts with `price_...`)

**PRO Plan:**
- Name: "Profesionálne predplatné"
- Description: "Pre väčšie projekty a tímy"
- Pricing: Recurring
- Price: €29.99/month
- Billing period: Monthly
- Click "Save product"
- **Copy the Price ID** (starts with `price_...`)

### Step 3: Update Code with Price IDs

**Edit `functions/src/config.ts`:**
```typescript
PRICE_ID_TO_TIER: {
  "price_YOUR_BASIC_PRICE_ID": "BASIC",  // Replace with actual Price ID
  "price_YOUR_PRO_PRICE_ID": "PRO",      // Replace with actual Price ID
}
```

**Edit `src/screens/SubscriptionScreen.tsx` (line ~36):**
```typescript
const STRIPE_PRICE_IDS = {
  BASIC_MONTHLY: "price_YOUR_BASIC_PRICE_ID",  // Replace with actual Price ID
  PRO_MONTHLY: "price_YOUR_PRO_PRICE_ID",      // Replace with actual Price ID
};
```

### Step 4: Get Stripe API Keys

1. Stripe Dashboard → Developers → API keys
2. Copy **Secret Key** (starts with `sk_test_...` for test mode)
3. Keep this secure - never commit to git!

### Step 5: Configure Firebase Functions

**Option A: Using Firebase Config (Legacy)**
```bash
firebase functions:config:set stripe.secret_key="sk_test_YOUR_SECRET_KEY"
```

**Option B: Using Firebase Secrets (Recommended)**
```bash
# Set secret interactively (will prompt for value)
firebase functions:secrets:set STRIPE_SECRET_KEY

# Or set via environment variable
echo "sk_test_YOUR_SECRET_KEY" | firebase functions:secrets:set STRIPE_SECRET_KEY
```

Then update `functions/src/index.ts` line 15:
```typescript
const stripeSecret = process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
```

### Step 6: Build and Deploy Functions (First Time)

```bash
cd functions
npm run build
firebase deploy --only functions
```

After deployment, note your function URLs:
- `createCheckoutSession`: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/createCheckoutSession`
- `createBillingPortalSession`: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/createBillingPortalSession`
- `stripeWebhook`: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`

### Step 7: Create Stripe Webhook Endpoint

1. Go to Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. **Endpoint URL:** `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`
4. **Description:** "Staveto subscription webhook"
5. **Events to send:**
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
6. Click "Add endpoint"
7. **Copy the Signing secret** (starts with `whsec_...`)

### Step 8: Set Webhook Secret in Firebase

```bash
firebase functions:config:set stripe.webhook_secret="whsec_YOUR_WEBHOOK_SECRET"
```

Or using secrets:
```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

Update `functions/src/index.ts` line 151:
```typescript
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || functions.config().stripe?.webhook_secret;
```

### Step 9: Redeploy Functions (After Config Changes)

```bash
cd functions
npm run build
firebase deploy --only functions
```

## 🧪 Local Development & Testing

### Running Functions Emulator

```bash
cd functions
npm run serve
```

This starts Firebase Emulator Suite. Functions will be available at:
- `http://localhost:5001/YOUR_PROJECT_ID/us-central1/createCheckoutSession`
- `http://localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook`

### Testing Webhook Locally with Stripe CLI

**Terminal 1: Start Functions Emulator**
```bash
cd functions
npm run serve
```

**Terminal 2: Forward Stripe Events**
```bash
stripe listen --forward-to http://localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook
```

This will output a webhook signing secret (different from production). Use this for local testing:
```bash
firebase functions:config:set stripe.webhook_secret="whsec_LOCAL_SECRET"
```

**Terminal 3: Trigger Test Events**
```bash
# Test checkout completion
stripe trigger checkout.session.completed

# Test subscription creation
stripe trigger customer.subscription.created

# Test subscription update
stripe trigger customer.subscription.updated

# Test subscription deletion
stripe trigger customer.subscription.deleted

# Test payment failure
stripe trigger invoice.payment_failed
```

### Testing Checkout Flow

1. **Start your Expo app:**
   ```bash
   npx expo start
   ```

2. **Navigate to Subscription Screen:**
   - Account tab → Predplatné

3. **Click "Upgrade to BASIC" or "Upgrade to PRO"**

4. **Use Stripe Test Card:**
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., `12/34`)
   - CVC: Any 3 digits (e.g., `123`)
   - ZIP: Any 5 digits (e.g., `12345`)

5. **Complete Checkout:**
   - Stripe Checkout opens in browser/webview
   - Enter test card details
   - Click "Subscribe"

6. **Verify Webhook Processing:**
   - Check Functions emulator logs for webhook event
   - Check Firestore: `users/{your-uid}.subscription` should update
   - Subscription tier should change to BASIC or PRO
   - Status should be "active"

7. **Verify App Updates:**
   - Return to app
   - Pull to refresh SubscriptionScreen
   - Should show new tier and limits

### Testing Billing Portal

1. With an active subscription, click "Spravovať platbu a faktúry"
2. Should open Stripe Billing Portal
3. Can update payment method, view invoices, cancel subscription

## 🔍 Troubleshooting

### Webhook Not Firing

1. **Check Stripe Dashboard → Webhooks → Endpoint logs**
   - Look for failed requests
   - Check response codes

2. **Verify Webhook Secret:**
   ```bash
   firebase functions:config:get stripe.webhook_secret
   ```
   Should match the secret from Stripe Dashboard

3. **Check Firebase Functions Logs:**
   ```bash
   firebase functions:log --only stripeWebhook
   ```

4. **Verify Function URL:**
   - Check Stripe webhook endpoint URL matches deployed function
   - Format: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`

### Subscription Not Updating in Firestore

1. **Check webhook is receiving events:**
   - Stripe Dashboard → Webhooks → Endpoint → Recent events

2. **Verify `firebaseUID` in metadata:**
   - Check Stripe customer metadata has `firebaseUID`
   - Check subscription metadata has `firebaseUID`

3. **Check Functions logs for errors:**
   ```bash
   firebase functions:log
   ```

4. **Verify Firestore rules allow server writes:**
   - Rules should allow Cloud Functions (admin SDK) to write
   - Client writes to `subscription` should be blocked

### Checkout Session Creation Fails

1. **Verify Stripe Secret Key:**
   ```bash
   firebase functions:config:get stripe.secret_key
   ```

2. **Check Price IDs exist in Stripe:**
   - Stripe Dashboard → Products → Check Price IDs match code

3. **Ensure user has email:**
   - Check `auth.currentUser.email` is not null

4. **Check Functions logs:**
   ```bash
   firebase functions:log --only createCheckoutSession
   ```

### "No firebaseUID found" in Webhook Logs

This means the webhook event doesn't have `firebaseUID` in metadata. This can happen if:
- Customer was created before metadata was added
- Subscription was created outside our checkout flow

**Fix:** The webhook handler tries to get `firebaseUID` from customer metadata as fallback. If that fails, check:
1. Stripe Customer → Metadata → Should have `firebaseUID`
2. Stripe Subscription → Metadata → Should have `firebaseUID`

## 📊 Verifying Implementation

### Check Firestore Rules

```bash
firebase firestore:rules:get
```

Should show:
- Users can read their own document
- Users CANNOT write `subscription` field (except initial FREE during registration)
- Only server (Cloud Functions) can write subscription

### Check Subscription Limits Work

1. **Create project limit test:**
   - FREE tier: Try creating 2nd project → Should fail with limit message
   - BASIC tier: Try creating 6th project → Should fail

2. **Create task limit test:**
   - FREE tier: Try creating 11th task → Should fail
   - BASIC tier: Try creating 51st task → Should fail

3. **Create expense limit test:**
   - FREE tier: Try creating 6th expense this month → Should fail
   - BASIC tier: Try creating 51st expense this month → Should fail

### Verify Client Cannot Modify Subscription

Try this in your app code (should fail):
```typescript
import { doc, updateDoc } from "firebase/firestore";
await updateDoc(doc(db, "users", userId), {
  subscription: { tier: "PRO", status: "active" }
});
```

Should throw permission error (Firestore rules block it).

## 🚀 Production Checklist

Before going live:

- [ ] Switch Stripe to **Live Mode**
- [ ] Update Stripe Secret Key to `sk_live_...`
- [ ] Create production products/prices in Stripe
- [ ] Update Price IDs in code
- [ ] Create production webhook endpoint
- [ ] Set production webhook secret
- [ ] Update deep link URLs in `functions/src/config.ts`
- [ ] Test with real card (small amount)
- [ ] Monitor webhook logs for first few transactions
- [ ] Set up Stripe email notifications for failed payments

## 📝 Files Changed Summary

### Created Files:
1. `functions/src/index.ts` - Cloud Functions (checkout, webhook, billing portal)
2. `functions/src/config.ts` - Stripe configuration (Price ID mapping)
3. `src/services/subscription.ts` - Client subscription service
4. `src/screens/SubscriptionScreen.tsx` - Subscription management UI

### Modified Files:
1. `firestore.rules` - Added rules to prevent client writes to subscription
2. `src/services/auth.ts` - Initialize FREE subscription on registration
3. `src/services/projects.ts` - Added subscription limit check
4. `src/services/tasks.ts` - Added subscription limit check
5. `src/services/expenses.ts` - Added subscription limit check
6. `src/navigation/RootNavigator.tsx` - Added SubscriptionScreen route
7. `src/screens/AccountScreen.tsx` - Added link to SubscriptionScreen

## ✅ Final Confirmation

**Client cannot modify subscription tier; only webhook/server updates Firestore.**

- ✅ Firestore rules: Client writes to `subscription` field are blocked
- ✅ Webhook handler: Only server-side code updates subscription
- ✅ Limit checks: Services check subscription before creating resources
- ✅ Source of truth: Stripe webhooks are the only way to upgrade/downgrade

## 🆘 Support

If you encounter issues:
1. Check Firebase Functions logs: `firebase functions:log`
2. Check Stripe Dashboard → Webhooks → Endpoint logs
3. Verify all Price IDs match between Stripe and code
4. Ensure webhook secret matches between Stripe and Firebase config
5. Test with Stripe CLI locally first before deploying
