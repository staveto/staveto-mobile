import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cacheDirectory,
  deleteAsync,
  downloadAsync,
  FileSystemSessionType,
} from "expo-file-system/legacy";
import type { AttachmentDoc } from "../services/attachments";
import { colors, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";

export type InAppViewerMode = "image" | "pdf" | "web";

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;

function isFirebaseStorageDownloadUrl(uri: string): boolean {
  try {
    const host = new URL(uri).host.toLowerCase();
    return host.includes("firebasestorage.googleapis.com") || host.includes("storage.googleapis.com");
  } catch {
    return false;
  }
}

/** True when URL path or fileName looks like a photo (Firebase paths often omit metadata). */
export function urlLooksLikeImage(uri: string | null, fileName?: string): boolean {
  if (!uri) return false;
  const fn = (fileName || "").toLowerCase();
  if (fn && IMAGE_EXT_RE.test(fn)) return true;
  try {
    const path = decodeURIComponent(new URL(uri).pathname).toLowerCase();
    return IMAGE_EXT_RE.test(path);
  } catch {
    return IMAGE_EXT_RE.test(uri.toLowerCase());
  }
}

export function urlLooksLikePdf(uri: string | null, fileName?: string): boolean {
  const fn = (fileName || "").toLowerCase();
  if (fn.endsWith(".pdf")) return true;
  if (!uri) return false;
  const lower = uri.toLowerCase();
  if (lower.includes(".pdf")) return true;
  try {
    const path = decodeURIComponent(new URL(uri).pathname).toLowerCase();
    return path.includes(".pdf");
  } catch {
    return false;
  }
}

/** Detect photos even when legacy metadata used fileType "document" / "other". */
export function isAttachmentImage(
  att: Pick<AttachmentDoc, "fileType" | "fileName" | "contentType">
): boolean {
  if (att.fileType === "image") return true;
  const fn = (att.fileName || "").toLowerCase();
  const ct = (att.contentType || "").toLowerCase();
  return ct.startsWith("image/") || IMAGE_EXT_RE.test(fn);
}

export function inferInAppViewerMode(
  att: Pick<AttachmentDoc, "fileType" | "fileName" | "contentType">
): InAppViewerMode {
  if (isAttachmentImage(att)) return "image";
  const fn = (att.fileName || "").toLowerCase();
  const ct = (att.contentType || "").toLowerCase();
  if (att.fileType === "pdf" || fn.endsWith(".pdf") || ct.includes("pdf")) return "pdf";
  return "web";
}

/**
 * Never use WebView for Firebase Storage image URLs ? Android opens them in Chrome.
 * Paths like .../attachments/{uuid}?alt=media often have no file extension.
 */
export function resolveInAppViewerMode(
  mode: InAppViewerMode,
  url: string | null,
  fileName: string
): InAppViewerMode {
  if (mode === "image") return "image";
  if (urlLooksLikeImage(url, fileName)) return "image";
  if (mode === "pdf" || urlLooksLikePdf(url, fileName)) return "pdf";
  if (url && isFirebaseStorageDownloadUrl(url) && !urlLooksLikePdf(url, fileName)) {
    return "image";
  }
  return mode;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  url: string | null;
  fileName: string;
  mode: InAppViewerMode;
  /** __DEV__ only: where preview was opened from (e.g. projectDocumentRow). */
  debugOpenSource?: string;
};

const win = Dimensions.get("window");
const PREVIEW_MAX_W = Math.min(win.width, 900);
const PREVIEW_MAX_H = win.height * 0.88;
/** End loading overlay and show in-app fallback if WebView never finishes. */
const PREVIEW_LOAD_TIMEOUT_MS = 10_000;
/** Android: try Google Docs embed in WebView if direct PDF load stalls. */
const PDF_GDOCS_ESCALATE_MS = 5_000;
const IMAGE_LOAD_TIMEOUT_MS = 12_000;

function urlHostOnly(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}

function googleDocsEmbedUrl(remoteUrl: string): string {
  return `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(remoteUrl)}`;
}

function isGoogleDocsViewerUri(uri: string): boolean {
  return uri.includes("docs.google.com/viewer");
}

function isLocalPreviewUri(uri: string): boolean {
  return uri.startsWith("file://") || uri.startsWith("content://");
}

type PdfEmbedStage = "direct" | "base64" | "gdocs" | "pdfjs";

/** Keep base64 WebView payloads bounded (Hermes string limits). */
const PDF_BASE64_MAX_BYTES = 12 * 1024 * 1024;

function mozillaPdfJsViewerUrl(remoteUrl: string): string {
  return `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(remoteUrl)}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const encode = globalThis.btoa;
  if (!encode) return "";
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return encode(binary);
}

function buildPdfBase64Html(base64: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0,maximum-scale=5,user-scalable=yes"/></head><body style="margin:0;height:100vh;overflow:hidden;background:#0f172a"><iframe src="data:application/pdf;base64,${base64}" type="application/pdf" width="100%" height="100%" style="border:0"></iframe></body></html>`;
}

function buildAndroidLocalPdfHtml(localUri: string): string {
  const safe = localUri.replace(/"/g, "%22");
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0,maximum-scale=4,user-scalable=yes"/></head><body style="margin:0;height:100vh;overflow:hidden;background:#0f172a"><embed src="${safe}" type="application/pdf" width="100%" height="100%"/></body></html>`;
}

/** Android: render downloaded PDF inside WebView without Google/CDN (works on emulator offline). */
async function buildPdfBase64HtmlFromCachedFile(localUri: string): Promise<string | null> {
  try {
    const response = await fetch(localUri);
    if (!response.ok) return null;
    const ab = await response.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > PDF_BASE64_MAX_BYTES) return null;
    const base64 = uint8ArrayToBase64(new Uint8Array(ab));
    if (!base64) return null;
    return buildPdfBase64Html(base64);
  } catch {
    return null;
  }
}

export function InAppAttachmentViewer({ visible, onClose, url, fileName, mode, debugOpenSource }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const resolvedMode = useMemo(
    () => resolveInAppViewerMode(mode, url, fileName),
    [mode, url, fileName]
  );
  const [imgLoading, setImgLoading] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState(false);
  /** Local file:// URI after cache download; for PDF fallback equals remote `url`. */
  const [pdfDisplayUri, setPdfDisplayUri] = useState<string | null>(null);
  /** Android last resort: HTML embed of cached file:// PDF */
  const [pdfHtmlSource, setPdfHtmlSource] = useState<string | null>(null);
  const [imageDisplayUri, setImageDisplayUri] = useState<string | null>(null);
  const pdfCachePathRef = useRef<string | null>(null);
  const imageCachePathRef = useRef<string | null>(null);
  const pdfEmbedStageRef = useRef<PdfEmbedStage>("direct");
  const loadSessionRef = useRef(0);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gdocsEscalateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webLoadingRef = useRef(true);
  webLoadingRef.current = webLoading;

  const clearPreviewTimers = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (gdocsEscalateRef.current) {
      clearTimeout(gdocsEscalateRef.current);
      gdocsEscalateRef.current = null;
    }
    if (imageTimeoutRef.current) {
      clearTimeout(imageTimeoutRef.current);
      imageTimeoutRef.current = null;
    }
  }, []);

  const debugPreview = useCallback(
    (event: string, extra?: Record<string, unknown>) => {
      if (!__DEV__) return;
      console.log("[AttachmentPreviewDebug]", {
        event,
        fileName,
        mimeType:
          resolvedMode === "pdf" ? "application/pdf" : resolvedMode === "image" ? "image/*" : "text/html",
        isPdf: resolvedMode === "pdf",
        isImage: resolvedMode === "image",
        hasUrl: !!url,
        urlHost: urlHostOnly(url),
        viewerMode: resolvedMode,
        requestedMode: mode,
        openSource: debugOpenSource,
        pdfEmbedStage: resolvedMode === "pdf" ? pdfEmbedStageRef.current : undefined,
        webLoading: webLoadingRef.current,
        ...extra,
      });
    },
    [fileName, mode, resolvedMode, url, debugOpenSource]
  );

  const resetState = useCallback(() => {
    clearPreviewTimers();
    loadSessionRef.current += 1;
    pdfEmbedStageRef.current = "direct";
    setImgLoading(true);
    setImgError(false);
    setWebLoading(true);
    setWebError(false);
    setPdfDisplayUri(null);
    setPdfHtmlSource(null);
    setImageDisplayUri(null);
  }, [clearPreviewTimers]);

  useEffect(() => {
    if (visible) resetState();
  }, [visible, url, resolvedMode, resetState]);

  const purgeCachedPdf = useCallback(async () => {
    const p = pdfCachePathRef.current;
    pdfCachePathRef.current = null;
    if (p) {
      try {
        await deleteAsync(p, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const purgeCachedImage = useCallback(async () => {
    const p = imageCachePathRef.current;
    imageCachePathRef.current = null;
    if (p) {
      try {
        await deleteAsync(p, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (!visible || resolvedMode !== "image" || !url) {
      setImageDisplayUri(null);
      return;
    }

    if (Platform.OS !== "android" || url.startsWith("file://") || url.startsWith("content://")) {
      setImageDisplayUri(url);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const prev = imageCachePathRef.current;
      if (prev) {
        try {
          await deleteAsync(prev, { idempotent: true });
        } catch {
          /* ignore */
        }
        imageCachePathRef.current = null;
      }

      try {
        const dir = cacheDirectory;
        if (!dir) {
          if (!cancelled) setImageDisplayUri(url);
          return;
        }
        const extMatch = (fileName || "").match(/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i);
        const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
        const dest = `${dir}staveto_inapp_img_${Date.now()}.${ext}`;
        const res = await downloadAsync(url, dest, {
          sessionType: FileSystemSessionType.FOREGROUND,
        });
        if (cancelled) {
          try {
            await deleteAsync(dest, { idempotent: true });
          } catch {
            /* ignore */
          }
          return;
        }
        if (res.status >= 400) {
          setImageDisplayUri(url);
          return;
        }
        imageCachePathRef.current = res.uri;
        setImageDisplayUri(res.uri);
        debugPreview("imageUriReady", { viewerMode: "android-cached" });
      } catch {
        if (!cancelled) {
          setImageDisplayUri(url);
          debugPreview("imageUriReady", { viewerMode: "android-remote-fallback" });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [visible, resolvedMode, url, fileName, debugPreview]);

  useEffect(() => {
    if (!visible || resolvedMode !== "image" || !url || !imageDisplayUri) return;
    clearPreviewTimers();
    imageTimeoutRef.current = setTimeout(() => {
      setImgLoading(false);
      setImgError(true);
      debugPreview("imageTimeout", { timeoutReached: true });
    }, IMAGE_LOAD_TIMEOUT_MS);
    return () => {
      if (imageTimeoutRef.current) {
        clearTimeout(imageTimeoutRef.current);
        imageTimeoutRef.current = null;
      }
    };
  }, [visible, resolvedMode, url, imageDisplayUri, clearPreviewTimers, debugPreview]);

  useEffect(() => {
    if (!visible || !url || (resolvedMode !== "pdf" && resolvedMode !== "web")) {
      clearPreviewTimers();
      return;
    }
    if (resolvedMode === "pdf" && !pdfDisplayUri && !pdfHtmlSource) return;

    const session = ++loadSessionRef.current;
    debugPreview("loadStart", { loadStart: true });

    loadTimeoutRef.current = setTimeout(() => {
      if (loadSessionRef.current !== session) return;
      if (!webLoadingRef.current) return;
      debugPreview("loadTimeout", { timeoutReached: true });
      setWebLoading(false);
      setWebError(true);
    }, PREVIEW_LOAD_TIMEOUT_MS);

    if (
      resolvedMode === "pdf" &&
      Platform.OS === "android" &&
      url &&
      pdfEmbedStageRef.current === "direct" &&
      pdfDisplayUri &&
      !isGoogleDocsViewerUri(pdfDisplayUri) &&
      !pdfDisplayUri.includes("mozilla.github.io/pdf.js")
    ) {
      gdocsEscalateRef.current = setTimeout(() => {
        if (loadSessionRef.current !== session) return;
        debugPreview("gdocsEscalate", { timeoutReached: false });
        pdfEmbedStageRef.current = "gdocs";
        setWebError(false);
        setWebLoading(true);
        setPdfDisplayUri(googleDocsEmbedUrl(url));
      }, PDF_GDOCS_ESCALATE_MS);
    }

    return clearPreviewTimers;
  }, [visible, url, resolvedMode, pdfDisplayUri, clearPreviewTimers, debugPreview]);

  useEffect(() => {
    if (!visible || !url || resolvedMode !== "pdf") {
      return;
    }

    /** Prefetch PDF to cache (avoids Android system download UI and WebView stalls on remote URLs). */
    let cancelled = false;
    pdfEmbedStageRef.current = "direct";

    const run = async () => {
      const prev = pdfCachePathRef.current;
      if (prev) {
        try {
          await deleteAsync(prev, { idempotent: true });
        } catch {
          /* ignore */
        }
        pdfCachePathRef.current = null;
      }

      try {
        const dir = cacheDirectory;
        if (!dir) {
          if (!cancelled) setPdfDisplayUri(url);
          return;
        }
        const dest = `${dir}staveto_inapp_pdf_${Date.now()}.pdf`;
        const res = await downloadAsync(url, dest, {
          sessionType: FileSystemSessionType.FOREGROUND,
        });
        if (cancelled) {
          try {
            await deleteAsync(dest, { idempotent: true });
          } catch {
            /* ignore */
          }
          return;
        }
        if (res.status >= 400) {
          setPdfDisplayUri(url);
          return;
        }
        pdfCachePathRef.current = res.uri;
        if (Platform.OS === "android") {
          const base64Html = await buildPdfBase64HtmlFromCachedFile(res.uri);
          if (cancelled) return;
          if (base64Html) {
            pdfEmbedStageRef.current = "base64";
            setPdfHtmlSource(base64Html);
            setPdfDisplayUri("base64-html");
            debugPreview("pdfUriReady", { viewerMode: "android-base64" });
            return;
          }
          pdfEmbedStageRef.current = "gdocs";
          setPdfDisplayUri(googleDocsEmbedUrl(url));
          debugPreview("pdfUriReady", { viewerMode: "android-gdocs-after-cache" });
        } else {
          setPdfDisplayUri(res.uri);
          debugPreview("pdfUriReady", { viewerMode: "cached-local" });
        }
      } catch {
        if (!cancelled) {
          if (Platform.OS === "android") {
            pdfEmbedStageRef.current = "gdocs";
            setPdfDisplayUri(googleDocsEmbedUrl(url));
            debugPreview("pdfUriReady", { viewerMode: "android-gdocs-fallback" });
          } else {
            setPdfDisplayUri(url);
            debugPreview("pdfUriReady", { viewerMode: "remote-fallback" });
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [visible, url, resolvedMode, debugPreview]);

  const handleClose = useCallback(() => {
    clearPreviewTimers();
    void purgeCachedPdf();
    void purgeCachedImage();
    resetState();
    onClose();
  }, [onClose, purgeCachedPdf, purgeCachedImage, resetState, clearPreviewTimers]);

  const finishWebLoad = useCallback(() => {
    clearPreviewTimers();
    setWebLoading(false);
    debugPreview("loadEnd", { loadEnd: true });
  }, [clearPreviewTimers, debugPreview]);

  const failWebLoad = useCallback(
    (reason: string) => {
      if (Platform.OS === "android" && resolvedMode === "pdf" && url) {
        if (pdfEmbedStageRef.current === "base64") {
          debugPreview("loadError", { loadError: reason, retry: "gdocs" });
          setPdfHtmlSource(null);
          pdfEmbedStageRef.current = "gdocs";
          setWebError(false);
          setWebLoading(true);
          setPdfDisplayUri(googleDocsEmbedUrl(url));
          return;
        }
        if (pdfEmbedStageRef.current === "direct") {
          debugPreview("loadError", { loadError: reason, retry: "gdocs" });
          pdfEmbedStageRef.current = "gdocs";
          setWebError(false);
          setWebLoading(true);
          setPdfDisplayUri(googleDocsEmbedUrl(url));
          return;
        }
        if (pdfEmbedStageRef.current === "gdocs") {
          debugPreview("loadError", { loadError: reason, retry: "pdfjs" });
          pdfEmbedStageRef.current = "pdfjs";
          setWebError(false);
          setWebLoading(true);
          setPdfDisplayUri(mozillaPdfJsViewerUrl(url));
          return;
        }
        const cached = pdfCachePathRef.current;
        if (cached && !pdfHtmlSource) {
          debugPreview("loadError", { loadError: reason, retry: "local-html" });
          setPdfHtmlSource(buildAndroidLocalPdfHtml(cached));
          setPdfDisplayUri("local-html");
          setWebError(false);
          setWebLoading(true);
          return;
        }
      }
      clearPreviewTimers();
      setWebLoading(false);
      setWebError(true);
      debugPreview("loadError", { loadError: reason, loadEnd: false });
    },
    [resolvedMode, url, pdfHtmlSource, clearPreviewTimers, debugPreview]
  );

  const shouldAllowWebViewNavigation = useCallback(
    (targetUrl: string) => {
      if (resolvedMode === "image") return false;
      if (urlLooksLikeImage(targetUrl, fileName)) return false;
      if (isFirebaseStorageDownloadUrl(targetUrl) && !urlLooksLikePdf(targetUrl, fileName)) return false;
      return true;
    },
    [resolvedMode, fileName]
  );

  const openExternal = useCallback(() => {
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  }, [url]);

  const webSource = useMemo(() => {
    if (resolvedMode === "pdf") {
      if (pdfHtmlSource) {
        return {
          html: pdfHtmlSource,
          baseUrl: pdfCachePathRef.current ?? undefined,
        };
      }
      return pdfDisplayUri && pdfDisplayUri !== "local-html" ? { uri: pdfDisplayUri } : undefined;
    }
    return url ? { uri: url } : undefined;
  }, [resolvedMode, pdfDisplayUri, pdfHtmlSource, url]);

  const pdfWebReady =
    !!pdfHtmlSource ||
    (!!pdfDisplayUri &&
      pdfDisplayUri !== "local-html" &&
      pdfDisplayUri !== "base64-html");

  const canShowWeb =
    resolvedMode === "web" ? !!url : resolvedMode === "pdf" ? pdfWebReady : false;

  const showWebLoader =
    !webError &&
    (resolvedMode === "web"
      ? !!url && webLoading
      : resolvedMode === "pdf"
        ? (!pdfDisplayUri && !pdfHtmlSource) || webLoading
        : false);

  const loaderHint =
    resolvedMode === "pdf" && !pdfDisplayUri && !pdfHtmlSource
      ? t("attachments.fetchingPdf")
      : t("attachments.inAppPreviewLoading");

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.title} numberOfLines={1}>
            {fileName || "???"}
          </Text>
          <View style={styles.headerActions}>
            {url ? (
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={openExternal}
                accessibilityRole="button"
                accessibilityLabel={t("attachments.openInBrowserA11y")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="open-outline" size={22} color={colors.textOnDark} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t("attachments.closeA11y")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={28} color={colors.textOnDark} />
            </TouchableOpacity>
          </View>
        </View>

        {resolvedMode === "image" && url ? (
          <View style={[styles.body, styles.imageBody]}>
            {!imageDisplayUri && !imgError ? (
              <View style={styles.centerFill}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.hint}>{t("attachments.inAppPreviewLoading")}</Text>
              </View>
            ) : null}
            {imgError ? (
              <View style={styles.fallback}>
                <Text style={styles.fallbackText}>{t("attachments.inAppPreviewFailed")}</Text>
                <TouchableOpacity style={styles.fallbackBtn} onPress={openExternal} activeOpacity={0.85}>
                  <Text style={styles.fallbackBtnText}>{t("attachments.openInBrowser")}</Text>
                </TouchableOpacity>
              </View>
            ) : imageDisplayUri ? (
              <View style={styles.imageStage}>
                <Image
                  source={{ uri: imageDisplayUri }}
                  style={[styles.image, { maxWidth: PREVIEW_MAX_W, maxHeight: PREVIEW_MAX_H }]}
                  resizeMode="contain"
                  onLoadStart={() => {
                    setImgLoading(true);
                    setImgError(false);
                    debugPreview("loadStart", { loadStart: true });
                  }}
                  onLoadEnd={() => {
                    if (imageTimeoutRef.current) {
                      clearTimeout(imageTimeoutRef.current);
                      imageTimeoutRef.current = null;
                    }
                    setImgLoading(false);
                    debugPreview("loadEnd", { loadEnd: true });
                  }}
                  onError={() => {
                    if (imageTimeoutRef.current) {
                      clearTimeout(imageTimeoutRef.current);
                      imageTimeoutRef.current = null;
                    }
                    setImgLoading(false);
                    setImgError(true);
                    debugPreview("loadError", { loadError: "image-error" });
                  }}
                />
                {imgLoading ? (
                  <View style={styles.centerFill}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.hint}>{t("attachments.inAppPreviewLoading")}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {(resolvedMode === "pdf" || resolvedMode === "web") && url ? (
          <View style={[styles.body, styles.webBody]}>
            {showWebLoader ? (
              <View style={styles.webLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.hint}>{loaderHint}</Text>
              </View>
            ) : null}
            {webError ? (
              <View style={styles.fallback}>
                <Text style={styles.fallbackText}>{t("attachments.inAppPreviewFailed")}</Text>
                <TouchableOpacity style={styles.fallbackBtn} onPress={openExternal} activeOpacity={0.85}>
                  <Text style={styles.fallbackBtnText}>{t("attachments.openInBrowser")}</Text>
                </TouchableOpacity>
              </View>
            ) : canShowWeb ? (
              <WebView
                key={
                  resolvedMode === "pdf"
                    ? pdfHtmlSource
                      ? "pdf-html"
                      : (pdfDisplayUri ?? url)
                    : url
                }
                source={webSource}
                style={styles.web}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                allowsFullscreenVideo={false}
                setSupportMultipleWindows={false}
                startInLoadingState={false}
                onShouldStartLoadWithRequest={(event) => shouldAllowWebViewNavigation(event.url)}
                onOpenWindow={() => false}
                onLoadStart={() => {
                  setWebLoading(true);
                  setWebError(false);
                  debugPreview("webViewLoadStart");
                }}
                onLoadEnd={finishWebLoad}
                onNavigationStateChange={(navState) => {
                  if (!navState.loading) finishWebLoad();
                }}
                onError={() => failWebLoad("webview-error")}
                onHttpError={(e) => {
                  if (resolvedMode === "pdf") {
                    // Hosted PDF viewers often trigger subresource 4xx; ignore for in-app PDF.
                    return;
                  }
                  const status = e.nativeEvent.statusCode;
                  if (status >= 400) {
                    failWebLoad(`http-${status}`);
                  }
                }}
                {...(Platform.OS === "android"
                  ? {
                      overScrollMode: "never" as const,
                      allowFileAccess: true,
                      allowUniversalAccessFromFileURLs: true,
                    }
                  : {})}
              />
            ) : null}
          </View>
        ) : null}

        {!url ? (
          <View style={styles.body}>
            <Text style={styles.fallbackText}>{t("attachments.missingFileLink")}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.97)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginRight: spacing.sm,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerBtn: {
    padding: spacing.xs,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  webBody: {
    alignSelf: "stretch",
    width: "100%",
  },
  imageBody: {
    alignSelf: "stretch",
  },
  imageStage: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  centerFill: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  image: {
    width: "100%",
    flexGrow: 1,
  },
  web: {
    flex: 1,
    width: "100%",
    backgroundColor: "#0f172a",
  },
  webLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
    backgroundColor: "rgba(15,23,42,0.75)",
  },
  hint: {
    marginTop: spacing.md,
    fontSize: 14,
    color: "rgba(255,255,255,0.75)",
  },
  fallback: {
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  fallbackText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
  },
  fallbackBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
  },
  fallbackBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
