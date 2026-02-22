import React, { useState, useEffect, useCallback } from "react";
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
  Platform,
  ActionSheetIOS,
  Switch,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import * as problemPhotosService from "../services/problemPhotos";
import * as projectMembersService from "../services/projectMembers";
import * as attachmentsService from "../services/attachments";
import type { ProblemCategory, ProblemPriority, ProblemPhoto } from "../services/problems";
import type { ProjectMemberDoc } from "../services/projectMembers";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";
import { DescriptionInputModal } from "../components/DescriptionInputModal";

let ImagePicker: typeof import("expo-image-picker") | null = null;
let DateTimePicker: any = null;
try {
  ImagePicker = require("expo-image-picker");
} catch {}
try {
  const pkg = require("@react-native-community/datetimepicker");
  DateTimePicker = pkg.default ?? pkg;
} catch {}

type RouteParams = { projectId: string; projectName?: string; projectType?: string };

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateSk(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

export function CreateProblemScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const { projectId, projectName, projectType } = (route.params ?? {}) as RouteParams;
  const { user } = useAuth();
  const access = useProjectAccess(projectId);
  const [members, setMembers] = useState<ProjectMemberDoc[]>([]);
  const [category, setCategory] = useState<ProblemCategory>("other");
  const [priority, setPriority] = useState<ProblemPriority>("medium");
  const [blocksWork, setBlocksWork] = useState(false);
  const [title, setTitle] = useState("");
  const [problemNoteText, setProblemNoteText] = useState<string | null>(null);
  const [problemNoteRecordingUri, setProblemNoteRecordingUri] = useState<string | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [location, setLocation] = useState("");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [photos, setPhotos] = useState<{ uri: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const projType = projectType ?? "BUILD";
  const categories = problemsService.getCategoriesForProjectType(projType);
  const singleMember = members.length === 1;

  useEffect(() => {
    if (projectId && user?.id) {
      projectMembersService.listProjectMembers(projectId).then((m) => {
        const assignable = m.filter((x) => x.userId && x.status === "active");
        setMembers(assignable);
        const me = assignable.find((x) => x.userId === user.id);
        if (me && !assigneeUid) {
          setAssigneeUid(me.userId);
          setAssigneeName(me.name ?? me.email ?? (me.userId === user?.id ? (user?.name ?? user?.email ?? "") : ""));
        }
        if (assignable.length === 1) {
          const m0 = assignable[0];
          setAssigneeUid(m0.userId);
          setAssigneeName(m0.name ?? m0.email ?? (m0.userId === user?.id ? (user?.name ?? user?.email ?? "") : ""));
        }
      });
    }
  }, [projectId, user?.id, user?.name, user?.email]);

  useEffect(() => {
    if (blocksWork) setPriority("high");
  }, [blocksWork]);

  const setQuickDate = useCallback((days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    setDueDate(d);
  }, []);

  const pickPhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("problems.photoNotAvailable"));
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("common.error"), t("problems.galleryPermission"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (!result.canceled && result.assets?.length) {
      setPhotos((p) => [...p, ...result.assets!.map((a) => ({ uri: a.uri }))]);
    }
  };

  const takePhoto = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("problems.photoNotAvailable"));
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("common.error"), t("problems.cameraPermission"));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos((p) => [...p, { uri: result.assets![0].uri }]);
    }
  };

  const showPhotoOptions = () => {
    const opts = [
      { text: t("problems.takePhoto"), onPress: takePhoto },
      { text: t("problems.selectFromGallery"), onPress: pickPhoto },
      { text: t("common.cancel"), style: "cancel" as const },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: opts.map((o) => o.text), cancelButtonIndex: 2 },
        (i) => opts[i]?.onPress?.()
      );
    } else {
      Alert.alert(t("problems.addPhoto"), "", opts);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((p) => p.filter((_, i) => i !== index));
  };

  const onSave = async () => {
    if (!projectId) return;
    if (!title.trim() || title.trim().length < 5) {
      Alert.alert(t("common.error"), t("problems.titleMinLength"));
      return;
    }
    if (!location.trim()) {
      Alert.alert(t("common.error"), t("problems.locationRequired"));
      return;
    }
    if (!assigneeUid) {
      Alert.alert(t("common.error"), t("problems.assigneeRequired"));
      return;
    }
    if (!access.canWrite) {
      Alert.alert(t("common.error"), t("errors.auth.editorRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const attachmentIds: string[] = [];

      if (problemNoteRecordingUri) {
        try {
          const voiceAttachment = await attachmentsService.uploadAttachment(projectId, {
            expenseId: null,
            taskId: null,
            phaseId: null,
            localUri: problemNoteRecordingUri,
            fileName: `problem_note_${Date.now()}.m4a`,
            mimeType: "audio/m4a",
            kind: "audio",
          });
          attachmentIds.push(voiceAttachment.id);
        } catch (e) {
          console.warn("[CreateProblem] Voice upload failed:", e);
          showToast(t("problems.savedVoiceFailed"));
        }
      }

      let detailValue: string | null = null;
      if (problemNoteText?.trim()) {
        detailValue = problemNoteText.trim();
      } else if (problemNoteRecordingUri && attachmentIds.length > 0) {
        detailValue = t("problems.voiceMessage");
      }

      const created = await problemsService.createProblem({
        projectId,
        projectType: projType,
        category,
        priority,
        shortDescription: title.trim(),
        detail: detailValue,
        location: location.trim() || null,
        blocksWork: blocksWork || null,
        assigneeUid,
        assigneeName: assigneeName || undefined,
        dueDate: dueDate ?? null,
        photos: [],
        attachments: attachmentIds,
      });

      const problemId = created.id;

      const uploadedPhotos: ProblemPhoto[] = [];
      for (let i = 0; i < photos.length; i++) {
        try {
          const photo = await problemPhotosService.uploadProblemPhoto(
            projectId,
            problemId,
            photos[i].uri
          );
          uploadedPhotos.push(photo);
        } catch (e) {
          console.warn("[CreateProblem] Photo upload failed:", e);
        }
      }
      if (uploadedPhotos.length > 0) {
        await problemsService.updateProblem(projectId, problemId, { photos: uploadedPhotos });
      }

      showToast(t("problems.saved"));
      navigation.goBack();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("common.error");
      Alert.alert(t("common.error"), msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!projectId) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t("common.error")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.titleLabel")} *</Text>
        <TextInput
          style={styles.inputSingle}
          value={title}
          onChangeText={setTitle}
          placeholder={t("problems.titlePlaceholder")}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.noteOptional")}</Text>
        <TouchableOpacity
          style={styles.addNoteButton}
          onPress={() => setShowNoteModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
          <Text style={styles.addNoteButtonText}>
            {problemNoteText?.trim() || problemNoteRecordingUri
              ? problemNoteText?.trim()
                ? problemNoteText.slice(0, 80) + (problemNoteText.length > 80 ? "…" : "")
                : "🎙 " + t("problems.voiceMessage")
              : t("problems.addNote")}
          </Text>
        </TouchableOpacity>
        {(problemNoteText?.trim() || problemNoteRecordingUri) && (
          <TouchableOpacity
            style={styles.removeNote}
            onPress={() => {
              setProblemNoteText(null);
              setProblemNoteRecordingUri(null);
            }}
          >
            <Ionicons name="close-circle" size={20} color={colors.error} />
            <Text style={styles.removeNoteText}>{t("common.delete")}</Text>
          </TouchableOpacity>
        )}
      </View>

      <DescriptionInputModal
        visible={showNoteModal}
        onClose={() => setShowNoteModal(false)}
        onConfirm={(text, recordingUri) => {
          setProblemNoteText(text?.trim() || null);
          setProblemNoteRecordingUri(recordingUri ?? null);
          setShowNoteModal(false);
        }}
        initialText={problemNoteText ?? ""}
        initialRecordingUri={problemNoteRecordingUri}
        placeholder={t("problems.detailPlaceholder")}
        title={t("problems.noteOptional")}
      />

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.locationLabel")} *</Text>
        <TextInput
          style={styles.inputSingle}
          value={location}
          onChangeText={setLocation}
          placeholder={t("problems.locationPlaceholder")}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.category")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {categories.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, category === c && styles.chipActive]}
              onPress={() => setCategory(c)}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                {t(`problems.categories.${c}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.priority")}</Text>
        <View style={styles.chipRow}>
          {(["low", "medium", "high"] as ProblemPriority[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.chip, priority === p && styles.chipActive]}
              onPress={() => setPriority(p)}
            >
              <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>
                {t(`problems.priorities.${p}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.helperText}>
          {priority === "low" && t("problems.priorityHelpLow")}
          {priority === "medium" && t("problems.priorityHelpMed")}
          {priority === "high" && t("problems.priorityHelpHigh")}
        </Text>
      </View>

      <View style={styles.field}>
        <View style={styles.toggleRow}>
          <Text style={styles.label}>{t("problems.blocksWork")}</Text>
          <Switch
            value={blocksWork}
            onValueChange={setBlocksWork}
            trackColor={{ false: "rgba(255,255,255,0.3)", true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.assignee")} *</Text>
        {singleMember ? (
          <View style={styles.assigneeStatic}>
            <Text style={styles.pickerText}>
              {assigneeName || (assigneeUid === user?.id ? t("problems.you") : assigneeUid)}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.picker}
            onPress={() => {
              const buttons = [
                ...members.map((m) => {
                  const label =
                    m.name ||
                    m.email ||
                    (m.userId === user?.id ? (user?.name ?? user?.email ?? t("problems.you")) : m.userId);
                  return {
                    text: label,
                    onPress: () => {
                      setAssigneeUid(m.userId);
                      setAssigneeName(
                        m.name ?? m.email ?? (m.userId === user?.id ? (user?.name ?? user?.email ?? "") : "")
                      );
                    },
                  };
                }),
                { text: t("common.cancel"), style: "cancel" as const },
              ];
              Alert.alert(t("problems.assignee"), "", buttons);
            }}
          >
            <Text style={assigneeUid ? styles.pickerText : styles.pickerPlaceholder}>
              {assigneeName ||
                (assigneeUid === user?.id ? t("problems.you") : assigneeUid) ||
                t("problems.selectAssignee")}
            </Text>
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.dueDate")}</Text>
        <View style={styles.quickDateRow}>
          <TouchableOpacity style={styles.quickChip} onPress={() => setQuickDate(0)}>
            <Text style={styles.quickChipText}>{t("problems.quickToday")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickChip} onPress={() => setQuickDate(1)}>
            <Text style={styles.quickChipText}>{t("problems.quickTomorrow")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickChip} onPress={() => setQuickDate(7)}>
            <Text style={styles.quickChipText}>{t("problems.quickPlus7")}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.picker} onPress={() => setShowDatePicker(true)}>
          <Text style={dueDate ? styles.pickerText : styles.pickerPlaceholder}>
            {dueDate ? formatDateSk(dueDate) : t("problems.noDueDate")}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        {showDatePicker && DateTimePicker && (
          <DateTimePicker
            value={dueDate ?? new Date()}
            mode="date"
            display="default"
            onChange={(_, d) => {
              setShowDatePicker(false);
              if (d) setDueDate(d);
            }}
          />
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.addPhoto")}</Text>
        <TouchableOpacity style={styles.addPhotoBtn} onPress={showPhotoOptions}>
          <Ionicons name="camera-outline" size={32} color={colors.primary} />
          <Text style={styles.addPhotoText}>{t("problems.addPhoto")}</Text>
        </TouchableOpacity>
        {photos.length > 0 && (
          <View style={styles.photoGrid}>
            {photos.map((p, i) => (
              <View key={i} style={styles.photoWrap}>
                <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                <TouchableOpacity style={styles.removePhoto} onPress={() => removePhoto(i)}>
                  <Ionicons name="close-circle" size={24} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
        onPress={onSave}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>{t("problems.save")}</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.saveHelperText}>{t("problems.saveHelperText")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  field: { marginBottom: spacing.lg },
  label: { color: colors.textOnDark, fontSize: 14, fontWeight: "600", marginBottom: spacing.sm },
  helperText: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  inputSingle: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 80,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.textOnDark, fontSize: 14 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  assigneeStatic: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
  },
  pickerText: { color: colors.text, fontSize: 16 },
  pickerPlaceholder: { color: colors.textMuted, fontSize: 16 },
  quickDateRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  quickChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  quickChipText: { color: colors.textOnDark, fontSize: 14 },
  addNoteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 8,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderStyle: "dashed",
  },
  addNoteButtonText: {
    fontSize: 15,
    color: colors.textMuted,
    flex: 1,
  },
  removeNote: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  removeNoteText: { color: colors.error, fontSize: 14 },
  addPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    borderStyle: "dashed",
  },
  addPhotoText: { color: colors.textOnDark, marginLeft: spacing.sm },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.sm },
  photoWrap: { position: "relative" },
  photoThumb: { width: 80, height: 80, borderRadius: 8 },
  removePhoto: { position: "absolute", top: -8, right: -8 },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  saveHelperText: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  errorText: { color: colors.textOnDark },
});
