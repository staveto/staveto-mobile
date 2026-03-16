/**
 * Analytics service – production-safe GA4 event logging via Firebase Analytics.
 * Strips PII, truncates values, limits params. Never throws.
 * In Expo Go (no native Firebase): no-ops silently.
 */

import { isFirebaseAvailable } from "../lib/firebaseAvailable";

function getAnalytics(): ReturnType<typeof import("@react-native-firebase/analytics")["default"]> | null {
  if (!isFirebaseAvailable()) return null;
  try {
    return require("@react-native-firebase/analytics").default();
  } catch {
    return null;
  }
}

const MAX_PARAMS = 10;
const MAX_STRING_LENGTH = 80;

/** Keys that look like PII – never send raw values. */
const PII_KEYS = new Set(
  ["email", "token", "password", "passwordHash", "authToken", "accessToken", "refreshToken", "apiKey", "secret"].map(
    (k) => k.toLowerCase()
  )
);

function isPiiKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (PII_KEYS.has(lower)) return true;
  if (lower.includes("email") || lower.includes("token") || lower.includes("password")) return true;
  return false;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(sanitizeValue); // limit array size
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (count >= MAX_PARAMS) break;
      if (!isPiiKey(k)) {
        out[k] = sanitizeValue(v);
        count++;
      }
    }
    return out;
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

function sanitizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(params)) {
    if (count >= MAX_PARAMS) break;
    if (isPiiKey(k)) continue;
    out[k] = sanitizeValue(v);
    count++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Log custom event to GA4. Safe: strips PII, truncates strings, limits params. Never throws.
 * @param name – event name (e.g. paywall_opened)
 * @param params – optional params (max 10, no PII, strings truncated to 80 chars)
 */
export function logEventSafe(name: string, params?: Record<string, unknown>): void {
  try {
    const a = getAnalytics();
    if (!a) return;
    const safe = sanitizeParams(params);
    if (safe) {
      a.logEvent(name, safe);
    } else {
      a.logEvent(name);
    }
  } catch (e) {
    if (__DEV__) console.warn("[analytics] logEvent failed:", name, e);
  }
}

/**
 * Log screen view to GA4. Never throws.
 * @param screenName – screen name for logScreenView
 */
export function logScreenSafe(screenName: string): void {
  try {
    const a = getAnalytics();
    if (!a) return;
    const safe = screenName?.slice(0, MAX_STRING_LENGTH) || "unknown";
    a.logScreenView({ screen_name: safe, screen_class: safe });
  } catch (e) {
    if (__DEV__) console.warn("[analytics] logScreenView failed:", screenName, e);
  }
}

// ─── Subscription funnel events (MVP) ───────────────────────────────────────
// paywall_opened: user saw paywall
// paywall_offerings_loaded: RevenueCat offerings fetched successfully
// paywall_offerings_failed: offerings fetch failed
// plan_selected: user selected a plan (e.g. monthly)
// purchase_tap: user tapped purchase CTA
// purchase_started: RevenueCat purchase call invoked
// purchase_success: purchase completed, entitlement active
// purchase_failed: purchase failed or cancelled

export type PurchaseFailureReason = "cancelled" | "store_error" | "network" | "not_allowed" | "unknown";

// ─── Usage events (optional, central place) ───────────────────────────────────
// project_create_success: project created successfully
// task_create_success: task created successfully
// task_complete: task marked as done

export function logProjectCreateSuccess(projectType: string, source = "projects"): void {
  logEventSafe("project_create_success", { projectType, source });
}

export function logTaskCreateSuccess(source = "project_overview"): void {
  logEventSafe("task_create_success", { source });
}

export function logTaskComplete(source = "task_detail"): void {
  logEventSafe("task_complete", { source });
}
