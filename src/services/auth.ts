import { Platform } from "react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { doc, setDoc, getDoc, serverTimestamp } from "../lib/rnFirestore";
import { db, getAuth } from "../firebase";
import { getDeviceRegionCode } from "../utils/countries";

export type AuthUser = { id: string; email: string; name?: string; firstName?: string; lastName?: string; phoneE164?: string };

function toAuthUser(u: { uid: string; email: string | null; displayName: string | null }): AuthUser {
  return {
    id: u.uid,
    email: u.email ?? "",
    name: u.displayName ?? undefined,
  };
}

function hasField(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

/**
 * Ensure user profile in Firestore. Does not overwrite existing email/name when
 * incoming values are empty (e.g. Apple "Hide My Email" – subsequent sign-in
 * may not return email/name).
 */
async function ensureUserProfile(user: AuthUser): Promise<void> {
  const ref = doc(db, "users", user.id);
  const snap = await getDoc(ref);
  const existing = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  // Only set email/emailLower when we have a value – don't overwrite with empty (Apple Hide My Email)
  const hasEmail = !!user.email?.trim();
  if (hasEmail) {
    const trimmed = user.email.trim();
    update.email = trimmed;
    update.emailLower = trimmed.toLowerCase();
  }
  // When hasEmail is false: don't add to update – existing email/emailLower stay unchanged

  if (!hasField(existing, "displayName") && (user.name?.trim() ?? (user.firstName || user.lastName))) {
    update.displayName = (user.name?.trim()) ?? ([user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null);
  }
  if (!hasField(existing, "firstName") && user.firstName) {
    update.firstName = user.firstName;
  }
  if (!hasField(existing, "lastName") && user.lastName) {
    update.lastName = user.lastName;
  }
  if (!hasField(existing, "phoneE164")) {
    update.phoneE164 = user.phoneE164 ?? null;
  }
  if (!hasField(existing, "locale")) {
    try {
      const { getLocales } = require("expo-localization");
      const locales = getLocales?.();
      const tag = locales?.[0]?.languageTag;
      update.locale = (tag && typeof tag === "string") ? tag : null;
    } catch {
      update.locale = null;
    }
  }
  if (!hasField(existing, "countryCode")) {
    update.countryCode = getDeviceRegionCode() ?? null;
  }
  if (!hasField(existing, "createdAt")) {
    update.createdAt = serverTimestamp();
  }

  await setDoc(ref, update, { merge: true });
}

export type OnboardingProfileData = {
  firstName: string;
  lastName: string;
  displayName: string;
  phoneE164?: string;
  primaryCountry?: string;
  timezone?: string;
};

/** Update Firestore user profile from onboarding. Does not overwrite existing values. */
export async function updateUserProfileFromOnboarding(
  uid: string,
  data: OnboardingProfileData
): Promise<void> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const existing = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    onboardingCompletedAt: serverTimestamp(),
  };
  if (!hasField(existing, "firstName") || !existing.firstName) {
    update.firstName = data.firstName;
  }
  if (!hasField(existing, "lastName") || !existing.lastName) {
    update.lastName = data.lastName;
  }
  if (!hasField(existing, "displayName") || !existing.displayName) {
    update.displayName = data.displayName;
  }
  if (data.phoneE164 && (!hasField(existing, "phoneE164") || !existing.phoneE164)) {
    update.phoneE164 = data.phoneE164;
  }
  if (data.primaryCountry && (!hasField(existing, "primaryCountry") || !existing.primaryCountry)) {
    update.primaryCountry = data.primaryCountry;
  }
  if (data.timezone && (!hasField(existing, "timezone") || !existing.timezone)) {
    update.timezone = data.timezone;
  }
  await setDoc(ref, update, { merge: true });

  const currentUser = getAuth()?.currentUser;
  if (currentUser?.uid === uid && data.displayName) {
    await currentUser.updateProfile({ displayName: data.displayName });
  }
}

export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: AuthUser; token: string }> {
  const trimEmail = email.trim().toLowerCase();
  const fbAuth = getAuth();
  if (!fbAuth) throw new Error("FIREBASE_DISABLED");
  const cred = await fbAuth.createUserWithEmailAndPassword(trimEmail, password);
  if (displayName?.trim()) {
    await cred.user.updateProfile({ displayName: displayName.trim() });
  }
  const user = toAuthUser(cred.user);
  await ensureUserProfile({
    id: user.id,
    email: trimEmail,
    name: displayName?.trim() ?? user.name,
  });
  const token = await cred.user.getIdToken();
  return { user, token };
}

