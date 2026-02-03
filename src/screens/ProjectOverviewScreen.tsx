import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  ActionSheetIOS,
  Platform,
  Linking,
  Image,
} from "react-native";
// Conditional imports - only load if packages are installed
let ImagePicker: typeof import('expo-image-picker') | null = null;
let DocumentPicker: typeof import('expo-document-picker') | null = null;
let AudioModule: typeof import('expo-av') | null = null;

try {
  ImagePicker = require('expo-image-picker');
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.warn('expo-image-picker or expo-document-picker not installed. Attachment features will be disabled.');
}

try {
  AudioModule = require('expo-av');
} catch (e) {
  console.warn('expo-av not installed. Voice recording features will be disabled.');
}

let DateTimePicker: any = null;
try {
  DateTimePicker = require('@react-native-community/datetimepicker');
} catch (e) {
  console.warn('@react-native-community/datetimepicker not installed. Date picker features will be disabled.');
}
import { useRoute, useNavigation, NavigationProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import { updatePhase, deletePhase, createPhase } from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import * as constructionDiaryService from "../services/constructionDiary";
import * as projectDocumentsService from "../services/projectDocuments";
import { updateTaskStatus } from "../services/taskService";
import { archiveTask, reorderTask, moveTaskToPhase } from "../services/tasks";
import { addPhasesToProject } from "../services/addPhasesToProject";
import type { TaskDoc } from "../services/tasks";
import type { ProjectPhaseDoc } from "../services/projects";
import type { ExpenseDoc } from "../services/expenses";
import type { AttachmentDoc } from "../services/attachments";
import type { DiaryEntryDoc } from "../services/constructionDiary";
import type { ProjectDocumentDoc } from "../services/projectDocuments";
import { colors, radius, spacing } from "../theme";
import { openInMaps } from "../lib/maps";

export function ProjectOverviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const routeParams = (route.params as { projectId?: string; projectName?: string; openExpenseModal?: boolean; openNewTask?: boolean; selectedPhaseId?: string | null }) ?? {};
  const { projectId: paramProjectId, projectName: paramProjectName, openExpenseModal: paramOpenExpenseModal, openNewTask: paramOpenNewTask, selectedPhaseId: paramSelectedPhaseId } = routeParams;
  const projectId = paramProjectId ?? "";
  const projectName = paramProjectName ?? "";

  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Map<string, boolean>>(new Map());
  const expandedPhasesRef = React.useRef<Map<string, boolean>>(new Map());
  const [expandedExpenses, setExpandedExpenses] = useState(false);
  const [expandedDiary, setExpandedDiary] = useState(false);
  const [expandedDocuments, setExpandedDocuments] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null); // Phase for new task
  const [showNewPhaseModal, setShowNewPhaseModal] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [editingPhase, setEditingPhase] = useState<ProjectPhaseDoc | null>(null);
  const [editPhaseName, setEditPhaseName] = useState("");
  const [showEditPhaseModal, setShowEditPhaseModal] = useState(false);
  const [movingTask, setMovingTask] = useState<TaskDoc | null>(null);
  const [showMoveTaskModal, setShowMoveTaskModal] = useState(false);
  const [showVoiceRecord, setShowVoiceRecord] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recording, setRecording] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDoc | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [showEditTaskModal, setShowEditTaskModal] = useState(false);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'new' | 'edit'>('new');
  const [datePickerDate, setDatePickerDate] = useState(new Date());
  const [projectType, setProjectType] = useState<string | undefined>(undefined);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [addressText, setAddressText] = useState<string | undefined>(undefined);
  const [addingPhases, setAddingPhases] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseDoc | null>(null);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState("");
  const [expensePhaseId, setExpensePhaseId] = useState<string | null>(null);
  const [expenseAttachment, setExpenseAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [uploadingExpenseAttachment, setUploadingExpenseAttachment] = useState(false);
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [attachmentContext, setAttachmentContext] = useState<{ type: 'task' | 'expense'; id: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentDoc[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState<AttachmentDoc | null>(null);
  const [viewingAttachmentURL, setViewingAttachmentURL] = useState<string | null>(null);
  const [taskAttachmentsMap, setTaskAttachmentsMap] = useState<Map<string, number>>(new Map());
  const [expenseAttachmentsMap, setExpenseAttachmentsMap] = useState<Map<string, number>>(new Map());
  const [attachmentThumbnails, setAttachmentThumbnails] = useState<Map<string, string>>(new Map());
  
  // Diary entries state
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntryDoc[]>([]);
  const [showDiaryModal, setShowDiaryModal] = useState(false);
  const [editingDiaryEntry, setEditingDiaryEntry] = useState<DiaryEntryDoc | null>(null);
  const [diaryDate, setDiaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [diaryWeather, setDiaryWeather] = useState("");
  const [diaryWorkers, setDiaryWorkers] = useState("");
  const [diaryWorkDescription, setDiaryWorkDescription] = useState("");
  const [diaryMaterials, setDiaryMaterials] = useState("");
  const [diaryNotes, setDiaryNotes] = useState("");
  const [diaryPhaseId, setDiaryPhaseId] = useState<string | null>(null);
  const [diaryAttachment, setDiaryAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [uploadingDiaryAttachment, setUploadingDiaryAttachment] = useState(false);
  
  // Project documents state
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocumentDoc[]>([]);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [editingDocument, setEditingDocument] = useState<ProjectDocumentDoc | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState<'plan' | 'permit' | 'contract' | 'report' | 'other'>('other');
  const [documentDescription, setDocumentDescription] = useState("");
  const [documentPhaseId, setDocumentPhaseId] = useState<string | null>(null);
  const [documentAttachment, setDocumentAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [uploadingDocumentAttachment, setUploadingDocumentAttachment] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      // DEBUG: Check auth state first
      const { auth: authInstance } = await import('../firebase');
      const currentUserUid = authInstance.currentUser?.uid;
      console.log(`[ProjectOverview] DEBUG: auth.currentUser?.uid = "${currentUserUid}"`);
      console.log(`[ProjectOverview] DEBUG: projectId = "${projectId}"`);
      
      if (!currentUserUid) {
        throw new Error('Musíte byť prihlásený na načítanie projektu.');
      }
      
      // Load project data to get projectType and templateId
      console.log(`[ProjectOverview] Loading project ${projectId}...`);
      let project = null;
      try {
        project = await projectsService.getProject(projectId);
      } catch (error: any) {
        console.error(`[ProjectOverview] Error loading project:`, error);
        // If project doesn't exist or permission denied, continue without project metadata
        // Phases/tasks might still load if user has access
        project = null;
      }
      
      if (project) {
        console.log(`[ProjectOverview] Project loaded: projectType="${project.projectType}", templateId="${project.templateId}"`);
        setProjectType(project.projectType);
        setTemplateId(project.templateId);
        setAddressText(project.addressText);
      } else {
        console.warn(`[ProjectOverview] Project ${projectId} not found or no access - continuing without project metadata`);
      }
      
      // Load phases (only for BUILD projects), tasks, expenses, and BUILD-specific data
      const projectTypeForLoad = project?.projectType || projectType;
      const isBuildProject = projectTypeForLoad === 'BUILD' || projectTypeForLoad === 'MANAGEMENT';
      
      console.log(`[ProjectOverview] Loading data for projectType="${projectTypeForLoad}", isBuildProject=${isBuildProject}...`);
      const loadPromises: Promise<any>[] = [];
      
      // Only load phases for BUILD projects
      if (isBuildProject) {
        loadPromises.push(
          projectsService.listProjectPhases(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading phases:`, error);
            if (error.code === 'permission-denied') {
              console.error(`[ProjectOverview] PERMISSION DENIED loading phases for project ${projectId}`);
              console.error(`[ProjectOverview] Firestore rule: projectOwner(${projectId})`);
              console.error(`[ProjectOverview] Check: get(projects/${projectId}).data.ownerId == ${currentUserUid}`);
              console.error(`[ProjectOverview] Returning empty phases array`);
            }
            // Return empty array instead of throwing - allows app to continue
            return [];
          })
        );
      } else {
        // For TRADE/MAINTENANCE: set empty phases array
        loadPromises.push(Promise.resolve([]));
      }
      
      loadPromises.push(
        tasksService.listTasksByProject(projectId).catch((error: any) => {
          console.error(`[ProjectOverview] Error loading tasks:`, error);
          if (error.code === 'permission-denied') {
            console.error(`[ProjectOverview] PERMISSION DENIED loading tasks for project ${projectId}`);
            console.error(`[ProjectOverview] Firestore rule: projectOwner(${projectId})`);
            console.error(`[ProjectOverview] Check: get(projects/${projectId}).data.ownerId == ${currentUserUid}`);
            console.error(`[ProjectOverview] Returning empty tasks array`);
          }
          // Return empty array instead of throwing - allows app to continue
          return [];
        })
      );
      
      loadPromises.push(
        expensesService.listExpensesByProject(projectId).catch((error: any) => {
          console.error(`[ProjectOverview] Error loading expenses:`, error);
          return [];
        })
      );
      
      // Load diary and documents for BUILD and MANAGEMENT projects
      const hasDiaryAndDocuments = isBuildProject;
      if (hasDiaryAndDocuments) {
        loadPromises.push(
          constructionDiaryService.listDiaryEntries(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading diary entries:`, error);
            return [];
          }),
          projectDocumentsService.listProjectDocuments(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading project documents:`, error);
            return [];
          })
        );
      }
      
      const results = await Promise.all(loadPromises);
      const ph = results[0];
      const tk = results[1];
      const exp = results[2];
      const diary = hasDiaryAndDocuments ? results[3] : [];
      const docs = hasDiaryAndDocuments ? results[4] : [];
      
      console.log(`[ProjectOverview] Loaded ${ph.length} phases, ${tk.length} tasks, ${exp.length} expenses for projectType="${projectTypeForLoad}"`);
      if (hasDiaryAndDocuments) {
        console.log(`[ProjectOverview] Loaded ${diary.length} diary entries, ${docs.length} documents`);
      }
      if (ph.length > 0) {
        console.log(`[ProjectOverview] Phase IDs: ${ph.map((p: any) => p.id).join(', ')}`);
        console.log(`[ProjectOverview] Phase names: ${ph.map((p: any) => p.name).join(', ')}`);
      }
      if (tk.length > 0) {
        console.log(`[ProjectOverview] Task IDs (first 5): ${tk.slice(0, 5).map((t: any) => t.id).join(', ')}`);
        if (isBuildProject) {
          const tasksWithPhase = tk.filter((t: any) => t.phaseId);
          const tasksWithoutPhase = tk.filter((t: any) => !t.phaseId);
          console.log(`[ProjectOverview] Tasks with phaseId: ${tasksWithPhase.length}, without phaseId: ${tasksWithoutPhase.length}`);
        }
      }
      
      // Only set phases for BUILD projects
      if (isBuildProject) {
        setPhases(ph || []);
      } else {
        setPhases([]); // TRADE/MAINTENANCE have no phases
      }
      setTasks(tk || []);
      setExpenses(exp || []);
      if (hasDiaryAndDocuments) {
        setDiaryEntries(diary);
        setProjectDocuments(docs);
      } else {
        setDiaryEntries([]);
        setProjectDocuments([]);
      }
      
      // Load all attachments for the project to build attachment count maps
      try {
        const allAttachments = await attachmentsService.listAttachments(projectId);
        console.log(`[ProjectOverview] Loaded ${allAttachments.length} total attachments`);
        
        // Build task attachments map
        const taskMap = new Map<string, number>();
        const expenseMap = new Map<string, number>();
        
        allAttachments.forEach(att => {
          if (att.taskId) {
            const count = taskMap.get(att.taskId) || 0;
            taskMap.set(att.taskId, count + 1);
          }
          if (att.expenseId) {
            const count = expenseMap.get(att.expenseId) || 0;
            expenseMap.set(att.expenseId, count + 1);
          }
        });
        
        console.log(`[ProjectOverview] Task attachments map:`, Array.from(taskMap.entries()));
        console.log(`[ProjectOverview] Expense attachments map:`, Array.from(expenseMap.entries()));
        
        setTaskAttachmentsMap(taskMap);
        setExpenseAttachmentsMap(expenseMap);
      } catch (error: any) {
        console.error(`[ProjectOverview] Error loading attachments for map:`, error);
        // Don't fail - attachments map is optional
        setTaskAttachmentsMap(new Map());
        setExpenseAttachmentsMap(new Map());
      }
      // Initialize all phases as collapsed (zrolované) by default
      const expanded = new Map<string, boolean>();
      ph.forEach((p: { id: string }) => expanded.set(p.id, false));
      setExpandedPhases(expanded);
    } catch (error: any) {
      console.error('[ProjectOverview] Error loading data:', error);
      setPhases([]);
      setTasks([]);
      setExpenses([]);
      setExpandedPhases(new Map());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);
  
  const onRefresh = useCallback(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);
  
  // Open expense modal if requested from navigation
  useEffect(() => {
    if (paramOpenExpenseModal && projectId) {
      setExpensePhaseId(paramSelectedPhaseId ?? null);
      setShowExpenseModal(true);
    }
  }, [paramOpenExpenseModal, projectId, paramSelectedPhaseId]);

  // Open new task modal if requested from navigation
  useEffect(() => {
    if (paramOpenNewTask && projectId) {
      setSelectedPhaseId(paramSelectedPhaseId ?? null);
      setShowNewTask(true);
    }
  }, [paramOpenNewTask, projectId, paramSelectedPhaseId]);

  const goBack = () => navigation.goBack();
  const goToMembers = () => (navigation as { navigate: (n: string, p?: object) => void }).navigate("ProjectMembers", { projectId, projectName });

  const onCreateTask = async () => {
    if (!orgId || !projectId) return;
    
    // For TRADE/MAINTENANCE: require either text or voice recording
    if (isTradeOrMaintenance && !newTitle.trim() && !recordingUri) {
      Alert.alert(t("common.error"), t("projectOverview.enterTaskDescription"));
      return;
    }
    
    // For BUILD: require text
    if (!isTradeOrMaintenance && !newTitle.trim()) {
      return;
    }
    
    setSubmitting(true);
    try {
      // For BUILD projects: use selectedPhaseId, for TRADE/MAINTENANCE: don't set phaseId
      const taskPhaseId = isBuildProject ? (selectedPhaseId || undefined) : undefined;
      
      // Determine task title: use text or "Hlasová nahrávka" if voice recording
      const taskTitle = newTitle.trim() || (recordingUri ? "Hlasová nahrávka" : "");
      
      console.log(`[ProjectOverview] Creating custom task: projectType="${projectType}", phaseId="${taskPhaseId || 'none'}", hasVoice=${!!recordingUri}`);
      
      const taskDoc = await tasksService.createTask(orgId, projectId, taskTitle, {
        phaseId: taskPhaseId,
        dueDate: newTaskDueDate.trim() || undefined,
        // order will be auto-calculated (max + 1) in createTask function
      });
      
      // If voice recording exists, upload it as attachment
      if (recordingUri && taskDoc.id) {
        try {
          console.log(`[ProjectOverview] Uploading voice recording for task ${taskDoc.id}...`);
          await attachmentsService.uploadAttachment(projectId, {
            taskId: taskDoc.id,
            phaseId: null,
            expenseId: null,
            localUri: recordingUri,
            fileName: `voice_${Date.now()}.m4a`,
            mimeType: 'audio/m4a',
            kind: 'audio' as const
          });
          console.log(`[ProjectOverview] Voice recording uploaded successfully for task ${taskDoc.id}`);
        } catch (attachmentError) {
          console.error(`[ProjectOverview] Error uploading voice recording:`, attachmentError);
          Alert.alert(t("common.warning"), t("projectOverview.taskCreatedVoiceFailed"));
          // Don't fail task creation if attachment upload fails
        }
      }
      
      setShowNewTask(false);
      setNewTitle("");
      setSelectedPhaseId(null);
      setShowVoiceRecord(false);
      setIsRecording(false);
      setRecordingUri(null);
      await load(true); // Reload with refresh
      console.log(`[ProjectOverview] Custom task created successfully`);
    } catch (e: unknown) {
      console.error(`[ProjectOverview] Error creating task:`, e);
      const c = (e as { code?: string }).code;
      Alert.alert("", c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  const openNewTaskModal = (phaseId?: string) => {
    setSelectedPhaseId(phaseId || null);
    setShowNewTask(true);
  };

  const openTaskDetail = (task: TaskDoc) => {
    console.log(`[ProjectOverview] Opening task detail for task ${task.id}`);
    try {
      // ProjectOverviewScreen is already in the root Stack navigator, so we can navigate directly
      (navigation as any).navigate("TaskDetail", { task });
    } catch (error) {
      console.error(`[ProjectOverview] Error navigating to TaskDetail:`, error);
      // Fallback: try with getParent (in case we're nested)
      try {
        const parent = navigation.getParent();
        if (parent) {
          (parent as any).navigate("TaskDetail", { task });
        } else {
          Alert.alert(t("common.error"), t("projectOverview.failedToOpenTask"));
        }
      } catch (fallbackError) {
        console.error(`[ProjectOverview] Fallback navigation also failed:`, fallbackError);
        Alert.alert(t("common.error"), t("projectOverview.failedToOpenTask"));
      }
    }
  };

  const toggleTaskStatus = async (task: TaskDoc) => {
    if (!projectId) return;
    
    try {
      const newStatus = task.status === "DONE" ? "OPEN" : "DONE";
      console.log(`[ProjectOverview] Toggling task ${task.id} from ${task.status} to ${newStatus}`);
      await updateTaskStatus(projectId, task.id, newStatus);
      
      // Reload tasks after status change
      await load(true);
      console.log(`[ProjectOverview] Task status updated successfully`);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error toggling task status:`, error);
      Alert.alert('Chyba', error.message || 'Nepodarilo sa zmeniť status úlohy.');
    }
  };

  const handleArchiveTask = async (task: TaskDoc) => {
    if (!projectId) return;
    
    Alert.alert(
      'Archivovať úlohu?',
      `Naozaj chceš archivovať úlohu "${task.title}"? Úloha sa skryje zo zoznamu, ale zostane v databáze.`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Archivovať',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log(`[ProjectOverview] Archiving task ${task.id}`);
              await archiveTask(projectId, task.id);
              await load(true);
              console.log(`[ProjectOverview] Task archived successfully`);
            } catch (error: any) {
              console.error(`[ProjectOverview] Error archiving task:`, error);
              Alert.alert(t("common.error"), error.message || t("projectOverview.failedToArchive"));
            }
          },
        },
      ]
    );
  };

  const handleEditTask = (task: TaskDoc) => {
    setEditingTask(task);
    setEditTaskTitle(task.title || "");
    setEditTaskDueDate(task.dueDate || "");
    if (task.dueDate) {
      setDatePickerDate(new Date(task.dueDate));
    }
    setShowEditTaskModal(true);
  };

  const handleSaveEditTask = async () => {
    if (!orgId || !projectId || !editingTask || !editTaskTitle.trim()) return;
    
    setSubmitting(true);
    try {
      console.log(`[ProjectOverview] Updating task ${editingTask.id}: title="${editTaskTitle.trim()}", dueDate="${editTaskDueDate || 'null'}"`);
      await tasksService.updateTaskTitle(orgId, projectId, editingTask.id, editTaskTitle.trim(), editTaskDueDate.trim() || null);
      setShowEditTaskModal(false);
      setEditingTask(null);
      setEditTaskTitle("");
      setEditTaskDueDate("");
      await load(true);
      console.log(`[ProjectOverview] Task updated successfully`);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error updating task:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (task: TaskDoc) => {
    if (!projectId) return;
    
    Alert.alert(
      'Vymazať úlohu?',
      `Naozaj chceš vymazať úlohu "${task.title}"? Táto akcia je nezvratná.`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            if (!orgId) return;
            try {
              console.log(`[ProjectOverview] Deleting task ${task.id}`);
              await tasksService.deleteTask(orgId, projectId, task.id);
              await load(true);
              console.log(`[ProjectOverview] Task deleted successfully`);
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting task:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
            }
          },
        },
      ]
    );
  };

  const handleReorderTask = async (task: TaskDoc, direction: 'up' | 'down') => {
    if (!projectId) return;
    
    try {
      console.log(`[ProjectOverview] Reordering task ${task.id} ${direction}`);
      await reorderTask(projectId, task.id, direction);
      await load(true);
      console.log(`[ProjectOverview] Task reordered successfully`);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error reordering task:`, error);
      Alert.alert(t("common.error"), error.message || t("projectOverview.failedToChangeOrder"));
    }
  };

  const handleMenuPress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Zrušiť', 'Upraviť projekt', 'Vymazať projekt'],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            handleEditProject();
          } else if (buttonIndex === 2) {
            handleDeleteProject();
          }
        }
      );
    } else {
      // Android - použij Alert
      Alert.alert(
        projectName || 'Projekt',
        'Vyberte akciu',
        [
          { text: 'Zrušiť', style: 'cancel' },
          { text: 'Upraviť projekt', onPress: handleEditProject },
          { text: 'Vymazať projekt', style: 'destructive', onPress: handleDeleteProject },
        ]
      );
    }
  };

  const handleEditProject = () => {
    setEditProjectName(projectName || "");
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editProjectName.trim() || !projectId || !orgId) return;
    setSubmitting(true);
    try {
      console.log(`[ProjectOverview] Updating project ${projectId}: name="${editProjectName.trim()}"`);
      await projectsService.updateProject(orgId, projectId, editProjectName.trim());
      setShowEditModal(false);
      setEditProjectName("");
      // Reload project data
      await load(true);
      // Update route params if needed
      Alert.alert(t("common.success"), t("projectOverview.projectUpdated"));
    } catch (error: any) {
      console.error(`[ProjectOverview] Error updating project:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProject = () => {
    Alert.alert(
      'Vymazať projekt?',
      `Naozaj chceš vymazať projekt "${projectName}"? Táto akcia je nezvratná a vymaže všetky fázy, úlohy a prílohy.`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            if (!projectId || !orgId) return;
            setSubmitting(true);
            try {
              console.log(`[ProjectOverview] Deleting project ${projectId}`);
              await projectsService.deleteProject(orgId, projectId);
              Alert.alert('Úspech', 'Projekt bol vymazaný.');
              // Navigate back to projects list
              navigation.goBack();
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting project:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleMoveTask = (task: TaskDoc) => {
    setMovingTask(task);
    setShowMoveTaskModal(true);
  };

  const handleMoveTaskToPhase = async (targetPhaseId: string | null) => {
    if (!projectId || !movingTask) return;
    
    try {
      await moveTaskToPhase(projectId, movingTask.id, targetPhaseId);
      
      // Reload data
      await load(true);
      
      setShowMoveTaskModal(false);
      setMovingTask(null);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error moving task:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToMoveTask"));
    }
  };

  const handleEditPhase = (phase: ProjectPhaseDoc) => {
    setEditingPhase(phase);
    setEditPhaseName(phase.name);
    setShowEditPhaseModal(true);
  };

  const handleCreatePhase = async () => {
    if (!projectId || !newPhaseName.trim()) return;
    
    setSubmitting(true);
    try {
      const newPhase = await createPhase(projectId, newPhaseName.trim());
      
      // Update local state
      setPhases(prevPhases => [...prevPhases, newPhase].sort((a, b) => a.order - b.order));
      
      setShowNewPhaseModal(false);
      setNewPhaseName("");
    } catch (error: any) {
      console.error(`[ProjectOverview] Error creating phase:`, error);
      Alert.alert('Chyba', error.message || 'Nepodarilo sa vytvoriť fázu.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePhase = async () => {
    if (!projectId || !editingPhase || !editPhaseName.trim()) return;
    
    setSubmitting(true);
    try {
      await updatePhase(projectId, editingPhase.id, editPhaseName.trim());
      
      // Update local state
      setPhases(prevPhases => 
        prevPhases.map(p => 
          p.id === editingPhase.id 
            ? { ...p, name: editPhaseName.trim() }
            : p
        )
      );
      
      setShowEditPhaseModal(false);
      setEditingPhase(null);
      setEditPhaseName("");
    } catch (error: any) {
      console.error(`[ProjectOverview] Error updating phase:`, error);
      Alert.alert(t("common.error"), error.message || t("projectOverview.failedToEditPhase"));
    }
  };

  const handleDeletePhase = async (phase: ProjectPhaseDoc) => {
    if (!projectId) return;
    
    // Check if phase has tasks
    const phaseTasks = tasks.filter(t => t.phaseId === phase.id);
    if (phaseTasks.length > 0) {
      Alert.alert(
        'Nemožno vymazať fázu',
        `Táto fáza obsahuje ${phaseTasks.length} úloh. Najprv vymažte alebo presuňte úlohy.`
      );
      return;
    }
    
    Alert.alert(
      'Vymazať fázu?',
      `Naozaj chcete vymazať fázu "${phase.name}"?`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePhase(projectId, phase.id);
              
              // Update local state
              setPhases(prevPhases => prevPhases.filter(p => p.id !== phase.id));
              
              // Remove from expanded phases
              const updated = new Map(expandedPhases);
              updated.delete(phase.id);
              expandedPhasesRef.current = updated;
              setExpandedPhases(updated);
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting phase:`, error);
              Alert.alert(t("common.error"), t("projectOverview.failedToDeletePhase"));
            }
          },
        },
      ]
    );
  };

  const onAssigneePress = (task: TaskDoc) => {
    if (!orgId || !user || !projectId) return;
    const name = user.name ?? user.email ?? "Me";
    if (task.assigneeId === user.id) {
      tasksService.updateTaskAssignee(orgId, projectId, task.id, null, null).then(() => load()).catch(() => {});
    } else {
      tasksService.updateTaskAssignee(orgId, projectId, task.id, user.id, name).then(() => load()).catch(() => {});
    }
  };

  // Expenses handlers
  const openExpenseModal = (expense?: ExpenseDoc) => {
    if (expense) {
      setEditingExpense(expense);
      setExpenseTitle(expense.title);
      setExpenseAmount(expense.amount?.toString() || "");
      setExpenseDate(expense.date ? expense.date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setExpenseNote(expense.note || "");
      setExpensePhaseId(expense.phaseId || null);
      setExpenseAttachment(null); // Reset attachment - will load from expense.attachmentId if needed
    } else {
      setEditingExpense(null);
      setExpenseTitle("");
      setExpenseAmount("");
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setExpenseNote("");
      setExpensePhaseId(null);
      setExpenseAttachment(null);
    }
    setShowExpenseModal(true);
  };

  const pickExpenseImage = async () => {
    if (!ImagePicker) {
      Alert.alert('Chyba', 'expo-image-picker nie je nainštalovaný.');
      return;
    }
    try {
      // Show action sheet to choose between camera and gallery
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Zrušiť', 'Odfotiť faktúru', 'Vybrať z galérie'],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await launchCameraForExpense();
            } else if (buttonIndex === 2) {
              await launchGalleryForExpense();
            }
          }
        );
      } else {
        Alert.alert(
          'Vyberte zdroj',
          'Odkiaľ chcete pridať faktúru?',
          [
            { text: 'Zrušiť', style: 'cancel' },
            { text: 'Odfotiť faktúru', onPress: launchCameraForExpense },
            { text: 'Vybrať z galérie', onPress: launchGalleryForExpense },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense image:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať obrázok.');
    }
  };

  const launchCameraForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup ku kamere na fotografovanie faktúr.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setExpenseAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error launching camera for expense:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa otvoriť kameru.');
    }
  };

  const launchGalleryForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup k galérii na výber faktúr.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setExpenseAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense from gallery:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať obrázok.');
    }
  };

  const pickDiaryImage = async () => {
    if (!ImagePicker) {
      Alert.alert('Chyba', 'expo-image-picker nie je nainštalovaný.');
      return;
    }
    try {
      // Show action sheet to choose between camera and gallery
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Zrušiť', 'Odfotiť', 'Vybrať z galérie'],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await launchCameraForDiary();
            } else if (buttonIndex === 2) {
              await launchGalleryForDiary();
            }
          }
        );
      } else {
        Alert.alert(
          'Vyberte zdroj',
          'Odkiaľ chcete pridať fotku?',
          [
            { text: 'Zrušiť', style: 'cancel' },
            { text: 'Odfotiť', onPress: launchCameraForDiary },
            { text: 'Vybrať z galérie', onPress: launchGalleryForDiary },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking diary image:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať fotku.');
    }
  };

  const launchCameraForDiary = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup ku kamere na fotografovanie.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setDiaryAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `dennik_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error launching camera for diary:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa otvoriť kameru.');
    }
  };

  const launchGalleryForDiary = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup k galérii na výber fotiek.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setDiaryAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `dennik_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking diary image from gallery:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať fotku.');
    }
  };

  const pickExpenseDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert('Chyba', 'expo-document-picker nie je nainštalovaný.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        setExpenseAttachment({
          uri: asset.uri,
          fileName: asset.name || `faktura_${Date.now()}.pdf`,
          mimeType: asset.mimeType || 'application/pdf',
          kind,
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense document:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať dokument.');
    }
  };

  const handleSaveExpense = async () => {
    if (!expenseTitle.trim() || !expenseAmount.trim() || !projectId || !orgId) return;
    
    const amount = parseFloat(expenseAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Chyba', 'Zadajte platnú sumu.');
      return;
    }
    
    setSubmitting(true);
    try {
      const expenseDateObj = new Date(expenseDate);
      let attachmentId: string | null = null;
      
      if (editingExpense) {
        // For editing: upload attachment first if provided, then update expense
        if (expenseAttachment) {
          try {
            setUploadingExpenseAttachment(true);
            const attachment = await attachmentsService.uploadAttachment(projectId, {
              expenseId: editingExpense.id,
              taskId: null,
              phaseId: expensePhaseId,
              localUri: expenseAttachment.uri,
              fileName: expenseAttachment.fileName,
              mimeType: expenseAttachment.mimeType,
              kind: expenseAttachment.kind === 'pdf' ? 'pdf' : expenseAttachment.kind === 'image' ? 'image' : 'document',
            });
            attachmentId = attachment.id;
            console.log(`[ProjectOverview] Uploaded expense attachment: ${attachmentId}`);
          } catch (error: any) {
            console.error(`[ProjectOverview] Error uploading expense attachment:`, error);
            Alert.alert('Upozornenie', 'Výdavok bol uložený, ale príloha sa nepodarila nahrať.');
          } finally {
            setUploadingExpenseAttachment(false);
          }
        }
        
        await expensesService.updateExpense(projectId, editingExpense.id, {
          title: expenseTitle.trim(),
          amount,
          date: expenseDateObj,
          note: expenseNote.trim() || undefined,
          attachmentId: attachmentId || editingExpense.attachmentId || undefined,
        });
        Alert.alert('Úspech', 'Výdavok bol upravený.');
      } else {
        // For new expense: create expense first, then upload attachment with expenseId
        const newExpense = await expensesService.createExpense(orgId, projectId, {
          title: expenseTitle.trim(),
          amount,
          date: expenseDateObj,
          note: expenseNote.trim() || undefined,
          phaseId: expensePhaseId || undefined,
        });
        
        // Upload attachment after expense creation (so we have expenseId)
        if (expenseAttachment && newExpense.id) {
          try {
            setUploadingExpenseAttachment(true);
            const attachment = await attachmentsService.uploadAttachment(projectId, {
              expenseId: newExpense.id,
              taskId: null,
              phaseId: expensePhaseId,
              localUri: expenseAttachment.uri,
              fileName: expenseAttachment.fileName,
              mimeType: expenseAttachment.mimeType,
              kind: expenseAttachment.kind === 'pdf' ? 'pdf' : expenseAttachment.kind === 'image' ? 'image' : 'document',
            });
            attachmentId = attachment.id;
            
            // Update expense with attachmentId
            await expensesService.updateExpense(projectId, newExpense.id, {
              attachmentId: attachmentId,
            });
            console.log(`[ProjectOverview] Uploaded expense attachment: ${attachmentId}`);
          } catch (error: any) {
            console.error(`[ProjectOverview] Error uploading expense attachment:`, error);
            Alert.alert('Upozornenie', 'Výdavok bol uložený, ale príloha sa nepodarila nahrať.');
          } finally {
            setUploadingExpenseAttachment(false);
          }
        }
        
        Alert.alert('Úspech', 'Výdavok bol pridaný.');
      }
      setShowExpenseModal(false);
      setExpenseAttachment(null);
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error saving expense:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
    } finally {
      setSubmitting(false);
      setUploadingExpenseAttachment(false);
    }
  };

  const handleDeleteExpense = (expense: ExpenseDoc) => {
    Alert.alert(
      'Vymazať výdavok?',
      `Naozaj chceš vymazať výdavok "${expense.title}"?`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            if (!projectId) return;
            try {
              await expensesService.deleteExpense(projectId, expense.id);
              await load(true);
              Alert.alert('Úspech', 'Výdavok bol vymazaný.');
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting expense:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
            }
          },
        },
      ]
    );
  };

  const getDocumentTypeLabel = (type: 'plan' | 'permit' | 'contract' | 'report' | 'other'): string => {
    switch (type) {
      case 'plan': return 'Plán';
      case 'permit': return 'Povolenie';
      case 'contract': return 'Zmluva';
      case 'report': return 'Správa';
      default: return 'Iné';
    }
  };

  const handleSaveDiaryEntry = async () => {
    if (!diaryWorkDescription.trim() || !projectId || !orgId) return;
    
    setSubmitting(true);
    try {
      const entryDate = new Date(diaryDate);
      let attachmentIds: string[] = [];
      
      // Upload attachment if provided
      if (diaryAttachment) {
        try {
          setUploadingDiaryAttachment(true);
          const attachment = await attachmentsService.uploadAttachment(projectId, {
            expenseId: null,
            taskId: null,
            phaseId: diaryPhaseId,
            localUri: diaryAttachment.uri,
            fileName: diaryAttachment.fileName,
            mimeType: diaryAttachment.mimeType,
            kind: diaryAttachment.kind,
          });
          attachmentIds = [attachment.id];
          console.log(`[ProjectOverview] Uploaded diary attachment: ${attachment.id}`);
        } catch (error: any) {
          console.error(`[ProjectOverview] Error uploading diary attachment:`, error);
          Alert.alert('Chyba', 'Nepodarilo sa nahrať fotku.');
          setSubmitting(false);
          setUploadingDiaryAttachment(false);
          return;
        } finally {
          setUploadingDiaryAttachment(false);
        }
      }
      
      if (editingDiaryEntry) {
        // For editing, merge with existing attachments
        const existingAttachments = editingDiaryEntry.attachments || [];
        const finalAttachments = diaryAttachment ? [...existingAttachments, ...attachmentIds] : existingAttachments;
        
        await constructionDiaryService.updateDiaryEntry(projectId, editingDiaryEntry.id, {
          date: entryDate,
          weather: diaryWeather.trim() || undefined,
          workers: diaryWorkers.trim() || undefined,
          workDescription: diaryWorkDescription.trim(),
          materials: diaryMaterials.trim() || undefined,
          notes: diaryNotes.trim() || undefined,
          phaseId: diaryPhaseId,
          attachments: finalAttachments,
        });
        Alert.alert('Úspech', 'Zápis do denníka bol upravený.');
      } else {
        await constructionDiaryService.createDiaryEntry(orgId, projectId, {
          date: entryDate,
          weather: diaryWeather.trim() || undefined,
          workers: diaryWorkers.trim() || undefined,
          workDescription: diaryWorkDescription.trim(),
          materials: diaryMaterials.trim() || undefined,
          notes: diaryNotes.trim() || undefined,
          phaseId: diaryPhaseId,
          attachments: attachmentIds,
        });
        Alert.alert('Úspech', 'Zápis do denníka bol pridaný.');
      }
      
      setShowDiaryModal(false);
      setEditingDiaryEntry(null);
      setDiaryDate(new Date().toISOString().split('T')[0]);
      setDiaryWeather("");
      setDiaryWorkers("");
      setDiaryWorkDescription("");
      setDiaryMaterials("");
      setDiaryNotes("");
      setDiaryPhaseId(null);
      setDiaryAttachment(null);
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error saving diary entry:`, error);
      Alert.alert('Chyba', error.message || 'Nepodarilo sa uložiť zápis do denníka.');
    } finally {
      setSubmitting(false);
      setUploadingDiaryAttachment(false);
    }
  };

  const pickDocumentFile = async () => {
    if (!DocumentPicker) {
      Alert.alert('Chyba', 'expo-document-picker nie je nainštalovaný.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        setDocumentAttachment({
          uri: asset.uri,
          fileName: asset.name || `dokument_${Date.now()}.pdf`,
          mimeType: asset.mimeType || 'application/pdf',
          kind,
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking document:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať dokument.');
    }
  };

  const handleSaveDocument = async () => {
    if (!documentName.trim() || !projectId || !orgId) return;
    
    if (!documentAttachment && !editingDocument) {
      Alert.alert('Chyba', 'Musíte pridať súbor dokumentu.');
      return;
    }
    
    setSubmitting(true);
    try {
      let attachmentId: string | null = null;
      
      // Upload attachment if provided
      if (documentAttachment) {
        try {
          setUploadingDocumentAttachment(true);
          const attachment = await attachmentsService.uploadAttachment(projectId, {
            expenseId: null,
            taskId: null,
            phaseId: documentPhaseId,
            localUri: documentAttachment.uri,
            fileName: documentAttachment.fileName,
            mimeType: documentAttachment.mimeType,
            kind: documentAttachment.kind,
          });
          attachmentId = attachment.id;
          console.log(`[ProjectOverview] Uploaded document attachment: ${attachmentId}`);
        } catch (error: any) {
          console.error(`[ProjectOverview] Error uploading document attachment:`, error);
          Alert.alert('Chyba', 'Nepodarilo sa nahrať súbor dokumentu.');
          setSubmitting(false);
          setUploadingDocumentAttachment(false);
          return;
        } finally {
          setUploadingDocumentAttachment(false);
        }
      }
      
      if (editingDocument) {
        await projectDocumentsService.updateProjectDocument(projectId, editingDocument.id, {
          name: documentName.trim(),
          type: documentType,
          description: documentDescription.trim() || undefined,
          phaseId: documentPhaseId,
        });
        Alert.alert('Úspech', 'Dokument bol upravený.');
      } else {
        if (!attachmentId) {
          Alert.alert('Chyba', 'Musíte pridať súbor dokumentu.');
          setSubmitting(false);
          return;
        }
        
        await projectDocumentsService.createProjectDocument(orgId, projectId, {
          name: documentName.trim(),
          type: documentType,
          description: documentDescription.trim() || undefined,
          attachmentId: attachmentId,
          phaseId: documentPhaseId,
        });
        Alert.alert('Úspech', 'Dokument bol pridaný.');
      }
      
      setShowDocumentModal(false);
      setEditingDocument(null);
      setDocumentName("");
      setDocumentType('other');
      setDocumentDescription("");
      setDocumentPhaseId(null);
      setDocumentAttachment(null);
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error saving document:`, error);
      Alert.alert('Chyba', error.message || 'Nepodarilo sa uložiť dokument.');
    } finally {
      setSubmitting(false);
      setUploadingDocumentAttachment(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const formatAmount = (amount: number | null, currency: string = 'EUR') => {
    if (amount === null || amount === undefined) {
      return `0.00 ${currency}`;
    }
    return `${amount.toFixed(2)} ${currency}`;
  };

  // Attachment handlers
  const openAttachmentModal = async (type: 'task' | 'expense', id: string) => {
    setAttachmentContext({ type, id });
    setShowAttachmentModal(true);
    try {
      const atts = await attachmentsService.listAttachments(projectId, {
        taskId: type === 'task' ? id : undefined,
        expenseId: type === 'expense' ? id : undefined,
      });
      setAttachments(atts);
      
      // Load thumbnails for images
      const thumbnailMap = new Map<string, string>();
      for (const att of atts) {
        if (att.fileType === 'image') {
          try {
            // Try to use stored downloadURL first
            const attachmentData = att as any;
            if (attachmentData.downloadURL) {
              thumbnailMap.set(att.id, attachmentData.downloadURL);
            } else {
              // Fetch URL from Storage
              const url = await attachmentsService.getAttachmentURL(att);
              thumbnailMap.set(att.id, url);
            }
          } catch (error: any) {
            console.error(`[ProjectOverview] Error loading thumbnail for ${att.id}:`, error);
            // Continue without thumbnail - will show icon instead
          }
        }
      }
      setAttachmentThumbnails(thumbnailMap);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error loading attachments:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa načítať prílohy.');
    }
  };

  const pickImage = async () => {
    if (!ImagePicker) {
      Alert.alert('Chyba', 'expo-image-picker nie je nainštalovaný. Spustite: npx expo install expo-image-picker');
      return;
    }
    try {
      // Show action sheet to choose between camera and gallery
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Zrušiť', 'Odfotiť', 'Vybrať z galérie', 'Vybrať video'],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              // Camera
              await launchCameraForAttachment();
            } else if (buttonIndex === 2) {
              // Gallery (images)
              await launchGalleryForAttachment();
            } else if (buttonIndex === 3) {
              // Video
              await launchVideoPicker();
            }
          }
        );
      } else {
        // Android - show Alert with options
        Alert.alert(
          'Vyberte zdroj',
          'Odkiaľ chcete pridať prílohu?',
          [
            { text: 'Zrušiť', style: 'cancel' },
            { text: 'Odfotiť', onPress: launchCameraForAttachment },
            { text: 'Vybrať z galérie', onPress: launchGalleryForAttachment },
            { text: 'Vybrať video', onPress: launchVideoPicker },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking image:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať prílohu.');
    }
  };

  const launchCameraForAttachment = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup ku kamere na fotografovanie.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadAttachmentFile(result.assets[0].uri, result.assets[0].fileName || 'image.jpg', 'image');
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error launching camera:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa otvoriť kameru.');
    }
  };

  const launchGalleryForAttachment = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup k galérii.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadAttachmentFile(result.assets[0].uri, result.assets[0].fileName || 'image.jpg', 'image');
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking from gallery:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať obrázok.');
    }
  };

  const launchVideoPicker = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Oprávnenie', 'Potrebujeme prístup k galérii na výber videa.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1.0,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await uploadAttachmentFile(
          asset.uri, 
          asset.fileName || `video_${Date.now()}.mp4`, 
          'document',
          asset.mimeType || 'video/mp4'
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking video:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať video.');
    }
  };

  const pickDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert('Chyba', 'expo-document-picker nie je nainštalovaný. Spustite: npx expo install expo-document-picker');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        await uploadAttachmentFile(asset.uri, asset.name, kind, asset.mimeType);
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking document:`, error);
      Alert.alert('Chyba', 'Nepodarilo sa vybrať dokument.');
    }
  };

  const uploadAttachmentFile = async (
    localUri: string,
    fileName: string,
    kind: 'image' | 'document' | 'pdf',
    mimeType?: string
  ) => {
    if (!projectId || !orgId || !attachmentContext) return;

    setUploadingAttachment(true);
    try {
      await attachmentsService.uploadAttachment(projectId, {
        taskId: attachmentContext.type === 'task' ? attachmentContext.id : null,
        expenseId: attachmentContext.type === 'expense' ? attachmentContext.id : null,
        localUri,
        fileName,
        mimeType: mimeType || (kind === 'image' ? 'image/jpeg' : kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
        kind,
      });
      
      // Reload attachments
      const atts = await attachmentsService.listAttachments(projectId, {
        taskId: attachmentContext.type === 'task' ? attachmentContext.id : undefined,
        expenseId: attachmentContext.type === 'expense' ? attachmentContext.id : undefined,
      });
      setAttachments(atts);
      
      // Load thumbnails for new images
      const thumbnailMap = new Map(attachmentThumbnails);
      for (const att of atts) {
        if (att.fileType === 'image' && !thumbnailMap.has(att.id)) {
          try {
            const attachmentData = att as any;
            if (attachmentData.downloadURL) {
              thumbnailMap.set(att.id, attachmentData.downloadURL);
            } else {
              const url = await attachmentsService.getAttachmentURL(att);
              thumbnailMap.set(att.id, url);
            }
          } catch (error: any) {
            console.error(`[ProjectOverview] Error loading thumbnail for ${att.id}:`, error);
          }
        }
      }
      setAttachmentThumbnails(thumbnailMap);
      
      // Update attachment maps
      if (attachmentContext.type === 'task') {
        const newMap = new Map(taskAttachmentsMap);
        const count = newMap.get(attachmentContext.id) || 0;
        newMap.set(attachmentContext.id, count + 1);
        setTaskAttachmentsMap(newMap);
      } else if (attachmentContext.type === 'expense') {
        const newMap = new Map(expenseAttachmentsMap);
        const count = newMap.get(attachmentContext.id) || 0;
        newMap.set(attachmentContext.id, count + 1);
        setExpenseAttachmentsMap(newMap);
      }
      
      Alert.alert('Úspech', 'Príloha bola pridaná.');
    } catch (error: any) {
      console.error(`[ProjectOverview] Error uploading attachment:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const openAttachment = async (attachment: AttachmentDoc) => {
    try {
      console.log(`[ProjectOverview] Opening attachment: ${attachment.fileName}, type: ${attachment.fileType}`);
      
      // Try to get URL - first check if downloadURL is stored in metadata (from upload)
      // Otherwise fetch it from Storage
      let url: string;
      try {
        // Check if attachment has downloadURL stored (it should be stored during upload)
        const attachmentData = attachment as any;
        if (attachmentData.downloadURL) {
          url = attachmentData.downloadURL;
          console.log(`[ProjectOverview] Using stored downloadURL`);
        } else {
          // Fetch URL from Storage
          url = await attachmentsService.getAttachmentURL(attachment);
          console.log(`[ProjectOverview] Fetched URL from Storage`);
        }
        console.log(`[ProjectOverview] Attachment URL: ${url.substring(0, 50)}...`);
      } catch (error: any) {
        console.error(`[ProjectOverview] Error getting attachment URL:`, error);
        const errorCode = error.code || '';
        const errorMessage = error.message || 'Neznáma chyba';
        
        if (errorCode === 'storage/unauthorized' || errorCode === 'permission-denied') {
          Alert.alert(
            'Chyba oprávnení',
            'Nemáte oprávnenie na zobrazenie tejto prílohy. Skontrolujte Storage rules a či ste vlastníkom projektu.'
          );
        } else {
          Alert.alert(
            'Chyba',
            `Nepodarilo sa načítať prílohu: ${errorMessage}\n\nSkontrolujte Storage rules a oprávnenia.`
          );
        }
        return;
      }
      
      // For images, show in modal viewer
      if (attachment.fileType === 'image') {
        setViewingAttachment(attachment);
        setViewingAttachmentURL(url);
        return;
      }
      
      // For documents/PDFs, try to open with Linking
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
        } else {
          Alert.alert(
            'Otvoriť prílohu',
            `Nepodarilo sa automaticky otvoriť prílohu. Skúste otvoriť URL v prehliadači.`
          );
        }
      } catch (error: any) {
        console.error(`[ProjectOverview] Error opening document:`, error);
        Alert.alert('Chyba', `Nepodarilo sa otvoriť prílohu: ${error.message || 'Neznáma chyba'}`);
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error opening attachment:`, error);
      Alert.alert('Chyba', `Nepodarilo sa otvoriť prílohu: ${error.message || 'Neznáma chyba'}`);
    }
  };

  const deleteAttachmentHandler = async (attachment: AttachmentDoc) => {
    Alert.alert(
      'Vymazať prílohu?',
      `Naozaj chceš vymazať "${attachment.fileName}"?`,
      [
        { text: 'Zrušiť', style: 'cancel' },
        {
          text: 'Vymazať',
          style: 'destructive',
          onPress: async () => {
            if (!projectId) return;
            try {
              await attachmentsService.deleteAttachment(projectId, attachment.id, attachment.storagePath);
              // Reload attachments
              const atts = await attachmentsService.listAttachments(projectId, {
                taskId: attachmentContext?.type === 'task' ? attachmentContext.id : undefined,
                expenseId: attachmentContext?.type === 'expense' ? attachmentContext.id : undefined,
              });
              setAttachments(atts);
              
              // Remove thumbnail from map
              const thumbnailMap = new Map(attachmentThumbnails);
              thumbnailMap.delete(attachment.id);
              setAttachmentThumbnails(thumbnailMap);
              
              // Update attachment maps
              if (attachmentContext?.type === 'task' && attachment.taskId) {
                const newMap = new Map(taskAttachmentsMap);
                const count = Math.max(0, (newMap.get(attachment.taskId) || 0) - 1);
                if (count > 0) {
                  newMap.set(attachment.taskId, count);
                } else {
                  newMap.delete(attachment.taskId);
                }
                setTaskAttachmentsMap(newMap);
              } else if (attachmentContext?.type === 'expense' && attachment.expenseId) {
                const newMap = new Map(expenseAttachmentsMap);
                const count = Math.max(0, (newMap.get(attachment.expenseId) || 0) - 1);
                if (count > 0) {
                  newMap.set(attachment.expenseId, count);
                } else {
                  newMap.delete(attachment.expenseId);
                }
                setExpenseAttachmentsMap(newMap);
              }
              
              Alert.alert('Úspech', 'Príloha bola vymazaná.');
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting attachment:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert('Chyba', c === "permission-denied" ? "Nemáte oprávnenie." : (error instanceof Error ? error.message : "Chyba."));
            }
          },
        },
      ]
    );
  };

  // Determine project type: BUILD has phases, TRADE/MAINTENANCE don't
  const isBuildProject = projectType === 'BUILD' || projectType === 'MANAGEMENT';
  const isTradeOrMaintenance = projectType === 'TRADE' || projectType === 'RESIDENTIAL' || projectType === 'MAINTENANCE';
  
  // Group tasks by phase (only for BUILD projects)
  const tasksByPhase = new Map<string, TaskDoc[]>();
  const phaseOrder: string[] = [];
  
  if (isBuildProject) {
    // For BUILD: group tasks by phaseId
    tasks.forEach((tk) => {
      // Include tasks with phaseId
      if (tk.phaseId) {
        if (!tasksByPhase.has(tk.phaseId)) tasksByPhase.set(tk.phaseId, []);
        tasksByPhase.get(tk.phaseId)!.push(tk);
      }
      // Tasks without phaseId will be shown in a separate section
    });
    // Set phase order from loaded phases
    phaseOrder.push(...(phases.map((p) => p.id)));
  } else {
    // For TRADE/MAINTENANCE: tasks don't have phases, just keep them in a flat list
    // We'll render them directly without phase grouping
  }
  
  // Get tasks without phaseId for BUILD projects
  const tasksWithoutPhase = isBuildProject ? tasks.filter(t => !t.phaseId) : [];
  
  console.log(`[ProjectOverview] Render: projectType="${projectType}", isBuildProject=${isBuildProject}, phases.length=${phases.length}, tasks.length=${tasks.length}, phaseOrder.length=${phaseOrder.length}`);
  if (phases.length > 0) {
    console.log(`[ProjectOverview] Phase order: ${phaseOrder.join(', ')}`);
  }

  const initials = (user?.name ?? user?.email ?? "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!projectId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Project not found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header: back | project name | members strip + menu */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.projectIcon}>
            <Ionicons name="list" size={20} color={colors.textOnDark} />
          </View>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>{projectName || t("projects.noName")}</Text>
            {projectType && (
              <Text style={styles.headerProjectType} numberOfLines={1}>
                {t(`projectType.${projectType}` as any) || projectType}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={goToMembers} style={styles.membersStrip}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Ionicons name="add" size={20} color={colors.textOnDark} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.headerMenu} 
          onPress={handleMenuPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="ellipsis-vertical" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      {/* Address section */}
      {addressText && (
        <View style={styles.addressSection}>
          <View style={styles.addressContent}>
            <Ionicons name="location" size={20} color={colors.primary} />
            <Text style={styles.addressText} numberOfLines={2}>{addressText}</Text>
          </View>
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={() => openInMaps(addressText)}
          >
            <Ionicons name="navigate" size={18} color="#FFFFFF" />
            <Text style={styles.navigateButtonText}>Navigovať</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Scrollable content */}
      <ScrollView 
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        nestedScrollEnabled
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Table: Task Name | Assignee */}
        {/* For TRADE/MAINTENANCE: only show table if there are tasks */}
        {/* For BUILD/MANAGEMENT: always show table */}
        {(!isTradeOrMaintenance || tasks.length > 0) && (
          <View style={styles.tableContainer}>
            <ScrollView 
              style={styles.tableScroll} 
              contentContainerStyle={styles.table} 
              nestedScrollEnabled
            >
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderText}>{t("projectOverview.taskName")}</Text>
            <Text style={[styles.tableHeaderText, styles.colAssignee]}>{t("projectOverview.assignee")}</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : tasks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>
              {isTradeOrMaintenance 
                ? "Projekt nemá žiadne úlohy." 
                : (t("projectOverview.noPhases") || "Projekt nemá žiadne fázy ani úlohy.")}
            </Text>
            <Text style={styles.emptySubtext}>
              {isTradeOrMaintenance 
                ? "Môžeš pridať úlohy pomocou tlačidla '+' v pravom dolnom rohu." 
                : (t("projectOverview.addPhaseHint") || "Môžeš pridať fázy a úlohy neskôr.")}
            </Text>
            {projectType === 'MANAGEMENT' && !templateId && !isTradeOrMaintenance && (
              <TouchableOpacity
                style={styles.addTemplateButton}
                onPress={async () => {
                  if (!projectId) return;
                  setAddingPhases(true);
                  try {
                    console.log(`[ProjectOverview] Adding phases to project ${projectId}...`);
                    await addPhasesToProject(projectId, 'eu-construction-v1');
                    console.log(`[ProjectOverview] Phases added successfully, reloading data...`);
                    // Wait a bit for Firestore to sync
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    // Force reload twice to ensure data is fetched
                    await load(true);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await load(true);
                    console.log(`[ProjectOverview] Data reloaded. Current phases: ${phases.length}, tasks: ${tasks.length}`);
                  } catch (error: any) {
                    console.error(`[ProjectOverview] Error adding phases:`, error);
                    Alert.alert('Chyba', error.message || 'Nepodarilo sa pridať fázy.');
                  } finally {
                    setAddingPhases(false);
                  }
                }}
                disabled={addingPhases}
              >
                {addingPhases ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="add-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.addTemplateButtonText}>Pridať fázy zo šablóny</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : isTradeOrMaintenance ? (
          // For TRADE/MAINTENANCE: show tasks without phases (flat list)
          <>
            {tasks.filter(t => !t.phaseId).map((task) => (
              <View key={task.id} style={styles.taskRow}>
              <View style={styles.taskNameCell}>
                <TouchableOpacity 
                  onPress={() => toggleTaskStatus(task)} 
                  activeOpacity={0.7}
                  style={styles.statusToggle}
                >
                  <Ionicons 
                    name={task.status === "DONE" ? "checkmark-circle" : "ellipse-outline"} 
                    size={24} 
                    color={task.status === "DONE" ? colors.primary : colors.textMuted} 
                  />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.taskTitleContainer} 
                  onPress={() => openTaskDetail(task)} 
                  activeOpacity={0.7}
                >
                  <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={2}>
                    {task.title || t("tasks.noTitle")}
                  </Text>
                  {task.dueDate && (
                    <Text style={styles.taskDueDate}>
                      <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={() => openAttachmentModal('task', task.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons 
                  name="attach-outline" 
                  size={20} 
                  color={(taskAttachmentsMap.get(task.id) || 0) > 0 ? '#4CAF50' : colors.textMuted} 
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.taskActionButton}
                onPress={() => handleEditTask(task)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="create-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.taskActionButton}
                onPress={() => handleDeleteTask(task)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              </View>
            ))}
          </>
        ) : phases.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>{t("projectOverview.noPhases") || "Projekt nemá žiadne fázy."}</Text>
            <Text style={styles.emptySubtext}>{t("projectOverview.addPhaseHint") || "Môžeš pridať fázy neskôr."}</Text>
            {projectType === 'MANAGEMENT' && !templateId && (
              <>
                <TouchableOpacity
                  style={styles.addTemplateButton}
                  onPress={() => setShowNewPhaseModal(true)}
                >
                  <Ionicons name="add-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.addTemplateButtonText}>Vytvoriť fázu</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addTemplateButton, { marginTop: spacing.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
                  onPress={async () => {
                    if (!projectId) return;
                    setAddingPhases(true);
                    try {
                      console.log(`[ProjectOverview] Adding phases to project ${projectId}...`);
                      await addPhasesToProject(projectId, 'eu-construction-v1');
                      console.log(`[ProjectOverview] Phases added successfully, reloading data...`);
                      // Wait a bit for Firestore to sync
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      // Force reload twice to ensure data is fetched
                      await load(true);
                      await new Promise(resolve => setTimeout(resolve, 500));
                      await load(true);
                      console.log(`[ProjectOverview] Data reloaded. Current phases: ${phases.length}, tasks: ${tasks.length}`);
                    } catch (error: any) {
                      console.error(`[ProjectOverview] Error adding phases:`, error);
                      Alert.alert('Chyba', error.message || 'Nepodarilo sa pridať fázy.');
                    } finally {
                      setAddingPhases(false);
                    }
                  }}
                  disabled={addingPhases}
                >
                  {addingPhases ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <>
                      <Ionicons name="document-text-outline" size={20} color={colors.primary} style={{ marginRight: 8 }} />
                      <Text style={[styles.addTemplateButtonText, { color: colors.primary }]}>Pridať fázy zo šablóny</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <>
            {/* Add phase button - for MANAGEMENT projects created from scratch */}
            {projectType === 'MANAGEMENT' && !templateId && (
              <TouchableOpacity
                style={styles.addPhaseButton}
                onPress={() => setShowNewPhaseModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.addPhaseButtonText}>Pridať fázu</Text>
              </TouchableOpacity>
            )}
            
            {/* For BUILD projects: show phases with tasks */}
            {phaseOrder.map((phaseKey) => {
              const phaseTasks = tasksByPhase.get(phaseKey) ?? [];
              const phase = phases.find((p) => p.id === phaseKey);
              
              // Show phase (even if it has no tasks - make it clickable)
              if (phase) {
                const expanded = expandedPhases.get(phaseKey) ?? false; // Default collapsed
                return (
                  <View key={phaseKey} style={styles.phaseBlock}>
                    <View style={styles.phaseHeaderContainer}>
                      <TouchableOpacity
                        style={styles.phaseHeader}
                        onPress={() => {
                          const newExpanded = new Map(expandedPhases);
                          newExpanded.set(phaseKey, !expanded);
                          setExpandedPhases(newExpanded);
                        }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons 
                          name={expanded ? "chevron-down" : "chevron-forward"} 
                          size={18} 
                          color={colors.primary} 
                          style={{ marginRight: 8 }}
                        />
                        <Text style={styles.phaseTitle}>{phase.name}</Text>
                        {phaseTasks.length > 0 && (
                          <Text style={styles.phaseTaskCount}>({phaseTasks.length})</Text>
                        )}
                      </TouchableOpacity>
                      <View style={styles.phaseActions}>
                        <TouchableOpacity
                          style={styles.phaseActionButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleEditPhase(phase);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.phaseActionButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDeletePhase(phase);
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {expanded && (
                      <>
                        {/* Add task button for this phase */}
                        <TouchableOpacity 
                          style={styles.addTaskToPhaseButton}
                          onPress={() => openNewTaskModal(phaseKey)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="add-circle-outline" size={18} color={colors.primary} style={{ marginRight: 6 }} />
                          <Text style={styles.addTaskToPhaseText}>{t("projectOverview.addTaskToPhase") || "Pridať úlohu"}</Text>
                        </TouchableOpacity>
                        
                        {phaseTasks.length === 0 ? (
                          <Text style={styles.emptyPhase}>{t("projectOverview.noTasksInPhase")}</Text>
                        ) : (
                          phaseTasks.map((task) => (
                            <View key={task.id} style={styles.taskRow}>
                              <View style={styles.taskNameCell}>
                                <TouchableOpacity 
                                  onPress={() => toggleTaskStatus(task)} 
                                  activeOpacity={0.7}
                                  style={styles.statusToggle}
                                >
                                  <Ionicons 
                                    name={task.status === "DONE" ? "checkmark-circle" : "ellipse-outline"} 
                                    size={24} 
                                    color={task.status === "DONE" ? colors.primary : colors.textMuted} 
                                  />
                                </TouchableOpacity>
                                <TouchableOpacity 
                                  style={styles.taskTitleContainer} 
                                  onPress={() => openTaskDetail(task)} 
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={2}>
                                    {task.title || t("tasks.noTitle")}
                                  </Text>
                                  {task.dueDate && (
                                    <Text style={styles.taskDueDate}>
                                      <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                              <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                                <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                                <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.attachmentButton}
                                onPress={() => openAttachmentModal('task', task.id)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              >
                                <Ionicons 
                                  name="attach-outline" 
                                  size={20} 
                                  color={(taskAttachmentsMap.get(task.id) || 0) > 0 ? '#4CAF50' : colors.textMuted} 
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.taskMoveButton}
                                onPress={() => handleMoveTask(task)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              >
                                <Ionicons 
                                  name="swap-horizontal-outline" 
                                  size={20} 
                                  color="#000000" 
                                />
                              </TouchableOpacity>
                            </View>
                          ))
                        )}
                      </>
                    )}
                  </View>
                );
              }
              
              // This shouldn't happen for BUILD projects - all tasks should have phaseId
              // But handle it gracefully just in case
              return null;
            })}
            
            {/* Show tasks without phaseId for BUILD projects */}
            {tasksWithoutPhase.length > 0 && (
              <View style={styles.phaseBlock}>
                <View style={styles.phaseHeader}>
                  <Ionicons 
                    name="chevron-down" 
                    size={18} 
                    color={colors.primary} 
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.phaseTitle}>Úlohy bez fázy</Text>
                  <Text style={styles.phaseTaskCount}>({tasksWithoutPhase.length})</Text>
                </View>
                <View style={styles.phaseContent}>
                  {tasksWithoutPhase.map((task) => (
                    <View key={task.id} style={styles.taskRow}>
                      <View style={styles.taskNameCell}>
                        <TouchableOpacity 
                          onPress={() => toggleTaskStatus(task)} 
                          activeOpacity={0.7}
                          style={styles.statusToggle}
                        >
                          <Ionicons 
                            name={task.status === "DONE" ? "checkmark-circle" : "ellipse-outline"} 
                            size={24} 
                            color={task.status === "DONE" ? colors.primary : colors.textMuted} 
                          />
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={styles.taskTitleContainer} 
                          onPress={() => openTaskDetail(task)} 
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={2}>
                            {task.title || t("tasks.noTitle")}
                          </Text>
                          {task.dueDate && (
                            <Text style={styles.taskDueDate}>
                              <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                        <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                        <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.attachmentButton}
                        onPress={() => openAttachmentModal('task', task.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons 
                          name="attach-outline" 
                          size={20} 
                          color={(taskAttachmentsMap.get(task.id) || 0) > 0 ? '#4CAF50' : colors.textMuted} 
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.taskMoveButton}
                        onPress={() => handleMoveTask(task)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons 
                          name="swap-horizontal-outline" 
                          size={20} 
                          color="#000000" 
                        />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
          </ScrollView>
        </View>
        )}

        {/* Expenses Section */}
        <View style={styles.expensesSection}>
        <TouchableOpacity 
          style={styles.expensesHeader}
          onPress={() => setExpandedExpenses(!expandedExpenses)}
        >
          <View style={styles.expensesHeaderLeft}>
            <Ionicons 
              name={expandedExpenses ? "chevron-down" : "chevron-forward"} 
              size={20} 
              color={colors.text} 
              style={{ marginRight: spacing.sm }}
            />
            <Text style={styles.expensesHeaderText}>Výdavky</Text>
            <Text style={styles.expensesCount}>({expenses.length})</Text>
          </View>
          <TouchableOpacity
            onPress={() => openExpenseModal()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="add-circle" size={24} color={colors.primary} />
          </TouchableOpacity>
        </TouchableOpacity>

        {expandedExpenses && (
          <View style={styles.expensesList}>
            {expenses.length === 0 ? (
              <Text style={styles.emptyExpenses}>Žiadne výdavky</Text>
            ) : (
              expenses.map((expense) => (
                <View key={expense.id} style={styles.expenseRow}>
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseTitle}>{expense.title}</Text>
                    <View style={styles.expenseMeta}>
                      <Text style={styles.expenseDate}>{formatDate(expense.date)}</Text>
                      <Text style={styles.expenseAmount}>{formatAmount(expense.amount, expense.currency)}</Text>
                    </View>
                    {expense.note && (
                      <Text style={styles.expenseNote} numberOfLines={2}>{expense.note}</Text>
                    )}
                  </View>
                  <View style={styles.expenseActions}>
                    <TouchableOpacity
                      style={styles.expenseActionButton}
                      onPress={() => openAttachmentModal('expense', expense.id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons 
                        name="attach-outline" 
                        size={20} 
                        color={(expenseAttachmentsMap.get(expense.id) || 0) > 0 ? '#4CAF50' : colors.textMuted} 
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.expenseActionButton}
                      onPress={() => openExpenseModal(expense)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.expenseActionButton}
                      onPress={() => handleDeleteExpense(expense)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </View>

        {/* Construction Diary Section - For BUILD and MANAGEMENT projects */}
        {(projectType === 'BUILD' || projectType === 'MANAGEMENT') && (
          <View style={styles.expensesSection}>
          <TouchableOpacity 
            style={styles.expensesHeader}
            onPress={() => setExpandedDiary(!expandedDiary)}
          >
            <View style={styles.expensesHeaderLeft}>
              <Ionicons 
                name={expandedDiary ? "chevron-down" : "chevron-forward"} 
                size={20} 
                color={colors.text} 
                style={{ marginRight: spacing.sm }}
              />
              <Text style={styles.expensesHeaderText}>
                {projectType === 'MANAGEMENT' ? 'Denník' : 'Stavebný denník'}
              </Text>
              <Text style={styles.expensesCount}>({diaryEntries.length})</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setEditingDiaryEntry(null);
                setDiaryDate(new Date().toISOString().split('T')[0]);
                setDiaryWeather("");
                setDiaryWorkers("");
                setDiaryWorkDescription("");
                setDiaryMaterials("");
                setDiaryNotes("");
                setDiaryPhaseId(null);
                setDiaryAttachment(null);
                setShowDiaryModal(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add-circle" size={24} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>

          {expandedDiary && (
            <View style={styles.expensesList}>
              {diaryEntries.length === 0 ? (
                <Text style={styles.emptyExpenses}>Žiadne zápisy do denníka</Text>
              ) : (
                diaryEntries.map((entry) => (
                  <View key={entry.id} style={styles.expenseRow}>
                    <View style={styles.expenseInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                        <Text style={styles.expenseTitle}>{formatDate(entry.date)}</Text>
                        {entry.attachments && entry.attachments.length > 0 && (
                          <Ionicons name="image" size={16} color={colors.primary} />
                        )}
                      </View>
                      <Text style={styles.expenseNote} numberOfLines={3}>{entry.workDescription}</Text>
                      {entry.weather && (
                        <Text style={styles.expenseDate}>Počasie: {entry.weather}</Text>
                      )}
                      {entry.workers && (
                        <Text style={styles.expenseDate}>Pracovníci: {entry.workers}</Text>
                      )}
                    </View>
                    <View style={styles.expenseActions}>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => {
                          setEditingDiaryEntry(entry);
                          setDiaryDate(entry.date.split('T')[0]);
                          setDiaryWeather(entry.weather || "");
                          setDiaryWorkers(entry.workers || "");
                          setDiaryWorkDescription(entry.workDescription);
                          setDiaryMaterials(entry.materials || "");
                          setDiaryNotes(entry.notes || "");
                          setDiaryPhaseId(entry.phaseId || null);
                          setDiaryAttachment(null); // Reset attachment when editing (existing attachments are already saved)
                          setShowDiaryModal(true);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => {
                          Alert.alert(
                            'Vymazať zápis',
                            `Naozaj chceš vymazať zápis z ${formatDate(entry.date)}?`,
                            [
                              { text: 'Zrušiť', style: 'cancel' },
                              {
                                text: 'Vymazať',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await constructionDiaryService.deleteDiaryEntry(projectId, entry.id);
                                    await load(true);
                                    Alert.alert('Úspech', 'Zápis bol vymazaný.');
                                  } catch (error: any) {
                                    Alert.alert('Chyba', error.message || 'Nepodarilo sa vymazať zápis.');
                                  }
                                },
                              },
                            ]
                          );
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
            )}
          </View>
        )}

        {/* Project Documents Section - For BUILD and MANAGEMENT projects */}
        {(projectType === 'BUILD' || projectType === 'MANAGEMENT') && (
          <View style={styles.expensesSection}>
          <TouchableOpacity 
            style={styles.expensesHeader}
            onPress={() => setExpandedDocuments(!expandedDocuments)}
          >
            <View style={styles.expensesHeaderLeft}>
              <Ionicons 
                name={expandedDocuments ? "chevron-down" : "chevron-forward"} 
                size={20} 
                color={colors.text} 
                style={{ marginRight: spacing.sm }}
              />
              <Text style={styles.expensesHeaderText}>Dokumenty projektu</Text>
              <Text style={styles.expensesCount}>({projectDocuments.length})</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setEditingDocument(null);
                setDocumentName("");
                setDocumentType('other');
                setDocumentDescription("");
                setDocumentPhaseId(null);
                setDocumentAttachment(null);
                setShowDocumentModal(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add-circle" size={24} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>

          {expandedDocuments && (
            <View style={styles.expensesList}>
              {projectDocuments.length === 0 ? (
                <Text style={styles.emptyExpenses}>Žiadne dokumenty</Text>
              ) : (
                projectDocuments.map((doc) => (
                  <View key={doc.id} style={styles.expenseRow}>
                    <View style={styles.expenseInfo}>
                      <Text style={styles.expenseTitle}>{doc.name}</Text>
                      <Text style={styles.expenseDate}>Typ: {getDocumentTypeLabel(doc.type)}</Text>
                      {doc.description && (
                        <Text style={styles.expenseNote} numberOfLines={2}>{doc.description}</Text>
                      )}
                    </View>
                    <View style={styles.expenseActions}>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={async () => {
                          try {
                            const attachment = await attachmentsService.getAttachmentURL({ storagePath: '', id: doc.attachmentId } as any);
                            const supported = await Linking.canOpenURL(attachment);
                            if (supported) {
                              await Linking.openURL(attachment);
                            }
                          } catch (error: any) {
                            Alert.alert('Chyba', 'Nepodarilo sa otvoriť dokument.');
                          }
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => {
                          setEditingDocument(doc);
                          setDocumentName(doc.name);
                          setDocumentType(doc.type);
                          setDocumentDescription(doc.description || "");
                          setDocumentPhaseId(doc.phaseId || null);
                          setShowDocumentModal(true);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => {
                          Alert.alert(
                            'Vymazať dokument',
                            `Naozaj chceš vymazať dokument "${doc.name}"?`,
                            [
                              { text: 'Zrušiť', style: 'cancel' },
                              {
                                text: 'Vymazať',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await projectDocumentsService.deleteProjectDocument(projectId, doc.id);
                                    await load(true);
                                    Alert.alert('Úspech', 'Dokument bol vymazaný.');
                                  } catch (error: any) {
                                    Alert.alert('Chyba', error.message || 'Nepodarilo sa vymazať dokument.');
                                  }
                                },
                              },
                            ]
                          );
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
              </View>
            )}
          </View>
        )}

        {/* Add a custom section - only for BUILD projects */}
        {isBuildProject && (
          <TouchableOpacity style={styles.addSection}>
            <Ionicons name="add-circle-outline" size={22} color={colors.textMuted} style={{ marginRight: 8 }} />
            <Text style={styles.addSectionText}>{t("projectOverview.addSection")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Bottom: List toggle + FAB/Button for new task */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity style={styles.listBtn}>
          <Ionicons name="swap-vertical" size={20} color={colors.textOnDark} style={{ marginRight: 6 }} />
          <Text style={styles.listBtnText}>{t("projectOverview.viewList")}</Text>
        </TouchableOpacity>
        {isTradeOrMaintenance ? (
          // For TRADE/MAINTENANCE: text button instead of FAB
          <TouchableOpacity 
            style={styles.addTaskButton} 
            onPress={() => setShowNewTask(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.addTaskButtonText}>Pridať úlohu</Text>
          </TouchableOpacity>
        ) : (
          // For BUILD: FAB
          <TouchableOpacity style={styles.fab} onPress={() => setShowNewTask(true)}>
            <Ionicons name="add" size={28} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Edit project modal */}
      <Modal visible={showEditModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Upraviť projekt</Text>
            <TextInput
              style={styles.input}
              value={editProjectName}
              onChangeText={setEditProjectName}
              placeholder="Názov projektu"
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => { setShowEditModal(false); setEditProjectName(""); }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveEdit} 
                disabled={!editProjectName.trim()}
              >
                <Text style={styles.modalOkText}>Uložiť</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Expense modal */}
      <Modal visible={showExpenseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingExpense ? 'Upraviť výdavok' : 'Pridať výdavok'}
            </Text>
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={expenseTitle}
              onChangeText={setExpenseTitle}
              placeholder="Názov výdavku *"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              autoFocus
            />
            <View style={styles.expenseAmountRow}>
              <TextInput
                style={[styles.input, styles.expenseAmountInput, { color: '#FFFFFF' }]}
                value={expenseAmount}
                onChangeText={setExpenseAmount}
                placeholder="Suma *"
                placeholderTextColor="rgba(255, 255, 255, 0.6)"
                keyboardType="decimal-pad"
              />
              <Text style={styles.expenseCurrencyLabel}>EUR</Text>
            </View>
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={expenseDate}
              onChangeText={setExpenseDate}
              placeholder="Dátum (YYYY-MM-DD)"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
            />
            <TextInput
              style={[styles.input, styles.textArea, { color: '#FFFFFF' }]}
              value={expenseNote}
              onChangeText={setExpenseNote}
              placeholder="Poznámka (voliteľné)"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              multiline
              numberOfLines={3}
            />
            
            {/* Expense Attachment Section */}
            <View style={styles.expenseAttachmentSection}>
              <Text style={styles.expenseAttachmentLabel}>Príloha faktúry (voliteľné)</Text>
              <View style={styles.expenseAttachmentButtons}>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickExpenseImage}
                  disabled={uploadingExpenseAttachment || submitting}
                >
                  <Ionicons name="image-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>Foto</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickExpenseDocument}
                  disabled={uploadingExpenseAttachment || submitting}
                >
                  <Ionicons name="document-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>PDF</Text>
                </TouchableOpacity>
              </View>
              {expenseAttachment && (
                <View style={styles.expenseAttachmentPreview}>
                  <Ionicons
                    name={expenseAttachment.kind === 'image' ? 'image-outline' : 'document-outline'}
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: spacing.sm }}
                  />
                  <Text style={styles.expenseAttachmentPreviewText} numberOfLines={1}>
                    {expenseAttachment.fileName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setExpenseAttachment(null)}
                    style={styles.expenseAttachmentRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              {uploadingExpenseAttachment && (
                <View style={styles.expenseAttachmentUploading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.expenseAttachmentUploadingText}>Nahráva sa...</Text>
                </View>
              )}
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => {
                  setShowExpenseModal(false);
                  setEditingExpense(null);
                  setExpenseTitle("");
                  setExpenseAmount("");
                  setExpenseDate(new Date().toISOString().split('T')[0]);
                  setExpenseNote("");
                  setExpensePhaseId(null);
                  setExpenseAttachment(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalOk, (!expenseTitle.trim() || (submitting)) && styles.modalOkDisabled]} 
                onPress={handleSaveExpense} 
                disabled={!expenseTitle.trim() || submitting}
              >
                <Text style={styles.modalOkText}>
                  {submitting ? 'Ukladá sa...' : (editingExpense ? 'Uložiť' : 'Pridať')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attachment modal */}
      <Modal visible={showAttachmentModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Prílohy</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAttachmentModal(false);
                  setAttachmentContext(null);
                  setAttachments([]);
                }}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Add attachment buttons */}
            <View style={styles.attachmentAddButtons}>
              <TouchableOpacity
                style={[styles.attachmentAddButton, uploadingAttachment && styles.attachmentAddButtonDisabled]}
                onPress={pickImage}
                disabled={uploadingAttachment}
              >
                <Ionicons name="image-outline" size={20} color={colors.primary} />
                <Text style={styles.attachmentAddButtonText}>Pridať foto</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.attachmentAddButton, uploadingAttachment && styles.attachmentAddButtonDisabled]}
                onPress={pickDocument}
                disabled={uploadingAttachment}
              >
                <Ionicons name="document-outline" size={20} color={colors.primary} />
                <Text style={styles.attachmentAddButtonText}>Pridať dokument</Text>
              </TouchableOpacity>
            </View>

            {uploadingAttachment && (
              <View style={styles.uploadingIndicator}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.uploadingText}>Nahráva sa...</Text>
              </View>
            )}

            {/* Attachment list */}
            <ScrollView style={styles.attachmentList}>
              {attachments.length === 0 ? (
                <Text style={styles.emptyAttachments}>Žiadne prílohy</Text>
              ) : (
                attachments.map((attachment) => {
                  const thumbnailURL = attachmentThumbnails.get(attachment.id);
                  const isImage = attachment.fileType === 'image';
                  
                  return (
                    <View key={attachment.id} style={styles.attachmentItem}>
                      <TouchableOpacity
                        style={styles.attachmentItemContent}
                        onPress={() => openAttachment(attachment)}
                      >
                        {isImage && thumbnailURL ? (
                          <Image
                            source={{ uri: thumbnailURL }}
                            style={styles.attachmentThumbnail}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons
                            name={
                              attachment.fileType === 'image' ? 'image-outline' :
                              attachment.fileType === 'pdf' ? 'document-text-outline' :
                              'document-outline'
                            }
                            size={24}
                            color={colors.primary}
                            style={{ marginRight: spacing.sm }}
                          />
                        )}
                        <View style={styles.attachmentItemInfo}>
                          <Text style={styles.attachmentItemName} numberOfLines={1}>
                            {attachment.fileName}
                          </Text>
                          {attachment.size && (
                            <Text style={styles.attachmentItemSize}>
                              {(attachment.size / 1024).toFixed(1)} KB
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.attachmentDeleteButton}
                        onPress={() => deleteAttachmentHandler(attachment)}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Image viewer modal */}
      <Modal visible={viewingAttachment !== null} transparent animationType="fade">
        <View style={styles.imageViewerOverlay}>
          <View style={styles.imageViewerHeader}>
            <Text style={styles.imageViewerTitle} numberOfLines={1}>
              {viewingAttachment?.fileName}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setViewingAttachment(null);
                setViewingAttachmentURL(null);
              }}
              style={styles.imageViewerCloseButton}
            >
              <Ionicons name="close" size={28} color={colors.textOnDark} />
            </TouchableOpacity>
          </View>
          {viewingAttachmentURL && (
            <ScrollView
              style={styles.imageViewerScroll}
              contentContainerStyle={styles.imageViewerContent}
              maximumZoomScale={3}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
            >
              <Image
                source={{ uri: viewingAttachmentURL }}
                style={styles.imageViewerImage}
                resizeMode="contain"
                onError={(error) => {
                  console.error(`[ProjectOverview] Image load error:`, error);
                  Alert.alert(
                    'Chyba', 
                    'Nepodarilo sa načítať obrázok.\n\nSkontrolujte:\n- Storage rules\n- Oprávnenia\n- Sieťové pripojenie'
                  );
                  setViewingAttachment(null);
                  setViewingAttachmentURL(null);
                }}
                onLoad={() => {
                  console.log(`[ProjectOverview] Image loaded successfully: ${viewingAttachment?.fileName}`);
                }}
              />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Edit task modal */}
      <Modal visible={showEditTaskModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Upraviť úlohu</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
              value={editTaskTitle}
              onChangeText={setEditTaskTitle}
              placeholder="Názov úlohy"
              placeholderTextColor="#000000"
              autoFocus
            />
            <Text style={styles.modalLabel}>Plánovaný termín ukončenia (voliteľné)</Text>
            <TouchableOpacity
              style={styles.dateInputButton}
              onPress={() => {
                // Show date picker
                const currentDate = editTaskDueDate ? new Date(editTaskDueDate) : new Date();
                setDatePickerDate(currentDate);
                setDatePickerMode('edit');
                setShowDatePicker(true);
              }}
            >
              <Text style={styles.dateInputText}>
                {editTaskDueDate || "Vybrať dátum"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowEditTaskModal(false);
                  setEditingTask(null);
                  setEditTaskTitle("");
                  setEditTaskDueDate("");
                  setShowDatePicker(false);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveEditTask} 
                disabled={submitting || !editTaskTitle.trim()}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : "Uložiť"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      {showDatePicker && DateTimePicker && (
        <>
          {Platform.OS === 'ios' ? (
            <Modal visible={showDatePicker} transparent animationType="slide">
              <View style={styles.modalOverlay}>
                <View style={styles.modal}>
                  <Text style={styles.modalTitle}>Vybrať dátum</Text>
                  <View style={styles.datePickerContainer}>
                    <View style={styles.datePickerIOS}>
                      {DateTimePicker && (
                        <DateTimePicker.default
                          value={datePickerDate}
                          mode="date"
                          display="spinner"
                          onChange={(_event: unknown, selectedDate?: Date) => {
                            if (selectedDate) {
                              setDatePickerDate(selectedDate);
                            }
                          }}
                        />
                      )}
                    </View>
                    <View style={styles.modalButtons}>
                      <TouchableOpacity
                        style={styles.modalCancel}
                        onPress={() => {
                          setShowDatePicker(false);
                        }}
                      >
                        <Text style={styles.modalCancelText}>Zrušiť</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalOk}
                        onPress={() => {
                          const dateStr = datePickerDate.toISOString().split('T')[0];
                          if (datePickerMode === 'new') {
                            setNewTaskDueDate(dateStr);
                          } else {
                            setEditTaskDueDate(dateStr);
                          }
                          setShowDatePicker(false);
                        }}
                      >
                        <Text style={styles.modalOkText}>Vybrať</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            </Modal>
          ) : (
            DateTimePicker && (
              <DateTimePicker.default
                value={datePickerDate}
                mode="date"
                display="default"
                onChange={(_event: unknown, selectedDate?: Date) => {
                  setShowDatePicker(false);
                  if (selectedDate) {
                    const dateStr = selectedDate.toISOString().split('T')[0];
                    if (datePickerMode === 'new') {
                      setNewTaskDueDate(dateStr);
                    } else {
                      setEditTaskDueDate(dateStr);
                    }
                  }
                }}
              />
            )
          )}
        </>
      )}

      {/* New task modal */}
      <Modal visible={showNewTask} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projectOverview.addTask")}</Text>
            
            {/* Phase selector (if phases exist - only for BUILD projects) */}
            {isBuildProject && phases.length > 0 && (
              <View style={styles.phaseSelector}>
                <Text style={styles.phaseSelectorLabel}>{t("projectOverview.selectPhase") || "Vyberte fázu:"}</Text>
                <View style={styles.phaseSelectorButtons}>
                  <TouchableOpacity
                    style={[styles.phaseSelectorButton, selectedPhaseId === null && styles.phaseSelectorButtonActive]}
                    onPress={() => setSelectedPhaseId(null)}
                  >
                    <Text style={[styles.phaseSelectorButtonText, selectedPhaseId === null && styles.phaseSelectorButtonTextActive]}>
                      {t("projectOverview.noPhase") || "Bez fázy"}
                    </Text>
                  </TouchableOpacity>
                  {phases.map((phase) => (
                    <TouchableOpacity
                      key={phase.id}
                      style={[styles.phaseSelectorButton, selectedPhaseId === phase.id && styles.phaseSelectorButtonActive]}
                      onPress={() => setSelectedPhaseId(phase.id)}
                    >
                      <Text style={[styles.phaseSelectorButtonText, selectedPhaseId === phase.id && styles.phaseSelectorButtonTextActive]}>
                        {phase.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            
            {/* For TRADE/MAINTENANCE: Voice or Text options */}
            {isTradeOrMaintenance && (
              <View style={styles.taskInputOptions}>
                <TouchableOpacity
                  style={[styles.inputOptionButton, showVoiceRecord && styles.inputOptionButtonActive]}
                  onPress={() => {
                    setShowVoiceRecord(true);
                    setNewTitle("");
                  }}
                >
                  <Ionicons name="mic" size={24} color={showVoiceRecord ? colors.primary : colors.textMuted} />
                  <Text style={[styles.inputOptionText, showVoiceRecord && styles.inputOptionTextActive]}>
                    Hlasová nahrávka
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inputOptionButton, !showVoiceRecord && styles.inputOptionButtonActive]}
                  onPress={() => {
                    setShowVoiceRecord(false);
                    setRecordingUri(null);
                  }}
                >
                  <Ionicons name="create-outline" size={24} color={!showVoiceRecord ? colors.primary : colors.textMuted} />
                  <Text style={[styles.inputOptionText, !showVoiceRecord && styles.inputOptionTextActive]}>
                    Napísať popis
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            
            {showVoiceRecord && isTradeOrMaintenance ? (
              // Voice recording interface
              <View style={styles.voiceRecordingContainer}>
                {isRecording ? (
                  <>
                    <View style={styles.recordingIndicator}>
                      <View style={styles.recordingDot} />
                      <Text style={styles.recordingText}>Nahrávam...</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.stopRecordingButton}
                      onPress={async () => {
                        if (!recording) return;
                        
                        try {
                          console.log('[ProjectOverview] Stopping recording...');
                          await recording.stopAndUnloadAsync();
                          const uri = recording.getURI();
                          console.log('[ProjectOverview] Recording stopped, URI:', uri);
                          
                          setRecordingUri(uri);
                          setIsRecording(false);
                          setRecording(null);
                        } catch (error: any) {
                          console.error('[ProjectOverview] Error stopping recording:', error);
                          Alert.alert('Chyba', 'Nepodarilo sa zastaviť nahrávanie: ' + (error.message || 'Neznáma chyba'));
                        }
                      }}
                    >
                      <Ionicons name="stop-circle" size={48} color="#FF3B30" />
                      <Text style={styles.stopRecordingText}>Zastaviť nahrávanie</Text>
                    </TouchableOpacity>
                  </>
                ) : recordingUri ? (
                  <>
                    <View style={styles.recordingPlayback}>
                      <Ionicons name="play-circle" size={48} color={colors.primary} />
                      <Text style={styles.recordingInfo}>Nahrávka pripravená</Text>
                      <TouchableOpacity
                        style={styles.rerecordButton}
                        onPress={async () => {
                          if (recording) {
                            try {
                              await recording.stopAndUnloadAsync();
                            } catch (e) {
                              // Ignore errors when stopping
                            }
                          }
                          setRecordingUri(null);
                          setIsRecording(false);
                          setRecording(null);
                        }}
                      >
                        <Text style={styles.rerecordText}>Nahrať znova</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.startRecordingButton}
                    onPress={async () => {
                      if (!AudioModule) {
                        Alert.alert('Chyba', 'Hlasová nahrávka nie je dostupná. Nainštalujte expo-av.');
                        return;
                      }
                      
                      try {
                        // Request permissions
                        const { status } = await AudioModule.Audio.requestPermissionsAsync();
                        if (status !== 'granted') {
                          Alert.alert('Chyba', 'Potrebujeme povolenie na nahrávanie zvuku.');
                          return;
                        }
                        
                        // Configure audio mode
                        await AudioModule.Audio.setAudioModeAsync({
                          allowsRecordingIOS: true,
                          playsInSilentModeIOS: true,
                        });
                        
                        // Start recording
                        const { recording: newRecording } = await AudioModule.Audio.Recording.createAsync(
                          AudioModule.Audio.RecordingOptionsPresets.HIGH_QUALITY
                        );
                        
                        setRecording(newRecording);
                        setIsRecording(true);
                        console.log('[ProjectOverview] Recording started');
                      } catch (error: any) {
                        console.error('[ProjectOverview] Error starting recording:', error);
                        Alert.alert('Chyba', 'Nepodarilo sa spustiť nahrávanie: ' + (error.message || 'Neznáma chyba'));
                      }
                    }}
                  >
                    <Ionicons name="mic-circle" size={64} color={colors.primary} />
                    <Text style={styles.startRecordingText}>Začať nahrávanie</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              // Text input
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder={isTradeOrMaintenance ? "Popis úlohy..." : t("tasks.taskPlaceholder")}
                placeholderTextColor="#000000"
                multiline={isTradeOrMaintenance}
                numberOfLines={isTradeOrMaintenance ? 4 : 1}
                textAlignVertical={isTradeOrMaintenance ? "top" : "center"}
              />
            )}
            
            <Text style={styles.modalLabel}>Plánovaný termín ukončenia (voliteľné)</Text>
            <TouchableOpacity
              style={styles.dateInputButton}
              onPress={() => {
                const currentDate = newTaskDueDate ? new Date(newTaskDueDate) : new Date();
                setDatePickerDate(currentDate);
                setDatePickerMode('new');
                setShowDatePicker(true);
              }}
            >
              <Text style={styles.dateInputText}>
                {newTaskDueDate || "Vybrať dátum"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={async () => { 
                  // Stop recording if active
                  if (recording) {
                    try {
                      await recording.stopAndUnloadAsync();
                    } catch (e) {
                      // Ignore errors
                    }
                  }
                  
      setShowNewTask(false);
      setNewTitle("");
      setNewTaskDueDate("");
      setSelectedPhaseId(null);
      setShowVoiceRecord(false);
      setIsRecording(false);
      setRecordingUri(null);
      setRecording(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={onCreateTask} 
                disabled={submitting || (!newTitle.trim() && !recordingUri)}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : t("tasks.create")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Construction Diary Modal */}
      <Modal visible={showDiaryModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingDiaryEntry ? 'Upraviť zápis do denníka' : 'Pridať zápis do denníka'}
            </Text>
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={diaryDate}
              onChangeText={setDiaryDate}
              placeholder="Dátum *"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
            />
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={diaryWeather}
              onChangeText={setDiaryWeather}
              placeholder="Počasie"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
            />
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={diaryWorkers}
              onChangeText={setDiaryWorkers}
              placeholder="Pracovníci"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
            />
            <TextInput
              style={[styles.input, styles.textArea, { color: '#FFFFFF' }]}
              value={diaryWorkDescription}
              onChangeText={setDiaryWorkDescription}
              placeholder="Popis práce *"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              multiline
              numberOfLines={4}
            />
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={diaryMaterials}
              onChangeText={setDiaryMaterials}
              placeholder="Materiály"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
            />
            <TextInput
              style={[styles.input, styles.textArea, { color: '#FFFFFF' }]}
              value={diaryNotes}
              onChangeText={setDiaryNotes}
              placeholder="Poznámky"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              multiline
              numberOfLines={3}
            />
            {phases.length > 0 && (
              <View style={styles.phaseSelector}>
                <Text style={styles.phaseSelectorLabel}>Fáza (voliteľné):</Text>
                <ScrollView style={styles.phaseSelectorScroll} horizontal>
                  <TouchableOpacity
                    style={[styles.phaseChip, diaryPhaseId === null && styles.phaseChipSelected]}
                    onPress={() => setDiaryPhaseId(null)}
                  >
                    <Text style={[styles.phaseChipText, diaryPhaseId === null && styles.phaseChipTextSelected]}>
                      Žiadna
                    </Text>
                  </TouchableOpacity>
                  {phases.map((phase) => (
                    <TouchableOpacity
                      key={phase.id}
                      style={[styles.phaseChip, diaryPhaseId === phase.id && styles.phaseChipSelected]}
                      onPress={() => setDiaryPhaseId(phase.id)}
                    >
                      <Text style={[styles.phaseChipText, diaryPhaseId === phase.id && styles.phaseChipTextSelected]}>
                        {phase.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            
            {/* Diary Photo Attachment */}
            <View style={styles.expenseAttachmentSection}>
              <Text style={styles.expenseAttachmentLabel}>Fotka (voliteľné)</Text>
              <View style={styles.expenseAttachmentButtons}>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingDiaryAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickDiaryImage}
                  disabled={uploadingDiaryAttachment || submitting}
                >
                  <Ionicons name="image-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>Pridať fotku</Text>
                </TouchableOpacity>
              </View>
              {diaryAttachment && (
                <View style={styles.expenseAttachmentPreview}>
                  <Ionicons
                    name="image-outline"
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: spacing.sm }}
                  />
                  <Text style={styles.expenseAttachmentPreviewText} numberOfLines={1}>
                    {diaryAttachment.fileName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setDiaryAttachment(null)}
                    style={styles.expenseAttachmentRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              {uploadingDiaryAttachment && (
                <View style={styles.expenseAttachmentUploading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.expenseAttachmentUploadingText}>Nahráva sa...</Text>
                </View>
              )}
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => {
                  setShowDiaryModal(false);
                  setEditingDiaryEntry(null);
                  setDiaryDate(new Date().toISOString().split('T')[0]);
                  setDiaryWeather("");
                  setDiaryWorkers("");
                  setDiaryWorkDescription("");
                  setDiaryMaterials("");
                  setDiaryNotes("");
                  setDiaryPhaseId(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveDiaryEntry} 
                disabled={!diaryWorkDescription.trim() || submitting}
              >
                <Text style={styles.modalOkText}>
                  {submitting ? 'Ukladá sa...' : (editingDiaryEntry ? 'Uložiť' : 'Pridať')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Project Document Modal */}
      <Modal visible={showDocumentModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {editingDocument ? 'Upraviť dokument' : 'Pridať dokument'}
            </Text>
            <TextInput
              style={[styles.input, { color: '#FFFFFF' }]}
              value={documentName}
              onChangeText={setDocumentName}
              placeholder="Názov dokumentu *"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              autoFocus
            />
            <View style={styles.documentTypeSelector}>
              <Text style={styles.documentTypeLabel}>Typ dokumentu:</Text>
              <View style={styles.documentTypeButtons}>
                {(['plan', 'permit', 'contract', 'report', 'other'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.documentTypeButton, documentType === type && styles.documentTypeButtonSelected]}
                    onPress={() => setDocumentType(type)}
                  >
                    <Text style={[styles.documentTypeButtonText, documentType === type && styles.documentTypeButtonTextSelected]}>
                      {getDocumentTypeLabel(type)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextInput
              style={[styles.input, styles.textArea, { color: '#FFFFFF' }]}
              value={documentDescription}
              onChangeText={setDocumentDescription}
              placeholder="Popis (voliteľné)"
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              multiline
              numberOfLines={3}
            />
            {phases.length > 0 && (
              <View style={styles.phaseSelector}>
                <Text style={styles.phaseSelectorLabel}>Fáza (voliteľné):</Text>
                <ScrollView style={styles.phaseSelectorScroll} horizontal>
                  <TouchableOpacity
                    style={[styles.phaseChip, documentPhaseId === null && styles.phaseChipSelected]}
                    onPress={() => setDocumentPhaseId(null)}
                  >
                    <Text style={[styles.phaseChipText, documentPhaseId === null && styles.phaseChipTextSelected]}>
                      Žiadna
                    </Text>
                  </TouchableOpacity>
                  {phases.map((phase) => (
                    <TouchableOpacity
                      key={phase.id}
                      style={[styles.phaseChip, documentPhaseId === phase.id && styles.phaseChipSelected]}
                      onPress={() => setDocumentPhaseId(phase.id)}
                    >
                      <Text style={[styles.phaseChipText, documentPhaseId === phase.id && styles.phaseChipTextSelected]}>
                        {phase.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            {!editingDocument && (
              <View style={styles.expenseAttachmentSection}>
                <Text style={styles.expenseAttachmentLabel}>Súbor dokumentu *</Text>
                <View style={styles.expenseAttachmentButtons}>
                  <TouchableOpacity
                    style={[styles.expenseAttachmentButton, (uploadingDocumentAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                    onPress={pickDocumentFile}
                    disabled={uploadingDocumentAttachment || submitting}
                  >
                    <Ionicons name="document-outline" size={20} color={colors.primary} />
                    <Text style={styles.expenseAttachmentButtonText}>PDF / Obrázok</Text>
                  </TouchableOpacity>
                </View>
                {documentAttachment && (
                  <View style={styles.expenseAttachmentPreview}>
                    <Ionicons
                      name={documentAttachment.kind === 'image' ? 'image-outline' : 'document-outline'}
                      size={20}
                      color={colors.primary}
                      style={{ marginRight: spacing.sm }}
                    />
                    <Text style={styles.expenseAttachmentPreviewText} numberOfLines={1}>
                      {documentAttachment.fileName}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setDocumentAttachment(null)}
                      style={styles.expenseAttachmentRemove}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}
                {uploadingDocumentAttachment && (
                  <View style={styles.expenseAttachmentUploading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.expenseAttachmentUploadingText}>Nahráva sa...</Text>
                  </View>
                )}
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => {
                  setShowDocumentModal(false);
                  setEditingDocument(null);
                  setDocumentName("");
                  setDocumentType('other');
                  setDocumentDescription("");
                  setDocumentPhaseId(null);
                  setDocumentAttachment(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveDocument} 
                disabled={!documentName.trim() || submitting}
              >
                <Text style={styles.modalOkText}>
                  {submitting ? 'Ukladá sa...' : (editingDocument ? 'Uložiť' : 'Pridať')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal for creating new phase */}
      <Modal visible={showNewPhaseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Vytvoriť fázu</Text>
            <TextInput
              style={styles.input}
              value={newPhaseName}
              onChangeText={setNewPhaseName}
              placeholder="Názov fázy"
              placeholderTextColor="rgba(0, 0, 0, 0.5)"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowNewPhaseModal(false);
                  setNewPhaseName("");
                }}
              >
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOk, (!newPhaseName.trim() || submitting) && styles.modalOkDisabled]}
                onPress={handleCreatePhase}
                disabled={!newPhaseName.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalOkText}>Vytvoriť</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal for editing phase */}
      <Modal visible={showEditPhaseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Upraviť fázu</Text>
            <TextInput
              style={styles.input}
              value={editPhaseName}
              onChangeText={setEditPhaseName}
              placeholder="Názov fázy"
              placeholderTextColor="rgba(0, 0, 0, 0.5)"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowEditPhaseModal(false);
                  setEditingPhase(null);
                  setEditPhaseName("");
                }}
              >
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOk, (!editPhaseName.trim() || submitting) && styles.modalOkDisabled]}
                onPress={handleUpdatePhase}
                disabled={!editPhaseName.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalOkText}>Uložiť</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal for moving task to another phase */}
      <Modal visible={showMoveTaskModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Presunúť úlohu</Text>
            {movingTask && (
              <Text style={styles.modalSubtitle}>"{movingTask.title}"</Text>
            )}
            <Text style={styles.modalLabel}>Vyberte fázu:</Text>
            <ScrollView style={styles.phaseList}>
              <TouchableOpacity
                style={styles.phaseOption}
                onPress={() => handleMoveTaskToPhase(null)}
              >
                <Text style={styles.phaseOptionText}>Bez fázy</Text>
              </TouchableOpacity>
              {phases.map((phase) => (
                <TouchableOpacity
                  key={phase.id}
                  style={styles.phaseOption}
                  onPress={() => handleMoveTaskToPhase(phase.id)}
                >
                  <Text style={styles.phaseOptionText}>{phase.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowMoveTaskModal(false);
                  setMovingTask(null);
                }}
              >
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.background,
    flexDirection: 'column',
  },
  scrollContent: { 
    flex: 1,
  },
  scrollContentContainer: { 
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },
  muted: { fontSize: 14, color: colors.textMuted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBack: { padding: spacing.xs },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", marginLeft: spacing.sm },
  projectIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  headerTitleContainer: { flex: 1, flexDirection: "column" },
  headerTitle: { fontSize: 20, fontWeight: "700", color: colors.textOnDark },
  headerProjectType: { fontSize: 12, fontWeight: "400", color: colors.textOnDark, opacity: 0.7, marginTop: 2 },
  membersStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#b366b3",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  headerMenu: { padding: spacing.xs },

  addressSection: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addressContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    marginRight: spacing.md,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    gap: spacing.xs,
  },
  navigateButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },

  tableContainer: { marginHorizontal: spacing.md, marginTop: spacing.md },
  tableScroll: { flex: 1 },
  table: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  phaseBlock: { marginBottom: spacing.md },
  phaseHeaderContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  phaseContent: {
    paddingLeft: spacing.md,
  },
  phaseHeader: { 
    flexDirection: "row", 
    alignItems: "center", 
    flex: 1,
    paddingVertical: spacing.xs,
    minWidth: 0,
  },
  phaseTitle: { fontSize: 13, fontWeight: "600", color: colors.primary, flex: 1 },
  phaseTaskCount: { fontSize: 12, color: colors.textMuted, marginLeft: spacing.xs },
  phaseActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  phaseActionButton: {
    padding: spacing.xs,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  tableHeaderText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  colAssignee: { width: 100, textAlign: "right" },
  loader: { marginVertical: spacing.lg },
  empty: { fontSize: 14, color: colors.textMuted, marginVertical: spacing.md },
  emptyContainer: { paddingVertical: spacing.lg, alignItems: "center" },
  emptySubtext: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs, textAlign: "center" },
  emptyPhase: { fontSize: 13, color: colors.textMuted, fontStyle: "italic", paddingVertical: spacing.sm },
  addTemplateButton: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius,
  },
  addTemplateButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  addPhaseButton: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius,
    justifyContent: "center",
  },
  addPhaseButtonText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 14,
  },
  addTaskToPhaseButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  addTaskToPhaseText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: "500",
  },
  phaseSelector: {
    marginBottom: spacing.md,
  },
  phaseSelectorScroll: {
    marginBottom: spacing.sm,
  },
  phaseChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
  },
  phaseChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  phaseChipText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  phaseChipTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  phaseSelectorLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  phaseSelectorButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  phaseSelectorButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseSelectorButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  phaseSelectorButtonText: {
    fontSize: 13,
    color: colors.text,
  },
  phaseSelectorButtonTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 44, // Ensure minimum height for multi-line text
  },
  taskNameCell: { flex: 1, flexDirection: "row", alignItems: "flex-start", paddingTop: 2 },
  statusToggle: { 
    padding: spacing.xs,
    marginRight: spacing.sm,
    marginTop: 2, // Align checkbox with first line of text
  },
  taskTitleContainer: { flex: 1 },
  taskTitle: { fontSize: 15, color: colors.text, flex: 1, lineHeight: 20 },
  taskTitleDone: { 
    textDecorationLine: "line-through",
    color: colors.textMuted,
    opacity: 0.7,
  },
  taskDueDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",

  },
  assigneeCell: { flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-end", gap: 4, paddingTop: 2 },
  assigneeText: { fontSize: 13, color: colors.textMuted, maxWidth: 70 },
  taskActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: spacing.xs,
  },
  reorderButton: {
    padding: spacing.xs,
  },
  taskMenuButton: {
    padding: spacing.xs,
  },

  addSection: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addSectionText: { fontSize: 14, color: colors.textMuted },

  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    minHeight: 60,
    width: '100%',
  },
  listBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
  },
  listBtnText: { fontSize: 14, color: colors.textOnDark },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addTaskButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius,
  },
  addTaskButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  taskInputOptions: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  inputOptionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  inputOptionButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  inputOptionText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  inputOptionTextActive: {
    color: colors.primary,
    fontWeight: "600",
  },
  voiceRecordingContainer: {
    alignItems: "center",
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  recordingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FF3B30",
    // Animation will be handled by React Native Animated API if needed
  },
  recordingText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: "500",
  },
  startRecordingButton: {
    alignItems: "center",
    gap: spacing.md,
  },
  startRecordingText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: "500",
  },
  stopRecordingButton: {
    alignItems: "center",
    gap: spacing.sm,
  },
  stopRecordingText: {
    fontSize: 14,
    color: "#FF3B30",
    fontWeight: "500",
  },
  recordingPlayback: {
    alignItems: "center",
    gap: spacing.sm,
  },
  recordingInfo: {
    fontSize: 14,
    color: colors.textMuted,
  },
  rerecordButton: {
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  rerecordText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
  },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  modalLabel: { fontSize: 14, fontWeight: "500", color: colors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  dateInputButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    minHeight: 48,
  },
  dateInputText: {
    fontSize: 16,
    color: colors.text,
    flex: 1,
  },
  datePickerContainer: {
    alignItems: "center",
  },
  datePickerIOS: {
    width: "100%",
    height: 200,
  },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md },
  modalCancel: { padding: spacing.sm },
  modalCancelText: { color: colors.textMuted },
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius },
  modalOkDisabled: { backgroundColor: colors.textMuted, opacity: 0.5 },
  modalOkText: { color: "#fff", fontWeight: "600" },

  // Expenses styles
  expensesSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  expensesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  expensesHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expensesHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  expensesCount: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  expensesList: {
    padding: spacing.sm,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  expenseInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  expenseTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  expenseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  expenseDate: {
    fontSize: 13,
    color: colors.textMuted,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  expenseNote: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  expenseActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  expenseActionButton: {
    padding: spacing.xs,
  },
  emptyExpenses: {
    padding: spacing.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 14,
  },
  expenseAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  expenseAmountInput: {
    flex: 1,
    marginRight: spacing.sm,
  },
  expenseCurrencyLabel: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  expenseAttachmentSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  expenseAttachmentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  expenseAttachmentButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  expenseAttachmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  expenseAttachmentButtonDisabled: {
    opacity: 0.5,
  },
  expenseAttachmentButtonText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  expenseAttachmentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseAttachmentPreviewText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  expenseAttachmentRemove: {
    padding: spacing.xs,
  },
  expenseAttachmentUploading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  expenseAttachmentUploadingText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  attachmentButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  taskActionButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  taskMoveButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  phaseList: {
    maxHeight: 300,
    marginVertical: spacing.md,
  },
  phaseOption: {
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseOptionText: {
    fontSize: 16,
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  attachmentAddButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  attachmentAddButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  attachmentAddButtonDisabled: {
    opacity: 0.5,
  },
  attachmentAddButtonText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  uploadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  uploadingText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  attachmentList: {
    maxHeight: 300,
  },
  emptyAttachments: {
    padding: spacing.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 14,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  attachmentItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachmentThumbnail: {
    width: 50,
    height: 50,
    borderRadius: radius,
    marginRight: spacing.sm,
    backgroundColor: colors.border,
  },
  attachmentItemInfo: {
    flex: 1,
  },
  attachmentItemName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  attachmentItemSize: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  attachmentDeleteButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  imageViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  imageViewerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnDark,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerImage: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: '100%',
    maxHeight: '100%',
  },
  documentTypeSelector: {
    marginBottom: spacing.md,
  },
  documentTypeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  documentTypeButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  documentTypeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  documentTypeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  documentTypeButtonText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  documentTypeButtonTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
});
