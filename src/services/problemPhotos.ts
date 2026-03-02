import { getStorage, auth } from "../firebase";
import type { ProblemPhoto } from "./problems";

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Upload a photo for a problem to Storage.
 * Path: projects/{projectId}/problems/{problemId}/{filename}
 * Storage rules: owner or editor can write; max 15MB.
 */
export async function uploadProblemPhoto(
  projectId: string,
  problemId: string,
  localUri: string,
  options?: { fileName?: string; mimeType?: string }
): Promise<ProblemPhoto> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na nahrávanie fotky.");
  }

  const response = await fetch(localUri);
  const blob = await response.blob();
  const fileSize = blob.size;

  if (fileSize > MAX_SIZE_BYTES) {
    throw new Error(`Súbor je príliš veľký. Maximálna veľkosť je 15 MB.`);
  }

  const ext = options?.fileName?.split(".").pop() ?? "jpg";
  const fileName = options?.fileName ?? `photo_${Date.now()}.${ext}`;
  const mimeType = options?.mimeType ?? "image/jpeg";

  const storagePath = `projects/${projectId}/problems/${problemId}/${fileName}`;
  const storageInstance = getStorage();
  if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
  const storageRef = storageInstance.ref(storagePath);

  try {
    await storageRef.putFile(localUri, { contentType: mimeType });
    const downloadURL = await storageRef.getDownloadURL();
    if (__DEV__) {
      console.log(`[problemPhotos] Uploaded: ${storagePath}`);
    }
    return {
      path: storagePath,
      downloadURL,
    };
  } catch (error: any) {
    const code = String(error?.code ?? "").toLowerCase();
    const msg = error?.message ?? "";
    console.error(`[problemPhotos] Upload error:`, { code, msg, projectId, problemId });
    if (code === "storage/unauthorized" || code === "storage/canceled" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    throw new Error(`Nepodarilo sa nahrať fotku: ${msg || code || "Neznáma chyba"}`);
  }
}

/**
 * Get download URL for a problem photo.
 */
export async function getProblemPhotoURL(storagePath: string): Promise<string> {
  try {
    const storageInstance = getStorage();
    if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
    const storageRef = storageInstance.ref(storagePath);
    return await storageRef.getDownloadURL();
  } catch (error: any) {
    const code = String(error?.code ?? "").toLowerCase();
    const msg = error?.message ?? "";
    console.error(`[problemPhotos] getDownloadURL error:`, { code, msg, path: storagePath });
    if (code === "storage/unauthorized" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    throw error;
  }
}
