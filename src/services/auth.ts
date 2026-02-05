export type AuthUser = { id: string; email: string; name?: string };

export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: AuthUser; token: string }> {
  throw new Error("Auth disabled in Expo Go. Use dev build.");
}

export async function login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  throw new Error("Auth disabled in Expo Go. Use dev build.");
}

export async function logout(): Promise<void> {
  throw new Error("Auth disabled in Expo Go. Use dev build.");
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
