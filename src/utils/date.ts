/**
 * Date utilities for Staveto - avoid timezone bugs by using local date parts.
 * NEVER use toISOString() for date-only comparisons (causes UTC shift).
 */

/** Convert Date to "YYYY-MM-DD" using local date parts (no timezone shift) */
export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Get first day of month as YYYY-MM-DD */
export function getMonthStartYmd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Get last day of month as YYYY-MM-DD */
export function getMonthEndYmd(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" to Date at local midnight (no timezone shift) */
export function ymdToDate(ymd: string): Date | null {
  if (!ymd || typeof ymd !== "string") return null;
  const parts = ymd.trim().split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

/**
 * Normalize due date (string | Date | Firestore Timestamp) to "YYYY-MM-DD" or null.
 * Uses local date parts - no timezone shift.
 */
export function normalizeDueDateToYmd(
  due: string | Date | { toDate?: () => Date } | null | undefined
): string | null {
  if (due == null) return null;
  if (typeof due === "string") {
    const trimmed = due.trim();
    if (!trimmed) return null;
    // Already YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    // Parse ISO or other format - use local date parts
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return toYmd(d);
  }
  if (due instanceof Date) {
    if (isNaN(due.getTime())) return null;
    return toYmd(due);
  }
  if (typeof due === "object" && typeof (due as { toDate?: () => Date }).toDate === "function") {
    const d = (due as { toDate: () => Date }).toDate();
    if (isNaN(d.getTime())) return null;
    return toYmd(d);
  }
  // Plain { seconds, nanoseconds } (serialized Timestamp) — avoid relying on instanceof
  if (typeof due === "object" && due !== null) {
    const o = due as { seconds?: unknown; nanoseconds?: unknown };
    if (typeof o.seconds === "number") {
      const nanos = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
      const d = new Date(o.seconds * 1000 + nanos / 1e6);
      if (isNaN(d.getTime())) return null;
      return toYmd(d);
    }
  }
  return null;
}

/**
 * Convert Firestore Timestamp-like values to ISO strings without `instanceof Timestamp`.
 * RN Firebase re-exports Timestamp as a Proxy; using `instanceof` with it can throw on Hermes
 * ("Cannot convert undefined value to object").
 */
export function firestoreValueToIsoString(ts: unknown): string | undefined {
  if (ts == null || ts === "") return undefined;
  try {
    if (typeof ts === "string") return ts;
    if (ts instanceof Date) {
      return isNaN(ts.getTime()) ? undefined : ts.toISOString();
    }
    if (typeof ts === "object" && ts !== null) {
      const o = ts as Record<string, unknown>;
      if (typeof o.toDate === "function") {
        const d = (o.toDate as () => Date)();
        if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
      }
      const sec = o.seconds;
      if (typeof sec === "number") {
        const nanos = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
        const d = new Date(sec * 1000 + nanos / 1e6);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
