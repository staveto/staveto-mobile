/**
 * Project Photos – zoznam všetkých fotiek projektu
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { InAppAttachmentViewer, inferInAppViewerMode } from "../components/InAppAttachmentViewer";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as attachmentsService from "../services/attachments";
import type { AttachmentDoc } from "../services/attachments";
import * as storageSmart from "../services/storageSmart";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

const GRID_GAP = spacing.sm;
const NUM_COLUMNS = 3;

export function ProjectPhotosScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useI18n();
  const params = (route.params as { projectId?: string; projectName?: string }) ?? {};
  const projectId = params.projectId ?? "";
  const projectName = params.projectName ?? "";
  const { isOffline, isPoorNetwork } = useOnlineStatus();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photos, setPhotos] = useState<AttachmentDoc[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [viewingPhoto, setViewingPhoto] = useState<AttachmentDoc | null>(null);
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const atts = await attachmentsService.listAttachments(projectId);
        const imageAtts = attachmentsService.attachmentsForProjectPhotoGallery(atts);
        setPhotos(imageAtts);

        const urlMap = new Map<string, string>();
        const onlineStatus = { isOffline, isPoorNetwork };
        for (const a of imageAtts) {
          const cached = (a as AttachmentDoc & { downloadURL?: string }).downloadURL;
          if (cached) {
            urlMap.set(a.id, cached);
            continue;
          }
          try {
            const url = await storageSmart.getDownloadUrlSmart(a.storagePath, onlineStatus);
            if (url) urlMap.set(a.id, url);
          } catch {
            // skip
          }
        }
        setPhotoUrls(urlMap);
      } catch (e) {
        console.error("[ProjectPhotos] Load error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, isOffline, isPoorNetwork]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openPhoto = async (att: AttachmentDoc) => {
    try {
      const cached =
        (att as AttachmentDoc & { downloadURL?: string }).downloadURL ?? photoUrls.get(att.id);
      if (cached) {
        setViewingUrl(cached);
        setViewingPhoto(att);
        return;
      }
      const url = await storageSmart.getDownloadUrlSmart(att.storagePath, {
        isOffline,
        isPoorNetwork,
      });
      setViewingUrl(url ?? null);
      setViewingPhoto(att);
    } catch {
      // ignore
    }
  };

  const cellSize = (width - spacing.md * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("projectPhotos.title") || "Fotky"}
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : photos.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="images-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t("projectPhotos.noPhotos") || "Žiadne fotky"}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
        >
          <View style={styles.grid}>
            {photos.map((att) => {
              const url = photoUrls.get(att.id);
              return (
                <TouchableOpacity
                  key={att.id}
                  style={[styles.cell, { width: cellSize, height: cellSize }]}
                  onPress={() => openPhoto(att)}
                  activeOpacity={0.8}
                >
                  {url ? (
                    <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.placeholder]}>
                      <Ionicons name="image-outline" size={32} color={colors.textMuted} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      <InAppAttachmentViewer
        visible={viewingPhoto !== null}
        onClose={() => {
          setViewingPhoto(null);
          setViewingUrl(null);
        }}
        url={viewingUrl}
        fileName={viewingPhoto?.fileName ?? ""}
        mode={viewingPhoto ? inferInAppViewerMode(viewingPhoto) : "image"}
        debugOpenSource="projectPhotosGrid"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  headerBack: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  cell: {
    borderRadius: 8,
    overflow: "hidden",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    backgroundColor: "rgba(0,0,0,0.05)",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginRight: spacing.md,
  },
  modalClose: {
    padding: spacing.xs,
  },
  modalScroll: { flex: 1 },
  modalContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalImage: {
    width: "100%",
    aspectRatio: 1,
    maxWidth: "100%",
    maxHeight: "100%",
  },
});
