import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
  RefreshControl,
  TextInput,
  Platform,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cacheDirectory,
  deleteAsync,
  downloadAsync,
  FileSystemSessionType,
} from "expo-file-system/legacy";
import MapView, { Marker } from "react-native-maps";

// Lazy-load expo-av only when playing audio (avoids iOS mic indicator at startup)
let AudioModule: typeof import("expo-av") | null = null;
function getAudioModule(): typeof import("expo-av") | null {
  if (!AudioModule) {
    try {
      AudioModule = require("expo-av");
    } catch {}
  }
  return AudioModule;
}
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import * as problemPhotosService from "../services/problemPhotos";
import * as attachmentsService from "../services/attachments";
import type { ProblemDoc, ProblemStatus } from "../services/problems";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";
import { openLatLngInMaps } from "../lib/maps";
import { ICON_HIT_SLOP } from "../utils/accessibility";
import Constants from "expo-constants";

const PRIORITY_COLORS: Record<string, string> = {
  low: "#2e7d32",
  medium: "#f57c00",
  high: "#c62828",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type RouteParams = { projectId: string; problemId: string; projectName?: string; projectType?: string };

export function ProblemDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId, problemId } = (route.params ?? {}) as RouteParams;
  const insets = useSafeAreaInsets();
  const access = useProjectAccess(projectId);
  const [problem, setProblem] = useState<ProblemDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [showArchiveInput, setShowArchiveInput] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [photoPreviewLoading, setPhotoPreviewLoading] = useState(false);
  const photoCachePathRef = React.useRef<string | null>(null);
  const soundRef = React.useRef<{ unloadAsync: () => Promise<void>; playAsync: () => Promise<void>; pauseAsync: () => Promise<void> } | null>(null);

  const canEdit =
    access.isOwner ||
    problem?.createdByUid === user?.id ||
    problem?.assigneeUid === user?.id;

  const load = useCallback(async () => {
    if (!projectId || !problemId) return;
    try {
      const p = await problemsService.getProblem(projectId, problemId);
      setProblem(p);
      if (p?.photos?.length) {
        const urls = new Map<string, string>();
        for (const ph of p.photos) {
          try {
            const url = ph.downloadURL ?? (await problemPhotosService.getProblemPhotoURL(ph.path));
            urls.set(ph.path, url);
          } catch (e) {
            console.warn("[ProblemDetail] Failed to load photo URL:", ph.path);
          }
        }
        setPhotoUrls(urls);
      }
      if (p?.audioUrl) {
        setAudioUrl(p.audioUrl);
      } else if (p?.attachments?.length) {
        for (const attId of p.attachments) {
          try {
            const att = await attachmentsService.getAttachment(projectId, attId);
            if (att?.fileType === "audio") {
              const url = att.downloadURL ?? (await attachmentsService.getAttachmentURL(att));
              setAudioUrl(url);
              break;
            }
          } catch (e) {
            console.warn("[ProblemDetail] Failed to load attachment:", attId);
          }
        }
      } else if (p?.audioAttachmentId) {
        try {
          const att = await attachmentsService.getAttachment(projectId, p.audioAttachmentId);
          if (att) {
            const url = att.downloadURL ?? (await attachmentsService.getAttachmentURL(att));
            setAudioUrl(url);
          }
        } catch (e) {
          console.warn("[ProblemDetail] Failed to load legacy audio attachment:", e);
        }
      } else {
        setAudioUrl(null);
      }
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, problemId, navigation, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const toggleAudio = useCallback(async () => {
    const url = audioUrl;
    const mod = getAudioModule();
    if (!url || !mod?.Audio) return;
    try {
      if (soundRef.current) {
        if (audioPlaying) {
          await soundRef.current.pauseAsync();
        } else {
          await soundRef.current.playAsync();
        }
        setAudioPlaying(!audioPlaying);
        return;
      }
      const { sound } = await mod.Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setAudioPlaying(true);
      sound.setOnPlaybackStatusUpdate((s: { didJustFinishNotInterruptedly?: boolean }) => {
        if (s?.didJustFinishNotInterruptedly) {
          setAudioPlaying(false);
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch (e) {
      console.warn("[ProblemDetail] Audio play error:", e);
    }
  }, [audioUrl, audioPlaying]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const updateStatus = async (newStatus: ProblemStatus) => {
    if (!projectId || !problemId || !canEdit) return;
    try {
      await problemsService.updateProblem(projectId, problemId, { status: newStatus });
      setProblem((p) => (p ? { ...p, status: newStatus } : null));
      showToast(t("problems.saved"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
    }
  };

  const archiveProblem = async () => {
    if (!projectId || !problemId || !canEdit) return;
    if (!resolutionNote.trim()) {
      Alert.alert(t("common.error"), "Please add how the problem was fixed.");
      return;
    }
    try {
      await problemsService.updateProblem(projectId, problemId, {
        resolutionNote: resolutionNote.trim(),
        archivedAt: new Date(),
        archivedByUid: user?.id ?? null,
      });
      showToast(t("problems.saved"));
      navigation.goBack();
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
    }
  };

  const deleteProblem = () => {
    if (!access.isOwner) return;
    Alert.alert(
      t("common.delete"),
      t("problems.deleteConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await problemsService.deleteProblem(projectId, problemId);
              showToast(t("problems.deleted"));
              navigation.goBack();
            } catch (e) {
              Alert.alert(t("common.error"), e instanceof Error ? e.message : "Chyba");
            }
          },
        },
      ]
    );
  };

  const closePhotoPreview = useCallback(async () => {
    setPhotoPreviewOpen(false);
    setPhotoPreviewUri(null);
    setPhotoPreviewLoading(false);
    const cached = photoCachePathRef.current;
    photoCachePathRef.current = null;
    if (cached) {
      try {
        await deleteAsync(cached, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const openPhoto = useCallback(async (url: string) => {
    if (__DEV__) {
      console.log("[AttachmentPreviewDebug]", {
        event: "openPreview",
        openSource: "problemDetail",
        viewerMode: "image",
        hasUrl: !!url,
      });
    }
    setPhotoPreviewOpen(true);
    setPhotoPreviewLoading(true);
    setPhotoPreviewUri(null);

    if (Platform.OS === "android" && !url.startsWith("file://") && !url.startsWith("content://")) {
      try {
        const dir = cacheDirectory;
        if (dir) {
          const dest = `${dir}staveto_problem_photo_${Date.now()}.jpg`;
          const res = await downloadAsync(url, dest, {
            sessionType: FileSystemSessionType.FOREGROUND,
          });
          if (res.status < 400) {
            photoCachePathRef.current = res.uri;
            setPhotoPreviewUri(res.uri);
            setPhotoPreviewLoading(false);
            return;
          }
        }
      } catch (e) {
        if (__DEV__) console.warn("[ProblemDetail] photo cache download failed:", e);
      }
    }

    setPhotoPreviewUri(url);
    setPhotoPreviewLoading(false);
  }, []);

  if (loading || !problem) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const statusFlow: ProblemStatus[] = ["open", "in_progress", "fixed", "verified", "rejected"];

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[problem.priority] ?? "#888" }]} />
          <Text style={styles.category} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t(`problems.categories.${problem.category}`)}
          </Text>
          <Text style={styles.priority} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t(`problems.priorities.${problem.priority}`)}
          </Text>
        </View>

        <Text style={styles.description} maxFontSizeMultiplier={1.2}>
          {problem.shortDescription}
        </Text>

        {problem.photos && problem.photos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.photos")}
            </Text>
            <View style={styles.photoGrid}>
              {problem.photos.map((ph) => {
                const url = photoUrls.get(ph.path) ?? ph.downloadURL;
                if (!url) return null;
                return (
                  <TouchableOpacity
                    key={ph.path}
                    onPress={() => void openPhoto(url)}
                    accessibilityRole="button"
                    accessibilityLabel={t("problems.photos")}
                    hitSlop={ICON_HIT_SLOP}
                  >
                    <Image source={{ uri: url }} style={styles.photoThumb} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {problem.location && (
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.locationLabel")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
              {problem.location}
            </Text>
          </View>
        )}
        {problem.gpsLocation && (
          <View style={styles.gpsSection}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.gpsLocation")}
            </Text>
            <TouchableOpacity
              style={styles.miniMapWrap}
              onPress={() => openLatLngInMaps(problem.gpsLocation!.lat, problem.gpsLocation!.lng)}
              activeOpacity={0.9}
            >
              {Platform.OS !== "web" &&
              (Platform.OS !== "android" ||
                !!Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()) ? (
                <>
                  <MapView
                    style={styles.miniMap}
                    region={{
                      latitude: problem.gpsLocation.lat,
                      longitude: problem.gpsLocation.lng,
                      latitudeDelta: 0.002,
                      longitudeDelta: 0.002,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    <Marker
                      coordinate={{
                        latitude: problem.gpsLocation.lat,
                        longitude: problem.gpsLocation.lng,
                      }}
                      pinColor={colors.primary}
                    />
                  </MapView>
                  <View style={styles.miniMapOverlay}>
                    <Ionicons name="navigate" size={20} color="#fff" />
                    <Text style={styles.miniMapOverlayText}>{t("maps.openInMaps")}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.mapPlaceholder}>
                  <Ionicons name="map" size={48} color={colors.primary} />
                  <Text style={styles.mapPlaceholderText}>{t("maps.openInMaps")}</Text>
                  <Text style={styles.mapPlaceholderCoords}>
                    {problem.gpsLocation.lat.toFixed(5)}°, {problem.gpsLocation.lng.toFixed(5)}°
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.gpsRow}>
              <Ionicons name="location" size={18} color={colors.primary} />
              <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
                {problem.gpsLocation.lat.toFixed(5)}°, {problem.gpsLocation.lng.toFixed(5)}°
              </Text>
            </View>
          </View>
        )}
        {!!problem.equipmentName && (
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("equipment.equipment")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
              {problem.equipmentName}
            </Text>
          </View>
        )}
        {(problem.detail || audioUrl) && (
          <View style={styles.meta}>
            <TouchableOpacity
              onPress={() => setNoteExpanded((e) => !e)}
              style={styles.noteHeader}
              accessibilityRole="button"
              accessibilityLabel={noteExpanded ? t("problems.hideDetails") : t("problems.showDetails")}
            >
              <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
                {t("problems.noteOptional")}
              </Text>
              <Ionicons name={noteExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
            </TouchableOpacity>
            {noteExpanded && (
              <>
                {problem.detail && problem.detail !== t("problems.voiceMessage") ? (
                  <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
                    {problem.detail}
                  </Text>
                ) : null}
                {audioUrl && (
                  <Text style={[styles.metaValue, !problem.detail && styles.voiceMessageLabel]} maxFontSizeMultiplier={1.3}>
                    🎙 {t("problems.voiceMessage")}
                  </Text>
                )}
              </>
            )}
            {!noteExpanded && (
              <>
                {problem.detail && problem.detail !== t("problems.voiceMessage") ? (
                  <Text style={styles.notePreview} maxFontSizeMultiplier={1.3} numberOfLines={2}>
                    {problem.detail}
                  </Text>
                ) : audioUrl ? (
                  <Text style={styles.notePreview} maxFontSizeMultiplier={1.3}>
                    🎙 {t("problems.voiceMessage")}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        )}

        <View style={styles.metaDivider} />
        <View style={styles.metaGrid}>
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.assignee")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {problem.assigneeUid ? (problem.assigneeName || problem.assigneeUid) : t("problems.noOneFromGroup")}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.createdBy")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {problem.createdByName || problem.createdByUid || "—"}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.createdAt")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {formatDate(problem.createdAt)}
            </Text>
          </View>
          {problem.dueDate ? (
            <View style={styles.meta}>
              <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
                {t("problems.dueDate")}
              </Text>
              <Text style={styles.metaValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {formatDate(problem.dueDate)}
              </Text>
            </View>
          ) : null}
        </View>
        {!!problem.archivedAt && (
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              Archived
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
              {formatDate(problem.archivedAt)}
            </Text>
            {!!problem.resolutionNote && (
              <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
                {problem.resolutionNote}
              </Text>
            )}
          </View>
        )}

        <View style={styles.statusSection}>
          <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
            {t("problems.status")}
          </Text>
          <Text style={styles.statusValue} maxFontSizeMultiplier={1.2}>
            {t(`problems.statuses.${problem.status}`)}
          </Text>
          {canEdit && (
            <View style={styles.statusButtons}>
              {statusFlow.map((s) => {
                const isSelected = problem.status === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.statusBtn,
                      !isSelected && s === "rejected" && styles.statusBtnRejectUnselected,
                      !isSelected && s !== "rejected" && styles.statusBtnUnselected,
                      isSelected && s === "rejected" && styles.statusBtnReject,
                      isSelected && s !== "rejected" && styles.statusBtnSelected,
                      isSelected && styles.statusBtnSelectedBorder,
                    ]}
                    onPress={() => updateStatus(s)}
                    accessibilityRole="button"
                    accessibilityLabel={t(`problems.statuses.${s}`)}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View style={styles.statusBtnInner}>
                      {isSelected && <Ionicons name="checkmark-circle" size={18} color="#fff" style={{ marginRight: 6 }} />}
                      <Text style={styles.statusBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                        {t(`problems.statuses.${s}`)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {canEdit && !problem.archivedAt && (
          <View style={styles.archiveSection}>
            <TouchableOpacity
              style={[styles.statusBtn, styles.archiveBtn]}
              onPress={() => setShowArchiveInput((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Archive"
            >
              <Text style={styles.statusBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                Archive
              </Text>
            </TouchableOpacity>
            {showArchiveInput && (
              <View style={styles.archiveInputWrap}>
                <TextInput
                  style={styles.archiveInput}
                  value={resolutionNote}
                  onChangeText={setResolutionNote}
                  placeholder="How was the problem fixed?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
                <TouchableOpacity
                  style={[styles.statusBtn, styles.archiveConfirmBtn]}
                  onPress={archiveProblem}
                  accessibilityRole="button"
                  accessibilityLabel="Archive now"
                >
                  <Text style={styles.statusBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                    Archive now
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {access.isOwner && (
          <TouchableOpacity
            style={[styles.deleteBtn, { marginTop: spacing.md }]}
            onPress={deleteProblem}
            accessibilityRole="button"
            accessibilityLabel={t("common.delete")}
          >
            <Ionicons name="trash-outline" size={20} color={colors.error} />
            <Text style={styles.deleteBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              {t("common.delete")}
            </Text>
          </TouchableOpacity>
        )}

        {audioUrl && AudioModule?.Audio && (
          <View style={styles.audioSection}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.voiceNote")}
            </Text>
            <TouchableOpacity
              style={styles.audioBtn}
              onPress={toggleAudio}
              accessibilityRole="button"
              accessibilityLabel={audioPlaying ? (t("common.pause") || "Pause") : (t("common.play") || "Play")}
            >
              <Ionicons name={audioPlaying ? "pause" : "play"} size={24} color={colors.primary} />
              <Text style={styles.audioBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                {audioPlaying ? (t("common.pause") || "Pause") : (t("common.play") || "Play")}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
    <Modal
      visible={photoPreviewOpen}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => void closePhotoPreview()}
    >
      <View style={styles.photoPreviewOverlay}>
        <View style={[styles.photoPreviewHeader, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.photoPreviewTitle}>{t("problems.photos")}</Text>
          <TouchableOpacity
            onPress={() => void closePhotoPreview()}
            accessibilityRole="button"
            accessibilityLabel={t("attachments.closeA11y")}
            hitSlop={ICON_HIT_SLOP}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.photoPreviewBody}>
          {photoPreviewLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : photoPreviewUri ? (
            <Image
              source={{ uri: photoPreviewUri }}
              style={styles.photoPreviewImage}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.photoPreviewError}>{t("attachments.inAppPreviewFailed")}</Text>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 80 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm, flexWrap: "wrap", gap: spacing.sm },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  category: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase" },
  priority: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  description: { fontSize: 16, color: colors.text, marginBottom: spacing.sm, lineHeight: 22 },
  meta: { marginBottom: spacing.xs, flex: 1, minWidth: "45%" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metaDivider: { height: 1, backgroundColor: "#eee", marginVertical: spacing.sm },
  metaLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 1 },
  noteHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  notePreview: { fontSize: 14, color: colors.textMuted, fontStyle: "italic" },
  metaValue: { fontSize: 14, color: colors.text },
  gpsSection: { marginBottom: spacing.sm },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  miniMapWrap: { marginTop: spacing.xs, borderRadius: 8, overflow: "hidden", position: "relative", backgroundColor: "#f5f5f5", minHeight: 72 },
  miniMap: { width: "100%", height: 72 },
  mapPlaceholder: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
    backgroundColor: "#f0f4f8",
  },
  mapPlaceholderText: { fontSize: 14, fontWeight: "600", color: colors.primary, marginTop: spacing.xs },
  mapPlaceholderCoords: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  miniMapOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  miniMapOverlayText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  voiceMessageLabel: { marginTop: 4 },
  statusSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "#eee" },
  statusValue: { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: 2 },
  statusButtons: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.xs },
  statusBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusBtnInner: { flexDirection: "row", alignItems: "center" },
  statusBtnUnselected: { backgroundColor: "rgba(224, 103, 55, 0.45)" },
  statusBtnRejectUnselected: { backgroundColor: "rgba(220, 53, 69, 0.45)" },
  statusBtnSelected: { backgroundColor: colors.primary },
  statusBtnReject: { backgroundColor: colors.error },
  statusBtnSelectedBorder: { borderWidth: 3, borderColor: "#fff" },
  statusBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  archiveSection: { marginTop: spacing.sm, gap: spacing.sm },
  archiveBtn: { backgroundColor: "#6b7280" },
  archiveInputWrap: { gap: spacing.sm },
  archiveInput: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    padding: spacing.md,
    color: colors.text,
    minHeight: 88,
    textAlignVertical: "top",
  },
  archiveConfirmBtn: { backgroundColor: "#374151", alignSelf: "flex-start" },
  photosSection: { marginTop: spacing.sm },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.xs, gap: spacing.xs },
  photoThumb: { width: 64, height: 64, borderRadius: 6 },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.97)",
  },
  photoPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  photoPreviewTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  photoPreviewBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  photoPreviewImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.75,
  },
  photoPreviewError: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    textAlign: "center",
  },
  audioSection: { marginTop: spacing.md },
  audioBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
    padding: spacing.md,
    gap: spacing.sm,
  },
  audioBtnText: { color: colors.primary, fontSize: 16 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    gap: spacing.sm,
  },
  deleteBtnText: { color: colors.error, fontSize: 16 },
});
