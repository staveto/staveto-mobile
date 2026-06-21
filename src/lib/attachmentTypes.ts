/**
 * Attachment types and metadata structure
 * 
 * All attachments are stored in: projects/{projectId}/attachments/{attachmentId}
 * Metadata links attachments to entities via optional fields: taskId, phaseId, expenseId
 */

export type AttachmentKind = 'image' | 'document' | 'pdf' | 'audio' | 'invoice' | 'other' | 'work_photo';

export type WorkPhotoType =
  | 'progress'
  | 'done'
  | 'problem'
  | 'material'
  | 'before'
  | 'after';

export type WorkPhotoLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export interface AttachmentMetadata {
  id: string;
  projectId: string;
  // Optional links to entities
  taskId?: string | null;
  phaseId?: string | null;
  expenseId?: string | null;
  // File info
  fileName: string;
  fileType: AttachmentKind;
  contentType?: string;
  size?: number; // bytes
  storagePath: string; // Full path in Firebase Storage
  // Metadata
  uploadedBy: string; // User UID
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string
  /** Work photo fields (optional — legacy attachments omit these). */
  kind?: 'work_photo' | string;
  photoType?: WorkPhotoType;
  comment?: string;
  source?: string;
  uploadedByName?: string;
  orgId?: string;
  location?: WorkPhotoLocation;
  timeEntryId?: string;
  workSessionId?: string;
}
