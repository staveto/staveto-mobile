import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { useI18n } from "../../i18n/I18nContext";
import { colors, radius, spacing } from "../../theme";
import {
  listMyProjects,
  listProjectsAssignedToCurrentUser,
  type ProjectDoc,
} from "../../services/projects";
import { listTasksByProject, type TaskDoc } from "../../services/tasks";
import { uploadWorkPhoto } from "../../services/attachments";
import * as timeTracking from "../../services/timeTracking";
import { resolveCanUploadWorkPhoto } from "../../lib/workPhotoAccess";
import { getCurrentPositionSafe, requestLocationPermission } from "../../lib/location";
import type { WorkPhotoType } from "../../lib/attachmentTypes";
import { showToast } from "../../helpers/toast";

const LAST_USED_PROJECT_KEY = "@staveto:lastUsedProjectId";

let ImagePicker: typeof import("expo-image-picker") | null = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {}

type RouteParams = {
  projectId?: string;
  projectName?: string;
  taskId?: string;
  phaseId?: string;
  photoType?: WorkPhotoType;
  /** When set, skip earlier wizard steps (e.g. after launcher bottom sheets). */
  initialStep?: Step;
};

type Step = "project" | "task" | "photo" | "details" | "success";

function resolveInitialStep(params: RouteParams): Step {
  if (params.initialStep) return params.initialStep;
  if (params.projectId?.trim()) return "task";
  return "project";
}

const PHOTO_TYPES: WorkPhotoType[] = [
  "progress",
  "done",
  "material",
  "before",
  "after",
];

function mergeProjects(owned: ProjectDoc[], assigned: ProjectDoc[]): ProjectDoc[] {
  const map = new Map<string, ProjectDoc>();
  for (const p of [...owned, ...assigned]) {
    if (!p.archivedAt) map.set(p.id, p);
  }
  return Array.from(map.values());
}

function projectSearchText(p: ProjectDoc): string {
  return [p.name, p.addressText, p.city].filter(Boolean).join(" ").toLowerCase();
}

