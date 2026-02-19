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
  return null;
}
