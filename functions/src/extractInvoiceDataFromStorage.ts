/**
 * PDF / image text extraction for invoice attachments.
 *
 * **This file has never contained a STUB / mock `rawText` string.** If your client still
 * receives `STUB Faktúra…`, you are not running this revision: redeploy the function, and
 * remove `EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL` if it points at a dev/mock server
 * (see mobile `src/services/ocr.ts`).
 */
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import vision from "@google-cloud/vision";
import { isPlaceholderOrMockOcrText } from "./ocrPlaceholderGuards";

if (!admin.apps.length) {
  admin.initializeApp();
}

/** Bump when extraction logic changes — compare with client `extractionLog.fnImplVersion`. */
const FN_IMPL_VERSION = "extractInvoiceDataFromStorage-async-pdf-v3-success-guard";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type ExtractPayload = {
  projectId?: string;
  attachmentId?: string;
  filePath?: string;
  mimeType?: string;
};

type ExtractionLog = {
  fnImplVersion: string;
  cloudRevision: string | null;
  downloadedBytes: number;
  mimeType: string;
  pathSuffix: string;
  pdfTextLayerChars: number;
  pdfTextLayerAttempted: boolean;
  visionAttempted: boolean;
  visionProvider: "none" | "vision-async-batch-pdf";
  visionAsyncCompleted?: boolean;
  visionOutputJsonCount?: number;
  visionError?: string;
  finalCharCount: number;
  usedPlaceholderGuard: boolean;
  /** Always false — this implementation has no mock OCR branch. */
  fallbackMockPath: false;
  previewHead: string;
};

async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text?: string }>;
  const res = await pdfParse(buf);
  return typeof res.text === "string" ? res.text.trim() : "";
}

async function extractTextFromImageBuffer(buf: Buffer): Promise<string> {
  const client = new vision.ImageAnnotatorClient();
  const [result] = await client.textDetection({ image: { content: buf } });
  const full = result.fullTextAnnotation?.text;
  if (typeof full === "string" && full.trim().length > 0) return full.trim();
  const first = result.textAnnotations?.[0]?.description;
  return typeof first === "string" ? first.trim() : "";
}

const MIN_PDF_TEXT_LAYER_CHARS = 12;

const VISION_ASYNC_TIMEOUT_MS = 110_000;

/**
 * Google Cloud Vision: PDF/TIFF document OCR must use **async** `files:asyncBatchAnnotate`
 * with an output GCS prefix — not synchronous `batchAnnotateFiles` alone.
 * @see https://cloud.google.com/vision/docs/pdf
 */
