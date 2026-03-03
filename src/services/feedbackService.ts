/**
 * Feedback service – submit user feedback to Firestore with app/device metadata.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Localization from "expo-localization";
import { db } from "../firebase";
import { collection, addDoc, serverTimestamp } from "../lib/rnFirestore";
import { getEntitlement } from "./billing";

export type FeedbackType = "bug" | "idea" | "other";

export interface FeedbackPayload {
  userId: string;
  orgId?: string | null;
  type: FeedbackType;
  rating?: number;
  message: string;
  allowContact?: boolean;
  context?: {
    screen?: string;
    action?: string;
  };
}

async function getAppMetadata() {
  const expoConfig = Constants.expoConfig;
  const buildNumber =
    (Platform.OS === "ios" ? expoConfig?.ios?.buildNumber : expoConfig?.android?.versionCode) ?? "?";
  return {
    version: expoConfig?.version ?? "1.0.0",
    buildNumber: String(buildNumber),
    releaseChannel: __DEV__ ? "development" : "production",
    platform: Platform.OS,
    osVersion: Device.osVersion ?? "?",
    deviceModel: Device.modelName ?? Device.deviceName ?? "?",
    locale: Localization.getLocales()[0]?.languageTag ?? "?",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "?",
  };
}

async function getSubscriptionMetadata() {
  try {
    const ent = await getEntitlement();
    return {
      isSubscribed: !!ent?.entitlement,
      activeEntitlementId: ent?.entitlement ? "pro" : undefined,
      offeringId: undefined,
      selectedPlanId: ent?.planId ?? undefined,
    };
  } catch {
    return { isSubscribed: false };
  }
}

/**
 * Submit feedback to Firestore `feedback` collection.
 * Includes app/device metadata and subscription status.
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  const [app, subscription] = await Promise.all([getAppMetadata(), getSubscriptionMetadata()]);

  const docData = {
    userId: payload.userId,
    orgId: payload.orgId ?? null,
    type: payload.type,
    rating: payload.rating ?? null,
    message: payload.message,
    allowContact: payload.allowContact ?? false,
    createdAt: serverTimestamp(),
    context: payload.context ?? {},
    app,
    subscription,
  };

  const col = collection(db, "feedback");
  await addDoc(col, docData);
}
