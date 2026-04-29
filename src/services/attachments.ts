import { collection, addDoc, query, where, getDocs, deleteDoc, doc, orderBy, serverTimestamp, Timestamp, getDoc, updateDoc } from "../lib/rnFirestore";
import { getStorage, db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { AttachmentMetadata, AttachmentKind } from "../lib/attachmentTypes";
import { addProjectEvent } from "./projectEvents";
import { compressImageForUpload } from "../utils/imageCompress";

export type AttachmentDoc = AttachmentMetadata;

/** True when attachment is tied to an expense (receipt scan) — excluded from project photo highlights. */
export function attachmentLinkedToExpense(att: Pick<AttachmentDoc, "expenseId">): boolean {
  return typeof att.expenseId === "string" && att.expenseId.trim().length > 0;
}

/** Task/diary/site photos — not receipt images from expenses. */
export function attachmentsForProjectPhotoGallery(atts: AttachmentDoc[]): AttachmentDoc[] {
  return atts.filter((a) => a.fileType === "image" && !attachmentLinkedToExpense(a));
}

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): AttachmentDoc | null {
  let d: Record<string, unknown>;
  try {
    const raw = docSnap.data();
    if (raw == null || typeof raw !== "object") {
      if (__DEV__) console.warn(`[attachments] toDoc: missing or invalid data for doc ${docSnap.id}`);
      return null;
    }
    d = raw as Record<string, unknown>;
  } catch (e) {
    if (__DEV__) console.warn(`[attachments] toDoc: data() failed for ${docSnap.id}`, e);
    return null;
  }

  const convertTimestamp = (ts: unknown): string | undefined => {
    try {
      if (ts == null) return undefined;
      if (ts instanceof Timestamp) return ts.toDate().toISOString();
      if (typeof ts === "string") return ts;
      if (typeof ts === "object" && ts !== null && typeof (ts as { toDate?: unknown }).toDate === "function") {
        return (ts as { toDate: () => Date }).toDate().toISOString();
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  try {
    return {
      id: docSnap.id,
      projectId: (d.projectId as string) ?? "",
      taskId: (d.taskId as string | null) ?? undefined,
      phaseId: (d.phaseId as string | null) ?? undefined,
      expenseId: (d.expenseId as string | null) ?? undefined,
      fileName: (d.fileName as string) ?? "",
      fileType: (d.fileType as AttachmentKind) ?? "other",
      contentType: (d.contentType as string) ?? undefined,
      size: typeof d.size === "number" ? d.size : undefined,
      storagePath: (d.storagePath as string) ?? "",
      uploadedBy: (d.uploadedBy as string) ?? "",
      createdAt: convertTimestamp(d.createdAt) ?? new Date().toISOString(),
      updatedAt: convertTimestamp(d.updatedAt),
      downloadURL: (d.downloadURL as string) ?? undefined,
    } as AttachmentDoc & { downloadURL?: string };
  } catch (e) {
    if (__DEV__) console.warn(`[attachments] toDoc: serialize failed for ${docSnap.id}`, e);
    return null;
  }
}

/**
 * Upload attachment to Firebase Storage and create metadata in Firestore
 */
export async function uploadAttachment(
  projectId: string,
  options: {
    taskId?: string | null;
    phaseId?: string | null;
    expenseId?: string | null;
    localUri: string;
    fileName: string;
    mimeType: string;
    kind: AttachmentKind;
  }
): Promise<AttachmentDoc> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na nahrávanie prílohy.');
  }

  // Verify project exists before upload (Storage rules enforce owner/editor write permission)
  try {
    const projectRef = doc(db, 'projects', projectId);
    const projectSnap = await getDoc(projectRef);
    if (!projectSnap.exists()) {
      throw new Error(`Projekt ${projectId} neexistuje v Firestore.`);
    }
    if (__DEV__) {
      console.log(`[attachments] Upload: projectId=${projectId}, uid=${currentUser.uid}`);
    }
  } catch (error: any) {
    console.error(`[attachments] Project verification error:`, error);
    throw error;
  }

  let uploadUri = options.localUri;
  let uploadMime = options.mimeType;
  let uploadFileName = options.fileName;

  if (options.kind === "image") {
    try {
      const prepared = await compressImageForUpload(options.localUri, options.fileName, options.mimeType);
      uploadUri = prepared.uri;
      uploadMime = prepared.mimeType;
      uploadFileName = prepared.fileName;
    } catch (e) {
      console.warn("[attachments] Image compress failed, uploading original:", e);
    }
  }

  // Read file as blob (post-compression size when applicable)
  const response = await fetch(uploadUri);
  const blob = await response.blob();
  const fileSize = blob.size;

  // Generate attachment ID
  const attachmentId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // Storage path: projects/{projectId}/attachments/{attachmentId}/{fileName}
  const storagePath = `projects/${projectId}/attachments/${attachmentId}/${uploadFileName}`;
  const storageInstance = getStorage();
  if (!storageInstance) throw new Error('Firebase Storage nie je dostupný.');
  const storageRef = storageInstance.ref(storagePath);

  // Upload to Storage
  console.log(`[attachments] Uploading to Storage: ${storagePath}`);
  console.log(`[attachments] Current user: ${currentUser.uid}`);
  console.log(`[attachments] Project ID: ${projectId}`);
  console.log(`[attachments] File size: ${(fileSize / 1024).toFixed(2)} KB`);
  
  try {
    await storageRef.putFile(uploadUri, { contentType: uploadMime });
    console.log(`[attachments] ✅ Upload successful: ${storagePath}`);
  } catch (error: any) {
    const code = String(error?.code ?? "").toLowerCase();
    const msg = error?.message ?? "";
    console.error(`[attachments] Storage upload error:`, { code, msg, projectId, uid: currentUser.uid });
    if (code === "storage/unauthorized" || code === "storage/canceled" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    throw new Error(`Nepodarilo sa nahrať súbor: ${msg || code || "Neznáma chyba"}`);
  }
  const finalFilePath = storageRef.fullPath || storagePath;
  console.log(`[attachments] Final uploaded filePath: ${finalFilePath}`);
  
  // Get download URL
  const downloadURL = await storageRef.getDownloadURL();
  console.log(`[attachments] Uploaded, download URL: ${downloadURL}`);

  // Create Firestore metadata
  const c = collection(db, paths.projectAttachments(projectId));
  const refDoc = await addDoc(c, {
    projectId,
    taskId: options.taskId ?? null,
    phaseId: options.phaseId ?? null,
    expenseId: options.expenseId ?? null,
    fileName: uploadFileName,
    fileType: options.kind,
    contentType: uploadMime,
    mimeType: uploadMime,
    size: fileSize,
    storagePath: finalFilePath,
    filePath: finalFilePath,
    uploadStatus: "uploaded",
    ocrStatus: options.kind === "image" || options.kind === "pdf" ? "pending" : null,
    downloadURL, // Store URL for quick access
    uploadedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  console.log(`[attachments] Created metadata doc: ${refDoc.id}`);

  try {
    const eventType = uploadMime?.startsWith("image/") ? "photo_added" : "document_added";
    await addProjectEvent(
      projectId,
      eventType,
      { fileName: uploadFileName },
      { kind: "attachment", id: refDoc.id }
    );
  } catch (error) {
    console.warn("[attachments] Failed to create project event:", error);
  }

  return {
    id: refDoc.id,
    projectId,
    taskId: options.taskId,
    phaseId: options.phaseId,
    expenseId: options.expenseId,
    fileName: uploadFileName,
    fileType: options.kind,
    contentType: uploadMime,
    size: fileSize,
    storagePath: finalFilePath,
    uploadedBy: currentUser.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    downloadURL,
  } as AttachmentDoc & { downloadURL?: string };
}

/**
 * Get a single attachment by ID.
 */
export async function getAttachment(
  projectId: string,
  attachmentId: string
): Promise<AttachmentDoc | null> {
  const refDoc = doc(db, paths.projectAttachment(projectId, attachmentId));
  const snap = await getDoc(refDoc);
  if (!snap.exists()) return null;
  const parsed = toDoc({ id: snap.id, data: snap.data.bind(snap) });
  return parsed;
}

/**
 * List attachments for a project, optionally filtered by taskId, expenseId, or phaseId
 */
export async function listAttachments(
  projectId: string,
  filters?: {
    taskId?: string;
    expenseId?: string;
    phaseId?: string;
  }
): Promise<AttachmentDoc[]> {
  const c = collection(db, paths.projectAttachments(projectId));
  
  // Build query: if we have filters, use where() without orderBy to avoid composite index requirement
  // Then sort in JavaScript. If no filters, use orderBy directly.
  let q;
  
  if (filters?.taskId) {
    q = query(c, where("taskId", "==", filters.taskId));
  } else if (filters?.expenseId) {
    q = query(c, where("expenseId", "==", filters.expenseId));
  } else if (filters?.phaseId) {
    q = query(c, where("phaseId", "==", filters.phaseId));
  } else {
    // No filters: can use orderBy directly (no composite index needed)
    q = query(c, orderBy("createdAt", "desc"));
  }

  const snap = await getDocs(q);
  const attachments = snap.docs
    .map((d) => {
      try {
        return toDoc({ id: d.id, data: d.data.bind(d) });
      } catch (e) {
        if (__DEV__) console.warn(`[attachments] listAttachments: skip doc ${d.id}`, e);
        return null;
      }
    })
    .filter((x): x is AttachmentDoc => x != null);
  
  // Sort by createdAt descending if we used filters (to avoid composite index)
  if (filters?.taskId || filters?.expenseId || filters?.phaseId) {
    attachments.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA; // Descending order
    });
  }
  
  return attachments;
}

/**
 * Get download URL for an attachment.
 * Storage rules: read allowed for owner or member with tasks/expenses/documents permission.
 */
export async function getAttachmentURL(attachment: AttachmentDoc): Promise<string> {
  try {
    const storageInstance = getStorage();
    if (!storageInstance) throw new Error('Firebase Storage nie je dostupný.');
    const storageRef = storageInstance.ref(attachment.storagePath);
    return await storageRef.getDownloadURL();
  } catch (error: any) {
    const code = String(error?.code ?? "").toLowerCase();
    const msg = error?.message ?? "";
    console.error(`[attachments] getDownloadURL error:`, { code, msg, path: attachment.storagePath });
    if (code === "storage/unauthorized" || msg.includes("permission-denied")) {
      throw new Error("permission-denied");
    }
    throw error;
  }
}

/**
 * Delete attachment (both Storage file and Firestore metadata)
 */
export async function deleteAttachment(
  projectId: string,
  attachmentId: string,
  storagePath: string
): Promise<void> {
  // Delete from Storage
  try {
    const storageInstance = getStorage();
    if (storageInstance) {
      const storageRef = storageInstance.ref(storagePath);
      await storageRef.delete();
      console.log(`[attachments] Deleted from Storage: ${storagePath}`);
    }
  } catch (error: any) {
    console.warn(`[attachments] Error deleting from Storage (may not exist):`, error);
    // Continue to delete Firestore doc even if Storage delete fails
  }

  // Delete Firestore metadata
  const refDoc = doc(db, paths.projectAttachment(projectId, attachmentId));
  await deleteDoc(refDoc);
  console.log(`[attachments] Deleted metadata doc: ${attachmentId}`);
}

/**
 * Link existing attachment to an expense (used when attachment is uploaded before expense creation).
 */
export async function linkAttachmentToExpense(
  projectId: string,
  attachmentId: string,
  expenseId: string
): Promise<void> {
  const refDoc = doc(db, paths.projectAttachment(projectId, attachmentId));
  await updateDoc(refDoc, {
    expenseId,
    updatedAt: serverTimestamp(),
  });
  console.log(`[attachments] Linked attachment ${attachmentId} -> expense ${expenseId}`);
}
