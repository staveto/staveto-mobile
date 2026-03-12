/**
 * RevenueCat Server Notifications Webhook
 * Maps app_user_id to Firebase uid. Updates users/{uid} billing fields.
 */

import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";

type RevenueCatEvent = {
  type?: string;
  id?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
  product_id?: string;
  entitlement_ids?: string[] | null;
  cancel_reason?: string;
  expiration_reason?: string;
  event?: {
    type?: string;
    app_user_id?: string;
    original_app_user_id?: string;
    expiration_at_ms?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export const revenuecatWebhook = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    let body: RevenueCatEvent;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    } catch {
      log("[revenuecatWebhook] Invalid JSON body");
      res.status(400).send("Invalid JSON");
      return;
    }

    const event = body.event as Record<string, unknown> | undefined;
    const eventType = (body.type ?? event?.type) as string ?? "UNKNOWN";
    const uid =
      (body.app_user_id ?? body.original_app_user_id ?? event?.app_user_id ?? event?.original_app_user_id) as
        | string
        | null;

    log("[revenuecatWebhook] event", {
      type: eventType,
      id: body.id,
      uid: uid ?? "null",
      expiration_at_ms: body.expiration_at_ms ?? null,
    });

    if (!uid || typeof uid !== "string") {
      log("[revenuecatWebhook] No app_user_id, skipping");
      res.status(200).send("OK");
      return;
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);

    const now = admin.firestore.FieldValue.serverTimestamp();

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
      case "SUBSCRIPTION_EXTENDED":
      case "UNCANCELLATION":
      case "TEMPORARY_ENTITLEMENT_GRANT": {
        const expMs = body.expiration_at_ms ?? event?.expiration_at_ms;
        const currentPeriodEndAt =
          typeof expMs === "number" && expMs > 0
            ? admin.firestore.Timestamp.fromMillis(expMs)
            : null;

        await userRef.set(
          {
            isPro: true,
            subscriptionStatus: "active",
            currentPeriodEndAt,
            cancelAtPeriodEnd: false,
            updatedAt: now,
          },
          { merge: true }
        );
        log("[revenuecatWebhook] Updated user active", { uid, currentPeriodEndAt: expMs });
        break;
      }

      case "CANCELLATION": {
        const expMs = body.expiration_at_ms ?? event?.expiration_at_ms;
        const currentPeriodEndAt =
          typeof expMs === "number" && expMs > 0
            ? admin.firestore.Timestamp.fromMillis(expMs)
            : null;

        await userRef.set(
          {
            cancelAtPeriodEnd: true,
            currentPeriodEndAt: currentPeriodEndAt ?? undefined,
            updatedAt: now,
          },
          { merge: true }
        );
        log("[revenuecatWebhook] Cancellation - keep isPro until period end", {
          uid,
          cancel_reason: body.cancel_reason,
        });
        break;
      }

      case "EXPIRATION": {
        await userRef.set(
          {
            isPro: false,
            subscriptionStatus: "expired",
            updatedAt: now,
          },
          { merge: true }
        );
        log("[revenuecatWebhook] Expiration - revoked access", {
          uid,
          expiration_reason: body.expiration_reason,
        });
        break;
      }

      case "TEST":
        log("[revenuecatWebhook] Test event received");
        break;

      default:
        log("[revenuecatWebhook] Unhandled event type", { type: eventType });
    }

    res.status(200).send("OK");
  }
);
