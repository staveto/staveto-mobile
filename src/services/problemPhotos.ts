import { getStorage, auth } from "../firebase";
import { compressImageForUpload } from "../utils/imageCompress";
import type { ProblemPhoto } from "./problems";

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

async function resolveFileSize(localUri: string): Promise<number> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(localUri, { size: true });
    if (info.exists && "size" in info && typeof info.size === "number" && info.size > 0) {
      return info.size;
    }
  } catch {
    /* fall through to fetch */
  }

  const response = await fetch(localUri);
  if (!response.ok) {
    throw new Error(`Nepodarilo sa načítať fotku (${response.status}).`);
  }
  const blob = await response.blob();
  return blob.size;
}

/**
 * Upload a photo for a problem to Storage.
 * Path: projects/{projectId}/problems/{problemId}/{filename}
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

  const mimeType = options?.mimeType ?? "image/jpeg";
  const baseName = options?.fileName ?? `photo_${Date.now()}.jpg`;

  let uploadUri = localUri;
  let uploadMime = mimeType;
  let uploadFileName = baseName;

  try {
    const prepared = await compressImageForUpload(localUri, baseName, mimeType);
    uploadUri = prepared.uri;
    uploadMime = prepared.mimeType;
    uploadFileName = prepared.fileName;
  } catch (e) {
    if (__DEV__) console.warn("[problemPhotos] compress failed, using original:", e);
  }

  const fileSize = await resolveFileSize(uploadUri);
  if (fileSize > MAX_SIZE_BYTES) {
    throw new Error("Súbor je príliš veľký. Maximálna veľkosť je 15 MB.");
  }

  const storagePath = `projects/${projectId}/problems/${problemId}/${uploadFileName}`;
  const storageInstance = getStorage();
  if (!storageInstance) throw new Error("Firebase Storage nie je dostupný.");
  const storageRef = storageInstance.ref(storagePath);

  try {
    await storageRef.putFile(uploadUri, { contentType: uploadMime });
    const downloadURL = await storageRef.getDownloadURL();
    if (__DEV__) {
      console.log(`[problemPhotos] Uploaded: ${storagePath}`);
    }
    return {
      path: storagePath,
      downloadURL,
    };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const code = String(err?.code ?? "").toLowerCase();
    const msg = err?.message ?? "";
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
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const code = String(err?.code ?? "").toLowerCase();
    const msg = err?.message ?? "";
    console.error(`[problemPhotos] getDownloadURL error:`, { code, msg, path: storagePath });
    if (code === "storage/unauthorized" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    throw error;
  }
}
