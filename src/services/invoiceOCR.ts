import { auth } from "../firebase";
import { getCallable } from "../firebase";
import { parseMoneyToNumber } from "../helpers/parseMoney";
import { TimeoutError, TIMEOUT_ERROR_CODE } from "../utils/withTimeout";
import {
  detectCurrencyCandidates,
  pickBestTotalFromText,
  type CurrencyCode,
} from "../utils/invoiceUniversal";
import { addProjectEvent } from "./projectEvents";
import type { InvoiceExtractionSource } from "../lib/invoiceTypes";
import type { ExtractInvoiceDataFromStorageResponse } from "../lib/extractInvoiceDataFromStorageContract";
import type { OcrParsed, OcrResult, OcrStatus } from "../lib/ocrTypes";
import { isPlainObject } from "../utils/isPlainObject";
import { buildParsedInvoiceEnvelope, enrichOcrParsedWithInvoiceText } from "./invoiceParser";
import { callExtractInvoiceDataFromStorage } from "./ocr";
import { tryExtractPdfTextCombined, tryRenderPdfFirstPageToImage } from "./pdfExtraction";

export type { OcrParsed, OcrStatus, OcrResult } from "../lib/ocrTypes";

/** Normalize backend parsed object: map various amount field names and parse string values. */
function normalizeToOcrParsed(
  raw: Record<string, unknown> | null | undefined,
  rawText?: string | null
): OcrParsed {
  const fallbackCurrency: CurrencyCode = "UNKNOWN";
  const emptyParsed: OcrParsed = {
    supplierName: null,
    invoiceNumber: null,
    issueDate: null,
    dueDate: null,
    totalAmount: null,
    vatAmount: null,
    currency: fallbackCurrency,
  };

  if (!raw || typeof raw !== "object") return emptyParsed;
  const ocr = raw as Record<string, unknown>;

  let currency: CurrencyCode = fallbackCurrency;
  const backendCurrency = ocr.currency as string | undefined;
  if (backendCurrency && typeof backendCurrency === "string" && backendCurrency.length >= 3) {
    currency = backendCurrency.toUpperCase() as CurrencyCode;
  } else if (rawText) {
    const candidates = detectCurrencyCandidates(rawText);
    currency = candidates[0]?.currency ?? fallbackCurrency;
  }
  if (currency === "UNKNOWN") currency = "EUR";

  const candidate =
    ocr.totalAmount ?? ocr.total ?? ocr.grandTotal ?? ocr.amount ?? ocr.sum ?? ocr.amountCents;
  const isFromCents = candidate === ocr.amountCents;
  let totalAmount: number | null = null;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    totalAmount = isFromCents ? candidate / 100 : candidate;
  } else {
    totalAmount = parseMoneyToNumber(candidate);
    if (totalAmount == null && typeof ocr.amountCents === "number" && ocr.amountCents > 0) {
      totalAmount = ocr.amountCents / 100;
    }
  }
  const MAX = 999_999.99;
  if (totalAmount != null && (totalAmount <= 0 || totalAmount > MAX)) totalAmount = null;

  let confidence = 0.5;
  let matchedLine: string | undefined;
  if (rawText) {
    const pickResult = pickBestTotalFromText(rawText);
    const pickMoney = pickResult.money;
    const pickConf = pickResult.confidence ?? 0;
    matchedLine = pickResult.matchedLine;

    if (totalAmount == null && pickMoney) {
      totalAmount = pickMoney.amount;
      currency = pickMoney.currency;
      confidence = pickConf;
    } else if (
      totalAmount != null &&
      pickMoney &&
      pickConf > 0.6 &&
      ((Number.isInteger(totalAmount) && totalAmount >= 100000) ||
        (Number.isInteger(totalAmount) && pickMoney.amount % 1 !== 0))
    ) {
      totalAmount = pickMoney.amount;
      currency = pickMoney.currency;
      confidence = pickConf;
    } else if (totalAmount != null && pickConf > confidence) {
      confidence = pickConf;
    }
  }

  let vatAmount: number | null = null;
  const vatRaw = ocr.vatAmount ?? ocr.vat ?? ocr.vatAmountCents;
  if (typeof vatRaw === "number" && Number.isFinite(vatRaw)) vatAmount = vatRaw >= 10000 ? vatRaw / 100 : vatRaw;
  else vatAmount = parseMoneyToNumber(vatRaw);
  if (vatAmount != null && (vatAmount <= 0 || vatAmount > MAX)) vatAmount = null;

  let supplierName = typeof ocr.supplierName === "string" ? ocr.supplierName.trim() : null;
  if (supplierName && /^[\u0600-\u06FF\s]+$/.test(supplierName) && supplierName.length < 10) supplierName = null;
  if (supplierName && /^[yíýľ]\s+/i.test(supplierName)) supplierName = supplierName.replace(/^[yíýľ]\s+/i, "").trim();
  if (!supplierName && rawText && typeof ocr.supplierTaxId === "string") {
    const taxId = ocr.supplierTaxId as string;
    const idx = rawText.indexOf(taxId);
    if (idx > 0) {
      const before = rawText.slice(0, idx);
      const m = before.match(
        /([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž0-9\u0600-\u06FF][^\n]{2,50}\s+(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl|s\.a\.|s\.l\.|nv|bv)\b)/i
      );
      const ex = m?.[1]?.replace(/\s+/g, " ").trim();
      if (ex && ex.length >= 4 && ex.length <= 80 && !/\d{6,}/.test(ex) && !(/^[\u0600-\u06FF\s]+$/.test(ex))) {
        supplierName = ex.replace(/^[yíýľ]\s+/i, "").trim();
      }
    }
    if (!supplierName && idx >= 0) {
      const after = rawText.slice(idx + taxId.length, idx + 200);
      const m2 = after.match(
        /([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž][^\n]{1,40}\s+(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b)/i
      );
      const ex2 = m2?.[1]?.replace(/\s+/g, " ").trim();
      if (ex2 && ex2.length >= 4 && ex2.length <= 80 && !/\d{6,}/.test(ex2) && !(/^[\u0600-\u06FF\s]+$/.test(ex2))) {
        supplierName = ex2.replace(/^[yíýľ]\s+/i, "").trim();
      }
    }
    if (!supplierName) {
      const lineList = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const taxId = ocr.supplierTaxId as string;
      for (let i = 0; i < lineList.length; i++) {
        if (!lineList[i].includes(taxId)) continue;
        for (const offset of [2, 1]) {
          if (i - offset < 0) continue;
          const line = lineList[i - offset].trim();
          if (line.length < 4 || line.length > 80 || /\d{6,}/.test(line)) continue;
          if (/^[\u0600-\u06FF\s]+$/.test(line) && line.length < 10) continue;
          supplierName = line.replace(/\s+/g, " ").trim().replace(/^[yíýľ]\s+/i, "").trim();
          if (/\b(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b/i.test(line)) break;
        }
        break;
      }
    }
    if (!supplierName) {
      const top = rawText.slice(0, 800);
      const m3 = top.match(
        /\b([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž][A-Za-záäčďéíĺľňóôřšťúýž0-9\s\-\.]{1,45}(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b)/i
      );
      const ex3 = m3?.[1]?.replace(/\s+/g, " ").trim();
      if (ex3 && ex3.length >= 4 && ex3.length <= 80 && !/\d{6,}/.test(ex3) && !(/^[\u0600-\u06FF\s]+$/.test(ex3))) {
        supplierName = ex3.replace(/^[yíýľ]\s+/i, "").trim();
      }
    }
  }
  return {
    supplierName,
    supplierTaxId: typeof ocr.supplierTaxId === "string" ? ocr.supplierTaxId : null,
    invoiceNumber: typeof ocr.invoiceNumber === "string" ? ocr.invoiceNumber : null,
    issueDate: typeof ocr.issueDate === "string" ? ocr.issueDate : null,
    dueDate: typeof ocr.dueDate === "string" ? ocr.dueDate : null,
    totalAmount,
    vatAmount,
    currency,
    confidence: { total: confidence, currency: currency !== fallbackCurrency ? 0.9 : 0.5, overall: confidence },
    matchedLine,
  };
}

function isLocalPdfTextUseful(rawText: string, parsed: OcrParsed): boolean {
  if (parsed.totalAmount != null) return true;
  if (parsed.supplierName && parsed.supplierName.trim().length >= 4) return true;
  const compact = rawText.replace(/\s/g, "");
  if (compact.length < 28) return false;
  if (/\d{1,3}(?:[\s\u00a0]\d{3})*[,.]\d{2}/.test(rawText) && /EUR|€|\bUSD\b|CZK|SK\d{2}/i.test(rawText)) {
    return true;
  }
  return /FAKT|fakt|daňov|DPH|IČO|IČ\s*DPH|IBAN|VS[\s:]|[Vv]ariabil|Dodávateľ|Dodavatel|Odberateľ|Odběratel|Celkom|Celkem|Spolu|Uhradiť|úhradě|Úhradě|Splatible|Ostáva|číslo\s*FA|RAZEM|ÖSSZESEN|GESAMT|RECHNUNG|Factuur|Factura|Invoice|Total\s+due|Montant\s+TTC/i.test(
    rawText
  );
}

function isLikelyPdf(mimeType: string | undefined, storageFullPath: string): boolean {
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("pdf")) return true;
  const leaf = storageFullPath.split("/").pop()?.split("?")[0] ?? "";
  return /\.pdf$/i.test(leaf);
}

function attachEnrichment(
  result: OcrResult,
  source: InvoiceExtractionSource,
  rawText?: string | null
): OcrResult {
  if (result.status !== "success" || !result.parsed) {
    return { ...result, extractionSource: result.extractionSource ?? "none" };
  }
  let parsed = result.parsed;
  const text = rawText ?? result.rawText;
  if (text) parsed = enrichOcrParsedWithInvoiceText(parsed, text);
  const parsedInvoice =
    text && text.length > 2 ? buildParsedInvoiceEnvelope(text, source, parsed) : undefined;
  return {
    ...result,
    parsed,
    rawText: text ?? result.rawText,
    extractionSource: source,
    parsedInvoice,
  };
}

async function extractPdfWithLocalAndCloud(input: {
  filePath: string;
  mimeType?: string;
  attachmentId?: string;
  projectId?: string;
  localPdfUri?: string;
}): Promise<OcrResult> {
  const normalizedPath = input.filePath.trim();

  const { rawText: mergedLocal, diagnostics } = await tryExtractPdfTextCombined({
    storageFullPath: normalizedPath,
    localPdfUri: input.localPdfUri,
  });
  if (__DEV__) {
    console.log("[invoiceOCR] PDF extraction diagnostics:", diagnostics);
  }

  let rawText: string | null = mergedLocal;

  if (rawText && rawText.length > 0) {
    const parsed0 = normalizeToOcrParsed({}, rawText);
    const compact = rawText.replace(/\s/g, "");
    const acceptable =
      isLocalPdfTextUseful(rawText, parsed0) ||
      (compact.length >= 12 && /\d/.test(rawText)) ||
      compact.length >= 35;

    if (acceptable) {
      const parsed = enrichOcrParsedWithInvoiceText(parsed0, rawText);
      if (input.projectId) {
        try {
          await addProjectEvent(
            input.projectId,
            "ocr_completed",
            { supplier: parsed.supplierName ?? undefined },
            input.attachmentId ? { kind: "attachment", id: input.attachmentId } : { kind: "ocr" }
          );
        } catch (eventError) {
          console.warn("[invoiceOCR] Failed to create project event:", eventError);
        }
      }
      return attachEnrichment({ status: "success", parsed, rawText }, "pdf-text", rawText);
    }
    console.warn(
      "[invoiceOCR] PDF: local text weak (chars=",
      rawText.length,
      ") — trying render stub then cloud fallback if configured."
    );
  } else {
    console.warn(
      "[invoiceOCR] PDF: in-app extractor returned empty — trying optional render path, then cloud Storage extraction."
    );
  }

  if (input.localPdfUri) {
    const renderedUri = await tryRenderPdfFirstPageToImage(input.localPdfUri);
    if (renderedUri) {
      console.log("[invoiceOCR] PDF render OCR path got URI (unexpected in default build); length:", renderedUri.length);
    }
  }

  let cloudCallError: string | undefined;

  if (input.projectId && input.attachmentId) {
    try {
      console.log("[invoiceOCR] Calling extractInvoiceDataFromStorage for PDF…");
      const data = await callExtractInvoiceDataFromStorage({
        filePath: normalizedPath,
        mimeType: input.mimeType?.includes("pdf") ? "application/pdf" : "application/pdf",
        projectId: input.projectId,
        attachmentId: input.attachmentId,
      });
      const rawPayload = data as ExtractInvoiceDataFromStorageResponse;
      console.log("[invoiceOCR] extractInvoiceDataFromStorage raw response", {
        keys: isPlainObject(data) ? Object.keys(data as object) : [],
        json: (() => {
          try {
            return JSON.stringify(data ?? null);
          } catch {
            return "(unserializable)";
          }
        })(),
        successStrict: rawPayload?.success === true,
        okStrict: rawPayload?.ok === true,
      });
      const cloud = await finalizeCloudOcrResponse(data, { ...input, filePath: normalizedPath });
      const cloudText = (cloud.rawText ?? (isPlainObject(data) ? (data as { rawText?: string }).rawText : "") ?? "").trim();
      const compactCloud = cloudText.replace(/\s/g, "");
      if (
        cloud.status === "success" &&
        cloud.parsed &&
        compactCloud.length >= 12 &&
        (isLocalPdfTextUseful(cloudText, cloud.parsed) || /\d/.test(cloudText))
      ) {
        return attachEnrichment({ ...cloud, rawText: cloudText }, "cloud-ocr", cloudText);
      }
      console.warn(
        "[invoiceOCR] Cloud PDF extraction did not yield success:",
        "cloud.status=",
        cloud.status,
        "cloud.errorCode=",
        cloud.errorCode,
        "compactCloudLen=",
        compactCloud.length
      );
    } catch (e) {
      const anyE = e as { code?: string; message?: string };
      const code = String(anyE?.code ?? "");
      const msg = String(anyE?.message ?? e ?? "");
      const isNotFound =
        code === "NOT_FOUND" ||
        code === "functions/not-found" ||
        /not-found|not_found|NOT_FOUND|functions\/not-found/i.test(msg) ||
        /not-found/i.test(code);
      cloudCallError = isNotFound ? "CLOUD_OCR_NOT_FOUND" : "CLOUD_OCR_FAILED";
      console.warn("[invoiceOCR] extractInvoiceDataFromStorage failed:", {
        cloudCallError,
        code: anyE?.code,
        message: anyE?.message,
      });
    }
  } else {
    console.warn(
      "[invoiceOCR] Skipping cloud PDF extraction: need projectId and attachmentId (upload metadata)."
    );
  }

  const errorCode =
    cloudCallError === "CLOUD_OCR_NOT_FOUND" || cloudCallError === "CLOUD_OCR_FAILED"
      ? cloudCallError
      : "PDF_NO_TEXT";

  return { status: "failed", parsed: null, errorCode, extractionSource: "none" };
}

export async function runInvoiceOCR(payload: {
  filePath: string;
  storagePath?: string;
  attachmentId: string;
  mimeType: string;
  projectId?: string;
}) {
  console.log("[invoiceOCR] RUN_INVOICE_OCR_START");

  const user = auth()?.currentUser;
  console.log("[invoiceOCR] PRE uid:", user?.uid ?? null);

  if (user) {
    const t0 = Date.now();
    await user.getIdToken(true);
    console.log("[invoiceOCR] PRE token refreshed in ms:", Date.now() - t0);
  }

  const fn = getCallable("extractInvoiceData", { timeoutMs: 120_000 });
  console.log("[invoiceOCR] calling callable extractInvoiceData, ts:", Date.now());
  console.log("[invoiceOCR] PAYLOAD:", JSON.stringify(payload));

  const watchdog = setTimeout(() => {
    console.error("[invoiceOCR] WATCHDOG: callable still pending after 8000ms");
  }, 8000);

  try {
    const t1 = Date.now();
    const result = await fn(payload);
    clearTimeout(watchdog);
    const res = result as { data?: Record<string, unknown> } | undefined;
    const data = res?.data ?? null;
    console.log("[invoiceOCR] POST result ms:", Date.now() - t1);
    const safe = isPlainObject(data) ? data : {};
    console.log("[invoiceOCR] response keys", Object.keys(safe));
    if (__DEV__) console.log("[invoiceOCR] response data", JSON.stringify(data ?? null, null, 2));
    return data;
  } catch (err: unknown) {
    clearTimeout(watchdog);
    const anyErr = err as { code?: string; message?: string; details?: unknown };
    console.error(
      "[invoiceOCR] POST error code =",
      anyErr?.code,
      "message =",
      anyErr?.message,
      "details =",
      anyErr?.details ?? null
    );
    throw err;
  } finally {
    console.log("[invoiceOCR] FINALLY reached, ts:", Date.now());
  }
}

function normalizeInvoiceAttachmentMime(
  mimeType: string | undefined,
  storageFullPath: string,
  isPdf: boolean
): string {
  const m = (mimeType ?? "").trim().toLowerCase();
  const leaf = storageFullPath.split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";

  if (isPdf) {
    if (m.includes("pdf")) return (mimeType ?? "").trim() || "application/pdf";
    if (leaf.endsWith(".pdf")) return "application/pdf";
    return "application/pdf";
  }

  if (m.startsWith("image/")) {
    if (m === "image/jpg") return "image/jpeg";
    return (mimeType ?? "").trim() || "image/jpeg";
  }
  if (m === "application/octet-stream" || !m) {
    if (/\.(jpe?g)$/i.test(leaf)) return "image/jpeg";
    if (/\.png$/i.test(leaf)) return "image/png";
    if (/\.webp$/i.test(leaf)) return "image/webp";
    if (/\.gif$/i.test(leaf)) return "image/gif";
    if (/\.(heic|heif)$/i.test(leaf)) return "image/heic";
  }
  return m || "image/jpeg";
}

async function finalizeCloudOcrResponse(
  data: unknown,
  input: {
    filePath: string;
    mimeType?: string;
    attachmentId?: string;
    projectId?: string;
    localPdfUri?: string;
  }
): Promise<OcrResult> {
  const result = data as OcrResult | ExtractInvoiceDataFromStorageResponse | undefined;
  if (!result) {
    return { status: "failed", parsed: null };
  }

  /** Storage-OCR envelope: `success` or `ok`, no top-level `status` (avoids colliding with OcrResult). */
  const r = result as Record<string, unknown>;
  const envelopeOk =
    !("status" in r) &&
    (r.success === true || r.ok === true);
  if (envelopeOk) {
    const rawParsed = (r.parsed as Record<string, unknown> | null | undefined) ?? null;
    const rawText =
      (typeof r.rawText === "string" ? r.rawText : null) ??
      (typeof r.extractedText === "string" ? r.extractedText : null) ??
      (typeof r.text === "string" ? r.text : null) ??
      (typeof r.fullText === "string" ? r.fullText : null) ??
      (typeof r.ocrText === "string" ? r.ocrText : null) ??
      undefined;
    const parsed = normalizeToOcrParsed(isPlainObject(rawParsed) ? rawParsed : {}, rawText);
    return { status: "success" as const, parsed, rawText };
  }

  if (!("status" in result) || !(result as OcrResult).status) {
    return { status: "failed", parsed: null };
  }
  const ocrResult = result as OcrResult & { cooldownSeconds?: number };
  const rawParsed = ocrResult.parsed as Record<string, unknown> | null;
  const rawText =
    ocrResult.rawText ??
    (result as { extractedText?: string }).extractedText ??
    (result as { text?: string }).text ??
    (result as { fullText?: string }).fullText ??
    (result as { ocrText?: string }).ocrText;
  if (ocrResult.status === "limit") {
    return {
      status: "limit",
      parsed: null,
      errorCode: ocrResult.errorCode ?? "LIMIT_REACHED",
      cooldownSeconds: ocrResult.cooldownSeconds,
    };
  }
  console.log("[expense autofill] amount candidates (raw)", {
    total: isPlainObject(rawParsed) ? rawParsed.total : undefined,
    totalAmount: isPlainObject(rawParsed) ? rawParsed.totalAmount : undefined,
    grandTotal: isPlainObject(rawParsed) ? rawParsed.grandTotal : undefined,
    amount: isPlainObject(rawParsed) ? rawParsed.amount : undefined,
    sum: isPlainObject(rawParsed) ? rawParsed.sum : undefined,
    amountCents: isPlainObject(rawParsed) ? rawParsed.amountCents : undefined,
  });
  const parsed = normalizeToOcrParsed(isPlainObject(rawParsed) ? rawParsed : {}, rawText);
  if (ocrResult.status === "success" && input.projectId) {
    try {
      await addProjectEvent(
        input.projectId,
        "ocr_completed",
        { supplier: parsed.supplierName ?? undefined },
        input.attachmentId ? { kind: "attachment", id: input.attachmentId } : { kind: "ocr" }
      );
    } catch (eventError) {
      console.warn("[invoiceOCR] Failed to create project event:", eventError);
    }
  }
  return { ...(ocrResult ?? {}), parsed };
}

function mapExtractorErrorToResult(error: unknown): OcrResult {
  if (error instanceof TimeoutError) {
    console.error("[invoiceOCR] extractInvoiceData timeout");
    return { status: "failed", parsed: null, errorCode: TIMEOUT_ERROR_CODE };
  }
  const errStr =
    error != null
      ? `code=${(error as { code?: string })?.code ?? "?"} msg=${(error as { message?: string })?.message ?? "?"} details=${JSON.stringify(
          (error as { details?: unknown })?.details ?? error
        )}`
      : "error is null/undefined";
  console.error("[invoiceOCR] extractInvoiceData catch:", errStr);
  const code = String(
    (error as { code?: string })?.code ??
      (error as { message?: string })?.message ??
      (error != null ? String(error) : "") ??
      ""
  );
  const lower = code.toLowerCase();
  if (lower.includes("not_found") || lower.includes("not-found")) {
    return { status: "failed", parsed: null, errorCode: "NOT_FOUND" };
  }
  return { status: "failed", parsed: null, errorCode: code || "UNKNOWN" };
}

export async function extractInvoiceData(input: {
  filePath: string;
  mimeType?: string;
  attachmentId?: string;
  projectId?: string;
  localPdfUri?: string;
}): Promise<OcrResult> {
  const normalizedPath = input.filePath?.trim();
  if (!normalizedPath) {
    return { status: "failed", parsed: null, errorCode: "EMPTY_FILE_PATH" };
  }
  if (
    normalizedPath.startsWith("file://") ||
    normalizedPath.startsWith("content://") ||
    normalizedPath.startsWith("gs://")
  ) {
    console.warn("[invoiceOCR] Invalid filePath for OCR (expected Storage fullPath):", normalizedPath);
    return { status: "failed", parsed: null, errorCode: "INVALID_FILE_PATH" };
  }

  if (isLikelyPdf(input.mimeType, normalizedPath)) {
    const pdfResult = await extractPdfWithLocalAndCloud({ ...input, filePath: normalizedPath });
    return pdfResult;
  }

  const normalizedMime = normalizeInvoiceAttachmentMime(input.mimeType, normalizedPath, false);

  const payload = {
    filePath: normalizedPath,
    storagePath: normalizedPath,
    mimeType: normalizedMime,
    attachmentId: input.attachmentId ?? "",
    projectId: input.projectId ?? "",
  };

  try {
    const data = await runInvoiceOCR(payload);
    const finalized = await finalizeCloudOcrResponse(data, { ...input, filePath: normalizedPath });
    if (finalized.status === "success" && finalized.parsed) {
      const rawText =
        finalized.rawText ??
        (isPlainObject(data) ? (data as { rawText?: string }).rawText : undefined) ??
        (isPlainObject(data) ? (data as { extractedText?: string }).extractedText : undefined);
      return attachEnrichment(finalized, "image-ocr", rawText);
    }
    return finalized;
  } catch (error) {
    return mapExtractorErrorToResult(error);
  }
}
