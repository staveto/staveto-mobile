import auth from "@react-native-firebase/auth";
import { getFns } from "../firebase";
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

  let vatAmount: number | null = null;
  const vatRaw = ocr.vatAmount ?? ocr.vat ?? ocr.vatAmountCents;
  if (typeof vatRaw === "number" && Number.isFinite(vatRaw)) vatAmount = vatRaw >= 10000 ? vatRaw / 100 : vatRaw;
  else vatAmount = parseMoneyToNumber(vatRaw);
  if (vatAmount != null && (vatAmount <= 0 || vatAmount > MAX)) vatAmount = null;

  return {
    supplierName: typeof ocr.supplierName === "string" ? ocr.supplierName : null,
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

  const fn = getFns().httpsCallable("extractInvoiceData");
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
      console.log("[expense autofill] amount candidates (raw, ok-branch)", {
        total: rawParsed?.total,
        totalAmount: rawParsed?.totalAmount,
        grandTotal: rawParsed?.grandTotal,
        amount: rawParsed?.amount,
        sum: rawParsed?.sum,
        amountCents: rawParsed?.amountCents,
      });
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
