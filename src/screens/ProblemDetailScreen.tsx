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
  Linking,
  RefreshControl,
  TextInput,
} from "react-native";

let AudioModule: typeof import("expo-av") | null = null;
try {
  AudioModule = require("expo-av");
} catch {}
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
import { ICON_HIT_SLOP } from "../utils/accessibility";

const PRIORITY_COLORS: Record<string, string> = {
  low: "#2e7d32",
  medium: "#f57c00",
  high: "#c62828",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
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
  const access = useProjectAccess(projectId);
  const [problem, setProblem] = useState<ProblemDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [showArchiveInput, setShowArchiveInput] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
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
    if (!url || !AudioModule?.Audio) return;
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
      const { sound } = await AudioModule.Audio.Sound.createAsync(
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

  const openPhoto = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  if (loading || !problem) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const statusFlow: ProblemStatus[] = ["open", "in_progress", "fixed", "verified", "rejected"];

  return (
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
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.noteOptional")}
            </Text>
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
          </View>
        )}

        <View style={styles.meta}>
          <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
            {t("problems.assignee")}
          </Text>
          <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
            {problem.assigneeName || problem.assigneeUid || "—"}
          </Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
            {t("problems.createdBy")}
          </Text>
          <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
            {problem.createdByName || problem.createdByUid || "—"}
          </Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
            {t("problems.createdAt")}
          </Text>
          <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
            {formatDate(problem.createdAt)}
          </Text>
        </View>
        {problem.dueDate && (
          <View style={styles.meta}>
            <Text style={styles.metaLabel} maxFontSizeMultiplier={1.2}>
              {t("problems.dueDate")}
            </Text>
            <Text style={styles.metaValue} maxFontSizeMultiplier={1.3}>
              {formatDate(problem.dueDate)}
            </Text>
          </View>
        )}
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
              {statusFlow.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusBtn,
                    s === "rejected" && styles.statusBtnReject,
                    problem.status === s && styles.statusBtnSelected,
                  ]}
                  onPress={() => updateStatus(s)}
                  accessibilityRole="button"
                  accessibilityLabel={t(`problems.statuses.${s}`)}
                  accessibilityState={{ selected: problem.status === s }}
                >
                  <Text style={styles.statusBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                    {t(`problems.statuses.${s}`)}
                  </Text>
                </TouchableOpacity>
              ))}
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
            style={[styles.deleteBtn, { marginTop: spacing.lg }]}
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
                    onPress={() => openPhoto(url)}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 80 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md, flexWrap: "wrap", gap: spacing.sm },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  category: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase" },
  priority: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  description: { fontSize: 18, color: colors.text, marginBottom: spacing.lg, lineHeight: 24 },
  meta: { marginBottom: spacing.sm },
  metaLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  metaValue: { fontSize: 15, color: colors.text },
  voiceMessageLabel: { marginTop: 4 },
  statusSection: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: "#eee" },
  statusValue: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 4 },
  statusButtons: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm },
  statusBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  statusBtnReject: { backgroundColor: colors.error },
  statusBtnSelected: {
    borderWidth: 2,
    borderColor: "#fff",
  },
  statusBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  archiveSection: { marginTop: spacing.md, gap: spacing.sm },
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
  photosSection: { marginTop: spacing.lg },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.sm },
  photoThumb: { width: 100, height: 100, borderRadius: 8 },
  audioSection: { marginTop: spacing.lg },
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
