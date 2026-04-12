/**
 * Layer A — document pipeline entry after the file is in Firebase Storage.
 * Upload + metadata remain in `attachmentsService` / screens; this module runs extraction only.
 */

import type { OcrResult } from "../lib/ocrTypes";
import { extractInvoiceData } from "./invoiceOCR";

export type ProcessExpenseDocumentInput = {
  projectId: string;
  attachmentId: string;
  filePath: string;
  mimeType: string;
  /** Local `file://` PDF URI for on-device text extraction when available */
  localPdfUri?: string;
};

/**
 * Runs the full extraction + semantic mapping pipeline for an expense attachment.
 * Non-blocking contract: callers catch errors; `OcrResult.status !== "success"` is normal.
 */
export async function processExpenseDocumentAttachment(
  input: ProcessExpenseDocumentInput
): Promise<OcrResult> {
  const path = input.filePath?.trim();
  if (!path) {
    return { status: "failed", parsed: null, errorCode: "EMPTY_FILE_PATH" };
  }
  if (__DEV__) {
    console.log("[documentProcessing] processExpenseDocumentAttachment", {
      projectId: input.projectId,
      attachmentId: input.attachmentId,
      mimeType: input.mimeType,
      filePathLen: path.length,
      hasLocalPdf: !!input.localPdfUri,
    });
  }
  return extractInvoiceData({
    filePath: path,
    mimeType: input.mimeType,
    attachmentId: input.attachmentId,
    projectId: input.projectId,
    localPdfUri: input.localPdfUri,
  });
}

/** @deprecated Use `processExpenseDocumentAttachment` for new code */
export { extractInvoiceData as processInvoiceAttachment } from "./invoiceOCR";
