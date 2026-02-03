/**
 * Firebase Cloud Functions for Stripe Subscription Management
 * 
 * SECURITY: All subscription updates happen server-side via webhooks.
 * Client cannot modify subscription tier directly.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";

admin.initializeApp();

// Initialize Stripe (get secret from config or env)
const stripeSecret = functions.config().stripe?.secret_key || process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  throw new Error("Stripe secret key not found. Set via: firebase functions:config:set stripe.secret_key='sk_...'");
}

const stripe = new Stripe(stripeSecret, {
  apiVersion: "2024-11-20.acacia",
});

import { getTierFromPriceId, STRIPE_CONFIG } from "./config";

/**
 * Create or get Stripe Customer for a Firebase user
 */
async function getOrCreateStripeCustomer(firebaseUID: string, email: string): Promise<string> {
  const userDoc = await admin.firestore().doc(`users/${firebaseUID}`).get();
  const userData = userDoc.data();
  
  // Check if customer already exists
  if (userData?.subscription?.stripeCustomerId) {
    return userData.subscription.stripeCustomerId;
  }
  
  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      firebaseUID,
    },
  });
  
  // Store customer ID in Firestore (client can read, but webhook will update)
  await admin.firestore().doc(`users/${firebaseUID}`).set(
    {
      subscription: {
        stripeCustomerId: customer.id,
        tier: "FREE",
        status: "active",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
  
  return customer.id;
}

/**
 * Callable HTTPS Function: Create Checkout Session
 * 
 * Client calls this to initiate Stripe Checkout.
 * Returns checkout URL that client opens in browser/webview.
 */
export const createCheckoutSession = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Musíte byť prihlásený.");
  }
  
  const { priceId } = data;
  if (!priceId || typeof priceId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "priceId je povinný.");
  }
  
  const firebaseUID = context.auth.uid;
  const userRecord = await admin.auth().getUser(firebaseUID);
  const email = userRecord.email;
  
  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "Používateľ nemá nastavený email.");
  }
  
  // Get or create Stripe customer
  const customerId = await getOrCreateStripeCustomer(firebaseUID, email);
  
  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: STRIPE_CONFIG.SUCCESS_URL_WEB + "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: STRIPE_CONFIG.CANCEL_URL_WEB,
    metadata: {
      firebaseUID,
    },
    subscription_data: {
      metadata: {
        firebaseUID,
      },
    },
  });
  
  return { url: session.url, sessionId: session.id };
});

/**
 * Callable HTTPS Function: Create Billing Portal Session
 * 
 * Allows users to manage subscription, update payment method, cancel, etc.
 */
export const createBillingPortalSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Musíte byť prihlásený.");
  }
  
  const firebaseUID = context.auth.uid;
  const userDoc = await admin.firestore().doc(`users/${firebaseUID}`).get();
  const userData = userDoc.data();
  
  const customerId = userData?.subscription?.stripeCustomerId;
  if (!customerId) {
    throw new functions.https.HttpsError("failed-precondition", "Nemáte aktívne predplatné.");
  }
  
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: STRIPE_CONFIG.SUCCESS_URL_WEB,
  });
  
  return { url: session.url };
});

/**
 * Callable HTTPS Function: Request Account Deletion (MVP)
 *
 * Creates a deletion request record and marks user doc for follow-up.
 * Actual deletion is handled manually or by a scheduled job later.
 */
export const requestAccountDeletion = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Musíte byť prihlásený.");
  }

  const firebaseUID = context.auth.uid;
  const userRecord = await admin.auth().getUser(firebaseUID);
  const email = userRecord.email ?? null;
  const reason = typeof data?.reason === "string" ? data.reason : null;

  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().doc(`deletionRequests/${firebaseUID}`).set(
    {
      userId: firebaseUID,
      email,
      reason,
      requestedAt: now,
      status: "requested",
    },
    { merge: true }
  );

  await admin.firestore().doc(`users/${firebaseUID}`).set(
    {
      deletionRequestedAt: now,
      deletionStatus: "requested",
      updatedAt: now,
    },
    { merge: true }
  );

  return { status: "requested" };
});

