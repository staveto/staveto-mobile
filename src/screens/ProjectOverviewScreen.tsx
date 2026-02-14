import React, { useCallback, useEffect, useState, useRef } from "react";
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
  Share,
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

let SpeechModule: typeof import('expo-speech') | null = null;
try {
  SpeechModule = require('expo-speech');
} catch (e) {
  console.warn('expo-speech not installed. Speech-to-text conversion will be disabled.');
}

let DateTimePicker: any = null;
try {
  DateTimePicker = require('@react-native-community/datetimepicker');
} catch (e) {
  console.warn('@react-native-community/datetimepicker not installed. Date picker features will be disabled.');
}
import { useRoute, useNavigation, NavigationProp, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useProjectAccess } from "../hooks/useProjectAccess";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import { updatePhase, deletePhase, createPhase } from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import * as constructionDiaryService from "../services/constructionDiary";
import * as projectDocumentsService from "../services/projectDocuments";
import * as projectEventsService from "../services/projectEvents";
import * as projectMembersService from "../services/projectMembers";
import * as equipmentService from "../services/equipment";
import * as weatherService from "../services/weather";
import { extractInvoiceData, type OcrParsed, type OcrStatus } from "../services/invoiceOCR";
import { calculateDistanceKm as calculateDistanceKmService } from "../services/distance";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { exportProjectToCsv } from "../services/projectExport";
import { updateTaskStatus } from "../services/taskService";
import { archiveTask, reorderTask, moveTaskToPhase } from "../services/tasks";
import { addPhasesToProject } from "../services/addPhasesToProject";
import type { TaskDoc } from "../services/tasks";
import type { ProjectPhaseDoc } from "../services/projects";
import type { ExpenseDoc } from "../services/expenses";
import type { AttachmentDoc } from "../services/attachments";
import type { DiaryEntryDoc } from "../services/constructionDiary";
import type { ProjectDocumentDoc } from "../services/projectDocuments";
import type { ProjectMemberDoc } from "../services/projectMembers";
import type { EquipmentDoc } from "../services/equipment";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";
import { openInMaps } from "../lib/maps";
import { isFeatureEnabled } from "../services/features";
import { formatEventSummary } from "../helpers/formatEvent";
import type { ProjectEvent } from "../lib/types";
import type { ProjectWeatherSnapshot } from "../services/weather";

const DONE_COLOR = "#2e7d32";
const OCR_MANUAL_FALLBACK_MESSAGE = "OCR zlyhalo – vyplň ručne";

