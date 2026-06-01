/**
 * Persist New Job AI flow attachments into project Documents (not temporary AI draft storage).
 */
import type { AttachmentKind } from "../lib/attachmentTypes";
import * as attachmentsService from "./attachments";
import * as projectDocumentsService from "./projectDocuments";

export type NewJobAttachmentInput = {
  localUri: string;
  fileName: string;
  mimeType: string;
};

const NEW_JOB_ATTACHMENT_DESC = "new_job_attachment";

function attachmentKindFromMime(mimeType: string): AttachmentKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  return "document";
}

function documentTypeFromMime(mimeType: string): "plan" | "permit" | "contract" | "report" | "other" {
  const m = mimeType.toLowerCase();
  if (m === "application/pdf") return "plan";
  if (m.startsWith("image/")) return "other";
  return "other";
}

/**
 * Upload each local file into project attachments + create ProjectDocument records.
 * Requires localUri still available on device (CreateProjectAIFlow keeps it after AI draft upload).
 */
export async function saveNewJobAttachmentsToProjectDocuments(
  ownerId: string,
  projectId: string,
  attachments: NewJobAttachmentInput[]
): Promise<number> {
  if (attachments.length === 0) return 0;

  let saved = 0;
  for (const att of attachments) {
    if (!att.localUri?.trim()) {
      if (__DEV__) console.warn("[newJobProjectDocuments] skip attachment without localUri:", att.fileName);
      continue;
    }
    const kind = attachmentKindFromMime(att.mimeType);
    const uploaded = await attachmentsService.uploadAttachment(projectId, {
      localUri: att.localUri,
      fileName: att.fileName,
      mimeType: att.mimeType,
      kind,
    });
    await projectDocumentsService.createProjectDocument(ownerId, projectId, {
      name: att.fileName,
      type: documentTypeFromMime(att.mimeType),
      description: NEW_JOB_ATTACHMENT_DESC,
      attachmentId: uploaded.id,
    });
    saved += 1;
  }
  return saved;
}
