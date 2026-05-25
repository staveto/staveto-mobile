/**
 * Feature flags for opt-in functionality (Staveto Business, etc.).
 *
 * Source of truth is `Constants.expoConfig.extra` (populated from EAS / .env via
 * `app.config.js`). Defaults are intentionally OFF so production builds stay on
 * the existing B2C surface unless the env var is explicitly set.
 *
 * Do NOT use these flags to gate destructive actions on the server — clients can
 * fake them. Server-side gating must always re-check via Firestore rules /
 * Cloud Function logic.
 */

import { getExtraEnv } from "./env";
import { getAuth } from "../firebase";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function readBoolFlag(key: string): boolean {
  const raw = getExtraEnv(key);
  if (!raw) return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Master switch for Staveto Business surface (drawer entry, gate, screens).
 * Default OFF. Set `EXPO_PUBLIC_BUSINESS_ENABLED=1` in `.env` / EAS to enable.
 *
 * Even when this flag is OFF, a user who has an active org membership will be
 * shown the Business entry by the drawer logic (added in a later phase). The
 * flag exists for dev/demo machines where no org membership exists yet.
 */
export function isBusinessFeatureEnabled(): boolean {
  return readBoolFlag("EXPO_PUBLIC_BUSINESS_ENABLED");
}

/**
 * Admin email whitelist parsed from `EXPO_PUBLIC_ADMIN_EMAILS` (comma-separated).
 * Used by the admin screens (later phase) as a defense-in-depth check on top of
 * the server-side custom claim `admin: true`.
 *
 * Production EAS: set `EXPO_PUBLIC_ADMIN_EMAILS` to the exact Firebase Auth email(s)
 * (comma-separated). Values are baked into the app at build time via `app.config.js`
 * `extra`; changing them requires a new production build.
 *
 * Returned emails are trimmed and lowercased. Empty / missing env yields `[]`.
 */
export function getAdminEmails(): string[] {
  const raw = getExtraEnv("EXPO_PUBLIC_ADMIN_EMAILS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Convenience helper: is the given email (case-insensitive) in the admin whitelist?
 * Returns false when whitelist is empty or email is falsy.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = getAdminEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

function hasFirebaseAdminClaim(claims: Record<string, unknown> | undefined): boolean {
  return claims?.admin === true;
}

/** Firebase custom claim `admin: true` (platform admin, not org owner). */
export async function readFirebaseAdminClaim(): Promise<boolean> {
  const auth = getAuth();
  const fbUser = auth?.currentUser;
  if (!fbUser) return false;
  try {
    const token = await fbUser.getIdTokenResult();
    return hasFirebaseAdminClaim(token.claims as Record<string, unknown>);
  } catch {
    return false;
  }
}

/**
 * Drawer / client UI: show Admin when email is whitelisted OR Firebase custom claim admin=true.
 * Does not use Business org role. Server-side checks remain authoritative.
 */
export async function resolveAdminMenuEnabled(
  email: string | null | undefined
): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  return readFirebaseAdminClaim();
}
