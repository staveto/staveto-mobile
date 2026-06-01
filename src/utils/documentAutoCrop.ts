import { Image } from "react-native";

export type DocumentCropRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type DocumentAutoCropResult = {
  uri: string;
  didCrop: boolean;
  confidence: number;
  cropRect?: DocumentCropRect;
  reason?: string;
};

type AutoCropInput = {
  uri: string;
  width?: number;
  height?: number;
};

/** Allow light finishing trims after native crop; full trims need slightly higher score. */
const MIN_CONFIDENCE = 0.58;
const MIN_EDGE_PX = 400;
const MIN_CROP_DIMENSION = 200;
const MAX_INSET = 0.15;

function logDebug(payload: Record<string, unknown>) {
  if (__DEV__) {
    console.log("[DocumentAutoCropDebug]", payload);
  }
}

function cropMetrics(
  width: number,
  height: number,
  cropRect: DocumentCropRect | null
): {
  aspectRatioBefore: number;
  aspectRatioAfter: number | null;
  marginTrimPercentX: number | null;
  marginTrimPercentY: number | null;
} {
  const aspectRatioBefore = Number((width / height).toFixed(3));
  if (!cropRect) {
    return { aspectRatioBefore, aspectRatioAfter: null, marginTrimPercentX: null, marginTrimPercentY: null };
  }
  const marginTrimPercentX = Number(((1 - cropRect.width / width) * 50).toFixed(1));
  const marginTrimPercentY = Number(((1 - cropRect.height / height) * 50).toFixed(1));
  return {
    aspectRatioBefore,
    aspectRatioAfter: Number((cropRect.width / cropRect.height).toFixed(3)),
    marginTrimPercentX,
    marginTrimPercentY,
  };
}

async function resolveDimensions(
  uri: string,
  width?: number,
  height?: number
): Promise<{ width: number; height: number } | null> {
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
    });
    return { width: Math.round(size.width), height: Math.round(size.height) };
  } catch {
    return null;
  }
}

function clampInset(value: number): number {
  return Math.min(Math.max(value, 0), MAX_INSET);
}

/**
 * Conservative margin-trim heuristic for receipt/invoice photos.
 * Does not analyze pixels — uses aspect ratio signals only.
 */
function estimateDocumentCrop(
  width: number,
  height: number
): { cropRect: DocumentCropRect | null; confidence: number; reason: string } {
  if (width < MIN_EDGE_PX || height < MIN_EDGE_PX) {
    return { cropRect: null, confidence: 0, reason: "image_too_small" };
  }

  const ratio = width / height;

  let insetX = 0;
  let insetY = 0;
  let confidence = 0;
  let reason = "no_clear_margin_signal";

  if (ratio < 0.62) {
    insetX = 0.14;
    insetY = 0.1;
    confidence = 0.74;
    reason = "tall_frame_margin_trim";
  } else if (ratio < 0.68) {
    insetX = 0.12;
    insetY = 0.08;
    confidence = 0.67;
    reason = "portrait_margin_trim";
  } else if (ratio <= 1.05) {
    // Common after native crop — still trim visible table/background margins.
    insetX = 0.08;
    insetY = 0.08;
    confidence = 0.63;
    reason = "document_like_finishing_trim";
  } else if (ratio > 1.35) {
    insetX = 0.1;
    insetY = 0.12;
    confidence = 0.72;
    reason = "landscape_margin_trim";
  } else if (ratio > 1.05) {
    insetX = 0.08;
    insetY = 0.1;
    confidence = 0.64;
    reason = "wide_frame_margin_trim";
  } else {
    return { cropRect: null, confidence: 0.4, reason: "no_clear_margin_signal" };
  }

  insetX = clampInset(insetX);
  insetY = clampInset(insetY);

  const originX = Math.round(width * insetX);
  const originY = Math.round(height * insetY);
  const cropWidth = Math.round(width * (1 - 2 * insetX));
  const cropHeight = Math.round(height * (1 - 2 * insetY));

  if (cropWidth < MIN_CROP_DIMENSION || cropHeight < MIN_CROP_DIMENSION) {
    return { cropRect: null, confidence: 0, reason: "crop_too_small" };
  }

  if (cropWidth > width * 0.96 || cropHeight > height * 0.96) {
    return { cropRect: null, confidence: 0.3, reason: "margins_too_small" };
  }

  return {
    cropRect: { originX, originY, width: cropWidth, height: cropHeight },
    confidence,
    reason,
  };
}

function noCrop(uri: string, reason: string, confidence = 0): DocumentAutoCropResult {
  return { uri, didCrop: false, confidence, reason };
}

/**
 * Attempts a safe document margin crop for expense receipt photos.
 * Never throws — returns the original URI on failure or low confidence.
 */
export async function autoCropDocumentImage(input: AutoCropInput): Promise<DocumentAutoCropResult> {
  try {
    const dims = await resolveDimensions(input.uri, input.width, input.height);
    if (!dims) {
      const result = noCrop(input.uri, "dimensions_unavailable");
      logDebug({
        didCrop: false,
        confidence: 0,
        reason: result.reason,
        originalWidth: input.width ?? null,
        originalHeight: input.height ?? null,
      });
      return result;
    }

    const { width, height } = dims;
    const estimate = estimateDocumentCrop(width, height);
    const metrics = cropMetrics(width, height, estimate.cropRect);

    if (!estimate.cropRect || estimate.confidence < MIN_CONFIDENCE) {
      logDebug({
        didCrop: false,
        confidence: estimate.confidence,
        reason: estimate.reason,
        originalWidth: width,
        originalHeight: height,
        cropRect: estimate.cropRect ?? null,
        ...metrics,
      });
      return noCrop(input.uri, estimate.reason, estimate.confidence);
    }

    const manipulator = await import("expo-image-manipulator").catch(() => null);
    if (!manipulator || typeof manipulator.manipulateAsync !== "function") {
      if (__DEV__) {
        console.warn(
          "[DocumentAutoCropDebug] expo-image-manipulator unavailable — using original image"
        );
      }
      logDebug({
        didCrop: false,
        confidence: estimate.confidence,
        reason: "manipulator_unavailable",
        originalWidth: width,
        originalHeight: height,
        cropRect: estimate.cropRect,
        ...metrics,
      });
      return noCrop(input.uri, "manipulator_unavailable", estimate.confidence);
    }

    const cropped = await manipulator.manipulateAsync(
      input.uri,
      [{ crop: estimate.cropRect }],
      { compress: 0.9, format: manipulator.SaveFormat.JPEG }
    );

    const result: DocumentAutoCropResult = {
      uri: cropped.uri,
      didCrop: true,
      confidence: estimate.confidence,
      cropRect: estimate.cropRect,
      reason: estimate.reason,
    };

    logDebug({
      didCrop: true,
      confidence: result.confidence,
      reason: result.reason,
      originalWidth: width,
      originalHeight: height,
      cropRect: result.cropRect,
      ...metrics,
    });

    return result;
  } catch (error) {
    if (__DEV__) {
      console.warn("[DocumentAutoCropDebug] auto crop failed — using original:", error);
    }
    return noCrop(input.uri, "error");
  }
}
