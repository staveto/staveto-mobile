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
