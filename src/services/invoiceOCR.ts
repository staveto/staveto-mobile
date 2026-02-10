import functionsModule from "@react-native-firebase/functions";
import { addProjectEvent } from "./projectEvents";

export type OcrStatus = "success" | "failed" | "limit";

export type OcrParsed = {
  supplierName: string | null;
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

function getRegionalFunctions(region: string) {
  try {
    // Preferred signature in RNFirebase namespaced API.
    return (functionsModule as unknown as (region: string) => ReturnType<typeof functionsModule>)(region);
  } catch {
    // Backward-compatible fallback.
    return functionsModule(undefined, region);
  }
}

export async function extractInvoiceData(input: {
  filePath: string;
  mimeType?: string;
  attachmentId?: string;
  projectId?: string;
}): Promise<OcrResult> {
  try {
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
    console.log("[invoiceOCR] Calling extractInvoiceData with filePath:", normalizedPath);
    console.log("[invoiceOCR] OCR payload mimeType:", input.mimeType ?? null, "attachmentId:", input.attachmentId ?? null);
    // Keep both keys for backward compatibility with already deployed backend.
    const payload = {
      filePath: normalizedPath,
      storagePath: normalizedPath,
      mimeType: input.mimeType ?? null,
      attachmentId: input.attachmentId ?? null,
    };

    let result: { data?: unknown } | undefined;
    try {
      // Preferred region for this project.
      const regionalFunctions = getRegionalFunctions("europe-west1");
      const fn = regionalFunctions.httpsCallable("extractInvoiceData");
      result = await fn(payload);
    } catch (regionalError: any) {
      const code = String(regionalError?.code || regionalError?.message || "").toLowerCase();
      const shouldFallback =
        code.includes("not_found") ||
        code.includes("not-found") ||
        code.includes("functions/not-found") ||
        code.includes("unimplemented");

      if (!shouldFallback) {
        throw regionalError;
      }

      console.warn("[invoiceOCR] extractInvoiceData not found in europe-west1, retrying default region.");
      const defaultFunctions = functionsModule();
      const defaultFn = defaultFunctions.httpsCallable("extractInvoiceData");
      result = await defaultFn(payload);
    }

    const data = result?.data as OcrResult | undefined;
    if (!data || !data.status) {
      return { status: "failed", parsed: null };
    }
    if (data.status === "success" && input.projectId) {
      try {
        await addProjectEvent(
          input.projectId,
          "ocr_completed",
          { supplier: data.parsed?.supplierName ?? undefined },
          input.attachmentId ? { kind: "attachment", id: input.attachmentId } : { kind: "ocr" }
        );
      } catch (eventError) {
        console.warn("[invoiceOCR] Failed to create project event:", eventError);
      }
    }
    return data;
  } catch (error: any) {
    const code = String(error?.code || error?.message || "");
    // Typical case when callable function is not deployed yet.
    if (code.toLowerCase().includes("not_found") || code.toLowerCase().includes("not-found")) {
      return { status: "failed", parsed: null, errorCode: "NOT_FOUND" };
    }
    return { status: "failed", parsed: null, errorCode: code || "UNKNOWN" };
  }
}
