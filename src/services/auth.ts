import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import firebaseAuth from "@react-native-firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "../lib/rnFirestore";
import { db, getAuth } from "../firebase";
import { getExtraEnv } from "../lib/env";
import { getDeviceRegionCode } from "../utils/countries";

/**
 * Web OAuth client ID (client_type 3) from project google-services.json — same as Google Cloud "Web client".
 * Public value; used when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing or mistakenly set to a Firebase App ID (1:…:android:…),
 * which causes Android DEVELOPER_ERROR / code 10.
 */
const GOOGLE_WEB_CLIENT_ID_FALLBACK =
  "255961550157-gaueraial600f02qa3qadki41fhvabit.apps.googleusercontent.com";

function isLikelyFirebaseAppId(value: string): boolean {
  return /^1:\d+:(android|ios|web):/i.test(value.trim());
}

function isValidGoogleWebClientId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (isLikelyFirebaseAppId(v)) return false;
  return v.includes(".apps.googleusercontent.com");
}

function resolveGoogleWebClientId(): string {
  const fromExtra = getExtraEnv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  if (fromExtra && isValidGoogleWebClientId(fromExtra)) {
    return fromExtra.trim();
  }
  if (fromExtra && __DEV__) {
    console.warn(
      "[auth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not a valid Web client ID. Use *.apps.googleusercontent.com (not 1:…:android:…). Using fallback."
    );
  }
  if (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
    const p = String(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).trim();
    if (isValidGoogleWebClientId(p)) return p;
  }
  if (__DEV__) {
    console.warn("[auth] Using GOOGLE_WEB_CLIENT_ID_FALLBACK (matches google-services.json Web client).");
  }
  return GOOGLE_WEB_CLIENT_ID_FALLBACK;
}

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
  /** Build vs trade — stored on `users.primaryUsageMode` (legacy `maintenance` still readable elsewhere). */
  primaryUsageMode?: "build" | "trade";
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
  // Do not overwrite with empty – Apple Sign-In may have provided name; App Store forbids requiring re-entry
  if (data.firstName && (!hasField(existing, "firstName") || !existing.firstName)) {
    update.firstName = data.firstName;
  }
  if (data.lastName && (!hasField(existing, "lastName") || !existing.lastName)) {
    update.lastName = data.lastName;
  }
  if (data.displayName && (!hasField(existing, "displayName") || !existing.displayName)) {
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
  if (data.primaryUsageMode === "build" || data.primaryUsageMode === "trade") {
    update.primaryUsageMode = data.primaryUsageMode;
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

/** Extract Firebase / native error code for UI (handles numeric Android codes like 10). */
export function getAuthErrorCodeFromUnknown(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code?: string | number }).code;
    if (c !== undefined && c !== null && String(c) !== "") return String(c);
  }
  return "";
}

// #region agent log
/** Android emulator: 127.0.0.1 is the device; host machine is 10.0.2.2 */
function agentIngestUrl(): string {
  const host = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
  return `http://${host}:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`;
}

function agentDebugLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  fetch(agentIngestUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1d16b2" },
    body: JSON.stringify({
      sessionId: "1d16b2",
      timestamp: Date.now(),
      runId: "pre-fix",
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data ?? {},
    }),
  }).catch(() => {});
}
// #endregion

function configureGoogleSignInSdk(): void {
  const webClientId = resolveGoogleWebClientId();
  const extraRaw = getExtraEnv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID");
  const extraValid = !!(extraRaw && isValidGoogleWebClientId(String(extraRaw)));
  // #region agent log
  agentDebugLog({
    hypothesisId: "H1",
    location: "auth.ts:configureGoogleSignInSdk",
    message: "google_signin_configure",
    data: {
      webClientIdLen: webClientId.length,
      webClientIdPrefix: webClientId.slice(0, 24),
      extraEnvPresent: !!String(extraRaw ?? "").trim(),
      extraEnvValidWebShape: extraValid,
    },
  });
  // #endregion
  GoogleSignin.configure({ webClientId, offlineAccess: false });
}

