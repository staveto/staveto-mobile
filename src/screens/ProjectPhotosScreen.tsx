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
  Alert,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { InAppAttachmentViewer } from "../components/InAppAttachmentViewer";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as attachmentsService from "../services/attachments";
import type { AttachmentDoc } from "../services/attachments";
import * as storageSmart from "../services/storageSmart";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useProjectAccess } from "../hooks/useProjectAccess";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {
  ImagePicker = null;
}

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
  const access = useProjectAccess(projectId);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const uploadSitePhoto = useCallback(
    async (localUri: string, fileName: string, mimeType = "image/jpeg") => {
      if (!projectId) return;
      if (!access.canWritePhotos) {
        Alert.alert(t("common.error"), t("projectOverview.noPermission"));
        return;
      }
      setUploading(true);
      try {
        await attachmentsService.uploadAttachment(projectId, {
          localUri,
          fileName,
          mimeType,
          kind: "image",
        });
        await load(true);
      } catch (error: unknown) {
        const c = (error as { code?: string }).code;
        Alert.alert(
          t("common.error"),
          c === "permission-denied"
            ? t("projectOverview.noPermission")
            : error instanceof Error
              ? error.message
              : t("common.error")
        );
      } finally {
        setUploading(false);
      }
    },
    [access.canWritePhotos, load, projectId, t]
  );

  const pickSitePhoto = useCallback(async () => {
    if (!access.canWritePhotos) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("projectOverview.imagePickerInstallCommand"));
      return;
    }
    const runCamera = async () => {
      const { status } = await ImagePicker!.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("projectOverview.cameraPermission"), t("projectOverview.cameraPermissionForInvoice"));
        return;
      }
      const result = await ImagePicker!.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        await uploadSitePhoto(asset.uri, asset.fileName || "image.jpg", asset.mimeType || "image/jpeg");
      }
    };
    const runGallery = async () => {
      const { status } = await ImagePicker!.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("projectOverview.galleryPermission"), t("projectOverview.galleryPermissionForInvoice"));
        return;
      }
      const result = await ImagePicker!.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        await uploadSitePhoto(asset.uri, asset.fileName || "image.jpg", asset.mimeType || "image/jpeg");
      }
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t("common.cancel"), t("projectOverview.takePhoto"), t("projectOverview.selectFromGallery")],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void runCamera();
          else if (buttonIndex === 2) void runGallery();
        }
      );
    } else {
      Alert.alert(t("projectOverview.selectSource"), t("projectOverview.selectSourceMessage"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("projectOverview.takePhoto"), onPress: () => void runCamera() },
        { text: t("projectOverview.selectFromGallery"), onPress: () => void runGallery() },
      ]);
    }
  }, [access.canWritePhotos, t, uploadSitePhoto]);

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
          {access.canWritePhotos ? (
            <TouchableOpacity style={styles.emptyAddBtn} onPress={() => void pickSitePhoto()} disabled={uploading}>
              <Ionicons name="camera-outline" size={20} color={colors.textOnDark} />
              <Text style={styles.emptyAddBtnText}>{t("projectOverview.addPhoto")}</Text>
            </TouchableOpacity>
          ) : null}
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
        mode="image"
        debugOpenSource="projectPhotosGrid"
      />

      {access.canWritePhotos ? (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
          onPress={() => void pickSitePhoto()}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={t("projectOverview.addPhoto")}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.textOnDark} />
          ) : (
            <Ionicons name="camera" size={26} color={colors.textOnDark} />
          )}
        </TouchableOpacity>
      ) : null}
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
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  emptyAddBtnText: {
    color: colors.textOnDark,
    fontWeight: "600",
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
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
