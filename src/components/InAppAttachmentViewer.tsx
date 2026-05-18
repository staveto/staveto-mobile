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

export function inferInAppViewerMode(
  att: Pick<AttachmentDoc, "fileType" | "fileName" | "contentType">
): InAppViewerMode {
  if (att.fileType === "image") return "image";
  const fn = (att.fileName || "").toLowerCase();
  const ct = (att.contentType || "").toLowerCase();
  if (att.fileType === "pdf" || fn.endsWith(".pdf") || ct.includes("pdf")) return "pdf";
  return "web";
}

type Props = {
  visible: boolean;
  onClose: () => void;
  url: string | null;
  fileName: string;
  mode: InAppViewerMode;
};

const win = Dimensions.get("window");
const PREVIEW_MAX_W = Math.min(win.width, 900);
const PREVIEW_MAX_H = win.height * 0.88;

export function InAppAttachmentViewer({ visible, onClose, url, fileName, mode }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [imgLoading, setImgLoading] = useState(true);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState(false);
  /** Local file:// URI after cache download; for PDF fallback equals remote `url`. */
  const [pdfDisplayUri, setPdfDisplayUri] = useState<string | null>(null);
  const pdfCachePathRef = useRef<string | null>(null);

  const resetState = useCallback(() => {
    setImgLoading(true);
    setWebLoading(true);
    setWebError(false);
    setPdfDisplayUri(null);
  }, []);

  useEffect(() => {
    if (visible) resetState();
  }, [visible, url, mode, resetState]);

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

  useEffect(() => {
    if (!visible || !url || mode !== "pdf") {
      return;
    }

    /**
     * Android WebView does not reliably render PDFs from a local `file://` URI (often fires
     * `onError`). iOS WKWebView handles local PDFs well and avoids the system "Downloading" UI
     * when we prefetch with a foreground session.
     */
    if (Platform.OS !== "ios") {
      setPdfDisplayUri(url);
      return;
    }

    let cancelled = false;

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
        setPdfDisplayUri(res.uri);
      } catch {
        if (!cancelled) setPdfDisplayUri(url);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [visible, url, mode]);

  const handleClose = useCallback(() => {
    void purgeCachedPdf();
    resetState();
    onClose();
  }, [onClose, purgeCachedPdf, resetState]);

  const openExternal = useCallback(() => {
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  }, [url]);

  const webSource = useMemo(() => {
    if (mode === "pdf") {
      return pdfDisplayUri ? { uri: pdfDisplayUri } : undefined;
    }
    return url ? { uri: url } : undefined;
  }, [mode, pdfDisplayUri, url]);

  const canShowWeb =
    mode === "web" ? !!url : mode === "pdf" ? !!pdfDisplayUri : false;

  const showWebLoader =
    !webError &&
    (mode === "web" ? !!url && webLoading : mode === "pdf" ? !pdfDisplayUri || webLoading : false);

  const loaderHint =
    mode === "pdf" && !pdfDisplayUri ? t("attachments.fetchingPdf") : t("attachments.inAppPreviewLoading");

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.title} numberOfLines={1}>
            {fileName || "—"}
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

        {mode === "image" && url ? (
          <View style={[styles.body, styles.imageBody]}>
            <View style={styles.imageStage}>
              <Image
                source={{ uri: url }}
                style={[styles.image, { maxWidth: PREVIEW_MAX_W, maxHeight: PREVIEW_MAX_H }]}
                resizeMode="contain"
                onLoadStart={() => setImgLoading(true)}
                onLoadEnd={() => setImgLoading(false)}
                onError={() => setImgLoading(false)}
              />
              {imgLoading ? (
                <View style={styles.centerFill}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {(mode === "pdf" || mode === "web") && url ? (
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
                key={mode === "pdf" ? pdfDisplayUri ?? url : url}
                source={webSource}
                style={styles.web}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                allowsFullscreenVideo={false}
                setSupportMultipleWindows={false}
                startInLoadingState={false}
                onLoadStart={() => {
                  setWebLoading(true);
                  setWebError(false);
                }}
                onLoadEnd={() => setWebLoading(false)}
                onError={() => {
                  if (
                    Platform.OS === "android" &&
                    mode === "pdf" &&
                    url &&
                    pdfDisplayUri &&
                    !pdfDisplayUri.includes("docs.google.com")
                  ) {
                    setWebLoading(true);
                    setWebError(false);
                    setPdfDisplayUri(
                      `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(url)}`
                    );
                    return;
                  }
                  setWebLoading(false);
                  setWebError(true);
                }}
                onHttpError={(e) => {
                  if (
                    Platform.OS === "android" &&
                    mode === "pdf" &&
                    url &&
                    pdfDisplayUri &&
                    !pdfDisplayUri.includes("docs.google.com") &&
                    e.nativeEvent.statusCode >= 400
                  ) {
                    setWebLoading(true);
                    setWebError(false);
                    setPdfDisplayUri(
                      `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(url)}`
                    );
                    return;
                  }
                  setWebLoading(false);
                  setWebError(true);
                }}
                {...(Platform.OS === "android"
                  ? {
                      overScrollMode: "never" as const,
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
