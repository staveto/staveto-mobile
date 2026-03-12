import * as admin from "firebase-admin";
import { log } from "firebase-functions/logger";

/**
 * Get all FCM device tokens for a user from users/{uid}/devices.
 */
export async function getUserTokens(uid: string): Promise<string[]> {
  const db = admin.firestore();
  const devicesSnap = await db.collection("users").doc(uid).collection("devices").get();
  const tokens: string[] = [];
  for (const doc of devicesSnap.docs) {
    const token = doc.data()?.token;
    if (typeof token === "string" && token.length > 0) {
      tokens.push(token);
    }
  }
  if (tokens.length === 0) {
    const userSnap = await db.collection("users").doc(uid).get();
    const lastToken = userSnap.data()?.token;
    if (typeof lastToken === "string" && lastToken.length > 0) {
      tokens.push(lastToken);
    }
  }
  return tokens;
}

/**
 * Find user UID by email (lowercase). Queries users where emailLower == emailLower.
 */
export async function findUidByEmailLower(emailLower: string): Promise<string | null> {
  if (!emailLower || typeof emailLower !== "string") return null;
  const normalized = emailLower.trim().toLowerCase();
  if (!normalized) return null;

  const db = admin.firestore();
  const usersSnap = await db.collection("users").where("emailLower", "==", normalized).limit(1).get();
  if (usersSnap.empty) return null;
  return usersSnap.docs[0].id;
}

/**
 * Send FCM push notification to user(s).
 */
export async function sendPushToUser(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<void> {
  const tokens = await getUserTokens(uid);
  if (tokens.length === 0) {
    log("[push] No tokens for uid", uid);
    return;
  }

  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: { priority: "high" as const },
    apns: { payload: { aps: { sound: "default" } } },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    if (response.failureCount > 0) {
      response.responses.forEach((r, i) => {
        if (!r.success) {
          log("[push] Send failed for token", i, r.error?.message);
        }
      });
    }
  } catch (error) {
    log("[push] sendPushToUser error", uid, error);
  }
}
