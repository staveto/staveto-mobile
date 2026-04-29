import { Image } from "react-native";

/** Long edge cap (~Retina ×2); balances quality vs Storage/load like typical messenger uploads. */
const MAX_EDGE_PX = 2048;
/** JPEG quality similar to common messaging apps (trade-off vs size). */
const JPEG_QUALITY = 0.82;

function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Resize large photos and re-encode as JPEG to reduce Storage size and UI decode cost.
 * Skips GIF (animation), SVG, and non-images.
 *
 * Loads `expo-image-manipulator` only when this runs (not at app startup), so missing
 * native code after an OTA JS update does not red-screen — we fall back to the original file.
 * For compression to work, the dev/production build must include the native module (`expo run:android` / EAS).
 */
export async function compressImageForUpload(
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<{ uri: string; fileName: string; mimeType: string }> {
  try {
    return await compressImageForUploadImpl(localUri, fileName, mimeType);
  } catch (e) {
    if (__DEV__) {
      console.warn("[imageCompress] unexpected failure — uploading original:", e);
    }
    return { uri: localUri, fileName, mimeType };
  }
}

async function compressImageForUploadImpl(
  localUri: string,
  fileName: string,
  mimeType: string
): Promise<{ uri: string; fileName: string; mimeType: string }> {
  const mt = mimeType.toLowerCase();
  if (!mt.startsWith("image/")) {
    return { uri: localUri, fileName, mimeType };
  }
  if (mt.includes("gif") || mt.includes("svg")) {
    return { uri: localUri, fileName, mimeType };
  }

  /** Dynamic import + `.catch` — some RN builds surface missing native modules as rejected imports (not sync throws). */
  const manipulator = await import("expo-image-manipulator").catch(() => null);
  if (!manipulator || typeof manipulator.manipulateAsync !== "function") {
    if (__DEV__) {
      console.warn(
        "[imageCompress] expo-image-manipulator not available — uploading original. Rebuild the dev client so native code matches JS (e.g. npx expo run:android)."
      );
    }
    return { uri: localUri, fileName, mimeType };
  }

  let width = 0;
  let height = 0;
  try {
    const sz = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(localUri, (w, h) => resolve({ width: w, height: h }), reject);
    });
    width = sz.width;
    height = sz.height;
  } catch {
    width = 0;
    height = 0;
  }

  const actions: Array<{ resize: { width: number; height: number } } | { resize: { width: number } }> = [];
  if (width > 0 && height > 0) {
    const maxDim = Math.max(width, height);
    if (maxDim > MAX_EDGE_PX) {
      const scale = MAX_EDGE_PX / maxDim;
      actions.push({
        resize: {
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        },
      });
    }
  } else {
    actions.push({ resize: { width: MAX_EDGE_PX } });
  }

  try {
    const result = await manipulator.manipulateAsync(localUri, actions, {
      compress: JPEG_QUALITY,
      format: manipulator.SaveFormat.JPEG,
    });

    const base = stripExtension(fileName);
    return {
      uri: result.uri,
      fileName: `${base}.jpg`,
      mimeType: "image/jpeg",
    };
  } catch (e) {
    console.warn("[imageCompress] manipulateAsync failed — uploading original:", e);
    return { uri: localUri, fileName, mimeType };
  }
}

