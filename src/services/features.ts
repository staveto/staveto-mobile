import { doc, getDoc } from "../lib/rnFirestore";
import { db, auth } from "../firebase";

export type UserSettings = {
  features?: {
    whatsappDiary?: boolean;
    contractors?: boolean;
  };
  country?: string;
};

let cachedSettings: { uid: string; settings: UserSettings } | null = null;

export async function getUserSettings(uid: string): Promise<UserSettings> {
  if (cachedSettings?.uid === uid) return cachedSettings.settings;
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? (snap.data() as { settings?: UserSettings }) : undefined;
  const settings = data?.settings ?? {};
  cachedSettings = { uid, settings };
  return settings;
}

export async function isFeatureEnabled(
  featureKey: "whatsappDiary" | "contractors",
  uid?: string
): Promise<boolean> {
  const userId = uid ?? auth.currentUser?.uid;
  if (!userId) return false;
  const settings = await getUserSettings(userId);
  return !!settings.features?.[featureKey];
}
