/**
 * Coerce Firestore `DocumentSnapshot.data()` / `QueryDocumentSnapshot.data()` to a plain map.
 * Prevents downstream crashes when `data()` is missing, non-object, or callers use `Object.keys` / `in` unsafely.
 */
export function safeFirestoreDocData(raw: unknown, context?: string): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    if (__DEV__ && context) {
      console.warn(`[safeFirestoreDocData] ${context}: data() was null or undefined — using {}`);
    }
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    if (__DEV__ && context) {
      console.warn(`[safeFirestoreDocData] ${context}: expected plain object, got ${typeof raw}`);
    }
    return {};
  }
  return raw as Record<string, unknown>;
}

const PLAIN_MAX_DEPTH = 14;
const PLAIN_MAX_ARRAY = 400;
const PLAIN_MAX_STRING = 16_000;

function plainFirestoreValue(value: unknown, depth: number): unknown {
  if (depth > PLAIN_MAX_DEPTH) return null;
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > PLAIN_MAX_STRING ? value.slice(0, PLAIN_MAX_STRING) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object") {
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      try {
        const d = (value as { toDate: () => Date }).toDate();
        return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      return value.slice(0, PLAIN_MAX_ARRAY).map((item) => plainFirestoreValue(item, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = plainFirestoreValue(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Eager plain copy — avoids RNFB lazy field access hanging sync parse loops. */
export function plainFirestoreDocData(raw: unknown, context?: string): Record<string, unknown> {
  const base = safeFirestoreDocData(raw, context);
  return plainFirestoreValue(base, 0) as Record<string, unknown>;
}