export function ProjectOverviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const routeParams = (route.params as {
    projectId?: string;
    projectName?: string;
    openExpenseModal?: boolean;
    openNewTask?: boolean;
    openDiaryModal?: boolean;
    diaryInputMode?: "text" | "voice";
    selectedPhaseId?: string | null;
    openExpenseId?: string | null;
    expandExpensesSection?: boolean;
  }) ?? {};
  const {
    projectId: paramProjectId,
    projectName: paramProjectName,
    openExpenseModal: paramOpenExpenseModal,
    openNewTask: paramOpenNewTask,
    openDiaryModal: paramOpenDiaryModal,
    diaryInputMode: paramDiaryInputMode,
    selectedPhaseId: paramSelectedPhaseId,
    openExpenseId: paramOpenExpenseId,
    expandExpensesSection: paramExpandExpensesSection,
  } = routeParams;
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
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [addingPhases, setAddingPhases] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectAddress, setEditProjectAddress] = useState("");
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseDoc | null>(null);
  const [openedExpenseId, setOpenedExpenseId] = useState<string | null>(null);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<'WORK' | 'MATERIAL' | 'OTHER' | 'TRAVEL' | undefined>(undefined);
  const [expenseTravelFromAddress, setExpenseTravelFromAddress] = useState("");
  const [expenseTravelToAddress, setExpenseTravelToAddress] = useState("");
  const [expenseTravelDistanceKm, setExpenseTravelDistanceKm] = useState("");
  const [expenseTravelRatePerKm, setExpenseTravelRatePerKm] = useState("0.30");
  const [expenseTravelRoundTrip, setExpenseTravelRoundTrip] = useState(false);
  const { isOnline } = useOnlineStatus();
  const [isLoadingDistance, setIsLoadingDistance] = useState(false);
  const [expenseSupplierName, setExpenseSupplierName] = useState("");
  const [expenseSupplierIco, setExpenseSupplierIco] = useState("");
  const [expensePhaseId, setExpensePhaseId] = useState<string | null>(null);
  const [expenseAttachment, setExpenseAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [expensePreuploadedAttachment, setExpensePreuploadedAttachment] = useState<{
    attachmentId: string;
    storagePath: string;
    mimeType: string;
    kind: 'image' | 'pdf' | 'document';
    fileName: string;
    localUri: string;
    isLinkedToExpense: boolean;
    linkedExpenseId?: string;
  } | null>(null);
  const [expenseOcrStatus, setExpenseOcrStatus] = useState<OcrStatus | null>(null);
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
  const [ocrLoading, setOcrLoading] = useState(false);
  const ocrRequestIdRef = useRef(0);
  const [ocrPendingReview, setOcrPendingReview] = useState<{
    projectId: string;
    expenseId: string;
    defaultTitle: string;
    defaultAmount: string;
    defaultDate: string;
    defaultSupplierName?: string;
    attachmentId?: string;
    storagePath?: string;
  } | null>(null);
  const isOwner = !!projectOwnerId && projectOwnerId === user?.id;
  const access = useProjectAccess(projectId, projectOwnerId);

  // Debug: log access once when loaded (dev only)
  const hasLoggedAccessRef = React.useRef(false);
  useEffect(() => {
    if (__DEV__ && !access.loading && projectId && user?.id && !hasLoggedAccessRef.current) {
      hasLoggedAccessRef.current = true;
      console.log("[access]", {
        uid: user.id,
        projectId,
        isOwner: access.isOwner,
        permissionLevel: access.permissionLevel,
        sharedItems: access.sharedItems,
        canReadExpenses: access.canReadExpenses,
        canReadDiary: access.canReadDiary,
        canReadDocuments: access.canReadDocuments,
        canWrite: access.canWrite,
      });
    }
    if (access.loading) hasLoggedAccessRef.current = false;
  }, [access.loading, access.isOwner, access.permissionLevel, access.sharedItems, access.canReadExpenses, access.canReadDiary, access.canReadDocuments, access.canWrite, projectId, user?.id]);

  // MAINTENANCE v2: equipment
  const [equipmentList, setEquipmentList] = useState<EquipmentDoc[]>([]);
  const [showEquipmentActionSheet, setShowEquipmentActionSheet] = useState(false);
  
  // Diary entries state
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntryDoc[]>([]);
  const [showDiaryModal, setShowDiaryModal] = useState(false);
  const [editingDiaryEntry, setEditingDiaryEntry] = useState<DiaryEntryDoc | null>(null);
  const [diaryDate, setDiaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [diaryWeather, setDiaryWeather] = useState("");
  const [diaryWorkers, setDiaryWorkers] = useState("");
  const [diaryWorkDescription, setDiaryWorkDescription] = useState("");
  const [diaryWorkDescriptionMode, setDiaryWorkDescriptionMode] = useState<'text' | 'voice'>('text');
  const [diaryWorkDescriptionRecordingUri, setDiaryWorkDescriptionRecordingUri] = useState<string | null>(null);
  const [diaryWorkDescriptionIsRecording, setDiaryWorkDescriptionIsRecording] = useState(false);
  const [diaryWorkDescriptionRecording, setDiaryWorkDescriptionRecording] = useState<any>(null);
  const [diaryMaterials, setDiaryMaterials] = useState("");
  const [diaryPhaseId, setDiaryPhaseId] = useState<string | null>(null);
  const [diaryAttachment, setDiaryAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [uploadingDiaryAttachment, setUploadingDiaryAttachment] = useState(false);
  
  // Project documents state
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocumentDoc[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberDoc[]>([]);
  const [showAssigneeModal, setShowAssigneeModal] = useState(false);
  const [assigneeTask, setAssigneeTask] = useState<TaskDoc | null>(null);
  const [assigneeCandidates, setAssigneeCandidates] = useState<
    Array<{ key: string; assigneeId: string | null; assigneeName: string | null; label: string }>
  >([]);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [editingDocument, setEditingDocument] = useState<ProjectDocumentDoc | null>(null);
  const [documentName, setDocumentName] = useState("");
  const [documentType, setDocumentType] = useState<'plan' | 'permit' | 'contract' | 'report' | 'other'>('other');
  const [documentDescription, setDocumentDescription] = useState("");
  const [documentPhaseId, setDocumentPhaseId] = useState<string | null>(null);
  const [documentAttachment, setDocumentAttachment] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' } | null>(null);
  const [uploadingDocumentAttachment, setUploadingDocumentAttachment] = useState(false);
  const [whatsappDiaryEnabled, setWhatsappDiaryEnabled] = useState(false);
  const [contractorsEnabled, setContractorsEnabled] = useState(false);
  const [phasesSectionExpanded, setPhasesSectionExpanded] = useState(true);
  const [taskFilter, setTaskFilter] = useState<'service' | 'all'>('service');
  const [activityEvents, setActivityEvents] = useState<ProjectEvent[]>([]);
  useEffect(() => {
    if (projectType === 'MAINTENANCE') setTaskFilter('service');
  }, [projectId, projectType]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const getOcrFallbackMessage = useCallback((errorCode?: string) => {
    const code = String(errorCode || "").toLowerCase();
    if (
      code.includes("not_found") ||
      code.includes("not-found") ||
      code.includes("functions/not-found") ||
      code.includes("unimplemented")
    ) {
      return "OCR backend nie je nasadeny. Nasadime Firebase function extractInvoiceData a potom to bude fungovat.";
    }
    if (code.includes("unauthenticated") || code.includes("permission-denied")) {
      return "OCR nema opravnenie. Skontrolujte prihlasenie a Firebase pravidla/funkcie.";
    }
    return OCR_MANUAL_FALLBACK_MESSAGE;
  }, []);
  const [weatherSnapshot, setWeatherSnapshot] = useState<ProjectWeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const formatActivityAge = useCallback((value: ProjectEvent["createdAt"]) => {
    try {
      const date =
        typeof value === "string"
          ? new Date(value)
          : value instanceof Date
          ? value
          : value?.toDate?.() ?? new Date();
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return `${diffH}h ago`;
      const diffD = Math.floor(diffH / 24);
      return `${diffD}d ago`;
    } catch {
      return "";
    }
  }, []);

  const loadActivity = useCallback(async () => {
    if (!projectId) return;
    setActivityLoading(true);
    try {
      const events = await projectEventsService.listProjectEvents(projectId, 30);
      setActivityEvents(events);
    } catch (error) {
      console.warn("[ProjectOverview] Failed to load project events:", error);
      setActivityEvents([]);
    } finally {
      setActivityLoading(false);
    }
  }, [projectId]);

  const weatherTypeIcon = useCallback((type: weatherService.DayRiskType): React.ComponentProps<typeof Ionicons>["name"] => {
    if (type === "RAIN") return "rainy-outline";
    if (type === "WIND") return "flag-outline";
    if (type === "FROST") return "snow-outline";
    if (type === "HEAT") return "sunny-outline";
    return "partly-sunny-outline";
  }, []);

  const weatherBadgeColor = useCallback((level: weatherService.WeatherRiskLevel) => {
    if (level === "PROBLEM") return "#d63b3b";
    if (level === "RISK") return "#e56f35";
    return "#5ea96a";
  }, []);

  const loadWeather = useCallback(
    async (forceRefresh = false) => {
      if (!projectId || !addressText?.trim()) {
        setWeatherSnapshot(null);
        setWeatherError(null);
        return;
      }
      setWeatherLoading(true);
      setWeatherError(null);
      try {
        const result = await weatherService.getProjectWeatherRisk(projectId, addressText, { forceRefresh });
        setWeatherSnapshot(result.snapshot);
      } catch (error: any) {
        setWeatherSnapshot(null);
        setWeatherError(error?.message || "Počasie sa nepodarilo načítať.");
      } finally {
        setWeatherLoading(false);
      }
    },
    [projectId, addressText]
  );

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
        setProjectOwnerId(project.ownerId ?? null);
      } else {
        console.warn(`[ProjectOverview] Project ${projectId} not found or no access - continuing without project metadata`);
      }
      
      // Load phases (only for BUILD projects), tasks, expenses, and BUILD-specific data
      const projectTypeForLoad = project?.projectType || projectType;
      const isBuildProject = projectTypeForLoad === 'BUILD' || projectTypeForLoad === 'MANAGEMENT';
      
      // Permission gating: only load what user can read (access from closure)
      const canReadPhases = access.canReadPhases;
      const canReadTasks = access.canReadTasks;
      const canReadExpenses = access.canReadExpenses;
      const canReadDiary = access.canReadDiary;
      const canReadDocuments = access.canReadDocuments;
      
      console.log(`[ProjectOverview] Loading data for projectType="${projectTypeForLoad}", canRead: phases=${canReadPhases}, tasks=${canReadTasks}, expenses=${canReadExpenses}, diary=${canReadDiary}, documents=${canReadDocuments}...`);
      const loadPromises: Promise<any>[] = [];
      
      // Only load phases for BUILD projects when canReadPhases
      if (isBuildProject && canReadPhases) {
        loadPromises.push(
          projectsService.listProjectPhases(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading phases:`, error);
            if (error.code === 'permission-denied') {
              console.error(`[ProjectOverview] PERMISSION DENIED loading phases for project ${projectId}`);
              return [];
            }
            return [];
          })
        );
      } else {
        loadPromises.push(Promise.resolve([]));
      }
      
      if (canReadTasks) {
        loadPromises.push(
          tasksService.listTasksByProject(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading tasks:`, error);
            if (error.code === 'permission-denied') return [];
            return [];
          })
        );
      } else {
        loadPromises.push(Promise.resolve([]));
      }
      
      if (canReadExpenses) {
        loadPromises.push(
          expensesService.listExpensesByProject(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading expenses:`, error);
            return [];
          })
        );
      } else {
        loadPromises.push(Promise.resolve([]));
      }
      
      // Diary is available across project types; documents remain BUILD/MANAGEMENT only.
      const hasDiary = projectTypeForLoad === 'BUILD' || projectTypeForLoad === 'MANAGEMENT' || projectTypeForLoad === 'TRADE' || projectTypeForLoad === 'MAINTENANCE' || projectTypeForLoad === 'RESIDENTIAL';
      const hasDocuments = isBuildProject;
      if (hasDiary && canReadDiary) {
        loadPromises.push(
          constructionDiaryService.listDiaryEntries(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading diary entries:`, error);
            return [];
          })
        );
      } else if (hasDiary) {
        loadPromises.push(Promise.resolve([]));
      }
      if (hasDocuments && canReadDocuments) {
        loadPromises.push(
          projectDocumentsService.listProjectDocuments(projectId).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading project documents:`, error);
            return [];
          })
        );
      } else if (hasDocuments) {
        loadPromises.push(Promise.resolve([]));
      }
      loadPromises.push(
        projectMembersService.listProjectMembers(projectId).catch((error: any) => {
          console.error(`[ProjectOverview] Error loading project members:`, error);
          return [];
        })
      );
      
      const results = await Promise.all(loadPromises);
      const ph = results[0];
      const tk = results[1];
      const exp = results[2];
      const diary = hasDiary ? results[3] : [];
      const docs = hasDocuments ? results[hasDiary ? 4 : 3] : [];
      const members = (results[results.length - 1] ?? []) as ProjectMemberDoc[];
      
      console.log(`[ProjectOverview] Loaded ${ph.length} phases, ${tk.length} tasks, ${exp.length} expenses for projectType="${projectTypeForLoad}"`);
      if (hasDiary || hasDocuments) {
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
      setDiaryEntries(hasDiary ? diary : []);
      setProjectDocuments(hasDocuments ? docs : []);
      setProjectMembers(members);

      // MAINTENANCE v2: load equipment only for MAINTENANCE projects
      const isMaintenanceLike = projectTypeForLoad === 'MAINTENANCE';
      if (isMaintenanceLike) {
        try {
          const eq = await equipmentService.listEquipment(projectId, { status: 'active' });
          setEquipmentList(eq);
        } catch (e: any) {
          console.warn('[ProjectOverview] Error loading equipment:', e);
          setEquipmentList([]);
        }
      } else {
        setEquipmentList([]);
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
      // Preserve expanded state across reloads
      const expanded = new Map<string, boolean>();
      ph.forEach((p: { id: string }) => {
        const prev = expandedPhasesRef.current.get(p.id);
        expanded.set(p.id, prev ?? false);
      });
      expandedPhasesRef.current = expanded;
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
  }, [
    projectId,
    access.canReadPhases,
    access.canReadTasks,
    access.canReadExpenses,
    access.canReadDiary,
    access.canReadDocuments,
  ]);
  
  const onRefresh = useCallback(() => {
    load(true);
    loadActivity();
    loadWeather(true);
  }, [load, loadActivity, loadWeather]);

  useEffect(() => {
    if (!projectId || access.loading) return;
    load();
  }, [projectId, access.loading, load]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  useFocusEffect(
    useCallback(() => {
      if (!projectId || !user?.id) return () => {};
      projectEventsService.markProjectSeen(projectId, user.id).catch((error) => {
        console.warn("[ProjectOverview] Failed to mark project seen:", error);
      });
      return () => {};
    }, [projectId, user?.id])
  );

  useEffect(() => {
    if (!user?.id) return;
    isFeatureEnabled("whatsappDiary", user.id).then(setWhatsappDiaryEnabled).catch(() => setWhatsappDiaryEnabled(false));
    isFeatureEnabled("contractors", user.id).then(setContractorsEnabled).catch(() => setContractorsEnabled(false));
  }, [user?.id]);
  
  // Open expense modal if requested from navigation (only when user has access)
  useEffect(() => {
    if (paramOpenExpenseModal && projectId && access.canReadExpenses && access.canWrite && access.sharedItems?.expenses === true) {
      setExpensePhaseId(paramSelectedPhaseId ?? null);
      setShowExpenseModal(true);
    }
  }, [paramOpenExpenseModal, projectId, paramSelectedPhaseId, access.canReadExpenses, access.canWrite, access.sharedItems?.expenses]);

  // Expand expenses section if requested from navigation (e.g. from ExpensesKpiScreen row click)
  useEffect(() => {
    if (paramExpandExpensesSection && projectId && access.canReadExpenses) {
      setExpandedExpenses(true);
    }
  }, [paramExpandExpensesSection, projectId, access.canReadExpenses]);

  useEffect(() => {
    if (!paramOpenExpenseId || !projectId) return;
    if (openedExpenseId === paramOpenExpenseId) return;
    const exp = expenses.find((e) => e.id === paramOpenExpenseId);
    if (exp) {
      setEditingExpense(exp);
      setExpenseTitle(exp.title ?? "");
      setExpenseAmount(exp.amount != null ? String(exp.amount) : "");
      setExpenseDate(exp.date ?? new Date().toISOString().split("T")[0]);
      setExpenseNote(exp.note ?? "");
      setExpensePhaseId(exp.phaseId ?? null);
      setShowExpenseModal(true);
      setOpenedExpenseId(paramOpenExpenseId);
    }
  }, [paramOpenExpenseId, projectId, openedExpenseId, expenses]);

  // Open new task modal if requested from navigation (only when user has access)
  useEffect(() => {
    if (paramOpenNewTask && projectId && access.canWrite && (access.sharedItems.tasks || access.sharedItems.phases)) {
      setSelectedPhaseId(paramSelectedPhaseId ?? null);
      setShowNewTask(true);
    }
  }, [paramOpenNewTask, projectId, paramSelectedPhaseId, access.canWrite, access.sharedItems.tasks, access.sharedItems.phases]);

  const goBack = () => navigation.goBack();
  const goToMembers = () => (navigation as { navigate: (n: string, p?: object) => void }).navigate("ProjectMembers", { projectId, projectName });

  const handleCalculateDistanceKm = useCallback(async () => {
    const from = expenseTravelFromAddress.trim();
    const to = expenseTravelToAddress.trim();
    if (!from || !to || isLoadingDistance || !isOnline) return;
    setIsLoadingDistance(true);
    try {
      const result = await calculateDistanceKmService({ fromAddress: from, toAddress: to, mode: "driving" });
      setExpenseTravelDistanceKm(String(result.distanceKm));
    } catch {
      showToast("Nepodarilo sa vypočítať km. Zadaj km ručne.");
    } finally {
      setIsLoadingDistance(false);
    }
  }, [expenseTravelFromAddress, expenseTravelToAddress, expenseTravelRatePerKm, expenseTravelRoundTrip, isLoadingDistance, isOnline]);

  useEffect(() => {
    if (expenseCategory !== "TRAVEL") return;
    const km = parseFloat(expenseTravelDistanceKm);
    const rate = parseFloat(expenseTravelRatePerKm) || 0.2;
    if (!Number.isFinite(km) || km <= 0) return;
    const mult = expenseTravelRoundTrip ? 2 : 1;
    setExpenseAmount(String(Math.round(km * rate * mult * 100) / 100));
  }, [expenseCategory, expenseTravelDistanceKm, expenseTravelRatePerKm, expenseTravelRoundTrip]);

  // Helper to validate and format amount input (only numbers and one decimal point/comma)
  const handleAmountChange = (text: string) => {
    // Remove all non-numeric characters except one decimal point or comma
    const cleaned = text.replace(/[^\d.,]/g, '');
    // Replace comma with dot for consistency
    const normalized = cleaned.replace(',', '.');
    // Ensure only one decimal point
    const parts = normalized.split('.');
    if (parts.length > 2) {
      // If more than one dot, keep only first part + dot + second part
      setExpenseAmount(parts[0] + '.' + parts.slice(1).join(''));
    } else {
      setExpenseAmount(normalized);
    }
  };

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
      Alert.alert("", c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : t("common.error")));
    } finally {
      setSubmitting(false);
    }
  };

  const openNewTaskModal = (phaseId?: string) => {
    if (!access.canWrite || (!access.sharedItems.tasks && !access.sharedItems.phases)) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    setSelectedPhaseId(phaseId || null);
    setShowNewTask(true);
  };

  const openNewDiaryModal = useCallback((mode: "text" | "voice" = "text", showPermissionAlert = true) => {
    if (!access.canWrite || access.sharedItems?.diary !== true) {
      if (!showPermissionAlert) return;
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    setEditingDiaryEntry(null);
    setDiaryDate(new Date().toISOString().split("T")[0]);
    setDiaryWeather("");
    setDiaryWorkers("");
    setDiaryWorkDescription("");
    setDiaryWorkDescriptionMode(mode);
    setDiaryWorkDescriptionRecordingUri(null);
    setDiaryWorkDescriptionIsRecording(false);
    setDiaryWorkDescriptionRecording(null);
    setDiaryMaterials("");
    setDiaryPhaseId(null);
    setDiaryAttachment(null);
    setShowDiaryModal(true);
  }, [access.canWrite, access.sharedItems.diary, t]);

  useEffect(() => {
    if (!paramOpenDiaryModal || !projectId) return;
    if (!projectOwnerId && access.loading) return;
    if (!access.canReadDiary || !access.canWrite || access.sharedItems?.diary !== true) return;
    openNewDiaryModal(paramDiaryInputMode === "voice" ? "voice" : "text", false);
  }, [paramOpenDiaryModal, paramDiaryInputMode, projectId, projectOwnerId, access.loading, access.canReadDiary, access.canWrite, access.sharedItems?.diary, openNewDiaryModal]);

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
    const newStatus = task.status === "DONE" ? "OPEN" : "DONE";

    if (newStatus === "DONE" && (task.subtasks?.length ?? 0) > 0) {
      const doneCount = task.subtasks?.filter((s) => s.done).length ?? 0;
      if (doneCount < (task.subtasks?.length ?? 0)) {
        Alert.alert(
          t("taskDetail.subtasksIncompleteTitle") || "Nie všetky subúlohy sú hotové",
          t("taskDetail.subtasksIncompleteBody") || "Chcete označiť úlohu ako hotovú?",
          [
            { text: t("common.cancel") || "Zrušiť", style: "cancel" },
            { text: t("taskDetail.markDone") || "Označiť", onPress: () => doToggleTaskStatus(task, newStatus) },
          ]
        );
        return;
      }
    }
    await doToggleTaskStatus(task, newStatus);
  };

  const doToggleTaskStatus = async (task: TaskDoc, newStatus: string) => {
    if (!projectId) return;
    try {
      console.log(`[ProjectOverview] Toggling task ${task.id} to ${newStatus}`);
      await updateTaskStatus(projectId, task.id, newStatus);
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error toggling task status:`, error);
      Alert.alert(t("common.error"), error.message || t("projectOverview.failedToChangeStatus"));
    }
  };

  const handleArchiveTask = async (task: TaskDoc) => {
    if (!projectId) return;
    
    Alert.alert(
      t("projectOverview.archiveTask") || 'Archivovať úlohu?',
      t("projectOverview.archiveTaskConfirm", { title: task.title }) || `Naozaj chceš archivovať úlohu "${task.title}"? Úloha sa skryje zo zoznamu, ale zostane v databáze.`,
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("projectOverview.archiveTask") || 'Archivovať',
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
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
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
      Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (task: TaskDoc) => {
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    if (!projectId) return;
    
    Alert.alert(
      t("projectOverview.deleteTask"),
      t("projectOverview.deleteTaskConfirm", { title: task.title || "" }),
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("common.delete"),
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
              Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
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

  const handleExportCsv = async () => {
    try {
      const result = await exportProjectToCsv(projectId);
      if (!result.ok) {
        Alert.alert(t("common.error"), result.error || t("projectOverview.exportFailed"));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(t("common.error"), msg);
    }
  };

  const handleMenuPress = () => {
    if (Platform.OS === 'ios') {
      const actions = [
        ...(isOwner ? [{ key: "edit", label: t("projectOverview.editProject"), onPress: handleEditProject }] : []),
        ...(whatsappDiaryEnabled ? [{ key: "updates", label: t("projectOverview.updates"), onPress: () => (navigation as any).navigate("Updates", { projectId }) }] : []),
        ...(contractorsEnabled ? [{ key: "suppliers", label: t("projectOverview.suppliers"), onPress: () => (navigation as any).navigate("ProjectSuppliers", { projectId }) }] : []),
        { key: "export", label: t("projectOverview.exportToCsv"), onPress: handleExportCsv },
        ...(isOwner ? [{ key: "delete", label: t("projectOverview.deleteProject"), onPress: handleDeleteProject }] : []),
      ];
      const options = [t("common.cancel"), ...actions.map((a) => a.label)];
      const deleteIndex = isOwner ? options.length - 1 : undefined;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: deleteIndex,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex <= 0) return;
          const action = actions[buttonIndex - 1];
          if (action) {
            action.onPress();
          }
        }
      );
    } else {
      // Android - použij Alert
      Alert.alert(
        projectName || t("projectOverview.project"),
        t("projectOverview.selectAction"),
        [
          { text: t("common.cancel"), style: 'cancel' },
          ...(isOwner ? [{ text: t("projectOverview.editProject"), onPress: handleEditProject }] : []),
          ...(whatsappDiaryEnabled ? [{ text: t("projectOverview.updates"), onPress: () => (navigation as any).navigate("Updates", { projectId }) }] : []),
          ...(contractorsEnabled ? [{ text: t("projectOverview.suppliers"), onPress: () => (navigation as any).navigate("ProjectSuppliers", { projectId }) }] : []),
          { text: t("projectOverview.exportToCsv"), onPress: handleExportCsv },
          ...(isOwner ? [{ text: t("projectOverview.deleteProject"), style: 'destructive', onPress: handleDeleteProject }] : []),
        ]
      );
    }
  };

  const handleEditProject = () => {
    setEditProjectName(projectName || "");
    setEditProjectAddress(addressText || "");
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editProjectName.trim() || !projectId || !orgId) return;
    setSubmitting(true);
    try {
      console.log(
        `[ProjectOverview] Updating project ${projectId}: name="${editProjectName.trim()}", address="${editProjectAddress.trim()}"`
      );
      await projectsService.updateProject(
        orgId,
        projectId,
        editProjectName.trim(),
        editProjectAddress.trim()
      );
      setShowEditModal(false);
      setEditProjectName("");
      setEditProjectAddress("");
      // Reload project data
      await load(true);
      // Update route params if needed
      Alert.alert(t("common.success"), t("projectOverview.projectUpdated"));
    } catch (error: any) {
      console.error(`[ProjectOverview] Error updating project:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProject = () => {
    Alert.alert(
      t("projectOverview.deleteProject"),
      t("projectOverview.deleteProjectConfirm", { name: projectName || "" }),
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("common.delete"),
          style: 'destructive',
          onPress: async () => {
            if (!projectId || !orgId) return;
            setSubmitting(true);
            try {
              console.log(`[ProjectOverview] Deleting project ${projectId}`);
              await projectsService.deleteProject(orgId, projectId);
              Alert.alert(t("common.success"), t("projectOverview.projectDeleted"));
              // Navigate back to projects list
              navigation.goBack();
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting project:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleMoveTask = (task: TaskDoc) => {
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    setMovingTask(task);
    setShowMoveTaskModal(true);
  };

  const handleMoveTaskToPhase = async (targetPhaseId: string | null) => {
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
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
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
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
      Alert.alert(t("common.error"), error.message || t("projectOverview.createPhaseFailed"));
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
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    if (!projectId) return;
    
    // Check if phase has tasks
    const phaseTasks = tasks.filter(t => t.phaseId === phase.id);
    if (phaseTasks.length > 0) {
      Alert.alert(
        t("projectOverview.cannotDeletePhase") || 'Nemožno vymazať fázu',
        t("projectOverview.cannotDeletePhaseMessage", { count: phaseTasks.length.toString() }) || `Táto fáza obsahuje ${phaseTasks.length} úloh. Najprv vymažte alebo presuňte úlohy.`
      );
      return;
    }
    
    Alert.alert(
      'Vymazať fázu?',
      `Naozaj chcete vymazať fázu "${phase.name}"?`,
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("common.delete"),
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
    const activeMembers = projectMembers
      .filter((member) => !!member.userId && member.sharedItems?.tasks !== false)
      .map((member) => ({
        key: `user:${member.userId}`,
        assigneeId: member.userId,
        assigneeName: member.name || member.email || member.userId,
        label: member.name || member.email || member.userId,
      }));
    const invitedMembers = projectMembers
      .filter((member) => !member.userId && member.sharedItems?.tasks !== false && !!(member.name || member.email))
      .map((member) => {
        const display = member.name || member.email || "";
        const invitedSuffix = t("projectMembers.invited") || "Pozvaný";
        return {
          key: `invited:${member.id}`,
          assigneeId: null as string | null,
          assigneeName: display,
          label: `${display} (${invitedSuffix})`,
        };
      });

    const candidates = [
      {
        key: `user:${user.id}`,
        assigneeId: user.id,
        assigneeName: user.name ?? user.email ?? "Ja",
        label: user.name ?? user.email ?? "Ja",
      },
      ...activeMembers,
      ...invitedMembers,
      {
        key: "unassigned",
        assigneeId: null as string | null,
        assigneeName: null,
        label: t("projectOverview.unassigned") || "Nepriradené",
      },
    ].filter((entry, index, arr) => arr.findIndex((x) => x.key === entry.key) === index);

    setAssigneeTask(task);
    setAssigneeCandidates(candidates);
    setShowAssigneeModal(true);
  };

  const applyAssigneeSelection = useCallback(
    (candidate: { key: string; assigneeId: string | null; assigneeName: string | null; label: string }) => {
      if (!orgId || !projectId || !assigneeTask) return;
      tasksService
        .updateTaskAssignee(orgId, projectId, assigneeTask.id, candidate.assigneeId, candidate.assigneeName, {
          taskTitle: assigneeTask.title ?? null,
          projectName: projectName || null,
        })
        .then(() => load())
        .catch((error) => {
          console.error("[ProjectOverview] Failed to update assignee:", error);
          Alert.alert(t("common.error"), t("projectOverview.failedToChangeStatus"));
        })
        .finally(() => {
          setShowAssigneeModal(false);
          setAssigneeTask(null);
        });
    },
    [assigneeTask, orgId, projectId, load, t]
  );

  // Expenses handlers
  const openExpenseModal = (expense?: ExpenseDoc, initialCategory?: "TRAVEL") => {
    if (expense) {
      setEditingExpense(expense);
      setExpenseTitle(expense.title);
      setExpenseAmount(expense.amount?.toString() || "");
      setExpenseDate(expense.date ? expense.date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setExpenseNote(expense.note || "");
      setExpenseCategory((expense.category as 'WORK' | 'MATERIAL' | 'OTHER' | 'TRAVEL' | undefined) || undefined);
      setExpenseSupplierName(expense.supplierName || "");
      setExpenseSupplierIco(expense.supplierIco || "");
      setExpensePhaseId(expense.phaseId || null);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseOcrStatus(null);
      const t = expense.travel;
      setExpenseTravelFromAddress(t?.fromAddress ?? "");
      setExpenseTravelToAddress(t?.toAddress ?? "");
      setExpenseTravelDistanceKm(t != null ? String(t.distanceKm) : "");
      setExpenseTravelRatePerKm(t != null ? String(t.ratePerKm) : "0.30");
      setExpenseTravelRoundTrip(t?.roundTrip ?? false);
    } else {
      setEditingExpense(null);
      setExpenseTitle("");
      setExpenseAmount("");
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setExpenseNote("");
      setExpenseCategory(initialCategory ?? undefined);
      setExpenseSupplierName("");
      setExpenseSupplierIco("");
      setExpensePhaseId(null);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseOcrStatus(null);
      setExpenseTravelFromAddress("");
      setExpenseTravelToAddress("");
      setExpenseTravelDistanceKm("");
      setExpenseTravelRatePerKm("0.30");
      setExpenseTravelRoundTrip(false);
    }
    setShowExpenseModal(true);
  };

  const applyOcrPrefill = (parsed: OcrParsed | null) => {
    if (!parsed) return;
    if (parsed.totalAmount != null) {
      setExpenseAmount(String(parsed.totalAmount));
    }
    if (parsed.issueDate) {
      setExpenseDate(parsed.issueDate);
    }
    if (parsed.supplierName) {
      setExpenseSupplierName(parsed.supplierName);
      if (!expenseTitle.trim()) {
        setExpenseTitle(parsed.supplierName);
      }
    }
    if (parsed.supplierTaxId) {
      setExpenseSupplierIco(parsed.supplierTaxId);
    }
  };

  const cleanupPreuploadedExpenseAttachment = async (
    nextPicked?: { uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' }
  ) => {
    const previous = expensePreuploadedAttachment;
    if (!previous) return;
    const isSameFile = !!nextPicked
      && previous.localUri === nextPicked.uri
      && previous.fileName === nextPicked.fileName
      && previous.mimeType === nextPicked.mimeType;
    if (isSameFile) return;
    if (previous.isLinkedToExpense || previous.linkedExpenseId) {
      console.log(
        `[ProjectOverview] Skipping preupload cleanup for linked attachment ${previous.attachmentId} (expenseId=${previous.linkedExpenseId ?? "unknown"}).`
      );
      return;
    }
    if (!projectId || !previous.attachmentId || !previous.storagePath) {
      console.warn("[ProjectOverview] Skipping preupload cleanup: missing projectId/attachmentId/storagePath.");
      return;
    }
    try {
      console.log(
        `[ProjectOverview] Cleaning up replaced preuploaded attachment ${previous.attachmentId} at ${previous.storagePath}`
      );
      await attachmentsService.deleteAttachment(projectId, previous.attachmentId, previous.storagePath);
      console.log(`[ProjectOverview] Cleanup successful for replaced attachment ${previous.attachmentId}`);
    } catch (error) {
      console.warn(`[ProjectOverview] Failed to cleanup replaced preuploaded attachment ${previous.attachmentId}:`, error);
    } finally {
      setExpensePreuploadedAttachment((current) =>
        current?.attachmentId === previous.attachmentId ? null : current
      );
    }
  };

  const handlePickedExpenseAttachment = async (picked: { uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' }) => {
    await cleanupPreuploadedExpenseAttachment(picked);
    setExpenseAttachment(picked);
    setExpenseOcrStatus(null);
    if (editingExpense || picked.kind !== "image" || !projectId) {
      return;
    }
    if (uploadingExpenseAttachment || ocrLoading) {
      console.warn("[ProjectOverview] Ignoring attachment pick while OCR/upload is running.");
      return;
    }
    try {
      setUploadingExpenseAttachment(true);
      const attachment = await attachmentsService.uploadAttachment(projectId, {
        expenseId: null,
        taskId: null,
        phaseId: expensePhaseId,
        localUri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        kind: "image",
      });
      const uploadedFilePath = attachment.storagePath?.trim();
      if (!uploadedFilePath) {
        throw new Error("Attachment upload returned empty filePath.");
      }
      console.log("[ProjectOverview] Auto OCR filePath:", uploadedFilePath);
      setExpensePreuploadedAttachment({
        attachmentId: attachment.id,
        storagePath: uploadedFilePath,
        mimeType: picked.mimeType,
        kind: picked.kind,
        fileName: picked.fileName,
        localUri: picked.uri,
        isLinkedToExpense: false,
      });
      setUploadingExpenseAttachment(false);
      setOcrLoading(true);
      const result = await extractInvoiceData({
        filePath: uploadedFilePath,
        mimeType: picked.mimeType,
        attachmentId: attachment.id,
        projectId,
      });
      setExpenseOcrStatus(result.status);
      if (result.status === "success") {
        applyOcrPrefill(result.parsed);
      } else {
        console.log("[OCR UI] error.code =", result.errorCode, "message=", result.errorCode);
        Alert.alert(t("common.warning"), getOcrFallbackMessage(result.errorCode));
      }
    } catch (error: any) {
      console.error("[ProjectOverview] Auto OCR after pick failed:", error);
      console.log("[OCR UI] error.code =", error?.code, "message=", error?.message);
      setExpenseOcrStatus("failed");
      Alert.alert(t("common.warning"), getOcrFallbackMessage(error?.code || error?.message));
    } finally {
      setUploadingExpenseAttachment(false);
      setOcrLoading(false);
    }
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
            options: [t("common.cancel"), t("projectOverview.takeInvoicePhoto"), t("projectOverview.selectFromGalleryForInvoice")],
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
          t("projectOverview.selectSource"),
          t("projectOverview.selectSourceForInvoice") || 'Odkiaľ chcete pridať faktúru?',
          [
            { text: t("common.cancel"), style: 'cancel' },
            { text: t("projectOverview.takeInvoicePhoto"), onPress: launchCameraForExpense },
            { text: t("projectOverview.selectFromGalleryForInvoice"), onPress: launchGalleryForExpense },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense image:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectImage"));
    }
  };

  const launchCameraForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t("projectOverview.cameraPermission"), t("projectOverview.cameraPermissionForInvoice"));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await handlePickedExpenseAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error launching camera for expense:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenCamera"));
    }
  };

  const launchGalleryForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t("projectOverview.galleryPermission"), t("projectOverview.galleryPermissionForInvoice"));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await handlePickedExpenseAttachment({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image',
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense from gallery:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectImage"));
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
            options: [t("common.cancel"), t("projectOverview.takePhoto"), t("projectOverview.selectFromGallery")],
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
            { text: t("common.cancel"), style: 'cancel' },
            { text: 'Odfotiť', onPress: launchCameraForDiary },
            { text: 'Vybrať z galérie', onPress: launchGalleryForDiary },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking diary image:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectPhoto"));
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
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenCamera"));
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
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectPhoto"));
    }
  };

  const pickExpenseDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert(t("common.error"), t("projectOverview.documentPickerNotInstalled"));
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
        await handlePickedExpenseAttachment({
          uri: asset.uri,
          fileName: asset.name || `faktura_${Date.now()}.pdf`,
          mimeType: asset.mimeType || 'application/pdf',
          kind,
        });
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking expense document:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectDocument"));
    }
  };

  const navigateToExpenseReview = (params: {
    projectId: string;
    expenseId: string;
    status: "success" | "failed" | "limit" | "cancelled";
    parsed: { supplierName: string | null; invoiceNumber: string | null; issueDate: string | null; totalAmount: number | null; vatAmount: number | null; currency: "EUR"; } | null;
    defaultTitle: string;
    defaultAmount: string;
    defaultDate: string;
    defaultSupplierName?: string;
    attachmentId?: string;
    storagePath?: string;
  }) => {
    (navigation as { navigate: (name: string, params?: unknown) => void }).navigate("ExpenseReview", params);
  };

  const handleOcrCancel = () => {
    ocrRequestIdRef.current = 0;
    setOcrLoading(false);
    const pending = ocrPendingReview;
    setOcrPendingReview(null);
    if (pending) {
      navigateToExpenseReview({
        ...pending,
        status: "cancelled",
        parsed: null,
      });
    }
  };

  const startOcrReview = async (input: {
    projectId: string;
    expenseId: string;
    storagePath: string;
    mimeType?: string;
    attachmentId?: string;
    defaultTitle: string;
    defaultAmount: string;
    defaultDate: string;
    defaultSupplierName?: string;
  }) => {
    const requestId = Date.now();
    const normalizedPath = input.storagePath?.trim();
    if (!normalizedPath) {
      console.warn("[ProjectOverview] OCR skipped: empty filePath/storagePath");
      Alert.alert(t("common.warning"), getOcrFallbackMessage("EMPTY_FILE_PATH"));
      await expensesService.updateExpense(input.projectId, input.expenseId, {
        ocrStatus: "failed",
      });
      navigateToExpenseReview({
        ...input,
        status: "failed",
        parsed: null,
      });
      return;
    }
    if (
      normalizedPath.startsWith("file://") ||
      normalizedPath.startsWith("content://") ||
      normalizedPath.startsWith("gs://")
    ) {
      console.warn("[ProjectOverview] OCR skipped: invalid storage filePath:", normalizedPath);
      Alert.alert(t("common.warning"), getOcrFallbackMessage("INVALID_FILE_PATH"));
      await expensesService.updateExpense(input.projectId, input.expenseId, {
        ocrStatus: "failed",
      });
      navigateToExpenseReview({
        ...input,
        status: "failed",
        parsed: null,
      });
      return;
    }
    console.log("[ProjectOverview] OCR request filePath:", normalizedPath);
    ocrRequestIdRef.current = requestId;
    setOcrPendingReview(input);
    setOcrLoading(true);
    try {
      const result = await extractInvoiceData({
        filePath: normalizedPath,
        mimeType: input.mimeType,
        attachmentId: input.attachmentId,
        projectId: input.projectId,
      });
      if (ocrRequestIdRef.current !== requestId) return;
      setOcrLoading(false);
      setOcrPendingReview(null);
      await expensesService.updateExpense(input.projectId, input.expenseId, {
        ocrStatus: result.status === "success" ? "done" : "failed",
      });
      if (result.status !== "success") {
        console.log("[OCR UI] error.code =", result.errorCode, "message=", result.errorCode);
        Alert.alert(t("common.warning"), getOcrFallbackMessage(result.errorCode));
      }
      navigateToExpenseReview({
        ...input,
        status: result.status,
        parsed: result.parsed,
      });
    } catch (error) {
      if (ocrRequestIdRef.current !== requestId) return;
      console.error("[ProjectOverview] OCR failed:", error);
      console.log("[OCR UI] error.code =", (error as any)?.code, "message=", (error as any)?.message);
      setOcrLoading(false);
      setOcrPendingReview(null);
      await expensesService.updateExpense(input.projectId, input.expenseId, {
        ocrStatus: "failed",
      });
      Alert.alert(t("common.warning"), getOcrFallbackMessage((error as any)?.code || (error as any)?.message));
      navigateToExpenseReview({
        ...input,
        status: "failed",
        parsed: null,
      });
    }
  };

  const handleSaveExpense = async () => {
    if (submitting || uploadingExpenseAttachment || ocrLoading) {
      console.warn("[ProjectOverview] Ignoring duplicate save click while busy.");
      return;
    }
    if (!projectId || !orgId) return;
    const canUseOcrDraft = !editingExpense && expenseAttachment?.kind === "image";
    const isTravel = expenseCategory === "TRAVEL";

    let titleValue: string;
    let amount: number | null = null;
    let travelData: { fromAddress: string; toAddress: string; distanceKm: number; ratePerKm: number; roundTrip: boolean } | undefined;

    if (isTravel) {
      const from = expenseTravelFromAddress.trim();
      const to = expenseTravelToAddress.trim();
      const km = parseFloat(expenseTravelDistanceKm.replace(",", "."));
      const rate = parseFloat(expenseTravelRatePerKm.replace(",", ".")) || 0.3;
      if (!from || !to) {
        Alert.alert(t("common.error"), "Vyplňte adresu A a B.");
        return;
      }
      if (!Number.isFinite(km) || km <= 0) {
        Alert.alert(t("common.error"), "Zadajte platnú vzdialenosť v km.");
        return;
      }
      const effectiveKm = expenseTravelRoundTrip ? km * 2 : km;
      amount = Math.round(effectiveKm * rate * 100) / 100;
      titleValue = `Cestovné: ${from} → ${to}`;
      travelData = { fromAddress: from, toAddress: to, distanceKm: km, ratePerKm: rate, roundTrip: expenseTravelRoundTrip };
    } else {
      titleValue = expenseTitle.trim() || (canUseOcrDraft ? "Invoice" : "");
      if (!titleValue) return;
      if (expenseAmount.trim()) {
        amount = parseFloat(expenseAmount);
        if (isNaN(amount) || amount <= 0) {
          Alert.alert(t("common.error"), t("projectOverview.enterValidAmount"));
          return;
        }
      } else if (!canUseOcrDraft) {
        Alert.alert(t("common.error"), t("projectOverview.enterValidAmount"));
        return;
      }
    }

    if (!expenseCategory) {
      Alert.alert(t("common.error"), "Vyberte typ výdavku (Práca, Materiál, Práca + Materiál alebo Cestovné).");
      return;
    }
    
    setSubmitting(true);
    let openedOcrReview = false;
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
            Alert.alert(t("common.warning"), t("projectOverview.expenseSavedAttachmentFailed"));
          } finally {
            setUploadingExpenseAttachment(false);
          }
        }
        
        await expensesService.updateExpense(projectId, editingExpense.id, {
          title: titleValue,
          amount,
          date: expenseDateObj,
          note: expenseNote.trim() || undefined,
          category: expenseCategory,
          supplierName: expenseSupplierName.trim() || undefined,
          supplierIco: expenseSupplierIco.trim() || undefined,
          attachmentId: attachmentId || editingExpense.attachmentId || undefined,
          ...(travelData && { travel: travelData }),
        });
        Alert.alert(t("common.success"), t("projectOverview.expenseUpdated"));
      } else {
        // For new expense: create expense first, then upload attachment with expenseId
        const newExpense = await expensesService.createExpense(orgId, projectId, {
          title: titleValue,
          amount,
          date: expenseDateObj,
          note: expenseNote.trim() || undefined,
          category: expenseCategory,
          supplierName: expenseSupplierName.trim() || undefined,
          supplierIco: expenseSupplierIco.trim() || undefined,
          phaseId: expensePhaseId || undefined,
          source: (expenseAttachment || expensePreuploadedAttachment) ? "DOCUMENT" : "MANUAL",
          status: "READY",
          uploadStatus: expensePreuploadedAttachment ? "uploaded" : (expenseAttachment ? "pending" : undefined),
          ocrStatus: expenseAttachment?.kind === "image"
            ? (expenseOcrStatus === "success" ? "done" : (expenseOcrStatus ? "failed" : "pending"))
            : undefined,
          filePath: expensePreuploadedAttachment?.storagePath ?? null,
          mimeType: expensePreuploadedAttachment?.mimeType ?? expenseAttachment?.mimeType ?? null,
          ...(travelData && { travel: travelData }),
        });

        if (expensePreuploadedAttachment) {
          attachmentId = expensePreuploadedAttachment.attachmentId;
          await attachmentsService.linkAttachmentToExpense(projectId, expensePreuploadedAttachment.attachmentId, newExpense.id);
          setExpensePreuploadedAttachment((prev) => (
            prev
              ? { ...prev, isLinkedToExpense: true, linkedExpenseId: newExpense.id }
              : prev
          ));
          await expensesService.updateExpense(projectId, newExpense.id, {
            attachmentId: expensePreuploadedAttachment.attachmentId,
            uploadStatus: "uploaded",
            filePath: expensePreuploadedAttachment.storagePath,
            mimeType: expensePreuploadedAttachment.mimeType,
            ocrStatus: expenseAttachment?.kind === "image"
              ? (expenseOcrStatus === "success" ? "done" : (expenseOcrStatus ? "failed" : "pending"))
              : undefined,
            ocrSupplierName: expenseSupplierName.trim() || null,
            ocrIssueDate: expenseDate || null,
            ocrTotalAmount: amount ?? null,
          });
        }

        // Upload attachment after expense creation (so we have expenseId)
        if (expenseAttachment && newExpense.id && !expensePreuploadedAttachment) {
          try {
            setUploadingExpenseAttachment(true);
            let attachmentStoragePath: string | undefined;
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
            attachmentStoragePath = attachment.storagePath?.trim();
            if (!attachmentStoragePath) {
              throw new Error("Attachment upload returned empty filePath.");
            }
            console.log("[ProjectOverview] Expense attachment uploaded filePath:", attachmentStoragePath);
            
            // Update expense with attachmentId
            await expensesService.updateExpense(projectId, newExpense.id, {
              attachmentId: attachmentId,
              uploadStatus: "uploaded",
              filePath: attachmentStoragePath ?? null,
              mimeType: expenseAttachment.mimeType,
              ocrStatus: expenseAttachment.kind === "image" ? "pending" : undefined,
              ocrSupplierName: expenseSupplierName.trim() || null,
              ocrIssueDate: expenseDate || null,
              ocrTotalAmount: amount ?? null,
            });
            console.log(`[ProjectOverview] Uploaded expense attachment: ${attachmentId}`);

            if (expenseAttachment.kind === "image" && attachmentStoragePath) {
              setShowExpenseModal(false);
              openedOcrReview = true;
              await startOcrReview({
                projectId,
                expenseId: newExpense.id,
                storagePath: attachmentStoragePath,
                mimeType: expenseAttachment.mimeType,
                attachmentId: attachmentId,
                defaultTitle: titleValue,
                defaultAmount: expenseAmount,
                defaultDate: expenseDate,
                defaultSupplierName: expenseSupplierName || undefined,
              });
            }
          } catch (error: any) {
            console.error(`[ProjectOverview] Error uploading expense attachment:`, error);
            await expensesService.updateExpense(projectId, newExpense.id, {
              uploadStatus: "failed",
              status: "READY",
              filePath: null,
              ocrStatus: expenseAttachment.kind === "image" ? "failed" : undefined,
              mimeType: expenseAttachment.mimeType,
            });
            if (expenseAttachment.kind === "image") {
              setShowExpenseModal(false);
              openedOcrReview = true;
              Alert.alert(t("common.warning"), getOcrFallbackMessage("OCR_SAVE_FALLBACK"));
              navigateToExpenseReview({
                projectId,
                expenseId: newExpense.id,
                status: "failed",
                parsed: null,
                defaultTitle: titleValue,
                defaultAmount: expenseAmount,
                defaultDate: expenseDate,
                defaultSupplierName: expenseSupplierName || undefined,
              });
            } else {
              Alert.alert(t("common.warning"), t("projectOverview.expenseSavedAttachmentFailed"));
            }
          } finally {
            setUploadingExpenseAttachment(false);
          }
        }

        if (!openedOcrReview) {
          Alert.alert(t("common.success"), t("projectOverview.expenseAdded"));
        }
      }
      setShowExpenseModal(false);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseCategory(undefined);
      setExpenseSupplierName("");
      setExpenseSupplierIco("");
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error saving expense:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
    } finally {
      setSubmitting(false);
      setUploadingExpenseAttachment(false);
    }
  };

  const handleDeleteExpense = (expense: ExpenseDoc) => {
    Alert.alert(
      t("projectOverview.deleteExpense"),
      t("projectOverview.deleteExpenseConfirmMessage", { title: expense.title || "" }),
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("common.delete"),
          style: 'destructive',
          onPress: async () => {
            if (!projectId) return;
            try {
              await expensesService.deleteExpense(projectId, expense.id);
              await load(true);
              Alert.alert(t("common.success"), t("projectOverview.expenseDeleted"));
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting expense:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
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

  const shareDiaryEntry = async (entry: DiaryEntryDoc) => {
    try {
      const phaseName = entry.phaseId ? phases.find(p => p.id === entry.phaseId)?.name : null;
      
      let shareText = `Update z projektu: ${projectName}\n\n`;
      shareText += `Dátum: ${formatDate(entry.date)}\n`;
      if (phaseName) {
        shareText += `Fáza: ${phaseName}\n`;
      }
      shareText += `\nPopis práce:\n${entry.workDescription}\n`;
      
      if (entry.weather) {
        shareText += `\nPočasie: ${entry.weather}\n`;
      }
      if (entry.workers) {
        shareText += `Pracovníci: ${entry.workers}\n`;
      }
      if (entry.materials) {
        shareText += `Materiály: ${entry.materials}\n`;
      }
      
      if (entry.attachments && entry.attachments.length > 0) {
        shareText += `\nPriložené: ${entry.attachments.length} ${entry.attachments.length === 1 ? 'súbor' : 'súborov'}`;
      }
      
      await Share.share({
        message: shareText,
        title: `Update: ${projectName} - ${formatDate(entry.date)}`,
      });
    } catch (error: any) {
      console.error('[ProjectOverview] Error sharing diary entry:', error);
      Alert.alert(t("common.error"), t("projectOverview.failedToShareUpdate"));
    }
  };

  const sharePhase = async (phase: ProjectPhaseDoc) => {
    try {
      const phaseTasks = tasksByPhase.get(phase.id) || [];
      const completedTasks = phaseTasks.filter(t => t.status === 'DONE');
      
      let shareText = `Update z projektu: ${projectName}\n\n`;
      shareText += `Fáza: ${phase.name}\n`;
      shareText += `\nStav: ${completedTasks.length} z ${phaseTasks.length} úloh dokončených\n`;
      
      if (completedTasks.length > 0) {
        shareText += `\nDokončené úlohy:\n`;
        completedTasks.forEach(task => {
          shareText += `✓ ${task.title || 'Bez názvu'}\n`;
          if (task.dueDate) {
            shareText += `  Termín: ${task.dueDate}\n`;
          }
        });
      }
      
      // Add diary entries for this phase
      const phaseDiaryEntries = diaryEntries.filter(e => e.phaseId === phase.id);
      if (phaseDiaryEntries.length > 0) {
        shareText += `\nZápisy do denníka:\n`;
        phaseDiaryEntries.forEach(entry => {
          shareText += `\n${formatDate(entry.date)}:\n`;
          shareText += `${entry.workDescription}\n`;
          if (entry.attachments && entry.attachments.length > 0) {
            shareText += `(${entry.attachments.length} ${entry.attachments.length === 1 ? 'fotka' : 'fotiek'})\n`;
          }
        });
      }
      
      await Share.share({
        message: shareText,
        title: `Update: ${projectName} - ${phase.name}`,
      });
    } catch (error: any) {
      console.error('[ProjectOverview] Error sharing phase:', error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSharePhaseUpdate"));
    }
  };

  const handleSaveDiaryEntry = async () => {
    if (!projectId || !orgId) return;
    
    // Validate: either text mode with text, or voice mode with recording
    if (diaryWorkDescriptionMode === 'text' && !diaryWorkDescription.trim()) {
      Alert.alert(t("common.error"), t("projectOverview.fillWorkDescription"));
      return;
    }
    if (diaryWorkDescriptionMode === 'voice' && !diaryWorkDescriptionRecordingUri) {
      Alert.alert(t("common.error"), t("projectOverview.uploadVoiceOrSwitchToText"));
      return;
    }
    
    setSubmitting(true);
    try {
      const entryDate = new Date(diaryDate);
      let attachmentIds: string[] = [];
      
      // Upload photo attachment if provided
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
          attachmentIds.push(attachment.id);
          console.log(`[ProjectOverview] Uploaded diary attachment: ${attachment.id}`);
        } catch (error: any) {
          console.error(`[ProjectOverview] Error uploading diary attachment:`, error);
          Alert.alert(t("common.error"), t("projectOverview.failedToUploadPhoto"));
          setSubmitting(false);
          setUploadingDiaryAttachment(false);
          return;
        } finally {
          setUploadingDiaryAttachment(false);
        }
      }
      
      // Upload voice recording if provided
      let workDescriptionText = diaryWorkDescription.trim() || undefined;
      if (diaryWorkDescriptionMode === 'voice' && diaryWorkDescriptionRecordingUri) {
        try {
          setUploadingDiaryAttachment(true);
          const voiceAttachment = await attachmentsService.uploadAttachment(projectId, {
            expenseId: null,
            taskId: null,
            phaseId: diaryPhaseId,
            localUri: diaryWorkDescriptionRecordingUri,
            fileName: `diary_work_description_${Date.now()}.m4a`,
            mimeType: 'audio/m4a',
            kind: 'audio',
          });
          attachmentIds.push(voiceAttachment.id);
          console.log(`[ProjectOverview] Uploaded diary voice recording: ${voiceAttachment.id}`);
          // If work description text is empty, set a placeholder
          if (!workDescriptionText) {
            workDescriptionText = '[Hlasová správa]';
          }
        } catch (error: any) {
          console.error(`[ProjectOverview] Error uploading diary voice recording:`, error);
          Alert.alert(t("common.error"), t("projectOverview.failedToUploadVoice"));
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
        const finalAttachments = attachmentIds.length > 0 ? [...existingAttachments, ...attachmentIds] : existingAttachments;
        
        await constructionDiaryService.updateDiaryEntry(projectId, editingDiaryEntry.id, {
          date: entryDate,
          weather: diaryWeather.trim() || undefined,
          workers: diaryWorkers.trim() || undefined,
          workDescription: workDescriptionText,
          materials: diaryMaterials.trim() || undefined,
          notes: undefined, // Notes field removed, using workDescription instead
          phaseId: diaryPhaseId,
          attachments: finalAttachments,
        });
        Alert.alert(t("common.success"), t("projectOverview.diaryEntryUpdated"));
      } else {
        await constructionDiaryService.createDiaryEntry(orgId, projectId, {
          date: entryDate,
          weather: diaryWeather.trim() || undefined,
          workers: diaryWorkers.trim() || undefined,
          workDescription: workDescriptionText,
          materials: diaryMaterials.trim() || undefined,
          notes: undefined, // Notes field removed, using workDescription instead
          phaseId: diaryPhaseId,
          attachments: attachmentIds,
        });
        Alert.alert(t("common.success"), t("projectOverview.diaryEntryAdded"));
      }
      
      setShowDiaryModal(false);
      setEditingDiaryEntry(null);
      setDiaryDate(new Date().toISOString().split('T')[0]);
      setDiaryWeather("");
      setDiaryWorkers("");
      setDiaryWorkDescription("");
      setDiaryWorkDescriptionMode('text');
      setDiaryWorkDescriptionRecordingUri(null);
      setDiaryWorkDescriptionIsRecording(false);
      setDiaryWorkDescriptionRecording(null);
      setDiaryMaterials("");
      setDiaryPhaseId(null);
      setDiaryAttachment(null);
      await load(true);
    } catch (error: any) {
      console.error(`[ProjectOverview] Error saving diary entry:`, error);
      Alert.alert(t("common.error"), error.message || t("projectOverview.failedToSaveDiaryEntry"));
    } finally {
      setSubmitting(false);
      setUploadingDiaryAttachment(false);
    }
  };

  const pickDocumentFile = async () => {
    if (!DocumentPicker) {
      Alert.alert(t("common.error"), t("projectOverview.documentPickerNotInstalled"));
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
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectDocument"));
    }
  };

  const handleSaveDocument = async () => {
    if (!documentName.trim() || !projectId || !orgId) return;
    
    if (!documentAttachment && !editingDocument) {
      Alert.alert(t("common.error"), t("projectOverview.mustAddDocumentFile"));
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
          Alert.alert(t("common.error"), t("projectOverview.failedToUploadDocument"));
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
        Alert.alert(t("common.success"), t("projectOverview.documentUpdated"));
      } else {
        if (!attachmentId) {
          Alert.alert(t("common.error"), t("projectOverview.mustAddDocumentFile"));
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
        Alert.alert(t("common.success"), t("projectOverview.documentAdded"));
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
      Alert.alert(t("common.error"), error.message || t("projectOverview.failedToSaveDocument"));
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
    if (!isOwner) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
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
      Alert.alert(t("common.error"), t("projectOverview.failedToLoadAttachments"));
    }
  };

  const pickImage = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("projectOverview.imagePickerInstallCommand"));
      return;
    }
    try {
      // Show action sheet to choose between camera and gallery
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [t("common.cancel"), t("projectOverview.takePhoto"), t("projectOverview.selectFromGallery"), t("projectOverview.selectVideo")],
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
          t("projectOverview.selectSource") || 'Vyberte zdroj',
          t("projectOverview.selectSourceMessage") || 'Odkiaľ chcete pridať prílohu?',
          [
            { text: t("common.cancel"), style: 'cancel' },
            { text: t("projectOverview.takePhoto"), onPress: launchCameraForAttachment },
            { text: t("projectOverview.selectFromGallery"), onPress: launchGalleryForAttachment },
            { text: t("projectOverview.selectVideo"), onPress: launchVideoPicker },
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
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenCamera"));
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
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectImage"));
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
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectDocument"));
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
      
      Alert.alert(t("common.success"), t("projectOverview.attachmentAdded"));
    } catch (error: any) {
      console.error(`[ProjectOverview] Error uploading attachment:`, error);
      const c = (error as { code?: string }).code;
      Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
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
            t("projectOverview.permissionError"),
            t("projectOverview.attachmentPermissionDenied") || 'Nemáte oprávnenie na zobrazenie tejto prílohy. Skontrolujte Storage rules a či ste vlastníkom projektu.'
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
            t("projectOverview.failedToAutoOpenAttachment")
          );
        }
      } catch (error: any) {
        console.error(`[ProjectOverview] Error opening document:`, error);
        Alert.alert(t("common.error"), t("projectOverview.failedToOpenAttachment", { error: error.message || t("common.unknown") }));
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error opening attachment:`, error);
      Alert.alert('Chyba', `Nepodarilo sa otvoriť prílohu: ${error.message || 'Neznáma chyba'}`);
    }
  };

  const deleteAttachmentHandler = async (attachment: AttachmentDoc) => {
    Alert.alert(
      t("projectOverview.deleteAttachment"),
      t("projectOverview.deleteAttachmentConfirmMessage", { fileName: attachment.fileName || "" }),
      [
        { text: t("common.cancel"), style: 'cancel' },
        {
          text: t("common.delete"),
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
              
              Alert.alert(t("common.success"), t("projectOverview.attachmentDeleted"));
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting attachment:`, error);
              const c = (error as { code?: string }).code;
              Alert.alert(t("common.error"), c === "permission-denied" ? t("projectOverview.noPermission") : (error instanceof Error ? error.message : t("common.error")));
            }
          },
        },
      ]
    );
  };

  // Determine project type: BUILD has phases, TRADE/MAINTENANCE don't
  const isBuildProject = projectType === 'BUILD' || projectType === 'MANAGEMENT';
  const isTradeOrMaintenance = projectType === 'TRADE' || projectType === 'RESIDENTIAL' || projectType === 'MAINTENANCE';
  const supportsDiary = isBuildProject || isTradeOrMaintenance;
  
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
  
  // MAINTENANCE: filter tasks by type (service vs all)
  const maintenanceTasks = projectType === 'MAINTENANCE' 
    ? (taskFilter === 'service' ? tasks.filter(t => t.serviceRuleId != null) : tasks)
    : tasks;
  const displayTasksForMaintenance = projectType === 'MAINTENANCE' ? maintenanceTasks : tasks;
  
  // Equipment map for task row lookup (equipmentId -> equipment)
  const equipmentMap = React.useMemo(() => {
    const m = new Map<string, EquipmentDoc>();
    equipmentList.forEach((eq) => m.set(eq.id, eq));
    return m;
  }, [equipmentList]);
  
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
        <Text style={styles.muted}>{t("projectOverview.projectNotFound") || "Project not found."}</Text>
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
                {projectType === "MAINTENANCE" ? t("projectType.maintenance") :
                  projectType === "RESIDENTIAL" ? t("projectType.RESIDENTIAL") :
                  projectType === "TRADE" ? t("projectType.TRADE") :
                  projectType === "MANAGEMENT" ? t("projectType.MANAGEMENT") :
                  projectType === "BUILD" ? t("projectType.build") :
                  t(`projectType.${projectType}` as any) || projectType}
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
      {__DEV__ && (
        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: '#1a1a2e' }}>
          <Text style={{ fontSize: 11, color: '#888' }}>
            [DEV] {access.permissionLevel} | tasks:{access.sharedItems.tasks ? 1 : 0} phases:{access.sharedItems.phases ? 1 : 0} exp:{access.sharedItems.expenses ? 1 : 0} diary:{access.sharedItems.diary ? 1 : 0} docs:{access.sharedItems.documents ? 1 : 0} | canWrite:{access.canWrite ? 1 : 0}
          </Text>
        </View>
      )}

      {/* Address section */}
      {(addressText || isOwner) && (
        <View style={styles.addressSection}>
          <View style={styles.addressTopRow}>
            <View style={styles.addressContent}>
              <Ionicons name="location" size={20} color={colors.primary} />
              <Text style={styles.addressText} numberOfLines={1}>
                {addressText?.trim() || "Adresa projektu nie je zadaná"}
              </Text>
              {isOwner ? (
                <TouchableOpacity
                  style={styles.editAddressButton}
                  onPress={handleEditProject}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="create-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
            {addressText?.trim() ? (
              <TouchableOpacity
                style={styles.navigateButton}
                onPress={() => openInMaps(addressText)}
              >
                <Ionicons name="navigate" size={18} color="#FFFFFF" />
                <Text style={styles.navigateButtonText}>{t("projectOverview.navigate")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {weatherLoading && !weatherSnapshot ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : weatherSnapshot ? (
            <View style={styles.weatherDaysRow}>
              {weatherSnapshot.daily.slice(0, 3).map((day) => (
                <TouchableOpacity
                  key={day.label}
                  style={styles.weatherDayCard}
                  onPress={() => Linking.openURL(weatherSnapshot.detailUrl)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.weatherDayLabel}>{day.label}</Text>
                  <View style={styles.weatherInlineRow}>
                    <Ionicons name={weatherTypeIcon(day.type)} size={18} color={weatherBadgeColor(day.level)} />
                    <Text style={styles.weatherDayTemp}>
                      {day.tempMaxC != null || day.tempMinC != null
                        ? `${day.tempMaxC != null ? Math.round(day.tempMaxC) : "?"}° / ${day.tempMinC != null ? Math.round(day.tempMinC) : "?"}°`
                        : "—"}
                    </Text>
                  </View>
                  <View style={[styles.weatherDayBadge, { backgroundColor: weatherBadgeColor(day.level) }]} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.weatherErrorText}>{weatherError || "Počasie sa nepodarilo načítať."}</Text>
          )}
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
        {/* MAINTENANCE v2: Equipment section only for MAINTENANCE projects */}
        {projectType === 'MAINTENANCE' && (
          <View style={styles.equipmentSection}>
            <Text style={styles.equipmentSectionTitle}>Zariadenia</Text>
            {equipmentList.length === 0 ? (
              <TouchableOpacity
                style={styles.equipmentCta}
                onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName })}
              >
                <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                <Text style={styles.equipmentCtaText}>Pridať zariadenie</Text>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.equipmentListRow}>
                  {equipmentList.slice(0, 2).map((eq) => (
                    <TouchableOpacity
                      key={eq.id}
                      style={styles.equipmentChip}
                      onPress={() => (navigation as any).navigate('EquipmentDetail', { projectId, projectName, equipmentId: eq.id })}
                      onLongPress={() => {
                        Alert.alert(
                          "Archivovať zariadenie",
                          `Naozaj chcete archivovať "${eq.name}"?`,
                          [
                            { text: "Zrušiť", style: "cancel" },
                            {
                              text: "Archivovať",
                              style: "destructive",
                              onPress: async () => {
                                try {
                                  await equipmentService.archiveEquipment(projectId!, eq.id);
                                  onRefresh();
                                } catch (e: any) {
                                  Alert.alert("Chyba", e.message || "Nepodarilo sa archivovať.");
                                }
                              },
                            },
                          ]
                        );
                      }}
                    >
                      {eq.photoUrl ? (
                        <Image
                          source={{ uri: eq.photoUrl }}
                          style={styles.equipmentChipImage}
                          resizeMode="cover"
                        />
                      ) : null}
                      <Text style={styles.equipmentChipText} numberOfLines={1}>{eq.labelCode || eq.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={styles.equipmentViewAll}
                  onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName })}
                >
                  <Text style={styles.equipmentViewAllText}>{t("projectOverview.viewAll") || "Zobraziť všetky"}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Table: Task Name | Assignee - only show if user can read tasks or phases */}
        {/* For TRADE/MAINTENANCE: only show table if there are tasks */}
        {/* For BUILD/MANAGEMENT: always show table */}
        {!access.loading && (access.canReadTasks || access.canReadPhases) && (!isTradeOrMaintenance || tasks.length > 0) && (
          <View style={styles.tableContainer}>
            <ScrollView 
              style={styles.tableScroll} 
              contentContainerStyle={styles.table} 
              nestedScrollEnabled
            >
          <TouchableOpacity
            style={styles.phasesSectionHeader}
            onPress={() => setPhasesSectionExpanded((prev) => !prev)}
            activeOpacity={0.7}
          >
            <View style={styles.phasesSectionHeaderLeft}>
              <Ionicons
                name={phasesSectionExpanded ? "chevron-down" : "chevron-forward"}
                size={18}
                color={colors.primary}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.phasesSectionHeaderText}>
                {projectType === 'MAINTENANCE' ? (t("projectOverview.serviceTasks") || "Servisné úlohy") : (t("projectOverview.phasesSection") || "Fázy a úlohy")}
              </Text>
              <Text style={styles.phasesSectionCount}>
                ({projectType === 'MAINTENANCE' ? displayTasksForMaintenance.length : tasks.length})
              </Text>
            </View>
          </TouchableOpacity>
          {phasesSectionExpanded && (
          <>
          {projectType === 'MAINTENANCE' && (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <TouchableOpacity
                onPress={() => setTaskFilter('service')}
                style={[styles.filterChip, taskFilter === 'service' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.filterChipText, taskFilter === 'service' && { color: '#fff' }]}>
                  {t("projectOverview.serviceTasksFilter") || "Servisné"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTaskFilter('all')}
                style={[styles.filterChip, taskFilter === 'all' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[styles.filterChipText, taskFilter === 'all' && { color: '#fff' }]}>
                  {t("projectOverview.allTasksFilter") || "Všetky"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderText}>{t("projectOverview.taskName")}</Text>
            <Text style={[styles.tableHeaderText, styles.colAssignee]}>{t("projectOverview.assignee")}</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (projectType === 'MAINTENANCE' ? displayTasksForMaintenance.length : tasks.length) === 0 && (isTradeOrMaintenance || phases.length === 0) ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>
              {isTradeOrMaintenance 
                ? t("projectOverview.noTasksProject")
                : (t("projectOverview.noPhases") || "Projekt nemá žiadne fázy ani úlohy.")}
            </Text>
            <Text style={styles.emptySubtext}>
              {isTradeOrMaintenance 
                ? t("projectOverview.noTasksHint")
                : (t("projectOverview.addPhaseHint") || "Môžeš pridať fázy a úlohy neskôr.")}
            </Text>
            {access.canWrite && !isTradeOrMaintenance && !templateId && (projectType === 'MANAGEMENT' || projectType === 'BUILD') && (access.canReadPhases || access.canReadTasks) && (
              <TouchableOpacity
                style={styles.addTemplateButton}
                onPress={() => setShowNewPhaseModal(true)}
              >
                <Ionicons name="add-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.addTemplateButtonText}>{t("projectOverview.createPhase")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : isTradeOrMaintenance ? (
          // For TRADE/MAINTENANCE: show tasks without phases (flat list)
          <>
            {(projectType === 'MAINTENANCE' ? displayTasksForMaintenance : tasks).filter(t => !t.phaseId).map((task) => (
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
                    color={task.status === "DONE" ? DONE_COLOR : colors.textMuted}
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
                  {(task.subtasks?.length ?? 0) > 0 && (
                    <Text style={styles.taskSubtaskProgress}>
                      {(task.subtasks?.filter((s) => s.done).length ?? 0)}/{(task.subtasks?.length ?? 0)}
                    </Text>
                  )}
                  {projectType === 'MAINTENANCE' && task.equipmentId && (() => {
                    const eq = equipmentMap.get(task.equipmentId);
                    return eq ? (
                      <Text style={[styles.taskEquipmentLabel, task.status === "DONE" && styles.taskEquipmentLabelDone]} numberOfLines={1}>
                        {eq.labelCode || eq.name || ''}
                      </Text>
                    ) : null;
                  })()}
                  {task.dueDate && (
                    <Text style={[styles.taskDueDate, task.status === "DONE" && styles.taskDueDateDone]}>
                      <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
              {isOwner ? (
                <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.colAssignee, styles.assigneeCell]}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                </View>
              )}
              {isOwner ? (
                <>
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
                </>
              ) : null}
              </View>
            ))}
          </>
        ) : phases.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.empty}>{t("projectOverview.noPhases") || "Projekt nemá žiadne fázy."}</Text>
            <Text style={styles.emptySubtext}>{t("projectOverview.addPhaseHint") || "Môžeš pridať fázy neskôr."}</Text>
            {isOwner && (projectType === 'BUILD' || (projectType === 'MANAGEMENT' && !templateId)) && (
              <>
                <TouchableOpacity
                  style={styles.addTemplateButton}
                  onPress={() => setShowNewPhaseModal(true)}
                >
                  <Ionicons name="add-circle" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.addTemplateButtonText}>{t("projectOverview.createPhase")}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <>
            {/* Add phase button - for MANAGEMENT projects created from scratch */}
            {isOwner && (projectType === 'BUILD' || (projectType === 'MANAGEMENT' && !templateId)) && (
              <TouchableOpacity
                style={styles.addPhaseButton}
                onPress={() => setShowNewPhaseModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.addPhaseButtonText}>{t("projectOverview.addPhase")}</Text>
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
                          expandedPhasesRef.current = newExpanded;
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
                        {(() => {
                          const phaseComplete = phaseTasks.length > 0 && phaseTasks.every((t) => t.status === "DONE");
                          return (
                            <>
                              <Text style={[styles.phaseTitle, phaseComplete && styles.phaseTitleDone]}>
                                {phase.name}
                              </Text>
                              {phaseTasks.length > 0 && (
                                <Text style={[styles.phaseTaskCount, phaseComplete && styles.phaseTaskCountDone]}>
                                  ({phaseTasks.length})
                                </Text>
                              )}
                            </>
                          );
                        })()}
                      </TouchableOpacity>
                      {isOwner ? (
                        <View style={styles.phaseActions}>
                          <TouchableOpacity
                            style={styles.phaseActionButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              sharePhase(phase);
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Ionicons name="share-outline" size={18} color={colors.primary} />
                          </TouchableOpacity>
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
                      ) : null}
                    </View>
                    {expanded && (
                      <>
                        {/* Add task button for this phase */}
                        {access.canWrite && (access.sharedItems.tasks || access.sharedItems.phases) ? (
                          <TouchableOpacity 
                            style={styles.addTaskToPhaseButton}
                            onPress={() => openNewTaskModal(phaseKey)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="add-circle-outline" size={18} color={colors.primary} style={{ marginRight: 6 }} />
                            <Text style={styles.addTaskToPhaseText}>{t("projectOverview.addTaskToPhase") || "Pridať úlohu"}</Text>
                          </TouchableOpacity>
                        ) : null}
                        
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
                                    color={task.status === "DONE" ? DONE_COLOR : colors.textMuted}
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
                                  {(task.subtasks?.length ?? 0) > 0 && (
                                    <Text style={styles.taskSubtaskProgress}>
                                      {(task.subtasks?.filter((s) => s.done).length ?? 0)}/{(task.subtasks?.length ?? 0)}
                                    </Text>
                                  )}
                                  {task.dueDate && (
                                    <Text style={[styles.taskDueDate, task.status === "DONE" && styles.taskDueDateDone]}>
                                      <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                              {isOwner ? (
                                <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                                  <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={[styles.colAssignee, styles.assigneeCell]}>
                                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                                  <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                                </View>
                              )}
                              {isOwner ? (
                                <>
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
                                </>
                              ) : null}
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
                  <Text style={styles.phaseTitle}>{t("projectOverview.tasksWithoutPhase")}</Text>
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
                            color={task.status === "DONE" ? DONE_COLOR : colors.textMuted}
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
                          {(task.subtasks?.length ?? 0) > 0 && (
                            <Text style={styles.taskSubtaskProgress}>
                              {(task.subtasks?.filter((s) => s.done).length ?? 0)}/{(task.subtasks?.length ?? 0)}
                            </Text>
                          )}
                          {task.dueDate && (
                            <Text style={[styles.taskDueDate, task.status === "DONE" && styles.taskDueDateDone]}>
                              <Ionicons name="calendar-outline" size={12} color={colors.textMuted} /> {task.dueDate}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                      {isOwner ? (
                        <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.colAssignee, styles.assigneeCell]}>
                          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.assigneeText} numberOfLines={1}>{task.assigneeName ?? t("projectOverview.unassigned")}</Text>
                        </View>
                      )}
                      {isOwner ? (
                        <>
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
                        </>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
          </>
          )}
          </ScrollView>
        </View>
        )}

        {/* Expenses Section - only show if user can read expenses */}
        {!access.loading && access.canReadExpenses && (
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
            <Text style={styles.expensesHeaderText}>{t("projectOverview.expenses")}</Text>
            <Text style={styles.expensesCount}>({expenses.length})</Text>
          </View>
          {access.canWrite && access.sharedItems?.expenses === true && (
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === "ios") {
                ActionSheetIOS.showActionSheetWithOptions(
                  {
                    options: [t("common.cancel"), "Normálny výdavok", "Cestovné (A→B)"],
                    cancelButtonIndex: 0,
                  },
                  (i) => {
                    if (i === 1) openExpenseModal();
                    if (i === 2) openExpenseModal(undefined, "TRAVEL");
                  }
                );
              } else {
                Alert.alert(
                  t("projectOverview.expenses"),
                  undefined,
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: "Normálny výdavok", onPress: () => openExpenseModal() },
                    { text: "Cestovné (A→B)", onPress: () => openExpenseModal(undefined, "TRAVEL") },
                  ]
                );
              }
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="add-circle" size={24} color={colors.primary} />
          </TouchableOpacity>
          )}
        </TouchableOpacity>

        {expandedExpenses && (
          <View style={styles.expensesList}>
            {expenses.length === 0 ? (
              <Text style={styles.emptyExpenses}>{t("projectOverview.noExpenses")}</Text>
            ) : (
              expenses.map((expense) => {
                const isTravel = expense.category === "TRAVEL" && expense.travel;
                const displayTitle = isTravel
                  ? `Cestovné: ${expense.travel!.fromAddress} → ${expense.travel!.toAddress}`
                  : expense.title;
                const effectiveKm = isTravel
                  ? (expense.travel!.roundTrip ? expense.travel!.distanceKm * 2 : expense.travel!.distanceKm)
                  : null;
                const travelSubtitle = isTravel && effectiveKm != null
                  ? `${effectiveKm} km × ${expense.travel!.ratePerKm} €/km`
                  : null;
                return (
                <View key={expense.id} style={styles.expenseRow}>
                  <View style={styles.expenseInfo}>
                    <Text style={styles.expenseTitle}>{displayTitle}</Text>
                    {travelSubtitle ? (
                      <Text style={styles.expenseNote} numberOfLines={1}>{travelSubtitle}</Text>
                    ) : null}
                    <View style={styles.expenseMeta}>
                      <Text style={styles.expenseDate}>{formatDate(expense.date)}</Text>
                      <Text style={styles.expenseAmount}>{formatAmount(expense.amount, expense.currency)}</Text>
                    </View>
                    {expense.note && !isTravel && (
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
                    {access.canWrite && access.sharedItems?.expenses === true && (
                    <>
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
                    </>
                    )}
                  </View>
                </View>
              );
              })
            )}
          </View>
        )}
      </View>
        )}

        {/* Construction Diary Section - only show if user can read diary */}
        {!access.loading && supportsDiary && access.canReadDiary && (
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
                {(projectType === 'MANAGEMENT' || isTradeOrMaintenance) ? 'Denník' : 'Stavebný denník'}
              </Text>
              <Text style={styles.expensesCount}>({diaryEntries.length})</Text>
            </View>
            {access.canWrite && access.sharedItems?.diary === true && (
            <TouchableOpacity
              onPress={() => openNewDiaryModal("text")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add-circle" size={24} color={colors.primary} />
            </TouchableOpacity>
            )}
          </TouchableOpacity>

          {expandedDiary && (
            <View style={styles.expensesList}>
              {diaryEntries.length === 0 ? (
                <Text style={styles.emptyExpenses}>{t("projectOverview.noDiaryEntries") || "Žiadne zápisy do denníka"}</Text>
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
                        <Text style={styles.expenseDate}>{t("projectOverview.weather")}: {entry.weather}</Text>
                      )}
                      {entry.workers && (
                        <Text style={styles.expenseDate}>{t("projectOverview.workers")}: {entry.workers}</Text>
                      )}
                    </View>
                    <View style={styles.expenseActions}>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => shareDiaryEntry(entry)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="share-outline" size={20} color={colors.primary} />
                      </TouchableOpacity>
                      {access.canWrite && access.sharedItems?.diary === true && (
                      <>
                      <TouchableOpacity
                        style={styles.expenseActionButton}
                        onPress={() => {
                          setEditingDiaryEntry(entry);
                          setDiaryDate(entry.date.split('T')[0]);
                          setDiaryWeather(entry.weather || "");
                          setDiaryWorkers(entry.workers || "");
                          setDiaryWorkDescription(entry.workDescription || "");
                          setDiaryWorkDescriptionMode('text');
                          setDiaryWorkDescriptionRecordingUri(null);
                          setDiaryWorkDescriptionIsRecording(false);
                          setDiaryWorkDescriptionRecording(null);
                          setDiaryMaterials(entry.materials || "");
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
                            t("projectOverview.deleteDiaryEntry"),
                            t("projectOverview.deleteDiaryEntryConfirmMessage", { date: formatDate(entry.date) }),
                            [
                              { text: t("common.cancel"), style: 'cancel' },
                              {
                                text: t("common.delete"),
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
                      </>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
            )}
          </View>
        )}

        {/* Project Documents Section - For BUILD and MANAGEMENT projects, only if can read documents */}
        {!access.loading && (projectType === 'BUILD' || projectType === 'MANAGEMENT') && access.canReadDocuments && (
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
              <Text style={styles.expensesHeaderText}>{t("projectOverview.projectDocuments")}</Text>
              <Text style={styles.expensesCount}>({projectDocuments.length})</Text>
            </View>
            {access.canWrite && access.sharedItems?.documents === true && (
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
            )}
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
                            Alert.alert(t("common.error"), t("projectOverview.failedToOpenDocument"));
                          }
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      {access.canWrite && access.sharedItems?.documents === true && (
                      <>
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
                            t("projectOverview.deleteDocument"),
                            t("projectOverview.deleteDocumentConfirmMessage", { name: doc.name || "" }),
                            [
                              { text: t("common.cancel"), style: 'cancel' },
                              {
                                text: t("common.delete"),
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
                      </>
                      )}
                    </View>
                  </View>
                ))
              )}
              </View>
            )}
          </View>
        )}

        <View style={styles.activityCard}>
          <TouchableOpacity
            style={styles.activityHeader}
            onPress={() => setActivityExpanded((prev) => !prev)}
            activeOpacity={0.7}
          >
            <Text style={styles.activityTitle}>{t("home.recentActivity") || "Activity"}</Text>
            <View style={styles.activityHeaderRight}>
              {activityLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Text style={styles.activityCount}>{activityEvents.length}</Text>
                  <Ionicons
                    name={activityExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.textMuted}
                  />
                </>
              )}
            </View>
          </TouchableOpacity>

          {activityEvents.length === 0 && !activityLoading ? (
            <Text style={styles.activityEmpty}>{t("home.noRecentActivity")}</Text>
          ) : (
            (activityExpanded ? activityEvents.slice(0, 4) : activityEvents.slice(0, 1)).map((event) => (
              <View key={event.id} style={styles.activityRow}>
                <Text style={styles.activitySummary} numberOfLines={1}>{formatEventSummary(t, event)}</Text>
                <Text style={styles.activityTime}>{formatActivityAge(event.createdAt)}</Text>
              </View>
            ))
          )}
          {!activityExpanded && activityEvents.length > 1 ? (
            <TouchableOpacity
              onPress={() => setActivityExpanded(true)}
              style={styles.activityViewAll}
              activeOpacity={0.7}
            >
              <Text style={styles.activityViewAllText}>{t("projectOverview.viewAll") || "Zobraziť všetko"}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      {/* Bottom: List toggle + FAB/Button for new task */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity style={styles.listBtn}>
          <Ionicons name="swap-vertical" size={20} color={colors.textOnDark} style={{ marginRight: 6 }} />
          <Text style={styles.listBtnText}>{t("projectOverview.viewList")}</Text>
        </TouchableOpacity>
        {access.canWrite && (access.sharedItems.tasks || access.sharedItems.phases) ? (
          isTradeOrMaintenance ? (
            // For TRADE/RESIDENTIAL: text button; MAINTENANCE shows action menu (úloha + zariadenie + servisný plán)
            projectType === 'MAINTENANCE' ? (
              <TouchableOpacity
                style={styles.addTaskButton}
                onPress={() => {
                  if (Platform.OS === 'ios' && ActionSheetIOS) {
                    ActionSheetIOS.showActionSheetWithOptions(
                      {
                        options: ['Zrušiť', 'Pridať úlohu', 'Pridať zariadenie', 'Pridať servisný plán'],
                        cancelButtonIndex: 0,
                      },
                      (idx) => {
                        if (idx === 1) openNewTaskModal();
                        else if (idx === 2) (navigation as any).navigate('EquipmentList', { projectId, projectName });
                        else if (idx === 3) (navigation as any).navigate('EquipmentList', { projectId, projectName, openServiceRule: true });
                      }
                    );
                  } else {
                    Alert.alert(
                      'Pridať',
                      '',
                      [
                        { text: 'Zrušiť', style: 'cancel' },
                        { text: 'Pridať úlohu', onPress: () => openNewTaskModal() },
                        { text: 'Pridať zariadenie', onPress: () => (navigation as any).navigate('EquipmentList', { projectId, projectName }) },
                        { text: 'Pridať servisný plán', onPress: () => (navigation as any).navigate('EquipmentList', { projectId, projectName, openServiceRule: true }) },
                      ]
                    );
                  }
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.addTaskButtonText}>{t("projectOverview.addTask") || "Pridať úlohu"}</Text>
                <Ionicons name="chevron-down" size={16} color="#FFFFFF" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity 
                style={styles.addTaskButton} 
                onPress={() => openNewTaskModal()}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.addTaskButtonText}>{t("projectOverview.addTask") || "Pridať úlohu"}</Text>
              </TouchableOpacity>
            )
          ) : (
            // For BUILD: FAB
            <TouchableOpacity style={styles.fab} onPress={() => openNewTaskModal()}>
              <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>
          )
        ) : null}
      </View>

      <Modal
        visible={showAssigneeModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowAssigneeModal(false);
          setAssigneeTask(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projectOverview.assignee") || "Pridelený"}</Text>
            <Text style={styles.assigneePickerSubtitle}>Vyber člena projektu</Text>
            <ScrollView style={styles.assigneePickerList} contentContainerStyle={styles.assigneePickerListContent}>
              {assigneeCandidates.map((candidate) => {
                const isSelected =
                  candidate.assigneeId !== null
                    ? assigneeTask?.assigneeId === candidate.assigneeId
                    : (assigneeTask?.assigneeId ?? null) === null &&
                      (assigneeTask?.assigneeName ?? null) === candidate.assigneeName;
                return (
                  <TouchableOpacity
                    key={candidate.key}
                    style={[styles.assigneePickerRow, isSelected && styles.assigneePickerRowActive]}
                    onPress={() => applyAssigneeSelection(candidate)}
                  >
                    <Text style={[styles.assigneePickerLabel, isSelected && styles.assigneePickerLabelActive]}>
                      {candidate.label}
                    </Text>
                    {isSelected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowAssigneeModal(false);
                  setAssigneeTask(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit project modal */}
      <Modal visible={showEditModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Upraviť projekt</Text>
            <TextInput
              style={styles.input}
              value={editProjectName}
              onChangeText={setEditProjectName}
              placeholder={t("projectOverview.projectNamePlaceholder")}
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.input}
              value={editProjectAddress}
              onChangeText={setEditProjectAddress}
              placeholder="Adresa projektu"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => {
                  setShowEditModal(false);
                  setEditProjectName("");
                  setEditProjectAddress("");
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveEdit} 
                disabled={!editProjectName.trim()}
              >
                <Text style={styles.modalOkText}>{t("common.save")}</Text>
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
              {editingExpense ? t("expense.edit") || 'Upraviť výdavok' : t("expense.add")}
            </Text>
            {/* Expense Attachment Section (top-first for OCR flow) */}
            <View style={styles.expenseAttachmentSection}>
              <Text style={styles.expenseAttachmentLabel}>{t("expense.invoice")}</Text>
              <Text style={styles.expenseAttachmentHint}>{t("expense.invoiceHint")}</Text>
              <View style={styles.expenseAttachmentButtons}>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickExpenseImage}
                  disabled={uploadingExpenseAttachment || submitting}
                >
                  <Ionicons name="image-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>{t("expense.photo")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickExpenseDocument}
                  disabled={uploadingExpenseAttachment || submitting}
                >
                  <Ionicons name="document-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>{t("expense.pdf")}</Text>
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
                    onPress={() => {
                      setExpenseAttachment(null);
                      setExpensePreuploadedAttachment(null);
                      setExpenseOcrStatus(null);
                    }}
                    style={styles.expenseAttachmentRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              {uploadingExpenseAttachment && (
                <View style={styles.expenseAttachmentUploading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || 'Nahrava sa...'}</Text>
                </View>
              )}
            </View>

            {/* Amount */}
            <View style={styles.expenseAmountRow}>
              <TextInput
                style={[styles.input, styles.expenseAmountInput]}
                value={expenseAmount}
                onChangeText={handleAmountChange}
                placeholder={t("projectOverview.expenseAmountPlaceholder")}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <Text style={styles.expenseCurrencyLabel}>EUR</Text>
            </View>

            {/* Category - identical function to Home */}
            <View style={styles.expenseCategorySection}>
              <Text style={styles.expenseCategoryLabel}>{t("expense.type")}</Text>
              <Text style={styles.expenseCategoryHint}>{t("expense.categoryHint")}</Text>
              <View style={styles.expenseCategoryButtons}>
                <TouchableOpacity
                  style={[
                    styles.expenseCategoryButton,
                    expenseCategory === 'WORK' && styles.expenseCategoryButtonActive,
                  ]}
                  onPress={() => setExpenseCategory('WORK')}
                >
                  {expenseCategory === "WORK" ? (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseCategoryButtonText,
                      expenseCategory === 'WORK' && styles.expenseCategoryButtonTextActive,
                    ]}
                  >
                    {t("expense.typeWork")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.expenseCategoryButton,
                    expenseCategory === 'MATERIAL' && styles.expenseCategoryButtonActive,
                  ]}
                  onPress={() => setExpenseCategory('MATERIAL')}
                >
                  {expenseCategory === "MATERIAL" ? (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseCategoryButtonText,
                      expenseCategory === 'MATERIAL' && styles.expenseCategoryButtonTextActive,
                    ]}
                  >
                    {t("expense.typeMaterial")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.expenseCategoryButton,
                    expenseCategory === 'OTHER' && styles.expenseCategoryButtonActive,
                  ]}
                  onPress={() => setExpenseCategory('OTHER')}
                >
                  {expenseCategory === "OTHER" ? (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseCategoryButtonText,
                      expenseCategory === 'OTHER' && styles.expenseCategoryButtonTextActive,
                    ]}
                  >
                    {t("expense.typeWorkMaterial")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.expenseCategoryButton,
                    expenseCategory === 'TRAVEL' && styles.expenseCategoryButtonActive,
                  ]}
                  onPress={() => setExpenseCategory('TRAVEL')}
                >
                  {expenseCategory === "TRAVEL" ? (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseCategoryButtonText,
                      expenseCategory === 'TRAVEL' && styles.expenseCategoryButtonTextActive,
                    ]}
                  >
                    Cestovné (A→B)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {expenseCategory === 'TRAVEL' && (
              <View style={styles.travelFormSection}>
                <Text style={styles.travelFormLabel}>Adresa A (odkiaľ)</Text>
                <TextInput
                  style={styles.input}
                  value={expenseTravelFromAddress}
                  onChangeText={setExpenseTravelFromAddress}
                  placeholder="napr. Žilina"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.travelFormLabel}>Adresa B (kam)</Text>
                <TextInput
                  style={styles.input}
                  value={expenseTravelToAddress}
                  onChangeText={setExpenseTravelToAddress}
                  placeholder="napr. Bratislava"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.travelDistanceRow}>
                  <View style={styles.travelDistanceInputWrap}>
                    <Text style={styles.travelFormLabel}>Vzdialenosť (km)</Text>
                    <TextInput
                      style={styles.input}
                      value={expenseTravelDistanceKm}
                      onChangeText={(t) => {
                        setExpenseTravelDistanceKm(t.replace(/[^\d.,]/g, '').replace(',', '.'));
                      }}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.calculateKmButton,
                      (!isOnline || !expenseTravelFromAddress.trim() || !expenseTravelToAddress.trim() || isLoadingDistance) && styles.calculateKmButtonDisabled,
                    ]}
                    onPress={handleCalculateDistanceKm}
                    disabled={!isOnline || !expenseTravelFromAddress.trim() || !expenseTravelToAddress.trim() || isLoadingDistance}
                  >
                    {isLoadingDistance ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.calculateKmButtonText}>Vypočítať km</Text>
                    )}
                  </TouchableOpacity>
                </View>
                <View style={styles.travelRateRow}>
                  <Text style={styles.travelFormLabel}>Sadzba (€/km)</Text>
                  <TextInput
                    style={[styles.input, styles.travelRateInput]}
                    value={expenseTravelRatePerKm}
                    onChangeText={(t) => setExpenseTravelRatePerKm(t.replace(/[^\d.,]/g, '').replace(',', '.'))}
                    placeholder="0.20"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <TouchableOpacity
                  style={styles.travelRoundTripRow}
                  onPress={() => setExpenseTravelRoundTrip((v) => !v)}
                >
                  <Ionicons name={expenseTravelRoundTrip ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
                  <Text style={styles.travelRoundTripText}>Tam a späť</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Supplier */}
            <TextInput
              style={styles.input}
              value={expenseSupplierName}
              onChangeText={setExpenseSupplierName}
              placeholder={t("expense.supplierName")}
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={expenseSupplierIco}
              onChangeText={setExpenseSupplierIco}
              placeholder={t("expense.supplierTaxId")}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />

            <TextInput
              style={styles.input}
              value={expenseTitle}
              onChangeText={setExpenseTitle}
              placeholder={t("projectOverview.expenseTitlePlaceholder")}
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.input}
              value={expenseDate}
              onChangeText={setExpenseDate}
              placeholder={t("projectOverview.expenseDatePlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              value={expenseNote}
              onChangeText={setExpenseNote}
              placeholder={t("projectOverview.expenseNotePlaceholder")}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />
            
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
                  setExpenseCategory(undefined);
                  setExpensePhaseId(null);
                  setExpenseSupplierIco("");
                  setExpenseSupplierName("");
                  setExpenseAttachment(null);
                  setExpensePreuploadedAttachment(null);
                  setExpenseTravelFromAddress("");
                  setExpenseTravelToAddress("");
                  setExpenseTravelDistanceKm("");
                  setExpenseTravelRatePerKm("0.30");
                  setExpenseTravelRoundTrip(false);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalOk,
                  (expenseCategory === "TRAVEL"
                    ? (!expenseTravelFromAddress.trim() || !expenseTravelToAddress.trim() || !expenseTravelDistanceKm.trim() || !Number.isFinite(parseFloat(expenseTravelDistanceKm.replace(",", "."))) || parseFloat(expenseTravelDistanceKm.replace(",", ".")) <= 0)
                    : (!expenseTitle.trim() && !(expenseAttachment?.kind === "image" && !editingExpense))
                    || submitting
                    || uploadingExpenseAttachment
                    || ocrLoading
                  ) && styles.modalOkDisabled,
                ]} 
                onPress={handleSaveExpense} 
                disabled={
                  (expenseCategory === "TRAVEL"
                    ? !expenseTravelFromAddress.trim() || !expenseTravelToAddress.trim() || !expenseTravelDistanceKm.trim() || !Number.isFinite(parseFloat(expenseTravelDistanceKm.replace(",", "."))) || parseFloat(expenseTravelDistanceKm.replace(",", ".")) <= 0
                    : (!expenseTitle.trim() && !(expenseAttachment?.kind === "image" && !editingExpense)))
                  || submitting
                  || uploadingExpenseAttachment
                  || ocrLoading
                }
              >
                <Text style={styles.modalOkText}>
                  {submitting ? t("common.saving") : (editingExpense ? t("common.save") : t("common.add"))}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* OCR loading */}
      <Modal visible={ocrLoading} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.ocrModal}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.ocrText}>{t("expense.ocrProcessing")}</Text>
            <TouchableOpacity style={styles.ocrCancelButton} onPress={handleOcrCancel}>
              <Text style={styles.ocrCancelText}>{t("expense.proceedManually")}</Text>
            </TouchableOpacity>
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
                <Text style={styles.uploadingText}>{t("common.uploading") || 'Nahráva sa...'}</Text>
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
                    t("common.error"), 
                    t("projectOverview.failedToLoadImage") || 'Nepodarilo sa načítať obrázok.\n\nSkontrolujte:\n- Storage rules\n- Oprávnenia\n- Sieťové pripojenie'
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
            <Text style={styles.modalTitle}>{t("projectOverview.editTask") || 'Upraviť úlohu'}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text }]}
              value={editTaskTitle}
              onChangeText={setEditTaskTitle}
              placeholder={t("projectOverview.taskTitlePlaceholder")}
              placeholderTextColor="#000000"
              autoFocus
            />
            <Text style={styles.modalLabel}>{t("projectOverview.plannedDueDate") || 'Plánovaný termín ukončenia (voliteľné)'}</Text>
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
                        <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
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
                          Alert.alert(t("common.error"), t("projectOverview.failedToStopRecording", { error: error.message || t("common.unknown") }));
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
                      <Text style={styles.recordingInfo}>{t("projectOverview.recordingReady")}</Text>
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
                        Alert.alert(t("common.error"), t("projectOverview.voiceRecordingNotAvailable"));
                        return;
                      }
                      
                      try {
                        // Request permissions
                        const { status } = await AudioModule.Audio.requestPermissionsAsync();
                        if (status !== 'granted') {
                          Alert.alert(t("common.error"), t("projectOverview.audioPermissionRequired"));
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
                        Alert.alert(t("common.error"), t("projectOverview.failedToStartRecording", { error: error.message || t("common.unknown") }));
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
            
            <Text style={styles.modalLabel}>{t("projectOverview.plannedDueDate") || 'Plánovaný termín ukončenia (voliteľné)'}</Text>
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
              style={styles.input}
              value={diaryDate}
              onChangeText={setDiaryDate}
              placeholder={t("projectOverview.diaryDatePlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={diaryWeather}
              onChangeText={setDiaryWeather}
              placeholder="Počasie"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={diaryWorkers}
              onChangeText={setDiaryWorkers}
              placeholder="Pracovníci"
              placeholderTextColor={colors.textMuted}
            />
            {/* Work Description Input Mode Selector */}
            <Text style={styles.modalLabel}>Popis práce *:</Text>
            <View style={styles.inputOptionContainer}>
              <TouchableOpacity
                style={[styles.inputOptionButton, diaryWorkDescriptionMode === 'text' && styles.inputOptionButtonActive]}
                onPress={() => {
                  setDiaryWorkDescriptionMode('text');
                  if (diaryWorkDescriptionRecording) {
                    try {
                      diaryWorkDescriptionRecording.stopAndUnloadAsync();
                    } catch (e) {
                      // Ignore
                    }
                  }
                  setDiaryWorkDescriptionRecordingUri(null);
                  setDiaryWorkDescriptionIsRecording(false);
                  setDiaryWorkDescriptionRecording(null);
                }}
              >
                <Ionicons name="create-outline" size={24} color={diaryWorkDescriptionMode === 'text' ? colors.primary : colors.textMuted} />
                <Text style={[styles.inputOptionText, diaryWorkDescriptionMode === 'text' && styles.inputOptionTextActive]}>
                  Písať text
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.inputOptionButton, diaryWorkDescriptionMode === 'voice' && styles.inputOptionButtonActive]}
                onPress={() => {
                  setDiaryWorkDescriptionMode('voice');
                  setDiaryWorkDescription('');
                }}
              >
                <Ionicons name="mic" size={24} color={diaryWorkDescriptionMode === 'voice' ? colors.primary : colors.textMuted} />
                <Text style={[styles.inputOptionText, diaryWorkDescriptionMode === 'voice' && styles.inputOptionTextActive]}>
                  Nahrávať hlas
                </Text>
              </TouchableOpacity>
            </View>

            {diaryWorkDescriptionMode === 'voice' ? (
              <View style={styles.voiceRecordingContainer}>
                {diaryWorkDescriptionIsRecording ? (
                  <>
                    <View style={styles.recordingIndicator}>
                      <View style={styles.recordingDot} />
                      <Text style={styles.recordingText}>Nahrávam...</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.stopRecordingButton}
                      onPress={async () => {
                        if (!diaryWorkDescriptionRecording) return;
                        
                        try {
                          console.log('[ProjectOverview] Stopping diary work description recording...');
                          await diaryWorkDescriptionRecording.stopAndUnloadAsync();
                          const uri = diaryWorkDescriptionRecording.getURI();
                          console.log('[ProjectOverview] Diary work description recording stopped, URI:', uri);
                          
                          setDiaryWorkDescriptionRecordingUri(uri);
                          setDiaryWorkDescriptionIsRecording(false);
                          setDiaryWorkDescriptionRecording(null);
                        } catch (error: any) {
                          console.error('[ProjectOverview] Error stopping diary work description recording:', error);
                          Alert.alert(t("common.error"), t("projectOverview.failedToStopRecording", { error: error.message || t("common.unknown") }));
                        }
                      }}
                    >
                      <Ionicons name="stop-circle" size={48} color="#FF3B30" />
                      <Text style={styles.stopRecordingText}>Zastaviť nahrávanie</Text>
                    </TouchableOpacity>
                  </>
                ) : diaryWorkDescriptionRecordingUri ? (
                  <>
                    <View style={styles.recordingPlayback}>
                      <Ionicons name="play-circle" size={48} color={colors.primary} />
                      <Text style={styles.recordingInfo}>{t("projectOverview.recordingReady")}</Text>
                      <View style={styles.recordingActions}>
                        <TouchableOpacity
                          style={styles.convertToTextButton}
                          onPress={async () => {
                            if (!diaryWorkDescriptionRecordingUri) return;
                            
                            try {
                              // TODO: Implement speech-to-text conversion
                              // This would require a backend API or service like Google Speech-to-Text
                              // For now, show a placeholder message
                              Alert.alert(
                                'Konverzia na text',
                                'Konverzia hlasu na text bude dostupná v budúcej verzii. Pre teraz môžete použiť hlasovú správu alebo prepnúť na textový režim.',
                                [
                                  {
                                    text: 'Prepnut na text',
                                    onPress: () => {
                                      setDiaryWorkDescriptionMode('text');
                                      setDiaryWorkDescriptionRecordingUri(null);
                                    },
                                  },
                                  { text: t("common.ok") },
                                ]
                              );
                            } catch (error: any) {
                              console.error('[ProjectOverview] Error converting speech to text:', error);
                              Alert.alert(t("common.error"), t("projectOverview.failedToConvertSpeech"));
                            }
                          }}
                        >
                          <Ionicons name="text-outline" size={20} color={colors.primary} />
                          <Text style={styles.convertToTextText}>{t("projectOverview.convertToText")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.rerecordButton}
                          onPress={async () => {
                            if (diaryWorkDescriptionRecording) {
                              try {
                                await diaryWorkDescriptionRecording.stopAndUnloadAsync();
                              } catch (e) {
                                // Ignore errors when stopping
                              }
                            }
                            setDiaryWorkDescriptionRecordingUri(null);
                            setDiaryWorkDescriptionIsRecording(false);
                            setDiaryWorkDescriptionRecording(null);
                          }}
                        >
                          <Text style={styles.rerecordText}>Nahrať znova</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.startRecordingButton}
                    onPress={async () => {
                      if (!AudioModule) {
                        Alert.alert(t("common.error"), t("projectOverview.voiceRecordingNotAvailable"));
                        return;
                      }
                      
                      try {
                        // Request permissions
                        const { status } = await AudioModule.Audio.requestPermissionsAsync();
                        if (status !== 'granted') {
                          Alert.alert(t("common.error"), t("projectOverview.audioPermissionRequired"));
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
                        
                        setDiaryWorkDescriptionRecording(newRecording);
                        setDiaryWorkDescriptionIsRecording(true);
                        console.log('[ProjectOverview] Diary work description recording started');
                      } catch (error: any) {
                        console.error('[ProjectOverview] Error starting diary work description recording:', error);
                        Alert.alert(t("common.error"), t("projectOverview.failedToStartRecording", { error: error.message || t("common.unknown") }));
                      }
                    }}
                  >
                    <Ionicons name="mic-circle" size={64} color={colors.primary} />
                    <Text style={styles.startRecordingText}>Začať nahrávanie</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.textInputContainer}>
                <View style={styles.textInputIconContainer}>
                  <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                </View>
                <TextInput
                  style={[styles.input, styles.textArea, styles.textInputWithIcon]}
                  value={diaryWorkDescription}
                  onChangeText={setDiaryWorkDescription}
                  placeholder="Popis práce *"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                />
              </View>
            )}
            <TextInput
              style={styles.input}
              value={diaryMaterials}
              onChangeText={setDiaryMaterials}
              placeholder="Materiály"
              placeholderTextColor={colors.textMuted}
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
                  <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || 'Nahráva sa...'}</Text>
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
                  setDiaryWorkDescriptionMode('text');
                  setDiaryWorkDescriptionRecordingUri(null);
                  setDiaryWorkDescriptionIsRecording(false);
                  setDiaryWorkDescriptionRecording(null);
                  setDiaryMaterials("");
                  setDiaryPhaseId(null);
                  setDiaryAttachment(null);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveDiaryEntry} 
                disabled={
                  submitting || 
                  (diaryWorkDescriptionMode === 'text' && !diaryWorkDescription.trim()) ||
                  (diaryWorkDescriptionMode === 'voice' && !diaryWorkDescriptionRecordingUri)
                }
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
              style={styles.input}
              value={documentName}
              onChangeText={setDocumentName}
              placeholder={t("projectOverview.documentNamePlaceholder")}
              placeholderTextColor={colors.textMuted}
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
              style={[styles.input, styles.textArea]}
              value={documentDescription}
              onChangeText={setDocumentDescription}
              placeholder="Popis (voliteľné)"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
            />
            <View style={styles.phaseSelector}>
              <Text style={styles.phaseSelectorLabel}>Dokument sa pridá za projekt: {projectName}</Text>
            </View>
            {!editingDocument && (
              <View style={styles.expenseAttachmentSection}>
                <Text style={styles.expenseAttachmentLabel}>Súbor dokumentu *</Text>
                <View style={styles.expenseAttachmentButtons}>
                  <TouchableOpacity
                    style={[styles.expenseAttachmentButton, (uploadingDocumentAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                    onPress={pickDocumentFile}
                    disabled={uploadingDocumentAttachment || submitting}
                  >
                    <Ionicons name="document-outline" size={20} color={colors.text} />
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
                    <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || 'Nahráva sa...'}</Text>
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
            <Text style={styles.modalTitle}>{t("projectOverview.createPhaseTitle")}</Text>
            <TextInput
              style={styles.input}
              value={newPhaseName}
              onChangeText={setNewPhaseName}
              placeholder={t("projectOverview.phaseNamePlaceholder")}
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
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOk, (!newPhaseName.trim() || submitting) && styles.modalOkDisabled]}
                onPress={handleCreatePhase}
                disabled={!newPhaseName.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalOkText}>{t("common.create")}</Text>
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
            <Text style={styles.modalTitle}>{t("projectOverview.editPhaseTitle")}</Text>
            <TextInput
              style={styles.input}
              value={editPhaseName}
              onChangeText={setEditPhaseName}
              placeholder={t("projectOverview.phaseNamePlaceholder")}
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
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOk, (!editPhaseName.trim() || submitting) && styles.modalOkDisabled]}
                onPress={handleUpdatePhase}
                disabled={!editPhaseName.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalOkText}>{t("common.save")}</Text>
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
            <Text style={styles.modalTitle}>{t("projectOverview.moveTaskTitle")}</Text>
            {movingTask && (
              <Text style={styles.modalSubtitle}>"{movingTask.title}"</Text>
            )}
            <Text style={styles.modalLabel}>{t("projectOverview.selectPhaseLabel")}</Text>
            <ScrollView style={styles.phaseList}>
              <TouchableOpacity
                style={styles.phaseOption}
                onPress={() => handleMoveTaskToPhase(null)}
              >
                <Text style={styles.phaseOptionText}>{t("projectOverview.noPhaseOption")}</Text>
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
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
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
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  addressTopRow: {
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
    fontSize: 13,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  editAddressButton: {
    marginLeft: spacing.xs,
    padding: 2,
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius,
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  navigateButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  weatherDaysRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  weatherDayCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: "#f5f6f8",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    minHeight: 74,
  },
  weatherDayLabel: {
    fontSize: 11,
    color: "#232323",
    fontWeight: "700",
    marginBottom: 2,
  },
  weatherInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  weatherDayTemp: {
    fontSize: 12,
    color: "#232323",
    fontWeight: "700",
    marginTop: 0,
    marginBottom: 2,
  },
  weatherDayBadge: {
    marginTop: 2,
    width: 18,
    borderRadius: 999,
    minHeight: 4,
  },
  weatherErrorText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  activityCard: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 28,
  },
  activityHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  activityCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  activityRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  activitySummary: {
    color: colors.text,
    fontSize: 13,
  },
  activityTime: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 11,
  },
  activityEmpty: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
  },
  activityMore: {
    marginTop: 2,
    color: colors.textMuted,
  },
  activityViewAll: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 4,
  },
  activityViewAllText: {
    fontSize: 13,
    color: colors.primary,
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
  phaseTitleDone: { color: DONE_COLOR },
  phaseTaskCount: { fontSize: 12, color: colors.textMuted, marginLeft: spacing.xs },
  phaseTaskCountDone: { color: DONE_COLOR },
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
    textDecorationColor: DONE_COLOR,
    color: DONE_COLOR,
  },
  taskSubtaskProgress: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  taskDueDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",

  },
  taskDueDateDone: { color: DONE_COLOR },
  taskEquipmentLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  taskEquipmentLabelDone: { color: DONE_COLOR },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filterChipText: { fontSize: 13, color: colors.text },
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
  equipmentSection: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  equipmentSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  equipmentCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  equipmentCtaText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "500",
  },
  equipmentListRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  equipmentChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 160,
    gap: spacing.sm,
  },
  equipmentChipImage: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  equipmentChipText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: "500",
  },
  equipmentViewAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  equipmentViewAllText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
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
  inputOptionContainer: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  inputOptionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
    minHeight: 56,
  },
  inputOptionButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "15",
    borderWidth: 3,
  },
  inputOptionText: {
    fontSize: 15,
    color: colors.textMuted,
    fontWeight: "500",
  },
  inputOptionTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  textInputContainer: {
    position: "relative",
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  textInputIconContainer: {
    position: "absolute",
    left: spacing.md,
    top: spacing.md,
    zIndex: 1,
  },
  textInputWithIcon: {
    paddingLeft: spacing.lg + spacing.md + 4,
  },
  voiceRecordingContainer: {
    alignItems: "center",
    padding: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
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
  recordingActions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
    alignItems: "center",
  },
  convertToTextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  convertToTextText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "500",
  },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  ocrModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.sm,
  },
  ocrText: { color: colors.text, fontSize: 14, textAlign: "center" },
  ocrCancelButton: { marginTop: spacing.sm },
  ocrCancelText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  assigneePickerSubtitle: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  assigneePickerList: { maxHeight: 280, marginBottom: spacing.md },
  assigneePickerListContent: { gap: spacing.xs },
  assigneePickerRow: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  assigneePickerRowActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  assigneePickerLabel: { fontSize: 15, color: colors.text, fontWeight: "500" },
  assigneePickerLabelActive: { color: colors.primary, fontWeight: "700" },
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
  phasesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  phasesSectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  phasesSectionHeaderText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  phasesSectionCount: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: spacing.xs,
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
  expenseCategorySection: {
    marginBottom: spacing.md,
  },
  expenseCategoryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  expenseCategoryHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  expenseCategoryButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  expenseCategoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  expenseCategoryButtonActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  expenseCategoryButtonText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  expenseCategoryButtonTextActive: {
    color: colors.primary,
    fontWeight: "700",
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
    color: "#000000",
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
    color: "#000000",
    fontWeight: "500",
  },
  documentTypeButtonTextSelected: {
    color: "#000000",
    fontWeight: "600",
  },
});
