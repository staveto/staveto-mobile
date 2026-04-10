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

function buildStorageOcrCallableUrl(): string {
  const fromEnv = getExtraEnv("EXPO_PUBLIC_EXTRACT_INVOICE_STORAGE_OCR_URL");
  if (fromEnv) return fromEnv.trim();
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
