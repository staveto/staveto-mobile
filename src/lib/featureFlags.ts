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
