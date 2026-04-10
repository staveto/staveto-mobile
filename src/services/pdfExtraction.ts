import { extractPdfTextFromUri, extractPdfTextFromStorageFullPath } from "../utils/extractPdfText";

export type PdfTextExtractionDiagnostics = {
  localUriTried: boolean;
  storageTried: boolean;
  fromLocalChars: number;
  fromStorageChars: number;
  mergedChars: number;
  mergedSource: "local" | "storage" | "none";
};

const compactLen = (s: string | null | undefined) => s?.replace(/\s/g, "").length ?? 0;

/**
 * Tries local PDF URI first, then Storage full path; picks the richer text.
 */
export async function tryExtractPdfTextCombined(input: {
  storageFullPath: string;
  localPdfUri?: string;
}): Promise<{ rawText: string | null; diagnostics: PdfTextExtractionDiagnostics }> {
  const diagnostics: PdfTextExtractionDiagnostics = {
    localUriTried: !!input.localPdfUri,
    storageTried: true,
    fromLocalChars: 0,
    fromStorageChars: 0,
    mergedChars: 0,
    mergedSource: "none",
  };

  let fromLocal: string | null = null;
  if (input.localPdfUri) {
    try {
      fromLocal = await extractPdfTextFromUri(input.localPdfUri);
      diagnostics.fromLocalChars = fromLocal?.length ?? 0;
      if (__DEV__) {
        console.log("[pdfExtraction] local URI branch chars:", diagnostics.fromLocalChars, {
          uriKind: input.localPdfUri.includes("content://") ? "content" : "file/other",
        });
      }
    } catch (e) {
      console.warn("[pdfExtraction] extractPdfTextFromUri:", e);
    }
  }

  let fromStorage: string | null = null;
  try {
    fromStorage = await extractPdfTextFromStorageFullPath(input.storageFullPath.trim());
    diagnostics.fromStorageChars = fromStorage?.length ?? 0;
    if (__DEV__) {
      console.log("[pdfExtraction] storage branch chars:", diagnostics.fromStorageChars);
    }
  } catch (e) {
    console.warn("[pdfExtraction] extractPdfTextFromStorageFullPath:", e);
  }

  let rawText: string | null = fromLocal;
  if (compactLen(fromStorage) > compactLen(fromLocal)) {
    rawText = fromStorage;
    diagnostics.mergedSource = "storage";
  } else if (fromLocal && compactLen(fromLocal) > 0) {
    diagnostics.mergedSource = "local";
  } else if (fromStorage) {
    rawText = fromStorage;
    diagnostics.mergedSource = "storage";
  }

  diagnostics.mergedChars = rawText?.length ?? 0;
  return { rawText, diagnostics };
}

/**
 * Optional: render first PDF page to an image for on-device OCR.
 * Not wired (no bundled native rasterizer); cloud `extractInvoiceDataFromStorage` is the supported fallback.
 */
export async function tryRenderPdfFirstPageToImage(_localPdfUri: string): Promise<string | null> {
  if (__DEV__) {
    console.log(
      "[pdfExtraction] tryRenderPdfFirstPageToImage: skipped (no native PDF→image pipeline in this build; use cloud extraction for scanned PDFs)."
    );
  }
  return null;
}
