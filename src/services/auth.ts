import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  deleteUser,
  linkWithCredential,
  AuthCredential,
  User,
  UserCredential,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION } from "../constants/consent";

export type AuthUser = { id: string; email: string; name?: string };

function toAuthUser(u: User): AuthUser {
  return {
    id: u.uid,
    email: u.email ?? "",
    name: u.displayName ?? undefined,
  };
}

export type RegisterOptions = {
  phoneCredential?: AuthCredential;
  phoneNumber?: string;
  locale?: string;
};

export async function register(
  email: string,
  password: string,
  displayName?: string,
  options?: RegisterOptions
): Promise<{ user: AuthUser; token: string }> {
  const trimEmail = email.trim().toLowerCase();
  const cred: UserCredential = await createUserWithEmailAndPassword(auth, trimEmail, password);
  try {
    if (displayName?.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    
    // Link phone credential only if provided (SMS verification enabled)
    if (options?.phoneCredential) {
      await linkWithCredential(cred.user, options.phoneCredential);
      await cred.user.getIdToken(true);
    }
    
    const user = toAuthUser(cred.user);
    
    // Save phone number to Firestore (even if not verified)
    // phoneVerified is true only if phoneCredential was provided
    await setDoc(doc(db, "users", cred.user.uid), {
      email: trimEmail,
      displayName: displayName?.trim() ?? null,
      phoneNumber: options?.phoneNumber ?? null,
      phoneVerified: !!options?.phoneCredential,
      language: options?.locale ?? null,
      termsAcceptedAt: serverTimestamp(),
      privacyAcceptedAt: serverTimestamp(),
      termsVersion: CONSENT_TERMS_VERSION,
      privacyVersion: CONSENT_PRIVACY_VERSION,
      consentSource: "signup",
      subscription: {
        tier: "FREE",
        status: "active",
        updatedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  
    // Note: Subscription initialization happens here for FREE tier.
    // For paid subscriptions, Stripe webhook will update this field (server-side only).
    const token = await cred.user.getIdToken();
    return { user, token };
  } catch (error) {
    try {
      await deleteUser(cred.user);
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}

export async function login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const trimEmail = email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth, trimEmail, password);
  const user = toAuthUser(cred.user);
  const token = await cred.user.getIdToken();
  return { user, token };
}

export async function logout(): Promise<void> {
  await signOut(auth);
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
  };
  return m[code] ?? "Chyba prihlásenia. Skúste znova.";
}
