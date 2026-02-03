import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Modal, ActivityIndicator, Linking, Alert } from "react-native";
import { useRoute } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import * as tasksService from "../services/tasks";
import * as attachmentsService from "../services/attachments";
import type { AttachmentDoc } from "../services/attachments";
import { colors, radius, spacing } from "../theme";
import { useI18n } from "../i18n/I18nContext";
import { 
  getStatusMappingsForUI, 
  normalizeStatusValue, 
  getStatusLabel,
  type StoredStatusValue 
} from "../helpers/taskStatusMapping";

type Task = { id: string; projectId: string; title: string; status?: string; dueDate?: string };

export function TaskDetailScreen() {
  const route = useRoute();
  const { orgId } = useAuth();
  const { t } = useI18n();
  const task = (route.params as { task: Task })?.task;
  const [status, setStatus] = useState((task?.status ?? "OPEN").toUpperCase());
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
        Alert.alert('Chyba', 'Nepodarilo sa načítať obrázok.');
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
        <Text style={styles.muted}>Úloha nebola nájdená.</Text>
      </View>
    );
  }

  const onStatusChange = async (newStatusValue: StoredStatusValue) => {
    if (!orgId || !task.projectId) return;
    
    // Normalize the status value to ensure we save the correct stored value
    const normalizedStatus = normalizeStatusValue(newStatusValue);
    setStatus(normalizedStatus);
    
    try {
      // Save the stored value (not the UI label) to the database
      await tasksService.updateTaskStatus(orgId, task.projectId, task.id, normalizedStatus);
    } catch {
      // On error, revert to the original task status
      const originalStatus = normalizeStatusValue(task.status);
      setStatus(originalStatus);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.card}>
        <Text style={styles.title}>{task.title || "Bez názvu"}</Text>
        {task.dueDate ? <Text style={styles.muted}>Termín: {task.dueDate}</Text> : null}
      </View>

      {/* Attachments Section */}
      {attachments.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Prílohy</Text>
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

      <Text style={styles.sectionLabel}>Status</Text>
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
