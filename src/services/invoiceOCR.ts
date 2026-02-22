import auth from "@react-native-firebase/auth";
import { getCallable } from "../firebase";
import { extractTotalFromRawText, parseMoneyToNumber } from "../helpers/parseMoney";
import { addProjectEvent } from "./projectEvents";

export type OcrStatus = "success" | "failed" | "limit";

export type OcrParsed = {
  supplierName: string | null;
  supplierTaxId?: string | null; // VAT / Tax ID (EU-wide: IČO, USt-IdNr, NIP, P.IVA, etc.)
  invoiceNumber: string | null;
  issueDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: "EUR";
};

/** Normalize backend parsed object: map various amount field names and parse string values (e.g. "65,19"). */
function normalizeToOcrParsed(
  raw: Record<string, unknown> | null | undefined,
  rawText?: string | null
): OcrParsed {
  if (!raw || typeof raw !== "object") {
    return { supplierName: null, invoiceNumber: null, issueDate: null, totalAmount: null, vatAmount: null, currency: "EUR" };
  }
  const ocr = raw as Record<string, unknown>;
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
  if (totalAmount == null && rawText) totalAmount = extractTotalFromRawText(rawText);
  // When backend returns round number (45, 46, 50) but rawText has XX,XX EUR – prefer mobile fallback
  if (totalAmount != null && rawText && totalAmount >= 40 && totalAmount <= 60 && Number.isInteger(totalAmount)) {
    const fromRaw = extractTotalFromRawText(rawText);
    if (fromRaw != null && fromRaw % 1 !== 0) totalAmount = fromRaw;
  }

  let vatAmount: number | null = null;
  const vatRaw = ocr.vatAmount ?? ocr.vat ?? ocr.vatAmountCents;
  if (typeof vatRaw === "number" && Number.isFinite(vatRaw)) vatAmount = vatRaw >= 10000 ? vatRaw / 100 : vatRaw;
  else vatAmount = parseMoneyToNumber(vatRaw);
  if (vatAmount != null && (vatAmount <= 0 || vatAmount > MAX)) vatAmount = null;

  let supplierName = typeof ocr.supplierName === "string" ? ocr.supplierName.trim() : null;
  // Reject OCR noise: short Arabic-only strings (e.g. "کلام") from misread Latin on non-Arabic invoices
  if (supplierName && /^[\u0600-\u06FF\s]+$/.test(supplierName) && supplierName.length < 10) supplierName = null;
  // Strip OCR artifact: "y DEK s.r.o." -> "DEK s.r.o." (misread "ľ" from "Dodávateľ")
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
    totalAmount,
    vatAmount,
    currency: "EUR",
  };
}

export type OcrResult = {
  status: OcrStatus;
  parsed: OcrParsed | null;
  rawText?: string;
  errorCode?: string;
  cooldownSeconds?: number;
};

export async function runInvoiceOCR(payload: {
  filePath: string;
  storagePath?: string;
  attachmentId: string;
  mimeType: string;
  projectId?: string;
}) {
  console.log("[invoiceOCR] RUN_INVOICE_OCR_START");

  const user = auth().currentUser;
  console.log("[invoiceOCR] PRE uid:", user?.uid ?? null);

  if (user) {
    const t0 = Date.now();
    await user.getIdToken(true);
    console.log("[invoiceOCR] PRE token refreshed in ms:", Date.now() - t0);
  }

  const fn = getCallable("extractInvoiceData");
  console.log("[invoiceOCR] calling callable, ts:", Date.now());
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
    console.log("[invoiceOCR] response keys", Object.keys(data || {}));
    console.log("[invoiceOCR] response data", JSON.stringify(data ?? null, null, 2));
    return data;
  } catch (err: any) {
    clearTimeout(watchdog);
    console.error("[invoiceOCR] POST error code =", err?.code, "message =", err?.message, "details =", err?.details ?? null);
    throw err;
  } finally {
    console.log("[invoiceOCR] FINALLY reached, ts:", Date.now());
  }
}

export async function extractInvoiceData(input: {
  filePath: string;
  mimeType?: string;
  attachmentId?: string;
  projectId?: string;
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

  const payload = {
    filePath: normalizedPath,
    storagePath: normalizedPath,
    mimeType: input.mimeType ?? "",
    attachmentId: input.attachmentId ?? "",
    projectId: input.projectId ?? "",
  };

  try {
    const data = await runInvoiceOCR(payload);

    const result = data as OcrResult | (Record<string, unknown> & { ok?: boolean }) | undefined;
    if (!result) {
      return { status: "failed", parsed: null };
    }
    if ("ok" in result && result.ok === true && !("status" in result)) {
      const rawParsed = (result as OcrResult).parsed as Record<string, unknown> | null;
      const rawText = (result as { rawText?: string }).rawText ?? (result as { extractedText?: string }).extractedText;
      const parsed = normalizeToOcrParsed(rawParsed, rawText);
      return { status: "success" as const, parsed };
    }
    if (!("status" in result) || !(result as OcrResult).status) {
      return { status: "failed", parsed: null };
    }
    const ocrResult = result as OcrResult & { cooldownSeconds?: number };
    const rawParsed = ocrResult.parsed as Record<string, unknown> | null;
    const rawText = ocrResult.rawText ?? (result as { extractedText?: string }).extractedText;
    if (ocrResult.status === "limit") {
      return {
        status: "limit",
        parsed: null,
        errorCode: ocrResult.errorCode ?? "LIMIT_REACHED",
        cooldownSeconds: ocrResult.cooldownSeconds,
      };
    }
    console.log("[expense autofill] amount candidates (raw)", {
      total: rawParsed?.total,
      totalAmount: rawParsed?.totalAmount,
      grandTotal: rawParsed?.grandTotal,
      amount: rawParsed?.amount,
      sum: rawParsed?.sum,
      amountCents: rawParsed?.amountCents,
    });
    const parsed = normalizeToOcrParsed(rawParsed, rawText);
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
    return { ...ocrResult, parsed };
  } catch (error: any) {
    const errStr = error != null
      ? `code=${error?.code ?? "?"} msg=${error?.message ?? "?"} details=${JSON.stringify(error?.details ?? error)}`
      : "error is null/undefined";
    console.error("[invoiceOCR] extractInvoiceData catch:", errStr);
    const code = String(error?.code ?? error?.message ?? (error != null ? String(error) : "") ?? "");
    if (code.toLowerCase().includes("not_found") || code.toLowerCase().includes("not-found")) {
      return { status: "failed", parsed: null, errorCode: "NOT_FOUND" };
    }
    return { status: "failed", parsed: null, errorCode: code || "UNKNOWN" };
  }
}
