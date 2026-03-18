import { Platform } from "react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import auth from "@react-native-firebase/auth";
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
  const googleCredential = auth.GoogleAuthProvider.credential(idToken);
  const cred = await auth().signInWithCredential(googleCredential);
  const user = toAuthUser(cred.user);
  await ensureUserProfile(user);
  const token = await cred.user.getIdToken();
  return { user, token };
}

/** Stored when account-exists-with-different-credential – used for linkAppleToExistingAccount */
let pendingAppleLink: { identityToken: string; rawNonce: string; email?: string } | null = null;

export function getPendingAppleLinkEmail(): string | undefined {
  return pendingAppleLink?.email;
}

export function clearPendingAppleLink(): void {
  pendingAppleLink = null;
}

/**
 * Link Apple credential to existing account (after user signs in with email/password).
 * Call when loginWithApple threw auth/account-exists-with-different-credential.
 */
export async function linkAppleToExistingAccount(
  email: string,
  password: string
): Promise<{ user: AuthUser; token: string }> {
  const data = pendingAppleLink;
  if (!data) {
    const err = new Error("Apple prepojenie vypršalo. Skúste prihlásenie cez Apple znova.") as Error & { code?: string };
    err.code = "auth/apple-link-expired";
    throw err;
  }
  const trimEmail = email.trim().toLowerCase();
  const fbAuth = getAuth();
  if (!fbAuth) throw new Error("FIREBASE_DISABLED");
  const cred = await fbAuth.signInWithEmailAndPassword(trimEmail, password);
  const appleCredential = auth.AppleAuthProvider.credential(data.identityToken, data.rawNonce);
  await cred.user.linkWithCredential(appleCredential);
  pendingAppleLink = null;
  const user = toAuthUser(cred.user);
  await ensureUserProfile(user);
  const token = await cred.user.getIdToken();
  return { user, token };
}

/** Check if Sign in with Apple is available (iOS only). Use to hide button when unavailable. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Sign in with Apple (iOS only). Never surfaces technical errors to UI (Apple 2.1(a)). */
export async function loginWithApple(): Promise<{ user: AuthUser; token: string }> {
  if (Platform.OS !== "ios") {
    const err = new Error("Sign in with Apple is only available on iOS.") as Error & { code?: string };
    err.code = "auth/apple-unavailable";
    throw err;
  }

  try {
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      const err = new Error("Sign in with Apple is not available on this device.") as Error & { code?: string };
      err.code = "auth/apple-unavailable";
      throw err;
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
    if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_signin_success");

    if (!credential?.identityToken) {
      const err = new Error(
        credential ? "Apple sign-in did not return required data. Please try again or use email." : "Používateľ zrušil prihlásenie."
      ) as Error & { code?: string };
      err.code = credential ? "auth/apple-missing-identity-token" : "auth/cancelled";
      throw err;
    }
    if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_identity_token_ok");

    const fbAuth = getAuth();
    if (!fbAuth) throw new Error("FIREBASE_DISABLED");

    const appleCredential = auth.AppleAuthProvider.credential(credential.identityToken, rawNonce);
    if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_firebase_credential_ok");

    let cred: Awaited<ReturnType<typeof fbAuth.signInWithCredential>>;
    try {
      cred = await fbAuth.signInWithCredential(appleCredential);
    } catch (linkErr: unknown) {
      const linkCode = (linkErr as { code?: string })?.code;
      if (linkCode === "auth/account-exists-with-different-credential") {
        pendingAppleLink = {
          identityToken: credential.identityToken,
          rawNonce,
          email: appleEmail || undefined,
        };
        if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] account-exists, stored pending link, email:", appleEmail || "(none)");
        throw linkErr;
      }
      throw linkErr;
    }
    if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_firebase_signin_ok");

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

    try {
      await ensureUserProfile(user);
      if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_profile_ok");
    } catch (profileErr) {
      if (__DEV__) {
        console.error("[APPLE_LOGIN_DEBUG] apple_step_profile_failed", (profileErr as Error)?.code, (profileErr as Error)?.message, (profileErr as Error)?.stack);
      }
      // User is already signed in to Firebase – don't fail the whole login
      // Profile will be created/updated on next sign-in or by AuthContext
      if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_profile_skipped_continue");
    }

    const token = await fbUser.getIdToken();
    if (__DEV__) console.log("[APPLE_LOGIN_DEBUG] apple_step_done");
    return { user, token };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const message = (e as { message?: string })?.message ?? "";
    const stack = (e as { stack?: string })?.stack ?? "";

    if (__DEV__) {
      console.error("[APPLE_LOGIN_DEBUG]", code, message, stack);
    }

    // User cancelled – UI should not show alert
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED" || code === "auth/cancelled") {
      const err = new Error("Používateľ zrušil prihlásenie.") as Error & { code?: string };
      err.code = "auth/cancelled";
      throw err;
    }

    // Preserve known Firebase auth codes so getAuthErrorMessage shows specific message
    if (code && code.startsWith("auth/")) {
      throw e;
    }

    // Never surface technical errors (e.g. "undefined is not a function") to users
    const err = new Error("Prihlásenie cez Apple zlyhalo. Skúste znova alebo použite email.") as Error & { code?: string };
    err.code = "auth/apple-unavailable";
    throw err;
  }
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
    "auth/apple-unavailable": "Prihlásenie cez Apple nie je na tomto zariadení dostupné. Použite prihlásenie emailom.",
    "auth/apple-missing-identity-token": "Apple sign-in did not return required data. Please try again or use email.",
    "auth/apple-timeout": "Apple sign-in timed out. Please try again.",
    "auth/apple-link-expired": "Apple prepojenie vypršalo. Skúste prihlásenie cez Apple znova.",
    "auth/cancelled": "Používateľ zrušil prihlásenie.",
    "DEVELOPER_ERROR": "Chyba konfigurácie. Skontrolujte SHA-1 v Firebase a Web Client ID.",
    "SIGN_IN_REQUIRED": "Používateľ zrušil prihlásenie.",
    "ERR_REQUEST_CANCELED": "Používateľ zrušil prihlásenie.",
  };
  return m[code] ?? "Chyba prihlásenia. Skúste znova.";
}
