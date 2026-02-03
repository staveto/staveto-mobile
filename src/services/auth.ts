import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
  UserCredential,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

export type AuthUser = { id: string; email: string; name?: string };

function toAuthUser(u: User): AuthUser {
  return {
    id: u.uid,
    email: u.email ?? "",
    name: u.displayName ?? undefined,
  };
}

export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: AuthUser; token: string }> {
  const trimEmail = email.trim().toLowerCase();
  const cred: UserCredential = await createUserWithEmailAndPassword(auth, trimEmail, password);
  if (displayName?.trim()) {
    await updateProfile(cred.user, { displayName: displayName.trim() });
  }
  const user = toAuthUser(cred.user);
  await setDoc(doc(db, "users", cred.user.uid), {
    email: trimEmail,
    displayName: displayName?.trim() ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const token = await cred.user.getIdToken();
  return { user, token };
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
