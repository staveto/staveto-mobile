/**
 * Pure helpers for iOS diagnostic env parsing (no React Native deps).
 * Used by iosDiagnostic.ts and unit tests.
 */

/** Parses raw env string: true only for "1", "true", "yes", "on" (case-insensitive). */
export function isDiagnosticOnValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
