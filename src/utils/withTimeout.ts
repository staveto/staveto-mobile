/**
 * Wraps a promise with a timeout. Rejects with a TIMEOUT error if the promise
 * does not resolve within ms milliseconds.
 * Use for Firebase Functions and other network calls to fail fast on weak/no connection.
 */
export const TIMEOUT_ERROR_CODE = "TIMEOUT";

export class TimeoutError extends Error {
  public readonly code = TIMEOUT_ERROR_CODE;

  constructor(
    message: string,
    public readonly label?: string,
    public readonly timeoutMs?: number
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Wraps a promise with a timeout.
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds (default 6000)
 * @param label - Optional label for error context (e.g. "extractInvoiceData")
 * @returns The result of the promise if it resolves in time
 * @throws TimeoutError if the promise does not resolve within ms
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 6000,
  label?: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new TimeoutError(
          `Operation timed out after ${ms}ms${label ? ` (${label})` : ""}`,
          label,
          ms
        )
      );
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}

/**
 * Check if an error is a timeout or network-related (for user-friendly messages).
 */
export function isTimeoutOrOfflineError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? "";
  return (
    code === TIMEOUT_ERROR_CODE ||
    msg.toLowerCase().includes("timeout") ||
    msg.toLowerCase().includes("network") ||
    msg.toLowerCase().includes("unavailable") ||
    msg.toLowerCase().includes("failed to fetch")
  );
}
