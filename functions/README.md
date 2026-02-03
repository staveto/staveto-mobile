# Firebase Cloud Functions for Stripe Subscriptions

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Configure Stripe

#### Get Stripe API Keys
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to Developers → API keys
3. Copy your **Secret Key** (starts with `sk_test_` for test mode, `sk_live_` for production)

#### Create Products and Prices
1. Go to Stripe Dashboard → Products
2. Create products:
   - **BASIC** - Základné predplatné (€9.99/month)
   - **PRO** - Profesionálne predplatné (€29.99/month)
3. For each product, create a recurring price (monthly)
4. Copy the Price IDs (start with `price_...`)

#### Update Configuration
1. Edit `functions/src/config.ts`:
   - Update `PRICE_ID_TO_TIER` mapping with your actual Stripe Price IDs
   - Example:
     ```typescript
     PRICE_ID_TO_TIER: {
       "price_1234567890": "BASIC",
       "price_0987654321": "PRO",
     }
     ```

### 3. Set Firebase Functions Config

```bash
# Set Stripe Secret Key
firebase functions:config:set stripe.secret_key="sk_test_YOUR_SECRET_KEY"

# After creating webhook endpoint (see step 4), set webhook secret
firebase functions:config:set stripe.webhook_secret="whsec_YOUR_WEBHOOK_SECRET"
```

**Alternative (Recommended for production):** Use Firebase Functions environment variables:
```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

Then update `functions/src/index.ts` to use:
```typescript
const stripeSecret = process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
```

### 4. Create Stripe Webhook Endpoint

#### For Local Development (using Stripe CLI):
```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to http://localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook
```

This will give you a webhook signing secret (starts with `whsec_`). Use this for local testing.

#### For Production:
1. Deploy functions first: `firebase deploy --only functions`
2. Go to Stripe Dashboard → Developers → Webhooks
3. Click "Add endpoint"
4. Endpoint URL: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`
5. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
6. Copy the webhook signing secret and set it in Firebase config

### 5. Build and Deploy

```bash
cd functions
npm run build
firebase deploy --only functions
```

## Local Development

### Run Functions Emulator

```bash
cd functions
npm run serve
```

This starts the Firebase Emulator Suite. Functions will be available at:
- `http://localhost:5001/YOUR_PROJECT_ID/us-central1/createCheckoutSession`
- `http://localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook`

### Test Webhook Locally

1. Start functions emulator: `npm run serve`
2. In another terminal, forward Stripe events:
   ```bash
   stripe listen --forward-to http://localhost:5001/YOUR_PROJECT_ID/us-central1/stripeWebhook
   ```
3. Trigger test events:
   ```bash
   stripe trigger checkout.session.completed
   stripe trigger customer.subscription.created
   ```

### Test Checkout Flow

1. Call `createCheckoutSession` from your app with a test Price ID
2. Use Stripe test card: `4242 4242 4242 4242`
3. Any future expiry date, any CVC
4. Complete checkout
5. Webhook should fire and update Firestore

## Security Notes

- **Client CANNOT modify subscription tier** - Only webhooks update `users/{uid}.subscription`
- Firestore rules prevent client writes to `subscription` field
- Stripe webhook signature is verified before processing events
- All subscription status comes from Stripe (source of truth)

## Troubleshooting

### Webhook not firing
- Check Stripe Dashboard → Webhooks → Endpoint logs
- Verify webhook secret is correct
- Check Firebase Functions logs: `firebase functions:log`

### Subscription not updating
- Check webhook endpoint is receiving events
- Verify `firebaseUID` is in metadata
- Check Firestore rules allow server writes

### Checkout session creation fails
- Verify Stripe secret key is set correctly
- Check Price IDs exist in Stripe
- Ensure user has email set
