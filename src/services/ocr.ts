import { getApp } from "@react-native-firebase/app";
import { httpsCallableFromUrl } from "@react-native-firebase/functions";
import { auth, getFunctionsInstance } from "../firebase";
import { getExtraEnv } from "../lib/env";
import { isPlainObject } from "../utils/isPlainObject";
import { withTimeout, isTimeoutOrOfflineError } from "../utils/withTimeout";

const REGION = "europe-west1";
const CALLABLE_NAME = "extractInvoiceDataFromStorage";

export type StorageInvoiceExtractionPayload = {
  filePath: string;
  mimeType: string;
  projectId: string;
  attachmentId?: string;
};

/**
 * Dev/mock servers often return a fixed `STUB Faktúra…` body. Reject obvious non-production URLs
 * so production builds always hit the real Firebase Gen2 HTTPS callable for this project.
 */
function isRejectedStorageOcrUrlOverride(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith("https://")) return true;
  if (/\blocalhost\b/.test(u) || u.includes("127.0.0.1") || u.includes("10.0.2.2")) return true;
  if (/\b(mock|stub|fake.?ocr|dummy)\b/i.test(u)) return true;
  return false;
}

function buildStorageOcrCallableUrl(): string {
  const fromEnv = getExtraEnv("EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL");
  if (fromEnv) {
    if (isRejectedStorageOcrUrlOverride(fromEnv)) {
      console.error(
        "[ocr] Ignoring EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL (unsafe or dev/mock pattern). Using default Firebase callable URL instead.",
        fromEnv.slice(0, 160)
      );
    } else {
      console.warn("[ocr] Using EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL:", fromEnv.trim().slice(0, 120));
      return fromEnv.trim();
    }
  }
  const projectId = getApp()?.options?.projectId ?? "";
  return `https://${REGION}-${projectId}.cloudfunctions.net/${CALLABLE_NAME}`;
}

/**
 * Callable `extractInvoiceDataFromStorage` — server downloads Storage object,
 * extracts PDF text (pdf-parse) or runs Vision on images.
 *
 * Uses `httpsCallableFromUrl` (same pattern as AI project callables) so Gen-1
 * regional HTTPS URLs resolve reliably on React Native Firebase.
 */
export async function callExtractInvoiceDataFromStorage(
  payload: StorageInvoiceExtractionPayload
): Promise<unknown> {
  const user = auth()?.currentUser;
  if (user) {
    const t0 = Date.now();
    await user.getIdToken(true);
    if (__DEV__) console.log("[ocr] storage extraction token refresh ms:", Date.now() - t0);
  }

  const fns = getFunctionsInstance();
  if (!fns) throw new Error("FIREBASE_FUNCTIONS_NOT_READY");

  const projectId = getApp()?.options?.projectId ?? "(unknown)";
  const url = buildStorageOcrCallableUrl();

  console.log("[ocr] extractInvoiceDataFromStorage call", {
    region: REGION,
    callableName: CALLABLE_NAME,
    firebaseProjectId: projectId,
    url,
    filePathLen: payload.filePath?.length,
    mimeType: payload.mimeType,
    projectIdPayload: payload.projectId,
    attachmentId: payload.attachmentId,
  });

  const fn = httpsCallableFromUrl<StorageInvoiceExtractionPayload, unknown>(fns, url);

  try {
    const result = await withTimeout(fn(payload), 120_000, CALLABLE_NAME);
    const wrapped = result as { data?: unknown };
    const unwrapped = wrapped?.data !== undefined ? wrapped.data : wrapped;
    const p = isPlainObject(unwrapped) ? unwrapped : {};
    console.log("[ocr] extractInvoiceDataFromStorage unwrapped (pre-validation)", {
      keys: Object.keys(p),
      success: p.success === true,
      ok: p.ok === true,
    });
    // #region agent log
    {
      const el = (p as { extractionLog?: { fnImplVersion?: string } }).extractionLog;
      const src = (p as { source?: string }).source;
      const rt = (p as { rawText?: string }).rawText;
      const deployMismatch =
        src === "cloud-ocr" ||
        (typeof rt === "string" && /\bSTUB\b/i.test(rt) && !el?.fnImplVersion);
      fetch(`http://127.0.0.1:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b82e16" },
        body: JSON.stringify({
          sessionId: "b82e16",
          hypothesisId: "H1_deploy_mismatch",
          location: "ocr.ts:callExtractInvoiceDataFromStorage",
          message: "storage_ocr_response_shape",
          data: {
            urlUsed: url.slice(0, 120),
            responseSource: src ?? null,
            hasExtractionLog: !!el,
            fnImplVersion: el?.fnImplVersion ?? null,
            rawTextLen: typeof rt === "string" ? rt.length : 0,
            deployMismatchLikely: deployMismatch,
            keys: Object.keys(p),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
    return unwrapped;
  } catch (err) {
    if (isTimeoutOrOfflineError(err)) {
      const friendly = new Error(
        "Slabé pripojenie alebo žiadny internet. Skúste znova neskôr."
      ) as Error & { code?: string };
      friendly.code = "NETWORK_ERROR";
      (friendly as Error & { cause?: unknown }).cause = err;
      throw friendly;
    }
    throw err;
  }
}
