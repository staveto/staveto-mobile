import auth from "@react-native-firebase/auth";
import functions from "@react-native-firebase/functions";
import { addProjectEvent } from "./projectEvents";

function getRegionalFunctions(region: string) {
  try {
    return (functions as unknown as (region: string) => ReturnType<typeof functions>)(region);
  } catch {
    return (functions as (app: unknown, region?: string) => ReturnType<typeof functions>)(undefined, region);
  }
}

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

export type OcrResult = {
  status: OcrStatus;
  parsed: OcrParsed | null;
  rawText?: string;
  errorCode?: string;
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

  const fns = getRegionalFunctions("europe-west1");
  const fn = fns.httpsCallable("extractInvoiceData");
  console.log("[invoiceOCR] region=europe-west1, calling callable, ts:", Date.now());
  console.log("[invoiceOCR] PAYLOAD:", JSON.stringify(payload));

  const watchdog = setTimeout(() => {
    console.error("[invoiceOCR] WATCHDOG: callable still pending after 8000ms");
  }, 8000);

  try {
    const t1 = Date.now();
    const result = await fn(payload);
    clearTimeout(watchdog);
    console.log("[invoiceOCR] POST result ms:", Date.now() - t1);
    console.log("[invoiceOCR] POST data:", JSON.stringify(result?.data ?? null));
    return result?.data;
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
      const parsed = (result as OcrResult).parsed ?? {
        supplierName: null,
        invoiceNumber: null,
        issueDate: null,
        totalAmount: null,
        vatAmount: null,
        currency: "EUR" as const,
      };
      return { status: "success" as const, parsed };
    }
    if (!("status" in result) || !(result as OcrResult).status) {
      return { status: "failed", parsed: null };
    }
    const ocrResult = result as OcrResult;
    if (ocrResult.status === "success" && input.projectId) {
      try {
        await addProjectEvent(
          input.projectId,
          "ocr_completed",
          { supplier: ocrResult.parsed?.supplierName ?? undefined },
          input.attachmentId ? { kind: "attachment", id: input.attachmentId } : { kind: "ocr" }
        );
      } catch (eventError) {
        console.warn("[invoiceOCR] Failed to create project event:", eventError);
      }
    }
    return ocrResult;
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