async function extractTextFromPdfViaVisionAsyncGcs(params: {
  buf: Buffer;
  uid: string;
  bucket: ReturnType<ReturnType<typeof admin.storage>["bucket"]>;
}): Promise<{ text: string; error?: string; outputJsonCount: number }> {
  const { buf, uid, bucket } = params;
  const id = randomBytes(12).toString("hex");
  const objectPath = `_invoice_ocr_tmp/${uid}/${id}.pdf`;
  const outputPrefix = `_invoice_ocr_tmp/${uid}/${id}-out`;
  const file = bucket.file(objectPath);
  const gsInputUri = `gs://${bucket.name}/${objectPath}`;
  const gsDestinationUri = `gs://${bucket.name}/${outputPrefix}/`;

  const cleanup = async () => {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (e) {
      logger.warn("extractInvoiceDataFromStorage cleanup input PDF failed", { objectPath, err: String(e) });
    }
    try {
      const [outFiles] = await bucket.getFiles({ prefix: `${outputPrefix}/` });
      await Promise.all(outFiles.map((f) => f.delete({ ignoreNotFound: true })));
    } catch (e) {
      logger.warn("extractInvoiceDataFromStorage cleanup vision output failed", { outputPrefix, err: String(e) });
    }
  };

  try {
    await file.save(buf, {
      contentType: "application/pdf",
      resumable: false,
      metadata: { cacheControl: "no-store" },
    });

    logger.info("extractInvoiceDataFromStorage vision async: temp PDF written", {
      gsInputUri,
      gsDestinationUri,
      bytes: buf.length,
    });

    const client = new vision.ImageAnnotatorClient({
      apiEndpoint: "eu-vision.googleapis.com",
    });
    const projectId = await client.getProjectId();
    const parent = `projects/${projectId}/locations/eu`;

    const [operation] = await client.asyncBatchAnnotateFiles({
      parent,
      requests: [
        {
          inputConfig: {
            gcsSource: { uri: gsInputUri },
            mimeType: "application/pdf",
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          outputConfig: {
            gcsDestination: { uri: gsDestinationUri },
            batchSize: 2,
          },
        },
      ],
    });

    const resultPromise = operation.promise() as Promise<unknown>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("VISION_ASYNC_PDF_TIMEOUT")), VISION_ASYNC_TIMEOUT_MS);
    });
    await Promise.race([resultPromise, timeoutPromise]);

    const [outFiles] = await bucket.getFiles({ prefix: `${outputPrefix}/` });
    const jsonFiles = outFiles.filter((f) => !f.name.endsWith("/") && /\.json$/i.test(f.name));
    logger.info("extractInvoiceDataFromStorage vision async: output objects", {
      count: jsonFiles.length,
      names: jsonFiles.map((f) => f.name).slice(0, 8),
    });

    const texts: string[] = [];
    for (const blob of jsonFiles) {
      try {
        const [body] = await blob.download();
        const json = JSON.parse(body.toString("utf8")) as {
          responses?: Array<{
            fullTextAnnotation?: { text?: string };
            textAnnotations?: Array<{ description?: string }>;
            error?: { message?: string };
          }>;
        };
        for (const resp of json.responses ?? []) {
          if (resp.error?.message) {
            logger.warn("extractInvoiceDataFromStorage vision page error", { message: resp.error.message });
          }
          const full = resp.fullTextAnnotation?.text;
          if (typeof full === "string" && full.trim().length > 0) {
            texts.push(full.trim());
            continue;
          }
          const first = resp.textAnnotations?.[0]?.description;
          if (typeof first === "string" && first.trim().length > 0) texts.push(first.trim());
        }
      } catch (parseErr) {
        logger.warn("extractInvoiceDataFromStorage vision output JSON parse failed", {
          name: blob.name,
          err: String(parseErr),
        });
      }
    }

    const text = texts.join("\n\n").trim();
    return { text, outputJsonCount: jsonFiles.length };
  } catch (e) {
    return { text: "", error: String(e), outputJsonCount: 0 };
  } finally {
    await cleanup();
  }
}

function buildFailureResponse(input: {
  mimeType: string;
  source: "pdf-text" | "cloud-docai";
  errorCode: string;
  log: ExtractionLog;
}) {
  return {
    success: false as const,
    ok: false as const,
    errorCode: input.errorCode,
    source: input.source,
    rawText: "",
    confidence: 0,
    parsed: null as null,
    vendorName: null as null,
    invoiceNumber: null as null,
    total: null as null,
    extractionLog: input.log,
  };
}

function buildSuccessResponse(input: {
  rawText: string;
  source: "pdf-text" | "cloud-docai";
  confidence: number;
  log: ExtractionLog;
}) {
  /**
   * Last line of defense: this repo never intentionally emits STUB bodies; if `rawText`
   * still looks like a mock fixture, refuse success (handles stale proxies / old layers).
   */
  if (isPlaceholderOrMockOcrText(input.rawText)) {
    logger.error("extractInvoiceDataFromStorage INVARIANT: blocked success with placeholder-like rawText", {
      fnImplVersion: input.log.fnImplVersion,
      cloudRevision: input.log.cloudRevision,
      source: input.source,
      head: input.rawText.slice(0, 160),
    });
    return buildFailureResponse({
      mimeType: input.log.mimeType,
      source: input.source,
      errorCode: "SERVER_BLOCKED_PLACEHOLDER_RAW_TEXT",
      log: {
        ...input.log,
        finalCharCount: 0,
        previewHead: "",
        usedPlaceholderGuard: true,
      },
    });
  }
  return {
    success: true as const,
    ok: true as const,
    source: input.source,
    rawText: input.rawText,
    confidence: input.confidence,
    parsed: null as null,
    vendorName: null as null,
    invoiceNumber: null as null,
    total: null as null,
    extractionLog: input.log,
  };
}

/**
 * HTTPS callable — `extractInvoiceDataFromStorage` (europe-west1).
 * PDF: text layer (pdf-parse) then Vision **async** PDF OCR to GCS (required by Vision for PDFs).
 * Never returns mock/stub placeholder strings.
 */
