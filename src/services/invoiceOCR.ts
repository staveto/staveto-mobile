import functionsModule from "@react-native-firebase/functions";

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

export async function extractInvoiceData(input: {
  filePath: string;
  mimeType?: string;
  attachmentId?: string;
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
    const regionalFunctions = functionsModule(undefined, "europe-west1");
    const fn = regionalFunctions.httpsCallable("extractInvoiceData");
    // Keep both keys for backward compatibility with already deployed backend.
    const result = await fn({
      filePath: normalizedPath,
      storagePath: normalizedPath,
      mimeType: input.mimeType ?? null,
      attachmentId: input.attachmentId ?? null,
    });
    const data = result?.data as OcrResult | undefined;
    if (!data || !data.status) {
      return { status: "failed", parsed: null };
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
