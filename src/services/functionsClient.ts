/**
 * Firebase Functions client with configurable timeout.
 * getCallable in firebase.ts already wraps all calls with 6s timeout.
 * Use getCallableWithTimeout here when a different timeout is needed.
 */

import { getCallable as getCallableOrig } from "../firebase";
import { withTimeout, isTimeoutOrOfflineError } from "../utils/withTimeout";

const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Get a callable function with custom timeout.
 * Use when default 6s is not appropriate (e.g. long-running OCR).
 */
export function getCallableWithTimeout<T = unknown, R = unknown>(
  name: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const fn = getCallableOrig<T, R>(name);
  return async (data: T) => {
    try {
      return await withTimeout(fn(data), timeoutMs, name);
    } catch (err) {
      if (isTimeoutOrOfflineError(err)) {
        const friendly = new Error(
          "Slabé pripojenie alebo žiadny internet. Skúste znova neskôr."
        ) as Error & { code?: string };
        friendly.code = "NETWORK_ERROR";
        (friendly as any).cause = err;
        throw friendly;
      }
      throw err;
    }
  };
}