/** Call once at app startup so Web client ID is never a stale/wrong value from .env alone. */
export function configureGoogleSignInAtStartup(): void {
  try {
    configureGoogleSignInSdk();
  } catch (e) {
    if (__DEV__) console.warn("[auth] configureGoogleSignInAtStartup:", e);
  }
}

function getFirebaseAuthOrThrow() {
  const fbAuth = getAuth();
  if (!fbAuth) {
    const err = new Error("FIREBASE_DISABLED") as Error & { code?: string };
    err.code = "auth/firebase-disabled";
    throw err;
  }
  return fbAuth;
}

/**
 * Clears the native Google Sign-In session (best effort).
 * Call before manual sign-in so the account picker is shown instead of silent reuse.
 */
export async function disconnectGoogleSignInSession(options?: {
  revokeAccess?: boolean;
}): Promise<void> {
  try {
    configureGoogleSignInSdk();
    await GoogleSignin.signOut();
    if (options?.revokeAccess) {
      await GoogleSignin.revokeAccess();
    }
  } catch {
    /* ignore — session may already be cleared */
  }
}

export async function loginWithGoogle(): Promise<{ user: AuthUser; token: string }> {
  configureGoogleSignInSdk();

  // Drop cached Google account so signIn() prompts for account selection.
  await disconnectGoogleSignInSession();

  // #region agent log
  agentDebugLog({
    hypothesisId: "H5",
    location: "auth.ts:loginWithGoogle",
    message: "after_configure",
    data: {
      platform: Platform.OS,
      executionEnvironment: String(Constants.executionEnvironment),
      isStoreClient: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    },
  });
  // #endregion

  // Expo Go uses host.exp.exponent — Firebase/Google OAuth is registered for com.staveto.app only → DEVELOPER_ERROR (10).
  if (Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    const err = new Error("Google Sign-In requires a development build, not Expo Go.") as Error & { code?: string };
    err.code = "auth/google-requires-dev-client";
    throw err;
  }

  try {
    if (Platform.OS === "android") {
      const hasPlayServices = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      if (!hasPlayServices) {
        throw new Error("Google Play Services nie sú dostupné. Aktualizujte ich v Obchode Play.");
      }
    }

    // #region agent log
    agentDebugLog({
      hypothesisId: "H3",
      location: "auth.ts:loginWithGoogle",
      message: "before_native_signIn",
      data: { platform: Platform.OS },
    });
    // #endregion

    const response = await GoogleSignin.signIn();

    if (response.type === "cancelled") {
      const err = new Error("Používateľ zrušil prihlásenie.") as Error & { code?: string };
      err.code = "auth/cancelled";
      throw err;
    }

    if (response.type !== "success") {
      const err = new Error("Používateľ zrušil prihlásenie.") as Error & { code?: string };
      err.code = "auth/cancelled";
      throw err;
    }

    // Prefer getTokens() so Firebase gets both idToken and accessToken (recommended for Google provider).
    let idToken: string | null = null;
    let accessToken: string | undefined;
    try {
      const tokens = await GoogleSignin.getTokens();
      idToken = tokens.idToken ?? null;
      accessToken = tokens.accessToken;
    } catch (tokErr) {
      if (__DEV__) console.warn("[auth] loginWithGoogle getTokens failed, falling back to signIn payload:", tokErr);
      idToken = response.data?.idToken ?? null;
    }

    if (!idToken) {
      const err = new Error("auth/google-missing-id-token") as Error & { code?: string };
      err.code = "auth/google-missing-id-token";
      throw err;
    }

    const googleCredential = firebaseAuth.GoogleAuthProvider.credential(idToken, accessToken);
    const fbAuth = getFirebaseAuthOrThrow();
    const cred = await fbAuth.signInWithCredential(googleCredential);
    const user = toAuthUser(cred.user);
    await ensureUserProfile(user);
    const token = await cred.user.getIdToken();
    // #region agent log
    agentDebugLog({
      hypothesisId: "H4",
      location: "auth.ts:loginWithGoogle",
      message: "firebase_signin_ok",
      data: { uidLen: cred.user.uid?.length ?? 0 },
    });
    // #endregion
    return { user, token };
  } catch (e: unknown) {
    // #region agent log
    {
      const c = getAuthErrorCodeFromUnknown(e);
      const msg = e instanceof Error ? e.message : String(e);
      const errObj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
      agentDebugLog({
        hypothesisId: "H4",
        location: "auth.ts:loginWithGoogle",
        message: "catch",
        data: {
          code: c || String(errObj.code ?? ""),
          msgSnippet: msg.slice(0, 180),
          errName: e instanceof Error ? e.name : typeof e,
        },
      });
    }
    // #endregion
    if (__DEV__) {
      const c = getAuthErrorCodeFromUnknown(e);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[auth] loginWithGoogle failed:", c || "(no code)", msg);
      if (Platform.OS === "android") {
        const looksDev =
          c === "10" ||
          c === "DEVELOPER_ERROR" ||
          msg.includes("DEVELOPER_ERROR") ||
          msg.includes("12500");
        if (looksDev) {
          console.warn(
            "[auth] If Expo Go: use dev build. Else DEVELOPER_ERROR: add SHA-1 of the keystore that signs this APK — often android/app/debug.keystore (npm run android:debug-sha), not only ~/.android. Firebase Android app + Web client ID."
          );
        }
      }
    }
    const authCode = getAuthErrorCodeFromUnknown(e);
    if (authCode.startsWith("auth/")) {
      throw e;
    }

    const raw = e as { code?: string | number; message?: string };
    const code = String(raw?.code ?? "");
    const msg = String(raw?.message ?? e ?? "");
    const looksDevError =
      code === "10" ||
      code === "DEVELOPER_ERROR" ||
      msg.includes("DEVELOPER_ERROR") ||
      msg.includes("12500");
    if (looksDevError) {
      const err = new Error("DEVELOPER_ERROR") as Error & { code?: string };
      err.code = "DEVELOPER_ERROR";
      throw err;
    }

    const cancelled =
      msg.toLowerCase().includes("cancel") ||
      code === "SIGN_IN_CANCELLED" ||
      code === "12501";
    if (cancelled) {
      const err = new Error("Používateľ zrušil prihlásenie.") as Error & { code?: string };
      err.code = "auth/cancelled";
      throw err;
    }

    throw e;
  }
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
  const appleCredential = firebaseAuth.AppleAuthProvider.credential(data.identityToken, data.rawNonce);
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

    const appleCredential = firebaseAuth.AppleAuthProvider.credential(credential.identityToken, rawNonce);
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
    "auth/google-missing-web-client-id":
      "Chýba EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (Web client ID z Google Cloud → Credentials → OAuth 2.0 Client IDs → typ Web application). Pridajte do .env a znova zostavte aplikáciu.",
    "auth/google-missing-id-token":
      "Google nevrátil ID token. Skontrolujte, že EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID je Web client ID (nie Android), a že v Firebase Authentication je zapnuté prihlásenie cez Google.",
    "auth/google-requires-dev-client":
      "Google prihlásenie nefunguje v Expo Go. Nainštalujte vývojovú aplikáciu (napr. run-android.bat alebo npx expo run:android), a spustite Metro s --dev-client.",
    "auth/firebase-disabled": "Firebase Auth nie je k dispozícii. Reštartujte aplikáciu.",
    "DEVELOPER_ERROR":
      "Google Sign-In: v Firebase musí byť SHA-1 kľúča, ktorý naozaj podpisuje APK (Expo často používa android/app/debug.keystore, nie len ~/.android). npm run android:debug-sha. Potom nový google-services.json a rebuild.",
    /** Android Google Sign-In numeric code for misconfigured SHA-1 / OAuth client */
    "10": "Kód 10: pridajte SHA-1 z projektového android/app/debug.keystore do Firebase (nie len z ~/.android). npm run android:debug-sha.",
    "SIGN_IN_REQUIRED": "Používateľ zrušil prihlásenie.",
    "ERR_REQUEST_CANCELED": "Používateľ zrušil prihlásenie.",
  };
  return m[code] ?? "Chyba prihlásenia. Skúste znova.";
}