export function AddWorkPhotoScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { user } = useAuth();
  const params = (route.params ?? {}) as RouteParams;
  const hasPrefilledProject = Boolean(params.projectId?.trim());
  const entryStep = resolveInitialStep(params);

  const [step, setStep] = useState<Step>(entryStep);
  const [loadingProjects, setLoadingProjects] = useState(entryStep === "project");
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<ProjectDoc | null>(
    hasPrefilledProject && params.projectId
      ? { id: params.projectId, name: params.projectName ?? "" }
      : null
  );
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(params.taskId ?? null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState("photo.jpg");
  const [photoMime, setPhotoMime] = useState("image/jpeg");
  const [comment, setComment] = useState("");
  const [photoType, setPhotoType] = useState<WorkPhotoType>(params.photoType ?? "progress");
  const [saving, setSaving] = useState(false);
  const [activeTimer, setActiveTimer] = useState<timeTracking.ActiveTimer | null>(null);
  const [locationHint, setLocationHint] = useState<"saved" | "unavailable" | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: t("workPhoto.title") });
  }, [navigation, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      if (hasPrefilledProject && params.projectId) {
        const timer = await timeTracking.getActiveTimer();
        if (cancelled) return;
        setActiveTimer(timer);
        setSelectedProject((prev) =>
          prev ?? { id: params.projectId!, name: params.projectName ?? "" }
        );
        const timerTaskId =
          timer?.projectId === params.projectId ? timer.taskId ?? null : null;
        if (params.taskId ?? timerTaskId) {
          setSelectedTaskId(params.taskId ?? timerTaskId);
        }
        if (params.initialStep) {
          setStep(params.initialStep);
        } else {
          setStep("task");
        }
        setLoadingProjects(false);
        return;
      }
      setLoadingProjects(true);
      try {
        const [owned, assigned, timer, lastUsed] = await Promise.all([
          listMyProjects(user.id),
          listProjectsAssignedToCurrentUser(),
          timeTracking.getActiveTimer(),
          AsyncStorage.getItem(LAST_USED_PROJECT_KEY),
        ]);
        if (cancelled) return;
        setActiveTimer(timer);
        const merged = mergeProjects(owned, assigned);
        merged.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        const timerId = timer?.projectId;
        const prefId = params.projectId ?? timerId ?? lastUsed ?? null;
        if (prefId) {
          merged.sort((a, b) => {
            if (a.id === timerId && b.id !== timerId) return -1;
            if (b.id === timerId && a.id !== timerId) return 1;
            if (a.id === prefId && b.id !== prefId) return -1;
            if (b.id === prefId && a.id !== prefId) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          });
        }
        setProjects(merged);
        const preselect = merged.find((p) => p.id === prefId) ?? null;
        if (preselect && params.projectId) {
          setSelectedProject(preselect);
          if (params.taskId ?? timer?.taskId) {
            setSelectedTaskId(params.taskId ?? timer?.taskId ?? null);
          }
          setStep(params.initialStep ?? "task");
        }
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, params.projectId, params.projectName, params.taskId, params.initialStep, hasPrefilledProject]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    let cancelled = false;
    setLoadingTasks(true);
    listTasksByProject(selectedProject.id)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => projectSearchText(p).includes(q));
  }, [projects, projectSearch]);

  const tasksByPhase = useMemo(() => {
    const groups = new Map<string, TaskDoc[]>();
    for (const task of tasks) {
      const key = task.phaseTitle?.trim() || task.phaseId?.trim() || t("workPhoto.noPhase");
      const list = groups.get(key) ?? [];
      list.push(task);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [tasks, t]);

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((tk) => tk.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  );

  const usingActiveSession = useMemo(() => {
    if (!activeTimer || !selectedProject) return false;
    return activeTimer.projectId === selectedProject.id;
  }, [activeTimer, selectedProject]);

  const checkUploadPermission = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !selectedProject) return false;
    const result = await resolveCanUploadWorkPhoto(selectedProject.id, {
      taskId: selectedTaskId,
      projectOwnerId: selectedProject.ownerId,
    });
    if (!result.allowed) {
      Alert.alert(t("common.error"), t("workPhoto.permissionDeniedAssigned"));
      return false;
    }
    return true;
  }, [selectedProject, selectedTaskId, t, user?.id]);

  const pickImage = useCallback(
    async (source: "camera" | "gallery") => {
      if (!ImagePicker) {
        Alert.alert(t("common.error"), t("projectOverview.imagePickerInstallCommand"));
        return;
      }
      const ok = await checkUploadPermission();
      if (!ok) return;

      try {
        if (source === "camera") {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(t("common.error"), t("projectOverview.cameraPermissionForPhoto"));
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          });
          const asset = result.assets?.[0];
          if (!result.canceled && asset?.uri) {
            setPhotoUri(asset.uri);
            setPhotoFileName(asset.fileName || "photo.jpg");
            setPhotoMime(asset.mimeType || "image/jpeg");
            setStep("details");
          }
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(t("common.error"), t("projectOverview.galleryPermissionForPhoto"));
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          });
          const asset = result.assets?.[0];
          if (!result.canceled && asset?.uri) {
            setPhotoUri(asset.uri);
            setPhotoFileName(asset.fileName || "photo.jpg");
            setPhotoMime(asset.mimeType || "image/jpeg");
            setStep("details");
          }
        }
      } catch (e) {
        console.warn("[AddWorkPhoto] pick error:", e);
        Alert.alert(t("common.error"), t("workPhoto.uploadFailed"));
      }
    },
    [checkUploadPermission, t]
  );

  const handleSave = async () => {
    if (!selectedProject || !photoUri || !user?.id) return;
    setSaving(true);
    setLocationHint(null);
    try {
      const ok = await checkUploadPermission();
      if (!ok) return;

      let location: { latitude: number; longitude: number; accuracy: number } | undefined;
      try {
        await requestLocationPermission();
        const gps = await getCurrentPositionSafe();
        if (gps) {
          location = { latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracyM };
          setLocationHint("saved");
        } else {
          setLocationHint("unavailable");
        }
      } catch {
        setLocationHint("unavailable");
      }

      await uploadWorkPhoto({
        projectId: selectedProject.id,
        localUri: photoUri,
        fileName: photoFileName,
        mimeType: photoMime,
        photoType,
        taskId: selectedTaskId,
        phaseId: selectedTask?.phaseId ?? params.phaseId ?? activeTimer?.phaseId ?? null,
        orgId: selectedProject.orgId ?? null,
        comment: comment.trim() || undefined,
        uploadedByName: user.name ?? user.firstName ?? undefined,
        location,
        workSessionId: usingActiveSession ? activeTimer?.startedAt : undefined,
      });

      await AsyncStorage.setItem(LAST_USED_PROJECT_KEY, selectedProject.id);
      setStep("success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("permission-denied")) {
        Alert.alert(t("common.error"), t("workPhoto.permissionDeniedAssigned"));
      } else {
        Alert.alert(t("common.error"), t("workPhoto.uploadFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const resetForAnother = () => {
    setPhotoUri(null);
    setComment("");
    setPhotoType("progress");
    setLocationHint(null);
    setStep("photo");
  };

  const renderProjectStep = () => (
    <View style={styles.section}>
      <Text style={styles.stepTitle}>{t("workPhoto.selectProject")}</Text>
      {usingActiveSession && activeTimer ? (
        <View style={styles.hintBanner}>
          <Ionicons name="time-outline" size={18} color={colors.primary} />
          <Text style={styles.hintText}>{t("workPhoto.activeSessionHint")}</Text>
        </View>
      ) : null}
      <TextInput
        style={styles.searchInput}
        placeholder={t("workPhoto.searchProject")}
        placeholderTextColor={colors.textMuted}
        value={projectSearch}
        onChangeText={setProjectSearch}
        accessibilityLabel={t("workPhoto.searchProject")}
      />
      {loadingProjects ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : filteredProjects.length === 0 ? (
        <Text style={styles.emptyText}>{t("workPhoto.noProjects")}</Text>
      ) : (
        filteredProjects.map((p) => {
          const isTimer = activeTimer?.projectId === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.listRow, selectedProject?.id === p.id && styles.listRowSelected]}
              onPress={() => {
                setSelectedProject(p);
                setSelectedTaskId(
                  activeTimer && activeTimer.projectId === p.id ? activeTimer.taskId ?? null : null
                );
                setStep("task");
              }}
              accessibilityRole="button"
            >
              <View style={styles.listRowBody}>
                <Text style={styles.listRowTitle}>{p.name}</Text>
                {p.addressText || p.city ? (
                  <Text style={styles.listRowSub}>{[p.addressText, p.city].filter(Boolean).join(", ")}</Text>
                ) : null}
                {isTimer ? <Text style={styles.listRowBadge}>{t("workPhoto.activeSessionHint")}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  const renderTaskStep = () => (
    <View style={styles.section}>
      <Text style={styles.stepTitle}>{t("workPhoto.selectTask")}</Text>
      <Text style={styles.projectContext}>{selectedProject?.name}</Text>
      <TouchableOpacity
        style={[styles.listRow, selectedTaskId === null && styles.listRowSelected]}
        onPress={() => {
          setSelectedTaskId(null);
          setStep("photo");
        }}
      >
        <Text style={styles.listRowTitle}>{t("workPhoto.generalProjectPhoto")}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
      {loadingTasks ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        tasksByPhase.map(([phase, phaseTasks]) => (
          <View key={phase} style={styles.phaseGroup}>
            <Text style={styles.phaseLabel}>{phase}</Text>
            {phaseTasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={[styles.listRow, selectedTaskId === task.id && styles.listRowSelected]}
                onPress={() => {
                  setSelectedTaskId(task.id);
                  setStep("photo");
                }}
              >
                <View style={styles.listRowBody}>
                  <Text style={styles.listRowTitle}>{task.title}</Text>
                  <Text style={styles.listRowSub}>{task.status}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}
      <TouchableOpacity
        style={styles.backLink}
        onPress={() => (hasPrefilledProject ? navigation.goBack() : setStep("project"))}
      >
        <Text style={styles.backLinkText}>{t("common.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPhotoStep = () => (
    <View style={styles.section}>
      <Text style={styles.stepTitle}>{selectedProject?.name}</Text>
      {selectedTask ? (
        <Text style={styles.projectContext}>{selectedTask.title}</Text>
      ) : (
        <Text style={styles.projectContext}>{t("workPhoto.generalProjectPhoto")}</Text>
      )}
      <TouchableOpacity style={styles.primaryBtn} onPress={() => void pickImage("camera")}>
        <Ionicons name="camera-outline" size={22} color="#fff" />
        <Text style={styles.primaryBtnText}>{t("workPhoto.takePhoto")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={() => void pickImage("gallery")}>
        <Ionicons name="images-outline" size={22} color={colors.primary} />
        <Text style={styles.secondaryBtnText}>{t("workPhoto.chooseFromGallery")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
        <Text style={styles.backLinkText}>{t("common.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDetailsStep = () => (
    <View style={styles.section}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.preview} accessibilityIgnoresInvertColors />
      ) : null}
      <Text style={styles.fieldLabel}>{t("workPhoto.commentLabel")}</Text>
      <TextInput
        style={styles.commentInput}
        placeholder={t("workPhoto.commentPlaceholder")}
        placeholderTextColor={colors.textMuted}
        value={comment}
        onChangeText={setComment}
        multiline
      />
      <Text style={styles.fieldLabel}>{t("workPhoto.photoTypeLabel")}</Text>
      <View style={styles.typeRow}>
        {PHOTO_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.typeChip, photoType === type && styles.typeChipActive]}
            onPress={() => setPhotoType(type)}
          >
            <Text style={[styles.typeChipText, photoType === type && styles.typeChipTextActive]}>
              {t(`workPhoto.type.${type}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {locationHint === "saved" ? (
        <Text style={styles.locationOk}>{t("workPhoto.locationSaved")}</Text>
      ) : locationHint === "unavailable" ? (
        <Text style={styles.locationMuted}>{t("workPhoto.locationUnavailable")}</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.primaryBtn, saving && styles.btnDisabled]}
        onPress={() => void handleSave()}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>{t("workPhoto.save")}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.backLink} onPress={() => setStep("photo")}>
        <Text style={styles.backLinkText}>{t("common.back")}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSuccessStep = () => (
    <View style={styles.section}>
      <Ionicons name="checkmark-circle" size={64} color={colors.primary} style={styles.successIcon} />
      <Text style={styles.successTitle}>{t("workPhoto.saved")}</Text>
      {locationHint === "saved" ? (
        <Text style={styles.locationOk}>{t("workPhoto.locationSaved")}</Text>
      ) : locationHint === "unavailable" ? (
        <Text style={styles.locationMuted}>{t("workPhoto.locationUnavailable")}</Text>
      ) : null}
      <TouchableOpacity style={styles.primaryBtn} onPress={resetForAnother}>
        <Text style={styles.primaryBtnText}>{t("workPhoto.addAnother")}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => {
          if (selectedProject) {
            showToast(t("workPhoto.saved"));
          }
          navigation.goBack();
        }}
      >
        <Text style={styles.secondaryBtnText}>{t("workPhoto.done")}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {step === "project" && renderProjectStep()}
      {step === "task" && renderTaskStep()}
      {step === "photo" && renderPhotoStep()}
      {step === "details" && renderDetailsStep()}
      {step === "success" && renderSuccessStep()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.formPanel },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  section: { gap: spacing.md },
  stepTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  projectContext: { fontSize: 15, color: colors.textMuted, marginBottom: spacing.sm },
  hintBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
  },
  hintText: { flex: 1, fontSize: 14, color: colors.text },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  loader: { marginVertical: spacing.lg },
  emptyText: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listRowSelected: { borderColor: colors.primary, backgroundColor: "#f0f4ff" },
  listRowBody: { flex: 1 },
  listRowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  listRowSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  listRowBadge: { fontSize: 12, color: colors.primary, marginTop: 4 },
  phaseGroup: { marginTop: spacing.sm },
  phaseLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  backLink: { alignSelf: "flex-start", paddingVertical: spacing.sm },
  backLinkText: { color: colors.primary, fontSize: 15 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    marginTop: spacing.sm,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius,
    marginTop: spacing.sm,
  },
  secondaryBtnText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  btnDisabled: { opacity: 0.7 },
  preview: {
    width: "100%",
    height: 220,
    borderRadius: radius,
    backgroundColor: colors.border,
  },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  commentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    minHeight: 88,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
    textAlignVertical: "top",
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, color: colors.text },
  typeChipTextActive: { color: "#fff", fontWeight: "600" },
  locationOk: { fontSize: 13, color: "#2e7d32" },
  locationMuted: { fontSize: 13, color: colors.textMuted },
  successIcon: { alignSelf: "center", marginVertical: spacing.md },
  successTitle: { fontSize: 22, fontWeight: "700", textAlign: "center", color: colors.text },
});
