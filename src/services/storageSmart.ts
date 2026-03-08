/**
 * Storage smart helpers – skip download URL fetch when offline/poor network
 * to avoid long hangs. Use placeholders in lists; fetch on detail or when online.
 */
import { getStorage } from "../firebase";

export type OnlineStatus = {
  isOffline: boolean;
  isPoorNetwork: boolean;
};

/**
 * Get download URL for a Storage path.
 * When offline or poor network: returns null immediately (no network call).
 * When online: fetches URL from Firebase Storage.
 */
export async function getDownloadUrlSmart(
  path: string,
  onlineStatus: OnlineStatus
): Promise<string | null> {
  if (onlineStatus.isOffline || onlineStatus.isPoorNetwork) {
    if (__DEV__) {
      console.log("[storageSmart] Skipping fetch (offline/poor):", path);
    }
    return null;
  }

  try {
    const storageInstance = getStorage();
    if (!storageInstance) return null;
    const storageRef = storageInstance.ref(path);
    return await storageRef.getDownloadURL();
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const code = String(err?.code ?? "").toLowerCase();
    const msg = err?.message ?? "";
    if (__DEV__) {
      console.warn("[storageSmart] getDownloadURL error:", { code, msg, path });
    }
    if (code === "storage/unauthorized" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    return null;
  }
}