export async function login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const trimEmail = email.trim().toLowerCase();
  const fbAuth = getAuth();
  if (!fbAuth) throw new Error("FIREBASE_DISABLED");
  const cred = await fbAuth.signInWithEmailAndPassword(trimEmail, password);
  const user = toAuthUser(cred.user);
  await ensureUserProfile(user);
  const token = await cred.user.getIdToken();
  return { user, token };
}

export async function loginWithGoogle(): Promise<{ user: AuthUser; token: string }> {
  if (Platform.OS === "android") {
    const hasPlayServices = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    if (!hasPlayServices) {
      throw new Error("Google Play Services nie sú dostupné. Aktualizujte ich v Obchode Play.");
    }
  }

  const response = await GoogleSignin.signIn();
  if (response.type === "cancelled" || !response.data?.idToken) {
    throw new Error("Používateľ zrušil prihlásenie.");
  }

  const idToken = response.data.idToken;
  const authMod = require("@react-native-firebase/auth").default;
  const googleCredential = authMod.GoogleAuthProvider.credential(idToken);
  const cred = await authMod().signInWithCredential(googleCredential);
  const user = toAuthUser(cred.user);
  await ensureUserProfile(user);
  const token = await cred.user.getIdToken();
  return { user, token };
}

/** Sign in with Apple (iOS only). Requires expo-apple-authentication + Firebase Auth Apple provider. */
export async function loginWithApple(): Promise<{ user: AuthUser; token: string }> {
  if (Platform.OS !== "ios") {
    throw new Error("Sign in with Apple is only available on iOS.");
  }

  const AppleAuthentication = require("expo-apple-authentication").default;
  const Crypto = require("expo-crypto");
  const authMod = require("@react-native-firebase/auth").default;

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    throw new Error("Sign in with Apple is not available on this device.");
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Používateľ zrušil prihlásenie.");
  }

  const provider = new authMod.OAuthProvider("apple.com");
  const appleCredential = provider.credential({
    idToken: credential.identityToken,
    rawNonce,
  });

  const cred = await authMod().signInWithCredential(appleCredential);

  // Apple sends fullName/email only on first sign-in; use them if present
  const fullName = credential.fullName;
  const appleEmail = credential.email?.trim() || "";
  const appleName =
    fullName?.givenName || fullName?.familyName
      ? [fullName.givenName, fullName.familyName].filter(Boolean).join(" ").trim()
      : "";

  const fbUser = cred.user;
  const user: AuthUser = {
    id: fbUser.uid,
    email: fbUser.email ?? appleEmail ?? "",
    name: fbUser.displayName ?? (appleName || undefined),
    firstName: fullName?.givenName ?? undefined,
    lastName: fullName?.familyName ?? undefined,
  };

  await ensureUserProfile(user);
  const token = await fbUser.getIdToken();
  return { user, token };
}

export async function logout(): Promise<void> {
  await getAuth()?.signOut();
}

/** Send password reset email to the given address. */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const trimEmail = email.trim().toLowerCase();
  if (!trimEmail || !trimEmail.includes("@")) {
    throw new Error("Zadajte platný email.");
  }
  const fbAuth = getAuth();
  if (!fbAuth) throw new Error("FIREBASE_DISABLED");
  await fbAuth.sendPasswordResetEmail(trimEmail);
}

/** Maps Firebase auth/ error codes to user-friendly messages. */
export function getAuthErrorMessage(code: string): string {
  const m: Record<string, string> = {
    "auth/invalid-email": "Neplatný email.",
    "auth/user-disabled": "Účet je deaktivovaný.",
    "auth/user-not-found": "Účet neexistuje.",
    "auth/wrong-password": "Nesprávne heslo.",
    "auth/email-already-in-use": "Email je už registrovaný.",
    "auth/weak-password": "Heslo musí mať aspoň 6 znakov.",
    "auth/invalid-credential": "Neplatné prihlasovacie údaje. Skontrolujte Web Client ID vo Firebase.",
    "auth/account-exists-with-different-credential": "Účet s týmto emailom už existuje. Prihláste sa heslom.",
    "auth/credential-already-in-use": "Tieto prihlasovacie údaje sú už použité.",
    "auth/operation-not-allowed": "Google alebo Apple prihlásenie nie je povolené. Skontrolujte Firebase Console.",
    "auth/configuration-not-found": "Chýba Web Client ID. Pridajte EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID do .env",
    "DEVELOPER_ERROR": "Chyba konfigurácie. Skontrolujte SHA-1 v Firebase a Web Client ID.",
    "SIGN_IN_REQUIRED": "Používateľ zrušil prihlásenie.",
    "ERR_REQUEST_CANCELED": "Používateľ zrušil prihlásenie.",
  };
  return m[code] ?? "Chyba prihlásenia. Skúste znova.";
}