/**
 * HTTPS Function: Stripe Webhook Handler
 * 
 * Handles Stripe events and updates Firestore subscription status.
 * This is the SOURCE OF TRUTH - only webhook can update subscription tier.
 * 
 * IMPORTANT: Webhook requires raw body for signature verification.
 * Firebase Functions automatically provides raw body in req.rawBody (v1) or req.body (v2).
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = functions.config().stripe?.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error("Webhook secret not configured");
    res.status(500).send("Webhook secret not configured");
    return;
  }
  
  if (!sig) {
    console.error("Missing stripe-signature header");
    res.status(400).send("Missing stripe-signature header");
    return;
  }
  
  let event: Stripe.Event;
  
  try {
    // Firebase Functions v1: req.body is already a Buffer for POST requests
    // Firebase Functions v2: Use req.rawBody if available, otherwise req.body
    const body = (req as any).rawBody || req.body;
    
    if (!body) {
      throw new Error("Request body is empty");
    }
    
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  
  // Handle the event
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (error: any) {
    console.error("Error handling webhook event:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process Stripe webhook events and update Firestore
 */
async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  let firebaseUID: string | undefined;
  
  // Extract firebaseUID based on event type
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      firebaseUID = session.metadata?.firebaseUID;
      break;
    }
    
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      // Try subscription metadata first
      firebaseUID = subscription.metadata?.firebaseUID;
      
      // If not in subscription metadata, get from customer metadata
      if (!firebaseUID && subscription.customer) {
        try {
          const customer = await stripe.customers.retrieve(subscription.customer as string);
          if (!customer.deleted && customer.metadata) {
            firebaseUID = customer.metadata.firebaseUID;
          }
        } catch (error) {
          console.warn(`Failed to retrieve customer ${subscription.customer}:`, error);
        }
      }
      break;
    }
    
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          firebaseUID = subscription.metadata?.firebaseUID;
          
          if (!firebaseUID && subscription.customer) {
            const customer = await stripe.customers.retrieve(subscription.customer as string);
            if (!customer.deleted && customer.metadata) {
              firebaseUID = customer.metadata.firebaseUID;
            }
          }
        } catch (error) {
          console.warn(`Failed to retrieve subscription for invoice:`, error);
        }
      }
      break;
    }
    
    default:
      // Try generic metadata extraction
      firebaseUID = (event.data.object as any).metadata?.firebaseUID;
  }
  
  if (!firebaseUID) {
    console.warn(`No firebaseUID found in event: ${event.type}, event ID: ${event.id}`);
    // Still log the event for debugging
    await admin.firestore().collection("billingEvents").add({
      eventType: event.type,
      firebaseUID: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      eventId: event.id,
      error: "No firebaseUID found",
    });
    return;
  }
  
  const userRef = admin.firestore().doc(`users/${firebaseUID}`);
  
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        await updateSubscriptionFromStripe(firebaseUID, session.subscription as string);
      }
      break;
    }
    
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await updateSubscriptionFromStripe(firebaseUID, subscription.id);
      break;
    }
    
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      // Downgrade to FREE when subscription is deleted
      await userRef.set(
        {
          subscription: {
            tier: "FREE",
            status: "canceled",
            stripeCustomerId: subscription.customer as string,
            stripeSubscriptionId: subscription.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      break;
    }
    
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        await userRef.set(
          {
            subscription: {
              status: "past_due",
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true }
        );
      }
      break;
    }
    
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  // Log event for audit (optional)
  await admin.firestore().collection("billingEvents").add({
    eventType: event.type,
    firebaseUID,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    eventId: event.id,
  });
}

/**
 * Update Firestore subscription from Stripe Subscription object
 */
async function updateSubscriptionFromStripe(
  firebaseUID: string,
  subscriptionId: string
): Promise<void> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    console.error("No price ID in subscription:", subscriptionId);
    return;
  }
  
  const tier = getTierFromPriceId(priceId);
  const status = mapStripeStatusToSubscriptionStatus(subscription.status);
  
  const userRef = admin.firestore().doc(`users/${firebaseUID}`);
  await userRef.set(
    {
      subscription: {
        tier,
        status,
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
  
  console.log(`Updated subscription for ${firebaseUID}: tier=${tier}, status=${status}`);
}

/**
 * Map Stripe subscription status to our subscription status
 */
function mapStripeStatusToSubscriptionStatus(
  stripeStatus: Stripe.Subscription.Status
): "trialing" | "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return "canceled";
    default:
      return "canceled";
  }
}
