import React, { useState, useEffect } from "react";
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
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import * as problemsService from "../services/problems";
import * as problemPhotosService from "../services/problemPhotos";
import * as projectMembersService from "../services/projectMembers";
import type { ProblemCategory, ProblemPriority, ProblemPhoto } from "../services/problems";
import type { ProjectMemberDoc } from "../services/projectMembers";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";

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
  const [shortDescription, setShortDescription] = useState("");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [photos, setPhotos] = useState<{ uri: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const projType = projectType ?? "BUILD";
  const categories = problemsService.getCategoriesForProjectType(projType);

  useEffect(() => {
    if (projectId) {
      projectMembersService.listProjectMembers(projectId).then((m) => {
        const assignable = m.filter((x) => x.userId && x.status === "active");
        setMembers(assignable);
        if (assignable.length === 1) {
          const m = assignable[0];
          setAssigneeUid(m.userId);
          setAssigneeName(m.name ?? m.email ?? (m.userId === user?.id ? (user?.name ?? user?.email ?? "") : ""));
        }
      });
    }
  }, [projectId, user?.id, user?.name, user?.email]);

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
    if (!projectId || !shortDescription.trim()) {
      Alert.alert(t("common.error"), t("problems.descriptionRequired"));
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
      const created = await problemsService.createProblem({
        projectId,
        projectType: projType,
        category,
        priority,
        shortDescription: shortDescription.trim(),
        assigneeUid,
        assigneeName: assigneeName || undefined,
        dueDate: dueDate ?? null,
        photos: [],
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
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.description")} *</Text>
        <TextInput
          style={styles.input}
          value={shortDescription}
          onChangeText={setShortDescription}
          placeholder={t("problems.descriptionPlaceholder")}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.assignee")} *</Text>
        <TouchableOpacity
          style={styles.picker}
          onPress={() => {
            const buttons = [
              ...members.map((m) => {
                const label = m.name || m.email || (m.userId === user?.id ? (user?.name ?? user?.email ?? t("problems.you")) : m.userId);
                return {
                  text: label,
                  onPress: () => {
                    setAssigneeUid(m.userId);
                    setAssigneeName(m.name ?? m.email ?? (m.userId === user?.id ? (user?.name ?? user?.email ?? "") : ""));
                  },
                };
              }),
              { text: t("common.cancel"), style: "cancel" as const },
            ];
            Alert.alert(t("problems.assignee"), "", buttons);
          }}
        >
          <Text style={assigneeUid ? styles.pickerText : styles.pickerPlaceholder}>
            {assigneeName || (assigneeUid === user?.id ? t("problems.you") : assigneeUid) || t("problems.selectAssignee")}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("problems.dueDate")}</Text>
        <TouchableOpacity style={styles.picker} onPress={() => setShowDatePicker(true)}>
          <Text style={dueDate ? styles.pickerText : styles.pickerPlaceholder}>
            {dueDate ? dueDate.toLocaleDateString() : t("problems.noDueDate")}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  field: { marginBottom: spacing.lg },
  label: { color: colors.textOnDark, fontSize: 14, fontWeight: "600", marginBottom: spacing.sm },
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
  errorText: { color: colors.textOnDark },
});