export const extractInvoiceDataFromStorage = onCall(
  { region: "europe-west1", memory: "1GiB", timeoutSeconds: 180 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const raw = request.data;
    if (!isPlainObject(raw)) {
      throw new HttpsError("invalid-argument", "Expected object payload.");
    }
    const p = raw as ExtractPayload;
    const filePath = typeof p.filePath === "string" ? p.filePath.trim() : "";
    const mimeType =
      typeof p.mimeType === "string" && p.mimeType.trim().length > 0
        ? p.mimeType.trim()
        : "application/octet-stream";
    const projectId = typeof p.projectId === "string" ? p.projectId.trim() : "";
    const attachmentId = typeof p.attachmentId === "string" ? p.attachmentId.trim() : "";

    if (!filePath) {
      throw new HttpsError("invalid-argument", "filePath is required.");
    }

    const bucket = admin.storage().bucket();
    let buf: Buffer;
    try {
      const [data] = await bucket.file(filePath).download();
      buf = data;
    } catch (e) {
      logger.error("Storage download failed", { filePath: filePath.slice(0, 200), err: String(e) });
      throw new HttpsError("not-found", "Could not read file from Storage.");
    }

    const downloadedBytes = buf.length;
    const pathSuffix = filePath.split("/").slice(-2).join("/");
    const cloudRevision = process.env.K_REVISION ?? process.env.FUNCTION_REVISION ?? null;

    logger.info("extractInvoiceDataFromStorage invoked", {
      fnImplVersion: FN_IMPL_VERSION,
      cloudRevision,
      uid: request.auth.uid,
      projectId,
      attachmentId,
      mimeType,
      downloadedBytes,
      storageDownloadOk: true,
      filePathPrefix: filePath.split("/").slice(0, 3).join("/"),
      filePathLen: filePath.length,
    });

    const m = mimeType.toLowerCase();
    const pathLower = filePath.toLowerCase();
    const isPdf = m.includes("pdf") || pathLower.endsWith(".pdf");

    const baseLog: Omit<ExtractionLog, "previewHead" | "finalCharCount"> = {
      fnImplVersion: FN_IMPL_VERSION,
      cloudRevision,
      downloadedBytes,
      mimeType,
      pathSuffix,
      pdfTextLayerChars: 0,
      pdfTextLayerAttempted: false,
      visionAttempted: false,
      visionProvider: "none",
      usedPlaceholderGuard: false,
      fallbackMockPath: false,
    };

    try {
      if (isPdf) {
        baseLog.pdfTextLayerAttempted = true;
        let rawText = await extractTextFromPdfBuffer(buf);
        let source: "pdf-text" | "cloud-docai" = "pdf-text";
        let visionError: string | undefined;
        let visionAsyncCompleted = false;
        let visionOutputJsonCount = 0;
        const pdfLayerCharCount = rawText.length;
        baseLog.pdfTextLayerChars = pdfLayerCharCount;

        logger.info("extractInvoiceDataFromStorage pdf-parse done", {
          pdfTextLayerChars: pdfLayerCharCount,
          mimeType,
          downloadedBytes,
        });

        if (isPlaceholderOrMockOcrText(rawText)) {
          const log: ExtractionLog = {
            ...baseLog,
            usedPlaceholderGuard: true,
            finalCharCount: 0,
            previewHead: "",
          };
          logger.warn("extractInvoiceDataFromStorage rejected placeholder pdf-parse output", log);
          return buildFailureResponse({
            mimeType,
            source: "pdf-text",
            errorCode: "PLACEHOLDER_TEXT_REJECTED",
            log,
          });
        }

        if (rawText.length < MIN_PDF_TEXT_LAYER_CHARS) {
          baseLog.visionAttempted = true;
          baseLog.visionProvider = "vision-async-batch-pdf";
          logger.info("extractInvoiceDataFromStorage calling Vision async PDF OCR", {
            reason: "pdf_text_layer_short",
            pdfTextLayerChars: pdfLayerCharCount,
            visionProvider: baseLog.visionProvider,
          });

          const vision = await extractTextFromPdfViaVisionAsyncGcs({
            buf,
            uid: request.auth.uid,
            bucket,
          });
          visionError = vision.error;
          visionAsyncCompleted = !vision.error;
          visionOutputJsonCount = vision.outputJsonCount;
          if (vision.text.length > rawText.length) {
            rawText = vision.text;
            source = "cloud-docai";
          }
          if (visionError) {
            logger.warn("extractInvoiceDataFromStorage Vision async PDF OCR failed", {
              visionError,
              pdfTextLayerChars: pdfLayerCharCount,
              visionOutputJsonCount,
            });
          } else {
            logger.info("extractInvoiceDataFromStorage Vision async PDF OCR finished", {
              visionChars: vision.text.length,
              visionOutputJsonCount,
            });
          }
        }

        if (isPlaceholderOrMockOcrText(rawText)) {
          const log: ExtractionLog = {
            ...baseLog,
            visionError,
            visionAsyncCompleted,
            visionOutputJsonCount,
            usedPlaceholderGuard: true,
            finalCharCount: 0,
            previewHead: "",
          };
          logger.warn("extractInvoiceDataFromStorage rejected placeholder after Vision", log);
          return buildFailureResponse({
            mimeType,
            source,
            errorCode: "PLACEHOLDER_TEXT_REJECTED",
            log,
          });
        }

        if (rawText.length < 1) {
          const log: ExtractionLog = {
            ...baseLog,
            visionError,
            visionAsyncCompleted,
            visionOutputJsonCount,
            finalCharCount: 0,
            previewHead: "",
          };
          logger.warn("extractInvoiceDataFromStorage PDF no extractable text", {
            ...log,
            errorCode: "PDF_NO_TEXT_LAYER",
          });
          return buildFailureResponse({
            mimeType,
            source: "pdf-text",
            errorCode: "PDF_NO_TEXT_LAYER",
            log,
          });
        }

        const confidence =
          rawText.length > 80 ? 0.78 : rawText.length > 24 ? 0.62 : rawText.length > 8 ? 0.48 : 0.28;
        const previewHead = rawText.length > 300 ? `${rawText.slice(0, 300)}…` : rawText;
        const log: ExtractionLog = {
          ...baseLog,
          visionError,
          visionAsyncCompleted,
          visionOutputJsonCount,
          finalCharCount: rawText.length,
          previewHead,
        };

        logger.info("extractInvoiceDataFromStorage response summary", {
          mimeType,
          extractionSource: source,
          charCount: rawText.length,
          confidence,
          projectId,
          attachmentId,
          storageDownloadOk: true,
          pdfTextLayerChars: pdfLayerCharCount,
          visionAttempted: log.visionAttempted,
          visionProvider: log.visionProvider,
          visionAsyncCompleted: log.visionAsyncCompleted,
          visionOutputJsonCount: log.visionOutputJsonCount,
          previewHead: log.previewHead.slice(0, 320),
        });

        return buildSuccessResponse({ rawText, source, confidence, log });
      }

      if (m.startsWith("image/")) {
        const rawText = await extractTextFromImageBuffer(buf);
        if (isPlaceholderOrMockOcrText(rawText)) {
          const log: ExtractionLog = {
            ...baseLog,
            usedPlaceholderGuard: true,
            finalCharCount: 0,
            previewHead: "",
          };
          return buildFailureResponse({
            mimeType,
            source: "cloud-docai",
            errorCode: "PLACEHOLDER_TEXT_REJECTED",
            log,
          });
        }
        if (rawText.length < 1) {
          const log: ExtractionLog = {
            ...baseLog,
            finalCharCount: 0,
            previewHead: "",
          };
          return buildFailureResponse({
            mimeType,
            source: "cloud-docai",
            errorCode: "IMAGE_OCR_EMPTY",
            log,
          });
        }
        const confidence = rawText.length > 120 ? 0.75 : rawText.length > 30 ? 0.58 : rawText.length > 8 ? 0.42 : 0.25;
        const previewHead = rawText.length > 300 ? `${rawText.slice(0, 300)}…` : rawText;
        const log: ExtractionLog = {
          ...baseLog,
          finalCharCount: rawText.length,
          previewHead,
        };
        logger.info("extractInvoiceDataFromStorage response summary", {
          mimeType,
          extractionSource: "cloud-docai",
          charCount: rawText.length,
          confidence,
          projectId,
          attachmentId,
          previewHead: log.previewHead.slice(0, 320),
        });
        return buildSuccessResponse({ rawText, source: "cloud-docai", confidence, log });
      }

      logger.warn("Unsupported mime for extractInvoiceDataFromStorage", { mimeType });
      throw new HttpsError("invalid-argument", "Unsupported mime type for extraction.");
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error("Text extraction failed", { mimeType, err: String(e) });
      throw new HttpsError("internal", "Document text extraction failed.");
    }
  }
);
