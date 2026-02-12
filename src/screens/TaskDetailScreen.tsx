import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  Linking,
  Alert,
  TextInput,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import * as tasksService from "../services/tasks";
import * as attachmentsService from "../services/attachments";
import type { AttachmentDoc } from "../services/attachments";
import type { TaskDoc } from "../services/tasks";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import {
  getStatusMappingsForUI,
  normalizeStatusValue,
  type StoredStatusValue,
} from "../helpers/taskStatusMapping";

function genId() {
  return "st_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

const DONE_COLOR = "#2e7d32";

type Task = TaskDoc;

export function TaskDetailScreen() {
  const route = useRoute();
  const { orgId } = useAuth();
  const { t } = useI18n();
  const task = (route.params as { task: Task })?.task;
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
  const statusMappings = getStatusMappingsForUI();

  useEffect(() => {
    if (task?.projectId && task?.id) {
      loadAttachments();
    }
  }, [task?.projectId, task?.id]);

  // Update status when task changes (e.g., from navigation or refresh)
  useEffect(() => {
    if (task?.status) {
      const normalizedStatus = normalizeStatusValue(task.status);
      setStatus(normalizedStatus);
    }
  }, [task?.status]);

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
    if (attachment.fileType === 'image') {
      try {
        const attachmentData = attachment as any;
        const url = attachmentData.downloadURL || await attachmentsService.getAttachmentURL(attachment);
        setViewingAttachmentURL(url);
        setViewingAttachment(attachment);
      } catch (error: any) {
        Alert.alert(t("common.error"), t("taskDetail.failedToLoadImage"));
      }
    } else {
      try {
        const url = await attachmentsService.getAttachmentURL(attachment);
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
        } else {
          Alert.alert(t("common.error"), t("taskDetail.cannotOpenFile"));
        }
      } catch (error: any) {
        Alert.alert(t("common.error"), t("taskDetail.failedToOpenFile"));
      }
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
    try {
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, normalizedStatus);
    } catch {
      setStatus(normalizeStatusValue(task.status));
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.card}>
        <Text style={styles.title}>{task.title || t("taskDetail.noTitle")}</Text>
        {task.dueDate ? <Text style={styles.muted}>{t("taskDetail.dueDate", { date: task.dueDate })}</Text> : null}
      </View>

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
        {statusMappings.map((mapping) => {
          const isActive = status === mapping.storedValue || 
                          normalizeStatusValue(status) === normalizeStatusValue(mapping.storedValue);
          
          return (
            <TouchableOpacity
              key={mapping.storedValue}
              style={[styles.statusBtn, isActive && styles.statusBtnActive]}
              onPress={() => onStatusChange(mapping.storedValue)}
            >
              <View style={styles.statusBtnContent}>
                <Text style={[styles.statusBtnText, isActive && styles.statusBtnTextActive]}>
                  {mapping.uiLabel}
                </Text>
                {mapping.caption && (
                  <Text style={[styles.statusBtnCaption, isActive && styles.statusBtnCaptionActive]}>
                    {mapping.caption}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Image Viewer Modal */}
      <Modal
        visible={viewingAttachment !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setViewingAttachment(null);
          setViewingAttachmentURL(null);
        }}
      >
        <View style={styles.imageViewerOverlay}>
          <View style={styles.imageViewerHeader}>
            <Text style={styles.imageViewerTitle} numberOfLines={1}>
              {viewingAttachment?.fileName || 'Obrázok'}
            </Text>
            <TouchableOpacity
              style={styles.imageViewerCloseButton}
              onPress={() => {
                setViewingAttachment(null);
                setViewingAttachmentURL(null);
              }}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.imageViewerScroll}
            contentContainerStyle={styles.imageViewerContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
          >
            {viewingAttachmentURL && (
              <Image
                source={{ uri: viewingAttachmentURL }}
                style={styles.imageViewerImage}
                resizeMode="contain"
              />
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  contentContainer: { padding: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "600", color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
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
