import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";

export const redeemPromoCode = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "UNAUTHENTICATED");
      }

      const uid = request.auth.uid;
      const data = (request.data ?? {}) as { code?: string };
      const rawCode = typeof data.code === "string" ? data.code.trim() : "";
      if (!rawCode) {
        throw new HttpsError("invalid-argument", "INVALID_CODE");
      }

      const CODE = rawCode.toUpperCase();
      const db = admin.firestore();
      const now = new Date();
      const nowTs = admin.firestore.Timestamp.fromDate(now);

      const promoRef = db.collection("promoCodes").doc(CODE);
      const userRef = db.collection("users").doc(uid);

      const result = await db.runTransaction(async (tx) => {
      const promoSnap = await tx.get(promoRef);
      if (!promoSnap.exists) {
        throw new HttpsError("not-found", "INVALID_CODE");
      }

      const promo = promoSnap.data() as {
        active?: boolean;
        durationDays?: number;
        maxRedemptions?: number;
        redemptions?: number;
        expiresAt?: admin.firestore.Timestamp;
        oneTimePerUser?: boolean;
      };

      if (promo.active !== true) {
        throw new HttpsError("failed-precondition", "INVALID_CODE");
      }

      if (promo.expiresAt && promo.expiresAt.toMillis() <= now.getTime()) {
        throw new HttpsError("failed-precondition", "EXPIRED");
      }

      const redemptions = promo.redemptions ?? 0;
      const maxRedemptions = promo.maxRedemptions;
      if (typeof maxRedemptions === "number" && redemptions >= maxRedemptions) {
        throw new HttpsError("resource-exhausted", "LIMIT_REACHED");
      }

      if (promo.oneTimePerUser !== false) {
        const existingSnap = await tx.get(
          db.collection("promoRedemptions").where("code", "==", CODE).where("uid", "==", uid).limit(1)
        );
        if (!existingSnap.empty) {
          throw new HttpsError("failed-precondition", "ALREADY_REDEEMED");
        }
      }

      const durationDays = typeof promo.durationDays === "number" ? promo.durationDays : 90;
      const grantedUntil = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      const grantedUntilTs = admin.firestore.Timestamp.fromDate(grantedUntil);

      tx.update(promoRef, {
        redemptions: admin.firestore.FieldValue.increment(1),
      });

      const redemptionRef = db.collection("promoRedemptions").doc();
      tx.set(redemptionRef, {
        code: CODE,
        uid,
        redeemedAt: nowTs,
        grantedUntil: grantedUntilTs,
      });

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        log("[redeemPromoCode] User doc not found", { uid });
        throw new HttpsError("failed-precondition", "USER_NOT_FOUND");
      }
      const currentSub = (userSnap.data()?.subscription as Record<string, unknown>) || {};
      const subscription: Record<string, unknown> = {
        tier: "PRO",
        status: "active",
        currentPeriodEnd: grantedUntilTs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        promoCode: CODE,
        source: "promo",
        stripeCustomerId: currentSub.stripeCustomerId ?? null,
        stripeSubscriptionId: currentSub.stripeSubscriptionId ?? null,
      };

      tx.update(userRef, {
        subscription,
      });

      return {
        ok: true,
        tier: "PRO",
        currentPeriodEnd: grantedUntil.toISOString(),
      };
    });

      return result;
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string | number })?.code;
      log("[redeemPromoCode] Unhandled error", { uid: request.auth?.uid, code, message: msg });
      throw new HttpsError("internal", `PROMO_FAILED: ${msg}`);
    }
  }
);
