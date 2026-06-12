import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import * as tasksService from "../services/tasks";
import * as attachmentsService from "../services/attachments";
import type { AttachmentDoc } from "../services/attachments";
import type { TaskDoc } from "../services/tasks";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import {
  normalizeStatusValue,
  type StoredStatusValue,
} from "../helpers/taskStatusMapping";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import {
  canManageTaskPlanningFromAccess,
  canWorkerToggleTaskStatus,
} from "../lib/taskPlanningPermissions";
import { toYmd } from "../utils/date";
import {
  InAppAttachmentViewer,
  inferInAppViewerMode,
  isAttachmentImage,
} from "../components/InAppAttachmentViewer";

let DateTimePicker: any = null;
try {
  DateTimePicker = require("@react-native-community/datetimepicker").default;
} catch {
  // ignore
}

function genId() {
  return "st_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

const DONE_COLOR = "#2e7d32";

type Task = TaskDoc;

export function TaskDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { orgId } = useAuth();
  const { t } = useI18n();
  const { task, onSaveComplete } = (route.params as { task: Task; onSaveComplete?: () => void }) ?? {};
  const [status, setStatus] = useState((task?.status ?? "OPEN").toUpperCase());
  const [subtasks, setSubtasks] = useState<Array<{ id: string; title: string; done: boolean; order: number }>>(() => {
    if (task?.subtasks && task.subtasks.length > 0) return task.subtasks;
    const checklist = (task as any)?.checklist;
    if (checklist?.length) return checklist.map((c: { id: string; title: string; done: boolean }, i: number) => ({ ...c, order: i }));
    return [];
  });
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDoc[]>([]);
  const [attachmentThumbnails, setAttachmentThumbnails] = useState<Map<string, string>>(new Map());
  const [viewingAttachment, setViewingAttachment] = useState<AttachmentDoc | null>(null);
  const [viewingAttachmentURL, setViewingAttachmentURL] = useState<string | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dueDate, setDueDate] = useState<string | null>(task?.dueDate ?? null);
  const [savingDate, setSavingDate] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [canManagePlanning, setCanManagePlanning] = useState(false);

  const planningStatusOptions = useMemo(
    () =>
      [
        { value: "OPEN" as StoredStatusValue, label: t("taskDetail.statusOpen") },
        { value: "DONE" as StoredStatusValue, label: t("taskDetail.statusDone") },
      ] as const,
    [t]
  );

  const todayYmd = toYmd(new Date());
  const isOverdue = !!dueDate && dueDate < todayYmd && normalizeStatusValue(status) !== "DONE";

  useEffect(() => {
    if (task?.projectId && task?.id) {
      loadAttachments();
    }
  }, [task?.projectId, task?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!orgId || !task?.projectId) return;
      const access = await fetchProjectAccess(task.projectId, orgId);
      if (!cancelled) setCanManagePlanning(canManageTaskPlanningFromAccess(access));
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, task?.projectId]);

  // Update status and dueDate when task changes (e.g., from navigation or refresh)
  useEffect(() => {
    if (task?.status) {
      const normalizedStatus = normalizeStatusValue(task.status);
      setStatus(normalizedStatus);
    }
    if (task?.dueDate !== undefined) {
      setDueDate(task.dueDate ?? null);
    }
  }, [task?.status, task?.dueDate]);

  const loadAttachments = async () => {
    if (!task?.projectId || !task?.id) return;
    
    setLoadingAttachments(true);
    try {
      const atts = await attachmentsService.listAttachments(task.projectId, {
        taskId: task.id,
      });
      setAttachments(atts);
      
      // Load thumbnails for images
      const thumbnailMap = new Map<string, string>();
      for (const att of atts) {
        if (att.fileType === 'image') {
          try {
            const attachmentData = att as any;
            if (attachmentData.downloadURL) {
              thumbnailMap.set(att.id, attachmentData.downloadURL);
            } else {
              const url = await attachmentsService.getAttachmentURL(att);
              thumbnailMap.set(att.id, url);
            }
          } catch (error: any) {
            console.error(`[TaskDetail] Error loading thumbnail for ${att.id}:`, error);
          }
        }
      }
      setAttachmentThumbnails(thumbnailMap);
    } catch (error: any) {
      console.error(`[TaskDetail] Error loading attachments:`, error);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const openAttachment = async (attachment: AttachmentDoc) => {
    try {
      const attachmentData = attachment as AttachmentDoc & { downloadURL?: string };
      const url = attachmentData.downloadURL || (await attachmentsService.getAttachmentURL(attachment));
      if (__DEV__) {
        const mode = inferInAppViewerMode(attachment);
        console.log("[AttachmentPreviewDebug]", {
          event: "openPreview",
          openSource: "taskDetailAttachment",
          fileName: attachment.fileName,
          mimeType: attachment.contentType || attachment.fileType,
          isImage: isAttachmentImage(attachment),
          isPdf: mode === "pdf",
          hasUrl: !!url,
          viewerMode: mode,
        });
      }
      setViewingAttachmentURL(url);
      setViewingAttachment(attachment);
    } catch (error: any) {
      Alert.alert(
        t("common.error"),
        isAttachmentImage(attachment)
          ? t("taskDetail.failedToLoadImage")
          : t("taskDetail.failedToOpenFile")
      );
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (fileType: string): keyof typeof Ionicons.glyphMap => {
    if (fileType === 'image') return 'image-outline';
    if (fileType === 'document') return 'document-text-outline';
    if (fileType === 'pdf') return 'document-outline';
    return 'attach-outline';
  };

  if (!task) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t("taskDetail.noTask")}</Text>
      </View>
    );
  }

  const onStatusChange = async (newStatusValue: StoredStatusValue) => {
    if (!orgId || !task.projectId) return;
    const normalizedStatus = normalizeStatusValue(newStatusValue);
    if (
      !canWorkerToggleTaskStatus(
        { assigneeId: task.assigneeId },
        orgId,
        canManagePlanning
      )
    ) {
      return;
    }

    if (normalizedStatus === "DONE" && subtasks.length > 0) {
      const doneCount = subtasks.filter((s) => s.done).length;
      if (doneCount < subtasks.length) {
        Alert.alert(
          t("taskDetail.subtasksIncompleteTitle") || "Nie všetky subúlohy sú hotové",
          t("taskDetail.subtasksIncompleteBody") || "Chcete označiť úlohu ako hotovú?",
          [
            { text: t("common.cancel") || "Zrušiť", style: "cancel" },
            { text: t("taskDetail.markDone") || "Označiť", onPress: () => doStatusChange(normalizedStatus) },
          ]
        );
        return;
      }
    }
    await doStatusChange(normalizedStatus);
  };

  const doStatusChange = async (normalizedStatus: StoredStatusValue) => {
    if (!orgId || !task.projectId) return;
    setStatus(normalizedStatus);
    setSavingStatus(true);
    try {
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, normalizedStatus);
    } catch {
      setStatus(normalizeStatusValue(task.status));
    } finally {
      setSavingStatus(false);
    }
  };

  const handleDateChange = (_ev: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      const ymd = toYmd(selectedDate);
      setDueDate(ymd);
      if (Platform.OS === "android") {
        saveDueDate(ymd);
      }
    }
  };

  const saveDueDate = async (ymd?: string) => {
    const targetYmd = ymd ?? dueDate;
    if (!targetYmd) return;
    if (!orgId || !task?.projectId) {
      Alert.alert(t("common.error") || "Chyba", t("taskDetail.failedToSaveDate") || "Nepodarilo sa uložiť dátum. Skontrolujte pripojenie.");
      return;
    }
    setSavingDate(true);
    try {
      await tasksService.updateTaskTitle(orgId, task.projectId, task.id, task.title ?? "", targetYmd);
      onSaveComplete?.();
    } catch (err: any) {
      setDueDate(task.dueDate ?? null);
      Alert.alert(t("common.error") || "Chyba", err?.message || t("taskDetail.failedToSaveDate") || "Nepodarilo sa uložiť dátum.");
    } finally {
      setSavingDate(false);
    }
  };

  const toggleSubtask = (id: string) => {
    const next = subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
    setSubtasks(next);
    tasksService.updateTaskSubtasks(orgId!, task.projectId, task.id, next);
  };

  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const newItem = { id: genId(), title: newSubtaskTitle.trim(), done: false, order: subtasks.length };
    const next = [...subtasks, newItem];
    setSubtasks(next);
    setNewSubtaskTitle("");
    tasksService.updateTaskSubtasks(orgId!, task.projectId, task.id, next);
  };

  const updateSubtaskTitle = (id: string, title: string) => {
    const next = subtasks.map((s) => (s.id === id ? { ...s, title } : s));
    setSubtasks(next);
    if (orgId) tasksService.updateTaskSubtasks(orgId, task.projectId, task.id, next);
  };

  const removeSubtask = (id: string) => {
    const next = subtasks.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }));
    setSubtasks(next);
    tasksService.updateTaskSubtasks(orgId!, task.projectId, task.id, next);
  };

  const handleDeleteTask = () => {
    if (!orgId || !task.projectId) {
      Alert.alert(t("common.error") || "Chyba", t("projectOverview.noPermission") || "Nemáte oprávnenie.");
      return;
    }
    Alert.alert(
      t("projectOverview.deleteTask"),
      t("projectOverview.deleteTaskConfirm", { title: task.title || "" }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await tasksService.deleteTask(orgId, task.projectId, task.id);
              onSaveComplete?.();
              navigation.goBack();
            } catch (err: unknown) {
              const c = (err as { code?: string })?.code;
              const msg =
                c === "permission-denied"
                  ? t("projectOverview.noPermission")
                  : err instanceof Error
                    ? err.message
                    : t("common.error");
              Alert.alert(t("common.error"), msg);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={[styles.card, isOverdue && styles.cardOverdue]}>
        <Text style={styles.title}>{task.title || t("taskDetail.noTitle")}</Text>
        {dueDate ? (
          <TouchableOpacity
            style={styles.dueDateRow}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={18} color={isOverdue ? "#ef4444" : colors.textMuted} />
            <Text style={[styles.dueDateText, isOverdue && styles.dueDateOverdue]}>
              {t("taskDetail.dueDate", { date: dueDate })}
            </Text>
            <Text style={styles.changeDateHint}>{t("taskDetail.changeDate")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.dueDateRow}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
            <Text style={styles.addDateHint}>{t("taskDetail.addDate")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {showDatePicker && DateTimePicker && (
        Platform.OS === "ios" ? (
          <Modal transparent visible>
            <View style={styles.datePickerOverlay}>
              <View style={styles.datePickerContent}>
                <DateTimePicker
                  value={dueDate ? new Date(dueDate + "T12:00:00") : new Date()}
                  mode="date"
                  display="spinner"
                  onChange={handleDateChange}
                />
                <View style={styles.datePickerActions}>
                  <TouchableOpacity
                    style={styles.datePickerCancelBtn}
                    onPress={() => {
                      setShowDatePicker(false);
                      setDueDate(task.dueDate ?? null);
                    }}
                  >
                    <Text style={styles.datePickerCancelText}>{t("common.cancel")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.datePickerSaveBtn}
                    onPress={() => {
                      setShowDatePicker(false);
                      saveDueDate();
                    }}
                    disabled={savingDate}
                  >
                    {savingDate ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.datePickerSaveText}>{t("taskDetail.save")}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={dueDate ? new Date(dueDate + "T12:00:00") : new Date()}
            mode="date"
            display="default"
            onChange={handleDateChange}
          />
        )
      )}

      {/* Subúlohy */}
      <Text style={styles.sectionLabel}>{t("taskDetail.subtasks") || "Subúlohy"}</Text>
      <View style={styles.subtasksContainer}>
        {subtasks.map((s) => (
          <View key={s.id} style={styles.subtaskRow}>
            <TouchableOpacity onPress={() => toggleSubtask(s.id)} style={styles.subtaskCheck}>
              <Ionicons name={s.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={s.done ? DONE_COLOR : colors.textMuted} />
            </TouchableOpacity>
            <TextInput
              style={[styles.subtaskInput, s.done && styles.subtaskInputDone]}
              value={s.title}
              onChangeText={(txt) => updateSubtaskTitle(s.id, txt)}
              onBlur={() => {
                const item = subtasks.find((x) => x.id === s.id);
                if (item && !item.title.trim()) removeSubtask(s.id);
              }}
            />
            <TouchableOpacity onPress={() => removeSubtask(s.id)}>
              <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.addSubtaskRow}>
          <TextInput
            style={[styles.input, styles.addSubtaskInput]}
            placeholder={t("taskDetail.addSubtask") || "Pridať subúlohu"}
            placeholderTextColor={colors.textMuted}
            value={newSubtaskTitle}
            onChangeText={setNewSubtaskTitle}
            onSubmitEditing={addSubtask}
          />
          <TouchableOpacity style={styles.addSubtaskBtn} onPress={addSubtask}>
            <Ionicons name="add-circle" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Attachments Section */}
      {attachments.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t("taskDetail.attachments") || 'Prílohy'}</Text>
          <View style={styles.attachmentsContainer}>
            {attachments.map((attachment) => {
              const thumbnail = attachmentThumbnails.get(attachment.id);
              const isImage = attachment.fileType === 'image';
              
              return (
                <TouchableOpacity
                  key={attachment.id}
                  style={styles.attachmentItem}
                  onPress={() => openAttachment(attachment)}
                  activeOpacity={0.7}
                >
                  {isImage && thumbnail ? (
                    <Image source={{ uri: thumbnail }} style={styles.attachmentThumbnail} />
                  ) : (
                    <View style={styles.attachmentIconContainer}>
                      <Ionicons name={getFileIcon(attachment.fileType)} size={24} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.attachmentInfo}>
                    <Text style={styles.attachmentName} numberOfLines={1}>{attachment.fileName}</Text>
                    {attachment.size && (
                      <Text style={styles.attachmentSize}>{formatFileSize(attachment.size)}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {loadingAttachments && (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      )}

      <Text style={styles.sectionLabel}>{t("taskDetail.status")}</Text>
      <View style={styles.statusRow}>
        {planningStatusOptions.map((option) => {
          const isActive =
            status === option.value ||
            normalizeStatusValue(status) === normalizeStatusValue(option.value);
          const isDone = normalizeStatusValue(option.value) === "DONE";
          const canToggle = canWorkerToggleTaskStatus(
            { assigneeId: task.assigneeId },
            orgId ?? "",
            canManagePlanning
          );

          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.statusBtn, isActive && styles.statusBtnActive]}
              onPress={() => onStatusChange(option.value)}
              disabled={savingStatus || !canToggle}
            >
              <View style={styles.statusBtnContent}>
                {savingStatus && isActive ? (
                  <ActivityIndicator size="small" color={isDone ? "#fff" : colors.primary} />
                ) : (
                  <Text style={[styles.statusBtnText, isActive && styles.statusBtnTextActive]}>
                    {option.label}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.deleteTaskButton, deleting && styles.deleteTaskButtonDisabled]}
        onPress={handleDeleteTask}
        disabled={deleting || savingStatus}
        activeOpacity={0.7}
      >
        {deleting ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
            <Text style={styles.deleteTaskText}>{t("projectOverview.deleteTask")}</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.confirmButton}
        onPress={async () => {
          const hasUnsavedDate = dueDate !== (task.dueDate ?? null);
          if (hasUnsavedDate && dueDate) {
            await saveDueDate();
          }
          navigation.goBack();
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.confirmButtonText}>{t("taskDetail.confirmAndBack")}</Text>
      </TouchableOpacity>

      <InAppAttachmentViewer
        visible={viewingAttachment !== null}
        onClose={() => {
          setViewingAttachment(null);
          setViewingAttachmentURL(null);
        }}
        url={viewingAttachmentURL}
        fileName={viewingAttachment?.fileName ?? ""}
        mode={viewingAttachment ? inferInAppViewerMode(viewingAttachment) : "image"}
        debugOpenSource="taskDetail"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  contentContainer: { padding: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  cardOverdue: { borderColor: "#ef4444", borderWidth: 2 },
  title: { fontSize: 20, fontWeight: "600", color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  dueDateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  dueDateText: { fontSize: 14, color: colors.textMuted },
  dueDateOverdue: { color: "#ef4444", fontWeight: "600" },
  changeDateHint: { fontSize: 12, color: colors.primary, marginLeft: spacing.xs },
  addDateHint: { fontSize: 14, color: colors.textMuted, fontStyle: "italic" },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  datePickerContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingBottom: spacing.xl,
  },
  datePickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  datePickerCancelBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  datePickerCancelText: { fontSize: 16, color: colors.textMuted },
  datePickerSaveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
    minWidth: 80,
    alignItems: "center",
  },
  datePickerSaveText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  deleteTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.45)",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    marginTop: spacing.lg,
  },
  deleteTaskButtonDisabled: { opacity: 0.6 },
  deleteTaskText: { fontSize: 16, fontWeight: "600", color: "#ef4444" },
  confirmButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  sectionLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.md },
  subtasksContainer: { marginBottom: spacing.md },
  subtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  subtaskCheck: { padding: spacing.xs },
  subtaskInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: spacing.xs },
  subtaskInputDone: { textDecorationLine: "line-through", color: colors.textMuted },
  addSubtaskRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  addSubtaskInput: { flex: 1 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  addSubtaskBtn: { padding: spacing.xs },
  statusRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  statusBtn: { 
    paddingVertical: spacing.sm, 
    paddingHorizontal: spacing.md, 
    borderRadius: radius, 
    borderWidth: 1, 
    borderColor: colors.border,
    minWidth: 80,
  },
  statusBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  statusBtnContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  statusBtnText: { color: colors.text, fontSize: 14, fontWeight: "500" },
  statusBtnTextActive: { color: "#fff" },
  statusBtnCaption: { 
    color: colors.textMuted, 
    fontSize: 10, 
    marginTop: 2,
  },
  statusBtnCaptionActive: { 
    color: "rgba(255, 255, 255, 0.8)",
  },
  attachmentsContainer: {
    marginBottom: spacing.md,
  },
  attachmentItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachmentThumbnail: {
    width: 50,
    height: 50,
    borderRadius: radius,
    marginRight: spacing.sm,
    backgroundColor: colors.border,
  },
  attachmentIconContainer: {
    width: 50,
    height: 50,
    borderRadius: radius,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  attachmentSize: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  loader: {
    marginVertical: spacing.md,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  imageViewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  imageViewerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginRight: spacing.md,
  },
  imageViewerCloseButton: {
    padding: spacing.xs,
  },
  imageViewerScroll: {
    flex: 1,
  },
  imageViewerContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  imageViewerImage: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: '100%',
    maxHeight: '100%',
  },
});
