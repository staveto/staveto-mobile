import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  KeyboardAvoidingView,
  Dimensions,
  Switch,
} from "react-native";

// Conditional imports - only load if packages are installed
let ImagePicker: typeof import('expo-image-picker') | null = null;
let DocumentPicker: typeof import('expo-document-picker') | null = null;

try {
  ImagePicker = require('expo-image-picker');
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.warn('expo-image-picker or expo-document-picker not installed. Attachment features will be disabled.');
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
import { useCapabilities } from "../hooks/useCapabilities";
import { useProjectAccess, fetchProjectAccess } from "../hooks/useProjectAccess";
import type { SmartReadOptions } from "../services/firestoreSmartRead";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import { auth } from "../firebase";
import { updatePhase, deletePhase, createPhase } from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import * as constructionDiaryService from "../services/constructionDiary";
import * as projectDocumentsService from "../services/projectDocuments";
import {
  calculateMaterialTotals,
  listMaterialSuggestions,
  listProjectMaterials,
} from "../services/projectMaterials";
import * as problemsService from "../services/problems";
import * as projectEventsService from "../services/projectEvents";
import * as projectMembersService from "../services/projectMembers";
import * as projectCoverService from "../services/projectCover";
import * as equipmentService from "../services/equipment";
import * as serviceRulesService from "../services/serviceRules";
import * as weatherService from "../services/weather";
import {
  processInvoiceAttachment,
  type OcrParsed,
  type OcrResult,
  type OcrStatus,
} from "../services/invoiceProcessing";
import {
  buildExpenseDocumentPrefill,
  getConfidenceAwareExpensePrefill,
  prefillDebugPayload,
} from "../services/documentPrefill";
import type { InvoiceExtractionSource } from "../lib/invoiceTypes";
import {
  ExpenseLineItemsMaterialImportSheet,
  type ExpenseMaterialImportContext,
} from "../components/ExpenseLineItemsMaterialImportSheet";
import type { ParsedDocumentLineItem } from "../lib/parsedDocumentTypes";
import { calculateRouteDistanceKm } from "../services/mapsDistance";
import type { Locale } from "../i18n/translations";
import { EUROPEAN_COUNTRIES, buildAddressWithCountry, parseCountryFromAddress } from "../utils/europeanCountries";
import { COUNTRY_CODES, getDeviceRegionCode, getLocalizedCountryName } from "../utils/countries";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { exportProjectToCsv } from "../services/projectExport";
import { exportProjectAsProtocol } from "../services/projectProtocolExport";
import * as timeTracking from "../services/timeTracking";
import { postDebugIngest } from "../lib/debugIngest";
import { showTeamFeatureSoftGate } from "../lib/teamFeatureSoftGate";
import * as quickNotesService from "../services/quickNotes";
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
import Svg, { Circle, Path } from "react-native-svg";
import { colors, radius, spacing } from "../theme";
import { showToast } from "../helpers/toast";
import { openInMaps } from "../lib/maps";
import { ICON_HIT_SLOP } from "../utils/accessibility";
import { isFeatureEnabled } from "../services/features";
import { formatEventSummary } from "../helpers/formatEvent";
import type { ProjectEvent } from "../lib/types";
import type { ProjectWeatherSnapshot } from "../services/weather";
import { DescriptionInputModal } from "../components/DescriptionInputModal";
import {
  InAppAttachmentViewer,
  inferInAppViewerMode,
  isAttachmentImage,
  resolveInAppViewerMode,
} from "../components/InAppAttachmentViewer";
import { AppBottomMenu, getAppBottomMenuExtraPadding } from "../components/AppBottomMenu";
import { useIsInsideMainTabNavigator } from "../navigation/tabBarVisibility";
import { CurrencyDropdown } from "../components/CurrencyDropdown";
import { trackPaywallEvent, checkAndShowPaywall } from "../services/paywallTrigger";
import {
  isBuildLikeStorageType,
  isMaintenanceStorageType,
  projectOverviewLoadsDiary,
  projectOverviewLoadsDocuments,
  projectOverviewLoadsEquipmentAndServiceRules,
  projectOverviewIsTradeOrMaintenanceFlatTasks,
} from "../lib/projectTypeModel";

/** First paint: server-first + empty-cache retry (no parallel 28s forceServer timeouts). */
const PROJECT_DETAIL_LOAD_OPTS: SmartReadOptions = { preferCacheWhenPoor: false };
/** Pull-to-refresh / refocus: bypass stale cache. */
const PROJECT_DETAIL_REFRESH_OPTS: SmartReadOptions = {
  forceServer: true,
  preferCacheWhenPoor: false,
};

const DONE_COLOR = "#2e7d32";

/** Synthetic phase row id when tasks carry denormalized {@link TaskDoc.phaseTitle} but no phaseId. */
const PHASE_TITLE_GROUP_PREFIX = "phase_title:";
function phaseTitleGroupKey(title: string): string {
  return `${PHASE_TITLE_GROUP_PREFIX}${encodeURIComponent(title.trim())}`;
}
function parsePhaseTitleGroupKey(key: string): string | null {
  if (!key.startsWith(PHASE_TITLE_GROUP_PREFIX)) return null;
  try {
    return decodeURIComponent(key.slice(PHASE_TITLE_GROUP_PREFIX.length));
  } catch {
    return null;
  }
}

/** Foto faktúry alebo PDF – po výbere sa spustí automatické OCR */
function isExpenseOcrAttachmentKind(
  kind: "image" | "pdf" | "document" | undefined | null
): boolean {
  return kind === "image" || kind === "pdf";
}

function isEuropeanCountryCode(code: string | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  return c.length === 2 && EUROPEAN_COUNTRIES.some((x) => x.code === c);
}

/** Default country for travel A/B: project → device region → app locale → SK. */
function resolveTravelDefaultCountry(projectCountry: string | undefined, deviceRegion: string, appLocale: Locale): string {
  const pc = (projectCountry ?? "").trim().toUpperCase();
  if (isEuropeanCountryCode(pc)) return pc;
  const dr = (deviceRegion ?? "").trim().toUpperCase();
  if (isEuropeanCountryCode(dr)) return dr;
  const localeToCountry: Record<Locale, string> = {
    sk: "SK",
    cs: "CZ",
    de: "DE",
    pl: "PL",
    it: "IT",
    es: "ES",
    en: "SK",
  };
  const lc = (localeToCountry[appLocale] ?? "SK").trim().toUpperCase();
  return isEuropeanCountryCode(lc) ? lc : "SK";
}

/** Mini A→B route graphic for travel expense (pins + dashed path). */
function TravelRouteMiniDiagram() {
  const pin = colors.primary;
  const line = "rgba(45, 74, 122, 0.42)";
  return (
    <View style={styles.travelRouteDiagramRow} accessibilityRole="image" accessibilityLabel="A → B">
      <Svg width={168} height={42} viewBox="0 0 168 42">
        <Path
          fill={pin}
          d="M18 36 L18 36 C10 23 6 17 6 12.5 C6 7 10.5 3 16 3 C21.5 3 26 7 26 12.5 C26 17 22 23 18 36 Z"
        />
        <Circle cx={16} cy={12.5} r={2.8} fill="#ffffff" />
        <Path
          d="M36 30 Q 84 6 132 30"
          fill="none"
          stroke={line}
          strokeWidth={2.2}
          strokeDasharray="5 7"
          strokeLinecap="round"
        />
        <Path
          fill={pin}
          d="M150 36 L150 36 C142 23 138 17 138 12.5 C138 7 142.5 3 148 3 C153.5 3 158 7 158 12.5 C158 17 154 23 150 36 Z"
        />
        <Circle cx={148} cy={12.5} r={2.8} fill="#ffffff" />
      </Svg>
    </View>
  );
}

export function ProjectOverviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { user, orgId } = useAuth();
  /** Solo namespace for writes; never block saves when AuthContext orgId is briefly null. */
  const ownerIdForWrite = orgId ?? user?.id ?? null;
  const routeParams = (route.params as {
    projectId?: string;
    projectName?: string;
    openExpenseModal?: boolean;
    initialExpenseCategory?: "WORK" | "TRAVEL";
    openNewTask?: boolean;
    /** Prefill new task title (e.g. from quick note inbox) */
    initialNewTaskTitle?: string;
    openDiaryModal?: boolean;
    diaryInputMode?: "text" | "voice";
    /** Prefill diary work description (e.g. from quick note) */
    initialDiaryWorkDescription?: string;
    /** After task/diary saved, mark this quick note processed */
    processQuickNoteId?: string;
    selectedPhaseId?: string | null;
    openExpenseId?: string | null;
    expandExpensesSection?: boolean;
    /** Expand this phase on load (e.g. when navigating from milestone click) */
    expandPhaseId?: string | null;
  }) ?? {};
  const {
    projectId: paramProjectId,
    projectName: paramProjectName,
    openExpenseModal: paramOpenExpenseModal,
    initialExpenseCategory: paramInitialExpenseCategory,
    openNewTask: paramOpenNewTask,
    initialNewTaskTitle: paramInitialNewTaskTitle,
    openDiaryModal: paramOpenDiaryModal,
    diaryInputMode: paramDiaryInputMode,
    initialDiaryWorkDescription: paramInitialDiaryWorkDescription,
    processQuickNoteId: paramProcessQuickNoteId,
    selectedPhaseId: paramSelectedPhaseId,
    openExpenseId: paramOpenExpenseId,
    expandExpensesSection: paramExpandExpensesSection,
    expandPhaseId: paramExpandPhaseId,
  } = routeParams;
  /** Strip zero-width / BOM; trim — mismatches Firestore `projectId` otherwise. */
  const projectId = (paramProjectId ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const paramProjectNameNorm = (paramProjectName ?? "").trim();
  /** Header uses route param first; when missing (e.g. deep link from notifications), fill from getProject(). */
  const [fetchedProjectName, setFetchedProjectName] = useState("");
  const projectName = (fetchedProjectName || paramProjectNameNorm).trim();

  useEffect(() => {
    setFetchedProjectName("");
  }, [projectId, paramProjectNameNorm]);

  const routeProjectIdRef = useRef(projectId);
  routeProjectIdRef.current = projectId;
  const projectDataLoadedOnceRef = useRef(false);
  /** Bumps on project change / new load — stale async results are ignored (no in-flight mutex). */
  const projectLoadGenerationRef = useRef(0);

  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  /** Persisted phases plus placeholders: orphan phaseIds, or phase_title:* rows from {@link TaskDoc.phaseTitle}. */
  const phasesForUi = useMemo(() => {
    const persistedPhaseById = new Map(phases.map((p) => [p.id, p]));
    const synthetic: ProjectPhaseDoc[] = [];

    const taskPhaseIdsSorted = [...new Set(tasks.map((tk) => tk.phaseId).filter(Boolean) as string[])].sort((a, b) =>
      a.localeCompare(b)
    );
    taskPhaseIdsSorted
      .filter((id) => !persistedPhaseById.has(id))
      .forEach((id, idx) => {
        synthetic.push({
          id,
          name: t("projectOverview.phaseSyntheticLabel", { index: String(idx + 1) }),
          order: 1_000_000 + idx,
        });
      });

    const titleKeysSorted = [
      ...new Set(
        tasks
          .filter((tk) => !tk.phaseId?.trim() && tk.phaseTitle?.trim())
          .map((tk) => phaseTitleGroupKey(tk.phaseTitle!.trim()))
      ),
    ].sort((a, b) => a.localeCompare(b));

    titleKeysSorted.forEach((key, idx) => {
      if (persistedPhaseById.has(key)) return;
      const label = parsePhaseTitleGroupKey(key) ?? key;
      synthetic.push({
        id: key,
        name: label,
        order: 2_000_000 + idx,
      });
    });

    return [...phases, ...synthetic].sort((a, b) => a.order - b.order);
  }, [phases, tasks, t]);
  const hasPhaseLinksOnTasks = useMemo(
    () => tasks.some((tk) => !!(tk.phaseId?.trim() || tk.phaseTitle?.trim())),
    [tasks]
  );
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Map<string, boolean>>(new Map());
  const expandedPhasesRef = React.useRef<Map<string, boolean>>(new Map());
  const [expandedExpenses, setExpandedExpenses] = useState(false);
  const [expandedDiary, setExpandedDiary] = useState(false);
  const [expandedProblems, setExpandedProblems] = useState(false);
  const [openProblemsCount, setOpenProblemsCount] = useState(0);
  const [projectHoursMinutes, setProjectHoursMinutes] = useState<number>(0);
  const [projectTodayMinutes, setProjectTodayMinutes] = useState<number>(0);
  const [projectWeekMinutes, setProjectWeekMinutes] = useState<number>(0);
  const [activeTimer, setActiveTimer] = useState<timeTracking.ActiveTimer | null>(null);
  const [timerTick, setTimerTick] = useState(0);
  const [timeCardLoading, setTimeCardLoading] = useState(false);
  const [timeStopLoading, setTimeStopLoading] = useState(false);
  /** Entries in current calendar week (for section header count, like expenses). */
  const [projectTimeWeekEntryCount, setProjectTimeWeekEntryCount] = useState(0);
  const [expandedDocuments, setExpandedDocuments] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showTaskDescriptionModal, setShowTaskDescriptionModal] = useState(false);
  /** Session-only dismiss for the post-create empty-state hero. Hides until next reload. */
  const [emptyHeroDismissed, setEmptyHeroDismissed] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null); // Phase for new task
  const [showNewPhaseModal, setShowNewPhaseModal] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [editingPhase, setEditingPhase] = useState<ProjectPhaseDoc | null>(null);
  const [editPhaseName, setEditPhaseName] = useState("");
  const [showEditPhaseModal, setShowEditPhaseModal] = useState(false);
  const [movingTask, setMovingTask] = useState<TaskDoc | null>(null);
  const [showMoveTaskModal, setShowMoveTaskModal] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDoc | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [showEditTaskModal, setShowEditTaskModal] = useState(false);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'new' | 'edit' | 'expense'>('new');
  const [datePickerDate, setDatePickerDate] = useState(new Date());
  const [projectType, setProjectType] = useState<string | undefined>(undefined);
  const [projectWorkspaceType, setProjectWorkspaceType] = useState<string | undefined>(undefined);
  const [projectOrgId, setProjectOrgId] = useState<string | undefined>(undefined);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [addressText, setAddressText] = useState<string | undefined>(undefined);
  const [projectCountryCode, setProjectCountryCode] = useState<string | undefined>(undefined);
  const [projectCity, setProjectCity] = useState<string | undefined>(undefined);
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | undefined>(undefined);
  const [coverImagePath, setCoverImagePath] = useState<string | undefined>(undefined);
  const [addingPhases, setAddingPhases] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectAddress, setEditProjectAddress] = useState("");
  const [editProjectCountry, setEditProjectCountry] = useState("");
  const [editProjectCity, setEditProjectCity] = useState("");
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
  const defaultCountry = getDeviceRegionCode();
  const [expenseTravelFromCountry, setExpenseTravelFromCountry] = useState(defaultCountry);
  const [expenseTravelToCountry, setExpenseTravelToCountry] = useState(defaultCountry);
  const [showCountryPicker, setShowCountryPicker] = useState<'from' | 'to' | null>(null);
  const [expenseTravelDistanceKm, setExpenseTravelDistanceKm] = useState("");
  const [expenseTravelRatePerKm, setExpenseTravelRatePerKm] = useState("0.30");
  const [expenseTravelRoundTrip, setExpenseTravelRoundTrip] = useState(false);
  const travelDefaultCountry = useMemo(
    () => resolveTravelDefaultCountry(projectCountryCode, defaultCountry, locale),
    [projectCountryCode, defaultCountry, locale]
  );
  const { isOnline } = useOnlineStatus();
  const [isLoadingDistance, setIsLoadingDistance] = useState(false);
  const [kmError, setKmError] = useState<string | undefined>(undefined);
  /** Travel form is long; avoid staying scrolled to bottom (e.g. after autoFocus on title) when switching to TRAVEL. */
  useEffect(() => {
    if (!showExpenseModal || expenseCategory !== "TRAVEL") return;
    const t = setTimeout(() => {
      expenseModalScrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 32);
    return () => clearTimeout(t);
  }, [showExpenseModal, expenseCategory]);

  const [expenseSupplierName, setExpenseSupplierName] = useState("");
  const [expenseSupplierIco, setExpenseSupplierIco] = useState("");
  const [expenseCurrency, setExpenseCurrency] = useState<string>("EUR");
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
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
  const [expenseOcrExtractionSource, setExpenseOcrExtractionSource] = useState<InvoiceExtractionSource | null>(null);
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
  const expenseModalScrollRef = useRef<ScrollView | null>(null);
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
  const [expenseOcrLineItems, setExpenseOcrLineItems] = useState<ParsedDocumentLineItem[]>([]);
  const [materialImportSheet, setMaterialImportSheet] = useState<ExpenseMaterialImportContext | null>(null);
  const access = useProjectAccess(projectId, projectOwnerId);
  const isOwner = access.isOwner || (!!projectOwnerId && !!user?.id && projectOwnerId === user.id);
  /** Native tab bar is visible inside HomeStack; custom dock would duplicate it. */
  const insideMainTabs = useIsInsideMainTabNavigator();
  const showAppBottomMenu = !insideMainTabs;
  const capabilities = useCapabilities({
    projectWorkspaceType,
    projectOrgId,
    legacyProject: !projectWorkspaceType && !projectOrgId,
  });

  const canViewProjectTime = useMemo(() => {
    if (access.loading) return false;
    return (
      access.isOwner ||
      access.canWriteTime ||
      (access.isMember && access.sharedItems?.timeTracking !== false)
    );
  }, [access.loading, access.isOwner, access.canWriteTime, access.isMember, access.sharedItems?.timeTracking]);

  /** Align with Firestore `tasks` delete/update: editors with tasks or phases sharing (same as „Pridať úlohu“). */
  const canMutateTasks = useMemo(() => {
    if (access.loading) return false;
    if (!access.canWrite) return false;
    if (access.isOwner) return true;
    return access.sharedItems.tasks === true || access.sharedItems.phases === true;
  }, [
    access.loading,
    access.canWrite,
    access.isOwner,
    access.sharedItems.tasks,
    access.sharedItems.phases,
  ]);

  const isTimerRunningOnThisProject = useMemo(
    () => !!activeTimer && activeTimer.projectId === projectId,
    [activeTimer, projectId]
  );

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
  const [serviceRulesCount, setServiceRulesCount] = useState(0);
  const [showEquipmentActionSheet, setShowEquipmentActionSheet] = useState(false);
  
  // Diary entries state
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntryDoc[]>([]);
  const [showDiaryModal, setShowDiaryModal] = useState(false);
  const [editingDiaryEntry, setEditingDiaryEntry] = useState<DiaryEntryDoc | null>(null);
  const [diaryDate, setDiaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [diaryWeather, setDiaryWeather] = useState("");
  const [diaryWorkers, setDiaryWorkers] = useState("");
  const [diaryWorkDescription, setDiaryWorkDescription] = useState("");
  const [diaryWorkDescriptionRecordingUri, setDiaryWorkDescriptionRecordingUri] = useState<string | null>(null);
  const [showDiaryDescriptionModal, setShowDiaryDescriptionModal] = useState(false);
  const [diaryMaterials, setDiaryMaterials] = useState("");
  const [diaryPhaseId, setDiaryPhaseId] = useState<string | null>(null);
  const [diaryAttachments, setDiaryAttachments] = useState<{ uri: string; fileName: string; mimeType: string; kind: 'image' | 'pdf' | 'document' }[]>([]);
  const [uploadingDiaryAttachment, setUploadingDiaryAttachment] = useState(false);
  const [viewingDiaryEntry, setViewingDiaryEntry] = useState<DiaryEntryDoc | null>(null);
  const [diaryDetailAttachmentUrls, setDiaryDetailAttachmentUrls] = useState<Map<string, string>>(new Map());
  const [diaryDetailAttachmentDocs, setDiaryDetailAttachmentDocs] = useState<Map<string, AttachmentDoc>>(new Map());
  
  // Project documents state
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocumentDoc[]>([]);
  const [materialPlannedCount, setMaterialPlannedCount] = useState(0);
  const [materialUsedCount, setMaterialUsedCount] = useState(0);
  const [materialTotalPrice, setMaterialTotalPrice] = useState(0);
  const [materialCurrency, setMaterialCurrency] = useState("EUR");
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
  const [phasesSectionExpanded, setPhasesSectionExpanded] = useState(false);
  const [taskFilter, setTaskFilter] = useState<'service' | 'all'>('service');
  const [activityEvents, setActivityEvents] = useState<ProjectEvent[]>([]);
  useEffect(() => {
    if (isMaintenanceStorageType(projectType)) setTaskFilter("service");
  }, [projectId, projectType]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const getOcrFallbackMessage = useCallback(
    (errorCode?: string, cooldownSeconds?: number) => {
      const code = String(errorCode || "").toUpperCase();
      if (code === "ENTITLEMENT_REQUIRED") {
        return t("subscription.entitlementRequired");
      }
      if (code === "LIMIT_REACHED") {
        return t("expense.ocrLimit");
      }
      if (code === "COOLDOWN" && typeof cooldownSeconds === "number") {
        return t("subscription.tryAgainIn", { seconds: String(cooldownSeconds) });
      }
      const codeLower = code.toLowerCase();
      if (
        codeLower.includes("not_found") ||
        codeLower.includes("not-found") ||
        codeLower.includes("functions/not-found") ||
        codeLower.includes("unimplemented")
      ) {
        return t("ocr.backendNotDeployed");
      }
      if (codeLower.includes("unauthenticated") || codeLower.includes("permission-denied")) {
        return t("ocr.noPermission");
      }
      if (code === "PDF_NO_TEXT") {
        return t("ocr.pdfNoText");
      }
      if (code === "CLOUD_OCR_NOT_FOUND" || code === "CLOUD_OCR_FAILED") {
        return t("ocr.pdfMobileAndCloudUnavailable");
      }
      return t("ocr.manualFallback");
    },
    [t]
  );
  const [weatherSnapshot, setWeatherSnapshot] = useState<ProjectWeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const formatActivityAge = useCallback(
    (value: ProjectEvent["createdAt"]) => {
      try {
        const date =
          typeof value === "string"
            ? new Date(value)
            : value instanceof Date
            ? value
            : value?.toDate?.() ?? new Date();
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return t("events.justNow");
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `${diffH}h ago`;
        const diffD = Math.floor(diffH / 24);
        return `${diffD}d ago`;
    } catch {
      return "";
    }
  }, [t]);

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

  /** Filter out expense/price-related activity when member doesn't have expenses shared. */
  const visibleActivityEvents = useMemo(() => {
    if (access.isOwner || access.canReadExpenses) return activityEvents;
    return activityEvents.filter(
      (e) => e.type !== "expense_added" && e.type !== "ocr_completed"
    );
  }, [activityEvents, access.isOwner, access.canReadExpenses]);

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
        setWeatherError(error?.message || t("projectOverview.weatherLoadFailed"));
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
    const loadGeneration = ++projectLoadGenerationRef.current;
    if (__DEV__) {
      console.log(
        `[ProjectOverview] load() invoked refresh=${isRefresh} gen=${loadGeneration} projectId="${projectId}"`
      );
    }

    const readOpts = isRefresh ? PROJECT_DETAIL_REFRESH_OPTS : PROJECT_DETAIL_LOAD_OPTS;

    if (isRefresh) {
      setRefreshing(true);
    } else if (!projectDataLoadedOnceRef.current) {
      setLoading(true);
    }

    const loadForProjectId = projectId;

    try {
      // Use static auth import — dynamic import("../firebase") can hang (circular deps / HMR).
      const currentUserUid = auth.currentUser?.uid ?? user?.id ?? null;
      let fbProjectId = "(unknown)";
      try {
        fbProjectId =
          (require("@react-native-firebase/app").getApp()?.options as { projectId?: string })?.projectId ??
          "(unknown)";
      } catch {
        /* ignore */
      }
      console.log(
        `[ProjectOverview] load start refresh=${isRefresh} uid="${currentUserUid}" projectId="${projectId}" firebase="${fbProjectId}"`
      );
      
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
        const rawWorkspaceType = (project as { workspaceType?: unknown }).workspaceType;
        const rawOrgId = (project as { orgId?: unknown }).orgId;
        setProjectWorkspaceType(typeof rawWorkspaceType === "string" ? rawWorkspaceType : undefined);
        setProjectOrgId(typeof rawOrgId === "string" ? rawOrgId : undefined);
        setTemplateId(project.templateId);
        setAddressText(project.addressText);
        setProjectCountryCode(project.countryCode);
        setProjectCity(project.city);
        setProjectOwnerId(project.ownerId ?? null);
        setCoverImageUrl(project.coverImageUrl);
        setCoverImagePath(project.coverImagePath);
        const nm = typeof project.name === "string" ? project.name.trim() : "";
        if (routeProjectIdRef.current === loadForProjectId) {
          setFetchedProjectName(nm);
        }
      } else {
        console.warn(`[ProjectOverview] Project ${projectId} not found or no access - continuing without project metadata`);
        setProjectWorkspaceType(undefined);
        setProjectOrgId(undefined);
        if (routeProjectIdRef.current === loadForProjectId) {
          setFetchedProjectName("");
        }
      }
      
      // Load phases for BUILD-like projects, AI-generated plans, and TRADE (Remeselník jobs persist phases + phaseId on tasks).
      const projectTypeForLoad = project?.projectType || projectType;
      const isBuildProject = isBuildLikeStorageType(projectTypeForLoad);
      const isAiGeneratedPlan = project?.templateId === "ai-generated";
      
      const resolvedOwnerId = project?.ownerId ?? projectOwnerId ?? null;
      const liveAccess = await fetchProjectAccess(projectId, currentUserUid, resolvedOwnerId);

      const isProjectOwner = !!(resolvedOwnerId && resolvedOwnerId === currentUserUid);
      const isOwnerForLoad = isProjectOwner || liveAccess.isOwner;
      const canReadPhases = isOwnerForLoad || liveAccess.canReadPhases;
      const canReadTasks = isOwnerForLoad || liveAccess.canReadTasks;
      const canReadExpenses = isOwnerForLoad || liveAccess.canReadExpenses;
      const canReadDiary = isOwnerForLoad || liveAccess.canReadDiary;
      const canReadDocuments = isOwnerForLoad || liveAccess.canReadDocuments;
      /** Firestore rules: attachments read = tasks OR expenses OR documents */
      const canReadAttachments = canReadTasks || canReadExpenses || canReadDocuments;
      
      console.log(
        `[ProjectOverview] Loading data for projectType="${projectTypeForLoad}", isProjectOwner=${isProjectOwner}, isOwnerForLoad=${isOwnerForLoad}, liveAccess.isOwner=${liveAccess.isOwner}, canRead: phases=${canReadPhases}, tasks=${canReadTasks}, expenses=${canReadExpenses}, diary=${canReadDiary}, documents=${canReadDocuments}...`
      );
      const loadPromises: Promise<any>[] = [];
      
      const shouldLoadProjectPhases =
        (isBuildProject || isAiGeneratedPlan || projectTypeForLoad === "TRADE") && canReadPhases;
      if (shouldLoadProjectPhases) {
        loadPromises.push(
          projectsService.listProjectPhases(projectId, readOpts).catch((error: any) => {
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
          tasksService.listTasksByProject(projectId, readOpts).catch((error: any) => {
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
          expensesService.listExpensesByProject(projectId, readOpts).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading expenses:`, error);
            return [];
          })
        );
      } else {
        loadPromises.push(Promise.resolve([]));
      }
      
      // Diary / documents: see `projectTypeModel` (documents = build-like only).
      const hasDiary = projectOverviewLoadsDiary(projectTypeForLoad);
      const hasDocuments = projectOverviewLoadsDocuments(projectTypeForLoad);
      if (hasDiary && canReadDiary) {
        loadPromises.push(
          constructionDiaryService.listDiaryEntries(projectId, readOpts).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading diary entries:`, error);
            return [];
          })
        );
      } else if (hasDiary) {
        loadPromises.push(Promise.resolve([]));
      }
      if (canReadDocuments) {
        loadPromises.push(
          projectDocumentsService.listProjectDocuments(projectId, readOpts).catch((error: any) => {
            console.error(`[ProjectOverview] Error loading project documents:`, error);
            return [];
          })
        );
      } else {
        loadPromises.push(Promise.resolve([]));
      }
      loadPromises.push(
        projectMembersService.listProjectMembers(projectId, true).catch((error: any) => {
          console.error(`[ProjectOverview] Error loading project members:`, error);
          return [];
        })
      );
      
      const results = await Promise.all(loadPromises);
      const ph = results[0];
      const tk = results[1];
      const exp = results[2];
      const diary = hasDiary ? results[3] : [];
      const docs = canReadDocuments ? results[hasDiary ? 4 : 3] : [];
      const members = (results[results.length - 1] ?? []) as ProjectMemberDoc[];
      
      if (
        routeProjectIdRef.current !== loadForProjectId ||
        loadGeneration !== projectLoadGenerationRef.current
      ) {
        if (__DEV__) {
          console.log(
            `[ProjectOverview] Skipping stale load apply for ${loadForProjectId} gen=${loadGeneration}`
          );
        }
        return;
      }

      console.log(`[ProjectOverview] Loaded ${ph.length} phases, ${tk.length} tasks, ${exp.length} expenses, ${members.length} members for projectType="${projectTypeForLoad}"`);
      if (hasDiary || hasDocuments) {
        console.log(`[ProjectOverview] Loaded ${diary.length} diary entries, ${docs.length} documents`);
      }
      if (ph.length > 0) {
        console.log(`[ProjectOverview] Phase IDs: ${ph.map((p: any) => p.id).join(', ')}`);
        console.log(`[ProjectOverview] Phase names: ${ph.map((p: any) => p.name).join(', ')}`);
      }
      if (tk.length > 0) {
        console.log(`[ProjectOverview] Task IDs (first 5): ${tk.slice(0, 5).map((t: any) => t.id).join(', ')}`);
        const tasksWithPhase = tk.filter((t: any) => !!t.phaseId);
        const tasksWithoutPhase = tk.filter((t: any) => !t.phaseId);
        console.log(
          `[ProjectOverview] Tasks with phaseId: ${tasksWithPhase.length}, without phaseId: ${tasksWithoutPhase.length} (buildLike=${isBuildProject})`
        );
        if (__DEV__ && !isBuildProject && tk.length > 0) {
          const phaseIdsOnTasks = [...new Set(tk.map((t: any) => t.phaseId).filter(Boolean))] as string[];
          const unknownPhaseIds = phaseIdsOnTasks.filter((id) => !ph.some((p: any) => p.id === id));
          console.log(
            `[ProjectOverview][tradeTaskLayout] projectId=${projectId} projectType=${projectTypeForLoad} phasesLoaded=${ph.length} tasksTotal=${tk.length} distinctTaskPhaseIds=${phaseIdsOnTasks.length} phaseIdsNotInLoadedPhases=${unknownPhaseIds.length}`,
            unknownPhaseIds.length ? { unknownPhaseIdsSample: unknownPhaseIds.slice(0, 5) } : {}
          );
        }
      }
      
      if (isBuildProject || isAiGeneratedPlan || projectTypeForLoad === "TRADE") {
        setPhases(ph || []);
      } else {
        setPhases([]);
      }
      setTasks(tk || []);
      setExpenses(exp || []);
      setDiaryEntries(hasDiary ? diary : []);
      setProjectDocuments(canReadDocuments ? docs : []);
      setProjectMembers(members);

      // MAINTENANCE v2: load equipment and service rules count only for MAINTENANCE projects
      const isMaintenanceLike = projectOverviewLoadsEquipmentAndServiceRules({
        projectType: projectTypeForLoad,
        jobsTabVisible: project?.jobsTabVisible,
      });
      if (isMaintenanceLike) {
        try {
          const [eq, rules] = await Promise.all([
            equipmentService.listEquipment(projectId, { status: 'active' }),
            serviceRulesService.listServiceRulesByProject(projectId, { status: 'active' }),
          ]);
          setEquipmentList(eq);
          setServiceRulesCount(rules.length);
        } catch (e: any) {
          console.warn('[ProjectOverview] Error loading equipment/service rules:', e);
          setEquipmentList([]);
          setServiceRulesCount(0);
        }
      } else {
        setEquipmentList([]);
        setServiceRulesCount(0);
      }

      // Problems count (open + in_progress) for all project types
      try {
        const count = await problemsService.countOpenProblems(projectId);
        setOpenProblemsCount(count);
      } catch (e: any) {
        console.warn("[ProjectOverview] Error loading problems count:", e);
        setOpenProblemsCount(0);
      }
      
      // Attachment counts on tasks/expenses — only when rules allow reading `attachments`
      if (canReadAttachments) {
        try {
          const allAttachments = await attachmentsService.listAttachments(projectId, undefined, readOpts);
          const safeAttachments = Array.isArray(allAttachments) ? allAttachments : [];
          console.log(`[ProjectOverview] Loaded ${safeAttachments.length} total attachments`);

          const taskMap = new Map<string, number>();
          const expenseMap = new Map<string, number>();

          safeAttachments.forEach((att) => {
            if (!att || typeof att !== "object") return;
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
          const code = String(error?.code ?? "");
          const msg = String(error?.message ?? "");
          const denied =
            code.includes("permission-denied") ||
            msg.includes("permission-denied") ||
            code.includes("PERMISSION_DENIED");
          if (denied) {
            if (__DEV__) {
              console.warn(`[ProjectOverview] No access to attachments list (expected for some shares):`, projectId);
            }
          } else {
            console.error(`[ProjectOverview] Error loading attachments for map:`, error);
          }
          setTaskAttachmentsMap(new Map());
          setExpenseAttachmentsMap(new Map());
        }
      } else {
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
      console.error("[ProjectOverview] Error loading data:", error);
      if (!isRefresh) {
        setPhases([]);
        setTasks([]);
        setExpenses([]);
        setExpandedPhases(new Map());
      }
    } finally {
      if (loadGeneration === projectLoadGenerationRef.current) {
        projectDataLoadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [projectId, projectOwnerId, projectType, user?.id]);
  
  const toLocalYmd = useCallback((d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const localWeekRange = useCallback((): { fromYmd: string; toYmd: string } => {
    const now = new Date();
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const diffToMon = (day + 6) % 7; // Mon=0
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - diffToMon);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { fromYmd: toLocalYmd(start), toYmd: toLocalYmd(end) };
  }, [toLocalYmd]);

  const formatMinutes = useCallback(
    (mins: number): string => {
      const total = Math.max(0, Math.round(mins || 0));
      const h = Math.floor(total / 60);
      const m = total % 60;
      return `${h} ${t("time.hoursShort")} ${String(m).padStart(2, "0")} ${t("time.minutesShort")}`;
    },
    [t]
  );

  const formatElapsedHms = useCallback((startedAtIso: string): string => {
    const startMs = new Date(startedAtIso).getTime();
    const diffMs = Date.now() - startMs;
    const safe = Number.isFinite(diffMs) && diffMs > 0 ? diffMs : 0;
    const totalSeconds = Math.floor(safe / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  const loadProjectTimeSummary = useCallback(async () => {
    if (!projectId) return;
    const allowed =
      !access.loading &&
      (access.isOwner ||
        access.canWriteTime ||
        (access.isMember && access.sharedItems?.timeTracking !== false));

    console.log("[PTS 1] start", {
      projectId,
      userId: user?.id,
      accessLoading: access.loading,
      isOwner: access.isOwner,
      routeOwnerMatch: isOwner,
      canWriteTime: access.canWriteTime,
      sharedTimeTracking: access.sharedItems?.timeTracking,
      allowed,
    });

    if (!allowed) {
      // #region agent log
      postDebugIngest({
        hypothesisId: "T1",
        location: "ProjectOverviewScreen.tsx:loadProjectTimeSummary",
        message: "pts_time_blocked_by_access",
        data: {
          projectIdLen: projectId.length,
          accessLoading: access.loading,
          isOwner: access.isOwner,
          canWriteTime: access.canWriteTime,
          isMember: access.isMember,
          sharedTimeTracking: access.sharedItems?.timeTracking ?? null,
        },
      });
      // #endregion
      setProjectHoursMinutes(0);
      setProjectTodayMinutes(0);
      setProjectWeekMinutes(0);
      setProjectTimeWeekEntryCount(0);
      setActiveTimer(null);
      return;
    }
    setTimeCardLoading(true);
    try {
      console.log("[PTS 2] before fetch");
      const timeOpts = { forUserId: user?.id ?? auth.currentUser?.uid ?? undefined };
      /** Avoid hanging forever on users/{uid} if Firestore get stalls. */
      const ACTIVE_TIMER_MS = 8_000;
      const at = await Promise.race([
        timeTracking.getActiveTimer().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ACTIVE_TIMER_MS)),
      ]);

      /**
       * One list for 24 months: same data as getProjectTotalMinutes + week slice in memory.
       * Previously we ran two full listTimeEntriesByProject (24mo + week) — doubled reads and
       * could leave timeCardLoading stuck for a long time on slow / retrying Firestore.
       */
      const now = new Date();
      const toAllYmd = toLocalYmd(now);
      const from24 = new Date(now);
      from24.setMonth(from24.getMonth() - 24);
      const fromAllYmd = toLocalYmd(from24);
      /** Do not race the list to `[]` on timeout — that zeroed totals on slow Firestore while data existed. */
      let allEntries: timeTracking.TimeEntryDoc[] = [];
      try {
        allEntries = await timeTracking.listTimeEntriesByProject(projectId, fromAllYmd, toAllYmd, timeOpts);
      } catch (e) {
        postDebugIngest({
          hypothesisId: "T5",
          location: "ProjectOverviewScreen.tsx:loadProjectTimeSummary",
          message: "pts_all_range_list_rejected",
          data: { err: e instanceof Error ? e.message : String(e) },
        });
        allEntries = [];
      }

      const totalMins = allEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
      const todayYmd = toLocalYmd(new Date());
      const { fromYmd, toYmd } = localWeekRange();
      const weekEntries = allEntries.filter((e) => {
        const dk = timeTracking.entryCalendarDayYmd(e);
        return !!dk && dk >= fromYmd && dk <= toYmd;
      });

      // #region agent log
      postDebugIngest({
        hypothesisId: "T4",
        location: "ProjectOverviewScreen.tsx:loadProjectTimeSummary",
        message: "pts_week_fetch_ok",
        data: {
          allEntriesLen: allEntries.length,
          weekEntriesLen: weekEntries.length,
          totalMins,
          fromAllYmd,
          toAllYmd,
          fromYmd,
          toYmd,
          positiveDurCount: weekEntries.filter((e) => (e.durationMinutes ?? 0) > 0).length,
        },
      });
      // #endregion

      console.log("[PTS 3] fetch result", {
        totalMins,
        weekEntriesLength: weekEntries.length,
        activeTimer: at,
      });

      setActiveTimer(at);

      let todaySum = 0;
      let weekSum = 0;
      for (const e of weekEntries) {
        const mins = e.durationMinutes ?? 0;
        if (mins <= 0) continue;
        const dayKey = timeTracking.entryCalendarDayYmd(e);
        if (!dayKey) continue;
        if (dayKey >= fromYmd && dayKey <= toYmd) {
          weekSum += mins;
        }
        if (dayKey === todayYmd) {
          todaySum += mins;
        }
      }

      console.log("[PTS 4] computed", {
        todaySum,
        weekSum,
        totalMins,
      });

      const weekEntryCount = weekEntries.filter((e) => (e.durationMinutes ?? 0) > 0).length;

      console.log("[PTS 5] setting state", {
        today: todaySum,
        week: weekSum,
        total: totalMins,
        weekEntryCount,
        weekEntriesLength: weekEntries.length,
      });

      /** Set project time state in one phase after all reads (avoids stale total from racing requests). */
      setProjectHoursMinutes(totalMins);
      setProjectWeekMinutes(weekSum);
      setProjectTodayMinutes(todaySum);
      setProjectTimeWeekEntryCount(weekEntryCount);
    } finally {
      setTimeCardLoading(false);
    }
  }, [
    projectId,
    user?.id,
    isOwner,
    access.loading,
    access.isOwner,
    access.canWriteTime,
    access.isMember,
    access.sharedItems?.timeTracking,
    localWeekRange,
    toLocalYmd,
  ]);

  const loadMaterialSummary = useCallback(async () => {
    if (!projectId) return;
    try {
      const [suggestions, usedMaterials] = await Promise.all([
        listMaterialSuggestions(projectId),
        listProjectMaterials(projectId),
      ]);
      setMaterialPlannedCount(suggestions.filter((s) => s.status === "planned").length);
      setMaterialUsedCount(usedMaterials.length);
      const totals = calculateMaterialTotals(usedMaterials);
      setMaterialTotalPrice(totals.totalPrice);
      setMaterialCurrency(totals.currency);
    } catch (e) {
      if (__DEV__) console.warn("[ProjectOverview] loadMaterialSummary failed", e);
      setMaterialPlannedCount(0);
      setMaterialUsedCount(0);
      setMaterialTotalPrice(0);
    }
  }, [projectId]);

  const onRefresh = useCallback(() => {
    load(true);
    loadActivity();
    loadWeather(true);
    loadProjectTimeSummary();
    void loadMaterialSummary();
  }, [load, loadActivity, loadWeather, loadProjectTimeSummary, loadMaterialSummary]);

  useEffect(() => {
    if (!projectId || access.loading) return;
    void load();
  }, [projectId, access.loading, access.isOwner, access.canReadTasks, user?.id, load]);

  useEffect(() => {
    projectDataLoadedOnceRef.current = false;
    projectLoadGenerationRef.current += 1;
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      if (!projectId || access.loading) return () => {};
      // Initial data load is handled by useEffect; only refresh on re-focus after success.
      if (!projectDataLoadedOnceRef.current) return () => {};
      void load(true);
      loadActivity();
      return () => {};
    }, [projectId, access.loading, load, loadActivity])
  );

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  useEffect(() => {
    if (!projectId || access.loading) return;
    void loadProjectTimeSummary();
  }, [projectId, access.loading, loadProjectTimeSummary]);

  useEffect(() => {
    if (!projectId || access.loading) return;
    void loadMaterialSummary();
  }, [projectId, access.loading, loadMaterialSummary]);

  useEffect(() => {
    if (!canViewProjectTime) return;
    console.log("[PTS-R] state after update", {
      projectTodayMinutes,
      projectWeekMinutes,
      projectHoursMinutes,
      projectTimeWeekEntryCount,
    });
  }, [
    canViewProjectTime,
    projectTodayMinutes,
    projectWeekMinutes,
    projectHoursMinutes,
    projectTimeWeekEntryCount,
  ]);

  useEffect(() => {
    // Tick running timer display when the active timer belongs to this project
    if (!activeTimer || activeTimer.projectId !== projectId) return;
    const interval = setInterval(() => setTimerTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTimer, projectId]);

  useFocusEffect(
    useCallback(() => {
      if (!projectId || !user?.id) return () => {};
      projectEventsService.markProjectSeen(projectId, user.id).catch((error) => {
        console.warn("[ProjectOverview] Failed to mark project seen:", error);
      });
      projectMembersService.listProjectMembers(projectId, true).then((m) => {
        console.log("[ProjectOverview] Members on focus:", m.length, m.map((x) => x.name || x.email));
        setProjectMembers(m);
      }).catch((err) => {
        console.warn("[ProjectOverview] Failed to refresh members on focus:", err);
      });
      return () => {};
    }, [projectId, user?.id])
  );

  useFocusEffect(
    useCallback(() => {
      if (!projectId || access.loading) return () => {};
      const allowed =
        access.isOwner ||
        access.canWriteTime ||
        (access.isMember && access.sharedItems?.timeTracking !== false);
      if (!allowed) return () => {};
      void loadProjectTimeSummary();
      return () => {};
    }, [
      projectId,
      access.loading,
      access.isOwner,
      access.canWriteTime,
      access.isMember,
      access.sharedItems?.timeTracking,
      loadProjectTimeSummary,
    ])
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
      if (paramInitialExpenseCategory) setExpenseCategory(paramInitialExpenseCategory);
      setShowExpenseModal(true);
    }
  }, [paramOpenExpenseModal, projectId, paramSelectedPhaseId, paramInitialExpenseCategory, access.canReadExpenses, access.canWrite, access.sharedItems?.expenses]);

  // Expand expenses section if requested from navigation (e.g. from ExpensesKpiScreen row click)
  useEffect(() => {
    if (paramExpandExpensesSection && projectId && access.canReadExpenses) {
      setExpandedExpenses(true);
    }
  }, [paramExpandExpensesSection, projectId, access.canReadExpenses]);

  // Expand phase when navigating from milestone click (ProjectOverviewDashboard)
  useEffect(() => {
    if (!paramExpandPhaseId || phasesForUi.length === 0) return;
    const phaseExists = phasesForUi.some((p) => p.id === paramExpandPhaseId);
    if (phaseExists) {
      setExpandedPhases((prev) => {
        const next = new Map(prev);
        next.set(paramExpandPhaseId, true);
        expandedPhasesRef.current = next;
        return next;
      });
    }
  }, [paramExpandPhaseId, phasesForUi]);

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
      if (paramInitialNewTaskTitle?.trim()) {
        setNewTitle(paramInitialNewTaskTitle.trim());
      }
      setShowNewTask(true);
    }
  }, [
    paramOpenNewTask,
    paramInitialNewTaskTitle,
    projectId,
    paramSelectedPhaseId,
    access.canWrite,
    access.sharedItems.tasks,
    access.sharedItems.phases,
  ]);

  const goBack = () => navigation.goBack();
  const goToMembers = () => {
    if (!capabilities.capabilities.canUseProjectMembers) {
      showTeamFeatureSoftGate({
        onRegisterCompany: () => {
          (navigation as { navigate: (n: string, p?: object) => void }).navigate("BusinessStack");
        },
      });
      return;
    }
    (navigation as { navigate: (n: string, p?: object) => void }).navigate("ProjectMembers", { projectId, projectName, projectType });
  };

  const handleCalculateDistanceKm = useCallback(async () => {
    const from = expenseTravelFromAddress.trim();
    const to = expenseTravelToAddress.trim();
    if (from.length < 3 || to.length < 3 || isLoadingDistance || !isOnline) return;
    setKmError(undefined);
    setIsLoadingDistance(true);
    try {
      const fromFull = buildAddressWithCountry(from, expenseTravelFromCountry);
      const toFull = buildAddressWithCountry(to, expenseTravelToCountry);
      const oneWayKm = await calculateRouteDistanceKm(fromFull, toFull);
      /** Pole „km“ = jedna cesta; tam a späť sa násobí až pri súhrne / uložení. */
      setExpenseTravelDistanceKm(String(Math.round(oneWayKm * 10) / 10));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const msg =
        raw === "distance_failed" || raw.includes("distance_failed")
          ? t("projectOverview.distanceCalcFailed")
          : raw || t("projectOverview.distanceCalcFailed");
      setKmError(msg);
      showToast(msg);
    } finally {
      setIsLoadingDistance(false);
    }
  }, [expenseTravelFromAddress, expenseTravelToAddress, expenseTravelFromCountry, expenseTravelToCountry, isLoadingDistance, isOnline, t]);

  const handleAddressBBlur = useCallback(() => {
    const from = expenseTravelFromAddress.trim();
    const to = expenseTravelToAddress.trim();
    const currentKm = parseFloat(expenseTravelDistanceKm.replace(",", "."));
    if (from.length >= 3 && to.length >= 3 && !isLoadingDistance && isOnline && (!Number.isFinite(currentKm) || currentKm === 0)) {
      handleCalculateDistanceKm();
    }
  }, [expenseTravelFromAddress, expenseTravelToAddress, expenseTravelDistanceKm, isLoadingDistance, isOnline, handleCalculateDistanceKm]);

  const swapTravelRoute = useCallback(() => {
    const a = expenseTravelFromAddress;
    const ac = expenseTravelFromCountry;
    setExpenseTravelFromAddress(expenseTravelToAddress);
    setExpenseTravelFromCountry(expenseTravelToCountry);
    setExpenseTravelToAddress(a);
    setExpenseTravelToCountry(ac);
    setKmError(undefined);
  }, [expenseTravelFromAddress, expenseTravelToAddress, expenseTravelFromCountry, expenseTravelToCountry]);

  const travelCalcDisabledHint = useMemo(() => {
    if (isLoadingDistance) return t("expenses.travel.calculatingDistance");
    if (!isOnline) return t("expenses.travel.offlineDistanceHint");
    if (expenseTravelFromAddress.trim().length < 3 || expenseTravelToAddress.trim().length < 3) {
      return t("expenses.travel.calculateDistanceDisabledHint");
    }
    return "";
  }, [
    isLoadingDistance,
    isOnline,
    expenseTravelFromAddress,
    expenseTravelToAddress,
    t,
  ]);

  useEffect(() => {
    if (expenseCategory !== "TRAVEL") return;
    const km = parseFloat(expenseTravelDistanceKm.replace(",", "."));
    const rate = parseFloat(expenseTravelRatePerKm.replace(",", "."));
    if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(rate) || rate <= 0) return;
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
    if (!ownerIdForWrite || !projectId) return;
    
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
      // BUILD + AI wizard plans persist phases on TRADE jobs — attach new tasks to selected phase when applicable.
      const wantsPhaseOnCreatedTask =
        isBuildLikeStorageType(projectType) ||
        templateId === "ai-generated" ||
        hasPhaseLinksOnTasks;
      const taskPhaseId = wantsPhaseOnCreatedTask ? (selectedPhaseId || undefined) : undefined;
      const selectedPhaseMeta = taskPhaseId
        ? phasesForUi.find((p) => p.id === taskPhaseId)
        : undefined;
      const taskPhaseTitle = selectedPhaseMeta?.name?.trim() ? selectedPhaseMeta.name.trim() : undefined;

      // Determine task title: use text or "Hlasová nahrávka" if voice recording
      const taskTitle = newTitle.trim() || (recordingUri ? t("projectOverview.voiceRecording") : "");
      
      console.log(`[ProjectOverview] Creating custom task: projectType="${projectType}", phaseId="${taskPhaseId || 'none'}", hasVoice=${!!recordingUri}`);
      
      const taskDoc = await tasksService.createTask(ownerIdForWrite, projectId, taskTitle, {
        phaseId: taskPhaseId,
        phaseTitle: taskPhaseTitle,
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
      setNewTaskDueDate("");
      setSelectedPhaseId(null);
      setRecordingUri(null);
      setShowTaskDescriptionModal(false);
      await load(true); // Reload with refresh
      if (paramProcessQuickNoteId && user?.id) {
        try {
          await quickNotesService.markQuickNoteProcessed(user.id, paramProcessQuickNoteId);
        } catch {
          /* ignore */
        }
        try {
          (navigation as unknown as { setParams?: (p: object) => void }).setParams?.({ processQuickNoteId: undefined });
        } catch {
          /* ignore */
        }
      }
      const { logTaskCreateSuccess } = require("../services/analytics");
      logTaskCreateSuccess("project_overview");
      console.log(`[ProjectOverview] Custom task created successfully`);
      trackPaywallEvent("task_created").then(() =>
        checkAndShowPaywall(user?.billing, navigation, "task_created")
      );
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

  const openNewDiaryModal = useCallback(
    (mode: "text" | "voice" = "text", showPermissionAlert = true, prefillWorkDescription?: string) => {
    if (!access.canWrite || access.sharedItems?.diary !== true) {
      if (!showPermissionAlert) return;
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    setEditingDiaryEntry(null);
    setDiaryDate(new Date().toISOString().split("T")[0]);
    setDiaryWeather("");
    setDiaryWorkers("");
    setDiaryWorkDescription(prefillWorkDescription?.trim() ?? "");
    setDiaryWorkDescriptionRecordingUri(null);
    setShowDiaryDescriptionModal(false);
    setDiaryMaterials("");
    setDiaryPhaseId(null);
    setDiaryAttachments([]);
    setShowDiaryModal(true);
  },
  [access.canWrite, access.sharedItems.diary, t]
);

  useEffect(() => {
    if (!paramOpenDiaryModal || !projectId) return;
    if (!projectOwnerId && access.loading) return;
    if (!access.canReadDiary || !access.canWrite || access.sharedItems?.diary !== true) return;
    openNewDiaryModal(
      paramDiaryInputMode === "voice" ? "voice" : "text",
      false,
      paramInitialDiaryWorkDescription
    );
  }, [
    paramOpenDiaryModal,
    paramDiaryInputMode,
    paramInitialDiaryWorkDescription,
    projectId,
    projectOwnerId,
    access.loading,
    access.canReadDiary,
    access.canWrite,
    access.sharedItems?.diary,
    openNewDiaryModal,
  ]);

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
    if (!canMutateTasks) {
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
    if (!ownerIdForWrite || !projectId || !editingTask || !editTaskTitle.trim()) return;
    
    setSubmitting(true);
    try {
      console.log(`[ProjectOverview] Updating task ${editingTask.id}: title="${editTaskTitle.trim()}", dueDate="${editTaskDueDate || 'null'}"`);
      await tasksService.updateTaskTitle(ownerIdForWrite, projectId, editingTask.id, editTaskTitle.trim(), editTaskDueDate.trim() || null);
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
    if (!canMutateTasks) {
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
            if (!ownerIdForWrite) return;
            try {
              console.log(`[ProjectOverview] Deleting task ${task.id}`);
              await tasksService.deleteTask(ownerIdForWrite, projectId, task.id);
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

  const showTaskActionsMenu = (task: TaskDoc, showMoveOption: boolean) => {
    const moveLabel = t("projectOverview.moveTaskTitle");
    const editLabel = t("projectOverview.editTask");
    const deleteLabel = t("projectOverview.deleteTask");
    const options: string[] = [t("common.cancel")];
    const actions: (() => void)[] = [];
    if (showMoveOption) {
      options.push(moveLabel);
      actions.push(() => handleMoveTask(task));
    }
    options.push(editLabel);
    actions.push(() => handleEditTask(task));
    options.push(deleteLabel);
    actions.push(() => handleDeleteTask(task));

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, destructiveButtonIndex: options.length - 1 },
        (buttonIndex) => {
          if (buttonIndex === 0) return;
          const action = actions[buttonIndex - 1];
          if (action) action();
        }
      );
    } else {
      Alert.alert(
        task.title || t("tasks.noTitle"),
        undefined,
        [
          { text: t("common.cancel"), style: "cancel" },
          ...(showMoveOption ? [{ text: moveLabel, onPress: () => handleMoveTask(task) }] : []),
          { text: editLabel, onPress: () => handleEditTask(task) },
          { text: deleteLabel, style: "destructive", onPress: () => handleDeleteTask(task) },
        ]
      );
    }
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

  const handleExportProtocol = async () => {
    try {
      const result = await exportProjectAsProtocol(projectId, {
        title: t("projectOverview.exportProtocol.title"),
        exportDate: t("projectOverview.exportProtocol.exportDate"),
        status: t("projectOverview.exportProtocol.status"),
        tasks: t("projectOverview.exportProtocol.tasks"),
        expenses: t("projectOverview.exportProtocol.expenses"),
        diary: t("projectOverview.exportProtocol.diary"),
        problems: t("projectOverview.exportProtocol.problems"),
        phase: t("projectOverview.exportProtocol.phase"),
        task: t("projectOverview.exportProtocol.task"),
        responsible: t("projectOverview.exportProtocol.responsible"),
        photos: t("projectOverview.exportProtocol.photos"),
        signature: t("projectOverview.exportProtocol.signature"),
        statusLabel: t("projectOverview.exportProtocol.statusLabel"),
        date: t("projectOverview.exportProtocol.date"),
        amount: t("projectOverview.exportProtocol.amount"),
        description: t("projectOverview.exportProtocol.description"),
        total: t("projectOverview.exportProtocol.total"),
        footer: t("projectOverview.exportProtocol.footer"),
      });
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
        ...(isOwner ? [{ key: "cover", label: t("cover.changeCover"), onPress: handleChangeCover }] : []),
        ...(whatsappDiaryEnabled ? [{ key: "updates", label: t("projectOverview.updates"), onPress: () => (navigation as any).navigate("Updates", { projectId }) }] : []),
        ...(contractorsEnabled ? [{ key: "suppliers", label: t("projectOverview.suppliers"), onPress: () => (navigation as any).navigate("ProjectSuppliers", { projectId }) }] : []),
        { key: "protocol", label: t("projectOverview.exportProtocol.title"), onPress: handleExportProtocol },
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
          ...(isOwner ? [{ text: t("cover.changeCover"), onPress: handleChangeCover }] : []),
          ...(whatsappDiaryEnabled ? [{ text: t("projectOverview.updates"), onPress: () => (navigation as any).navigate("Updates", { projectId }) }] : []),
          ...(contractorsEnabled ? [{ text: t("projectOverview.suppliers"), onPress: () => (navigation as any).navigate("ProjectSuppliers", { projectId }) }] : []),
          { text: t("projectOverview.exportProtocol.title"), onPress: handleExportProtocol },
          { text: t("projectOverview.exportToCsv"), onPress: handleExportCsv },
          ...(isOwner ? [{ text: t("projectOverview.deleteProject"), style: 'destructive', onPress: handleDeleteProject }] : []),
        ]
      );
    }
  };

  const handleEditProject = () => {
    setEditProjectName(projectName || "");
    setEditProjectAddress(addressText || "");
    setEditProjectCountry(projectCountryCode || "SK");
    setEditProjectCity(projectCity || "");
    setShowEditModal(true);
  };

  const handleChangeCover = useCallback(() => {
    const hasCover = !!coverImageUrl;
    const options = [
      t("cover.cancel"),
      t("cover.takePhoto"),
      t("cover.chooseFromGallery"),
      ...(hasCover ? [t("cover.remove")] : []),
    ];
    const cancelIndex = 0;
    const takeIndex = 1;
    const chooseIndex = 2;
    const removeIndex = hasCover ? 3 : -1;

    const runUpload = async (action: "camera" | "gallery") => {
      try {
        const picked = await projectCoverService.pickCoverImageWithOptions(t, action);
        if (!picked?.uri) return;
        const { url, path } = await projectCoverService.uploadProjectCover(projectId, picked.uri);
        await projectCoverService.setProjectCover(projectId, { url, path }, coverImagePath);
        setCoverImageUrl(url);
        setCoverImagePath(path);
        await load(true);
      } catch (e: any) {
        const msg = e?.message || (typeof e === "string" ? e : t("cover.uploadError"));
        Alert.alert(t("common.error"), msg);
      }
    };

    const runRemove = async () => {
      try {
        await projectCoverService.removeProjectCover(projectId);
        setCoverImageUrl(undefined);
        setCoverImagePath(undefined);
        await load(true);
      } catch (e: any) {
        const msg = e?.message || (typeof e === "string" ? e : t("cover.uploadError"));
        Alert.alert(t("common.error"), msg);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex },
        async (buttonIndex) => {
          if (buttonIndex === takeIndex) await runUpload("camera");
          else if (buttonIndex === chooseIndex) await runUpload("gallery");
          else if (buttonIndex === removeIndex) await runRemove();
        }
      );
    } else {
      const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [
        { text: t("cover.cancel"), style: "cancel" },
        { text: t("cover.takePhoto"), onPress: () => runUpload("camera") },
        { text: t("cover.chooseFromGallery"), onPress: () => runUpload("gallery") },
      ];
      if (hasCover) {
        buttons.push({ text: t("cover.remove"), onPress: () => runRemove() });
      }
      Alert.alert(t("cover.changeTitle"), "", buttons);
    }
  }, [projectId, coverImageUrl, coverImagePath, t, load]);

  const handleSaveEdit = async () => {
    if (!editProjectName.trim() || !projectId) return;
    if (!ownerIdForWrite) {
      Alert.alert(t("common.error"), t("login.required") || "Musíte byť prihlásený.");
      return;
    }
    setSubmitting(true);
    try {
      console.log(
        `[ProjectOverview] Updating project ${projectId}: name="${editProjectName.trim()}", address="${editProjectAddress.trim()}"`
      );
      await projectsService.updateProject(
        ownerIdForWrite,
        projectId,
        editProjectName.trim(),
        editProjectAddress.trim(),
        editProjectCountry.trim() || null,
        editProjectCity.trim() || null
      );
      setShowEditModal(false);
      setEditProjectName("");
      setEditProjectAddress("");
      setEditProjectCountry("");
      setEditProjectCity("");
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
            if (!projectId) return;
            const uid = auth.currentUser?.uid ?? orgId;
            if (!uid) {
              Alert.alert(t("common.error"), t("createProject.notSignedIn"));
              return;
            }
            setSubmitting(true);
            try {
              console.log(`[ProjectOverview] Deleting project ${projectId}`);
              await projectsService.deleteProject(uid, projectId);
              Alert.alert(t("common.success"), t("projectOverview.projectDeleted"));
              // Navigate back to projects list
              navigation.goBack();
            } catch (error: any) {
              console.error(`[ProjectOverview] Error deleting project:`, error);
              const c = projectsService.getFirestoreErrorCode(error);
              const denied =
                c === "permission-denied" ||
                c === "firestore/permission-denied" ||
                c.includes("permission-denied");
              Alert.alert(
                t("common.error"),
                denied ? t("projectOverview.noPermission") : error instanceof Error ? error.message : t("common.error")
              );
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleMoveTask = (task: TaskDoc) => {
    if (!canMutateTasks) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    setMovingTask(task);
    setShowMoveTaskModal(true);
  };

  const handleMoveTaskToPhase = async (targetPhaseId: string | null, phaseDisplayName?: string) => {
    if (!canMutateTasks) {
      Alert.alert(t("common.error"), t("projectOverview.noPermission"));
      return;
    }
    if (!projectId || !movingTask) return;
    
    try {
      await moveTaskToPhase(projectId, movingTask.id, targetPhaseId, {
        phaseTitle: targetPhaseId === null ? null : phaseDisplayName,
      });
      
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

  const assigneeDisplay = (task: TaskDoc) => {
    const name = task.assigneeName?.trim();
    if (!name) return t("projectOverview.unassigned") || "Nepriradené";
    if (name === "—" || name === "\u2014" || name === "â€\"" || name === "-" || name === "–") return t("projectOverview.unassigned") || "Nepriradené";
    return name;
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
      if (!ownerIdForWrite || !projectId || !assigneeTask) return;
      tasksService
        .updateTaskAssignee(ownerIdForWrite, projectId, assigneeTask.id, candidate.assigneeId, candidate.assigneeName, {
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
    [assigneeTask, ownerIdForWrite, projectId, load, t]
  );

  // Expenses handlers
  const openExpenseModal = (expense?: ExpenseDoc, initialCategory?: "TRAVEL" | "WORK") => {
    if (expense) {
      setEditingExpense(expense);
      setExpenseTitle(expense.title);
      setExpenseAmount(expense.amount?.toString() || "");
      setExpenseDate(expense.date ? expense.date.split('T')[0] : new Date().toISOString().split('T')[0]);
      setExpenseNote(expense.note || "");
      setExpenseCategory((expense.category as 'WORK' | 'MATERIAL' | 'OTHER' | 'TRAVEL' | undefined) || undefined);
      setExpenseSupplierName(expense.supplierName || "");
      setExpenseSupplierIco(expense.supplierIco || "");
      setExpenseCurrency(expense.currency || "EUR");
      setExpensePhaseId(expense.phaseId || null);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseOcrStatus(null);
      setExpenseOcrExtractionSource(null);
      const t = expense.travel;
      setExpenseTravelFromAddress(t?.fromAddress ?? "");
      setExpenseTravelToAddress(t?.toAddress ?? "");
      setExpenseTravelFromCountry(
        parseCountryFromAddress(t?.fromAddress ?? "") ?? defaultCountry
      );
      setExpenseTravelToCountry(
        parseCountryFromAddress(t?.toAddress ?? "") ?? defaultCountry
      );
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
      setExpenseCurrency("EUR");
      setExpensePhaseId(null);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseOcrStatus(null);
      setExpenseOcrExtractionSource(null);
      setExpenseTravelFromAddress("");
      setExpenseTravelToAddress("");
      setExpenseTravelDistanceKm("");
      setExpenseTravelRatePerKm("0.30");
      setExpenseTravelRoundTrip(false);
      setExpenseTravelFromCountry(travelDefaultCountry);
      setExpenseTravelToCountry(travelDefaultCountry);
    }
    setShowExpenseModal(true);
  };

  const getExtractionSourceLabel = useCallback(
    (src: InvoiceExtractionSource | null | undefined) => {
      if (!src || src === "none") return null;
      if (src === "pdf-text") return t("expense.ocrSourcePdfText");
      if (src === "cloud-ocr") return t("expense.ocrSourceCloud");
      if (src === "image-ocr") return t("expense.ocrSourceImageOcr");
      if (src === "pdf-render-ocr") return t("expense.ocrSourcePdfRender");
      return null;
    },
    [t]
  );

  const applyOcrPrefill = (ocrResult: OcrResult | null) => {
    if (!ocrResult?.parsed) {
      // #region agent log
      fetch(`${Platform.OS === "android" ? "http://10.0.2.2" : "http://127.0.0.1"}:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b82e16" },
        body: JSON.stringify({
          sessionId: "b82e16",
          hypothesisId: "H3",
          location: "ProjectOverviewScreen.tsx:applyOcrPrefill",
          message: "skip_no_parsed",
          data: { status: ocrResult?.status ?? null, hasParsed: !!ocrResult?.parsed },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return;
    }
    const prefill = getConfidenceAwareExpensePrefill(ocrResult);
    // #region agent log
    fetch(`${Platform.OS === "android" ? "http://10.0.2.2" : "http://127.0.0.1"}:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b82e16" },
      body: JSON.stringify({
        sessionId: "b82e16",
        hypothesisId: "H3",
        location: "ProjectOverviewScreen.tsx:applyOcrPrefill",
        message: "prefill_values",
        data: {
          amount: prefill.amount ?? null,
          hasSupplier: !!prefill.supplierName,
          hasDate: !!prefill.issueDate,
          hasCurrency: !!prefill.currency,
          parsedTotal: ocrResult.parsed?.totalAmount ?? null,
          rawTextLen: ocrResult.rawText?.length ?? 0,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (__DEV__) {
      console.log(
        "[ProjectOverview] OCR prefill",
        prefillDebugPayload(ocrResult, buildExpenseDocumentPrefill(ocrResult))
      );
    }
    setExpenseTitle("");
    setExpenseNote("");
    if (prefill.amount) setExpenseAmount(prefill.amount);
    if (prefill.issueDate) setExpenseDate(prefill.issueDate);
    if (prefill.currency) setExpenseCurrency(prefill.currency);
    if (prefill.supplierName) setExpenseSupplierName(prefill.supplierName);
    if (prefill.supplierIco) setExpenseSupplierIco(prefill.supplierIco);
    setExpenseOcrLineItems(ocrResult.parsedDocument?.items ?? []);
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
    setExpenseOcrExtractionSource(null);
    if (editingExpense || !isExpenseOcrAttachmentKind(picked.kind) || !projectId) {
      // #region agent log
      fetch(`${Platform.OS === "android" ? "http://10.0.2.2" : "http://127.0.0.1"}:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b82e16" },
        body: JSON.stringify({
          sessionId: "b82e16",
          hypothesisId: "H1",
          location: "ProjectOverviewScreen.tsx:handlePickedExpenseAttachment",
          message: "early_exit_before_ocr",
          data: {
            editingExpense: !!editingExpense,
            ocrKindOk: isExpenseOcrAttachmentKind(picked.kind),
            hasProjectId: !!projectId,
            pickedKind: picked.kind,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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
        kind: picked.kind === "pdf" ? "pdf" : "image",
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
      const result = await processInvoiceAttachment({
        filePath: uploadedFilePath,
        mimeType: picked.mimeType,
        attachmentId: attachment.id,
        projectId,
        localPdfUri: picked.kind === "pdf" ? picked.uri : undefined,
      });
      // #region agent log
      fetch(`${Platform.OS === "android" ? "http://10.0.2.2" : "http://127.0.0.1"}:7281/ingest/2418b79b-8c5b-4006-a07d-878605a09a96`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b82e16" },
        body: JSON.stringify({
          sessionId: "b82e16",
          hypothesisId: "H2",
          location: "ProjectOverviewScreen.tsx:handlePickedExpenseAttachment",
          message: "processInvoiceAttachment_done",
          data: {
            status: result.status,
            errorCode: result.errorCode ?? null,
            extractionSource: result.extractionSource ?? null,
            totalAmount: result.parsed?.totalAmount ?? null,
            supplierLen: result.parsed?.supplierName?.length ?? 0,
            rawTextLen: result.rawText?.length ?? 0,
            docType: result.parsedDocument?.documentType ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setExpenseOcrStatus(result.status);
      setExpenseOcrExtractionSource(result.extractionSource ?? null);
      setExpenseOcrLineItems(result.parsedDocument?.items ?? []);
      if (result.status === "success") {
        applyOcrPrefill(result);
      } else {
        console.log("[OCR UI] error.code =", result.errorCode, "message=", result.errorCode);
        Alert.alert(t("common.warning"), getOcrFallbackMessage(result.errorCode, result.cooldownSeconds));
      }
    } catch (error: any) {
      console.error("[ProjectOverview] Auto OCR after pick failed:", error);
      console.log("[OCR UI] error.code =", error?.code, "message=", error?.message);
      setExpenseOcrStatus("failed");
      setExpenseOcrExtractionSource(null);
      setExpenseOcrLineItems([]);
      Alert.alert(t("common.warning"), getOcrFallbackMessage(error?.code || error?.message));
    } finally {
      setUploadingExpenseAttachment(false);
      setOcrLoading(false);
    }
  };

  const pickExpenseImage = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("projectOverview.imagePickerInstallCommand"));
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
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
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
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
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
      Alert.alert(t("common.error"), t("projectOverview.imagePickerInstallCommand"));
      return;
    }
    try {
      // Gallery first (allows multiple photos), then camera
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [t("common.cancel"), t("projectOverview.selectMultiplePhotos"), t("projectOverview.takePhoto")],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await launchGalleryForDiary();
            } else if (buttonIndex === 2) {
              await launchCameraForDiary();
            }
          }
        );
      } else {
        Alert.alert(
          t("projectOverview.selectSource") || 'Vyberte zdroj',
          t("projectOverview.selectSourceMessage") || 'Odkiaľ chcete pridať fotky?',
          [
            { text: t("common.cancel"), style: 'cancel' },
            { text: t("projectOverview.selectMultiplePhotos"), onPress: launchGalleryForDiary },
            { text: t("projectOverview.takePhoto"), onPress: launchCameraForDiary },
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
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        setDiaryAttachments((prev) => [
          ...prev,
          {
            uri: asset.uri,
            fileName: asset.fileName || `dennik_${Date.now()}.jpg`,
            mimeType: asset.mimeType || 'image/jpeg',
            kind: 'image' as const,
          },
        ]);
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
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      const assets = result?.assets ?? [];
      if (!result?.canceled && assets.length > 0) {
        const newAttachments = assets.map((asset) => ({
          uri: asset.uri,
          fileName: asset.fileName || `dennik_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
          kind: 'image' as const,
        }));
        setDiaryAttachments((prev) => [...prev, ...newAttachments]);
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

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        await handlePickedExpenseAttachment({
          uri: asset.uri,
          fileName: asset.fileName ?? (asset as { name?: string }).name ?? `faktura_${Date.now()}.pdf`,
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
    parsed: OcrParsed | null;
    defaultTitle: string;
    defaultAmount: string;
    defaultDate: string;
    defaultSupplierName?: string;
    defaultCurrency?: string;
    attachmentId?: string;
    storagePath?: string;
    /** Cloud enrichment — review hints, validation flags (additive). */
    expenseExtraction?: Record<string, unknown>;
    /** Truncated OCR plain text for audit (avoid huge navigation payloads). */
    ocrRawTextTruncated?: string;
    lineItems?: ParsedDocumentLineItem[];
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
    defaultCurrency?: string;
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
      const result = await processInvoiceAttachment({
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
        Alert.alert(t("common.warning"), getOcrFallbackMessage(result.errorCode, result.cooldownSeconds));
      }
      navigateToExpenseReview({
        ...input,
        status: result.status,
        parsed: result.parsed,
        expenseExtraction: result.expenseExtraction,
        ocrRawTextTruncated: result.rawText?.slice(0, 12_000),
        lineItems: result.parsedDocument?.items ?? [],
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
    if (!projectId || !ownerIdForWrite) return;
    const canUseOcrDraft = !editingExpense && isExpenseOcrAttachmentKind(expenseAttachment?.kind);
    const isTravel = expenseCategory === "TRAVEL";

    let titleValue: string;
    let amount: number | null = null;
    let travelData: { fromAddress: string; toAddress: string; distanceKm: number; ratePerKm: number; roundTrip: boolean } | undefined;

    if (isTravel) {
      const from = expenseTravelFromAddress.trim();
      const to = expenseTravelToAddress.trim();
      const km = parseFloat(expenseTravelDistanceKm.replace(",", "."));
      if (!from || !to) {
        Alert.alert(t("common.error"), t("expense.enterAddressAandB"));
        return;
      }
      if (!Number.isFinite(km) || km <= 0) {
        Alert.alert(t("common.error"), t("expense.enterValidDistanceKm"));
        return;
      }
      const rateRaw = parseFloat(expenseTravelRatePerKm.replace(",", "."));
      if (!Number.isFinite(rateRaw) || rateRaw <= 0) {
        Alert.alert(t("common.error"), t("expenses.travel.enterValidRate"));
        return;
      }
      const rate = rateRaw;
      const effectiveKm = expenseTravelRoundTrip ? km * 2 : km;
      amount = Math.round(effectiveKm * rate * 100) / 100;
      titleValue = t("expense.travelDisplay", { from, to });
      setExpenseTitle(titleValue);
      travelData = { fromAddress: from, toAddress: to, distanceKm: km, ratePerKm: rate, roundTrip: expenseTravelRoundTrip };
    } else {
      const trimmedTitle = expenseTitle.trim();
      if (!trimmedTitle) {
        Alert.alert(t("common.error"), t("projectOverview.expenseTitleRequired"));
        return;
      }
      titleValue = trimmedTitle;
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
      Alert.alert(t("common.error"), t("expense.selectTypeWorkMaterialTravel"));
      return;
    }
    
    const expenseDateObj = new Date(expenseDate);
    if (Number.isNaN(expenseDateObj.getTime())) {
      Alert.alert(t("common.error"), t("projectOverview.expenseDatePlaceholder"));
      return;
    }

    setSubmitting(true);
    let openedOcrReview = false;
    let savedExpenseId: string | null = null;
    let savedAttachmentIdForImport: string | null = null;
    try {
      const form = {
        editing: !!editingExpense,
        title: titleValue,
        amount,
        category: expenseCategory,
        expenseDate,
        currency: expenseCurrency,
        phaseId: expensePhaseId,
        note: expenseNote,
        supplierName: expenseSupplierName,
        supplierIco: expenseSupplierIco,
        ocrStatus: expenseOcrStatus,
        attachments: expensePreuploadedAttachment
          ? {
              mode: "preuploaded" as const,
              attachmentId: expensePreuploadedAttachment.attachmentId,
              storagePath: expensePreuploadedAttachment.storagePath,
              mimeType: expensePreuploadedAttachment.mimeType,
              kind: expensePreuploadedAttachment.kind,
              fileName: expensePreuploadedAttachment.fileName,
              isLinkedToExpense: expensePreuploadedAttachment.isLinkedToExpense,
              linkedExpenseId: expensePreuploadedAttachment.linkedExpenseId,
              localUriLen: expensePreuploadedAttachment.localUri?.length,
            }
          : expenseAttachment
            ? {
                mode: "local" as const,
                kind: expenseAttachment.kind,
                fileName: expenseAttachment.fileName,
                mimeType: expenseAttachment.mimeType,
                uriLen: expenseAttachment.uri?.length,
              }
            : null,
        receipt: {
          ocrStatus: expenseOcrStatus,
          supplierDraft: expenseSupplierName.trim() || null,
        },
        travel: travelData ?? null,
      };
      try {
        console.log("[saveExpense] form", JSON.stringify(form, null, 2));
        console.log("[saveExpense] attachments", JSON.stringify(form?.attachments ?? null, null, 2));
        console.log("[saveExpense] receipt", JSON.stringify(form?.receipt ?? null, null, 2));
        console.log("[saveExpense] travel", JSON.stringify(form?.travel ?? null, null, 2));
      } catch (logErr) {
        console.warn("[saveExpense] debug log failed:", logErr);
      }

      if (__DEV__) {
        console.log("[saveExpense] pre-persist", {
          editing: !!editingExpense,
          travelData: travelData ?? null,
          selectedAttachment: expensePreuploadedAttachment
            ? { mode: "preuploaded" as const, attachmentId: expensePreuploadedAttachment.attachmentId }
            : expenseAttachment
              ? { mode: "local" as const, kind: expenseAttachment.kind, fileName: expenseAttachment.fileName }
              : null,
          ocr: { expenseOcrStatus, canUseOcrDraft },
          amount,
          currency: expenseCurrency,
        });
      }

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
          ...(travelData != null ? { travel: travelData } : {}),
        });
        Alert.alert(t("common.success"), t("projectOverview.expenseUpdated"));
      } else {
        const newExpense = await expensesService.createExpense(ownerIdForWrite, projectId, {
          title: titleValue,
          amount,
          currency: expenseCurrency || "EUR",
          date: expenseDateObj,
          note: expenseNote.trim() || undefined,
          category: expenseCategory,
          supplierName: expenseSupplierName.trim() || undefined,
          supplierIco: expenseSupplierIco.trim() || undefined,
          phaseId: expensePhaseId || undefined,
          source: (expenseAttachment || expensePreuploadedAttachment) ? "DOCUMENT" : "MANUAL",
          status: "READY",
          uploadStatus: expensePreuploadedAttachment ? "uploaded" : (expenseAttachment ? "pending" : undefined),
          ocrStatus: isExpenseOcrAttachmentKind(expenseAttachment?.kind)
            ? (expenseOcrStatus === "success" ? "done" : (expenseOcrStatus ? "failed" : "pending"))
            : undefined,
          filePath: expensePreuploadedAttachment?.storagePath ?? null,
          mimeType: expensePreuploadedAttachment?.mimeType ?? expenseAttachment?.mimeType ?? null,
          ocrCurrency: expenseCurrency || "EUR",
          attachments:
            form.attachments == null
              ? []
              : Array.isArray(form.attachments)
                ? form.attachments
                : [form.attachments],
          receipt: form.receipt,
          travel: travelData ?? null,
        });
        savedExpenseId = newExpense.id;

        if (expensePreuploadedAttachment) {
          attachmentId = expensePreuploadedAttachment.attachmentId;
          savedAttachmentIdForImport = attachmentId;
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
            ocrStatus: isExpenseOcrAttachmentKind(expenseAttachment?.kind)
              ? (expenseOcrStatus === "success" ? "done" : (expenseOcrStatus ? "failed" : "pending"))
              : undefined,
            ocrSupplierName: expenseSupplierName.trim() || null,
            ocrIssueDate: expenseDate || null,
            ocrTotalAmount: amount ?? null,
            ocrCurrency: expenseCurrency || "EUR",
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
            savedAttachmentIdForImport = attachmentId;
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
              ocrStatus: isExpenseOcrAttachmentKind(expenseAttachment.kind) ? "pending" : undefined,
              ocrSupplierName: expenseSupplierName.trim() || null,
              ocrIssueDate: expenseDate || null,
              ocrTotalAmount: amount ?? null,
            });
            console.log(`[ProjectOverview] Uploaded expense attachment: ${attachmentId}`);

            if (isExpenseOcrAttachmentKind(expenseAttachment.kind) && attachmentStoragePath) {
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
                defaultCurrency: expenseCurrency || "EUR",
              });
            }
          } catch (error: any) {
            console.error(`[ProjectOverview] Error uploading expense attachment:`, error);
            await expensesService.updateExpense(projectId, newExpense.id, {
              uploadStatus: "failed",
              status: "READY",
              filePath: null,
              ocrStatus: isExpenseOcrAttachmentKind(expenseAttachment.kind) ? "failed" : undefined,
              mimeType: expenseAttachment.mimeType,
            });
            if (isExpenseOcrAttachmentKind(expenseAttachment.kind)) {
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
                defaultCurrency: expenseCurrency || "EUR",
              });
            } else {
              Alert.alert(t("common.warning"), t("projectOverview.expenseSavedAttachmentFailed"));
            }
          } finally {
            setUploadingExpenseAttachment(false);
          }
        }

        if (!openedOcrReview) {
          const shouldOfferMaterialImport =
            savedExpenseId &&
            savedAttachmentIdForImport &&
            expenseOcrLineItems.length > 0;
          if (shouldOfferMaterialImport && savedExpenseId && savedAttachmentIdForImport) {
            setMaterialImportSheet({
              projectId,
              expenseId: savedExpenseId,
              attachmentId: savedAttachmentIdForImport,
              currency: expenseCurrency || "EUR",
              supplierName: expenseSupplierName.trim() || undefined,
              expenseTitle: titleValue,
              expenseDate: expenseDate,
              items: expenseOcrLineItems,
            });
          } else {
            Alert.alert(t("common.success"), t("projectOverview.expenseAdded"));
          }
        }
      }
      setShowExpenseModal(false);
      setExpenseAttachment(null);
      setExpensePreuploadedAttachment(null);
      setExpenseOcrLineItems([]);
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
      const phaseName = entry.phaseId ? phasesForUi.find((p) => p.id === entry.phaseId)?.name : null;
      
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

  const openDiaryDetailModal = async (entry: DiaryEntryDoc) => {
    setViewingDiaryEntry(entry);
    setDiaryDetailAttachmentUrls(new Map());
    setDiaryDetailAttachmentDocs(new Map());
    const attachmentIds = entry.attachments || [];
    if (attachmentIds.length > 0) {
      const urlMap = new Map<string, string>();
      const docMap = new Map<string, AttachmentDoc>();
      for (const attId of attachmentIds) {
        try {
          const att = await attachmentsService.getAttachment(projectId, attId);
          if (att) {
            docMap.set(attId, att);
            if (isAttachmentImage(att)) {
              const url = (att as AttachmentDoc & { downloadURL?: string }).downloadURL
                ?? (await attachmentsService.getAttachmentURL(att));
              urlMap.set(attId, url);
            }
          }
        } catch (e) {
          console.warn(`[ProjectOverview] Failed to load diary attachment ${attId}:`, e);
        }
      }
      setDiaryDetailAttachmentUrls(urlMap);
      setDiaryDetailAttachmentDocs(docMap);
    }
  };

  const openDiaryImage = (attachmentId: string) => {
    const att = diaryDetailAttachmentDocs.get(attachmentId);
    const url = diaryDetailAttachmentUrls.get(attachmentId);
    if (att && url) {
      openAttachmentPreview(att, url, "diaryGallery");
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
    if (!projectId || !ownerIdForWrite) return;
    
    // Validate: need either text or voice recording
    if (!diaryWorkDescription.trim() && !diaryWorkDescriptionRecordingUri) {
      Alert.alert(t("common.error"), t("projectOverview.fillWorkDescription"));
      return;
    }
    
    setSubmitting(true);
    try {
      const entryDate = new Date(diaryDate);
      let attachmentIds: string[] = [];
      
      // Upload photo attachments if provided
      if (diaryAttachments.length > 0) {
        try {
          setUploadingDiaryAttachment(true);
          for (const att of diaryAttachments) {
            const attachment = await attachmentsService.uploadAttachment(projectId, {
              expenseId: null,
              taskId: null,
              phaseId: diaryPhaseId,
              localUri: att.uri,
              fileName: att.fileName,
              mimeType: att.mimeType,
              kind: att.kind,
            });
            attachmentIds.push(attachment.id);
            console.log(`[ProjectOverview] Uploaded diary attachment: ${attachment.id}`);
          }
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
      if (diaryWorkDescriptionRecordingUri) {
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
            workDescriptionText = t("projectOverview.voiceMessage");
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
        await constructionDiaryService.createDiaryEntry(ownerIdForWrite, projectId, {
          date: entryDate,
          weather: diaryWeather.trim() || undefined,
          workers: diaryWorkers.trim() || undefined,
          workDescription: workDescriptionText,
          materials: diaryMaterials.trim() || undefined,
          notes: undefined, // Notes field removed, using workDescription instead
          phaseId: diaryPhaseId,
          attachments: attachmentIds,
          projectName: projectName || null,
        });
        Alert.alert(t("common.success"), t("projectOverview.diaryEntryAdded"));
        if (paramProcessQuickNoteId && user?.id) {
          try {
            await quickNotesService.markQuickNoteProcessed(user.id, paramProcessQuickNoteId);
          } catch {
            /* ignore */
          }
          try {
            (navigation as unknown as { setParams?: (p: object) => void }).setParams?.({ processQuickNoteId: undefined });
          } catch {
            /* ignore */
          }
        }
      }
      
      setShowDiaryModal(false);
      setEditingDiaryEntry(null);
      setDiaryDate(new Date().toISOString().split('T')[0]);
      setDiaryWeather("");
      setDiaryWorkers("");
      setDiaryWorkDescription("");
      setDiaryWorkDescriptionRecordingUri(null);
      setShowDiaryDescriptionModal(false);
      setDiaryMaterials("");
      setDiaryPhaseId(null);
      setDiaryAttachments([]);
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

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        setDocumentAttachment({
          uri: asset.uri,
          fileName: asset.fileName ?? (asset as { name?: string }).name ?? `dokument_${Date.now()}.pdf`,
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
    if (!documentName.trim() || !projectId || !ownerIdForWrite) return;
    
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
        
        await projectDocumentsService.createProjectDocument(ownerIdForWrite, projectId, {
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
      Alert.alert(t("common.error"), t("projectOverview.selectAttachmentFailed"));
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
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        await uploadAttachmentFile(asset.uri, asset.fileName || 'image.jpg', 'image');
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
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        await uploadAttachmentFile(asset.uri, asset.fileName || 'image.jpg', 'image');
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
        mediaTypes: ["videos"],
        allowsEditing: false,
        quality: 1.0,
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        await uploadAttachmentFile(
          asset.uri, 
          asset.fileName || `video_${Date.now()}.mp4`, 
          'document',
          asset.mimeType || 'video/mp4'
        );
      }
    } catch (error: any) {
      console.error(`[ProjectOverview] Error picking video:`, error);
      Alert.alert(t("common.error"), t("projectOverview.selectVideoFailed"));
    }
  };

  const pickDocument = async () => {
    if (!DocumentPicker) {
      Alert.alert(t("common.error"), t("projectOverview.documentPickerInstallCommand"));
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
      });

      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const kind = asset.mimeType?.includes('pdf') ? 'pdf' : 
                     asset.mimeType?.startsWith('image/') ? 'image' : 'document';
        const fileName = asset.fileName ?? (asset as { name?: string }).name ?? 'document';
        await uploadAttachmentFile(asset.uri, fileName, kind, asset.mimeType);
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
    if (!projectId || !ownerIdForWrite || !attachmentContext) return;

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

  const attachmentPreviewHost = (uri: string): string | null => {
    try {
      return new URL(uri).host;
    } catch {
      return null;
    }
  };

  const openAttachmentPreview = (
    attachment: AttachmentDoc,
    url: string,
    openSource: string
  ) => {
    if (__DEV__) {
      const requestedMode = inferInAppViewerMode(attachment);
      const mode = resolveInAppViewerMode(requestedMode, url, attachment.fileName);
      console.log("[AttachmentPreviewDebug]", {
        event: "openPreview",
        openSource,
        fileName: attachment.fileName,
        mimeType: attachment.contentType || attachment.fileType,
        isImage: isAttachmentImage(attachment),
        isPdf: mode === "pdf",
        hasUrl: !!url,
        urlHost: attachmentPreviewHost(url),
        viewerMode: mode,
        requestedMode,
      });
    }
    setViewingAttachment(attachment);
    setViewingAttachmentURL(url);
  };

  const openAttachment = async (attachment: AttachmentDoc) => {
    try {
      let url: string;
      try {
        const attachmentData = attachment as AttachmentDoc & { downloadURL?: string };
        if (attachmentData.downloadURL) {
          url = attachmentData.downloadURL;
        } else {
          url = await attachmentsService.getAttachmentURL(attachment);
        }
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
            t("common.error"),
            t("projectOverview.failedToLoadAttachment", { error: errorMessage })
          );
        }
        return;
      }

      openAttachmentPreview(attachment, url, "projectAttachmentRow");
    } catch (error: any) {
      console.error(`[ProjectOverview] Error opening attachment:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenAttachment", { error: error.message || t("common.unknown") }));
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

  // Structure: BUILD (and MANAGEMENT build-like) = phased; plain TRADE/MAINTENANCE = flat unless tasks carry phaseId or AI template.
  const isTradeOrMaintenance = projectOverviewIsTradeOrMaintenanceFlatTasks(projectType);
  const supportsDiary = projectOverviewLoadsDiary(projectType);
  /** Show phased layout when BUILD-like, AI template, or TRADE tasks reference phases (persisted or synthetic rows). */
  const showPhaseGroupedTasks =
    isBuildLikeStorageType(projectType) ||
    templateId === "ai-generated" ||
    (isTradeOrMaintenance && hasPhaseLinksOnTasks);
  const tradeFlatNoPhaseUi =
    isTradeOrMaintenance && templateId !== "ai-generated" && !hasPhaseLinksOnTasks;
  /** AI template but nothing phase-shaped — fall back to flat list (tasks truly have no phaseId). */
  const aiPlanFallbackFlat =
    templateId === "ai-generated" &&
    phases.length === 0 &&
    tasks.length > 0 &&
    !hasPhaseLinksOnTasks;
  const renderTradeLikeFlatRows = tradeFlatNoPhaseUi || aiPlanFallbackFlat;

  const tasksByPhase = new Map<string, TaskDoc[]>();
  const phaseOrder: string[] = [];

  if (showPhaseGroupedTasks) {
    tasks.forEach((tk) => {
      let bucket: string | null = tk.phaseId?.trim() || null;
      if (!bucket && tk.phaseTitle?.trim()) {
        bucket = phaseTitleGroupKey(tk.phaseTitle.trim());
      }
      if (!bucket) return;
      if (!tasksByPhase.has(bucket)) tasksByPhase.set(bucket, []);
      tasksByPhase.get(bucket)!.push(tk);
    });
    phaseOrder.push(...phasesForUi.map((p) => p.id));
    const orphanPhaseIdsOnTasks = [...tasksByPhase.keys()].filter((id) => !phaseOrder.includes(id)).sort((a, b) =>
      a.localeCompare(b)
    );
    phaseOrder.push(...orphanPhaseIdsOnTasks);
  }

  const tasksWithoutPhase = showPhaseGroupedTasks
    ? tasks.filter((t) => !t.phaseId?.trim() && !t.phaseTitle?.trim())
    : [];
  
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
  
  console.log(
    `[ProjectOverview] Render: projectType="${projectType}", templateId="${templateId}", showPhaseGroupedTasks=${showPhaseGroupedTasks}, phases.length=${phases.length}, phasesForUi=${phasesForUi.length}, tasks.length=${tasks.length}, phaseOrder.length=${phaseOrder.length}`
  );
  if (phasesForUi.length > 0) {
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
        <TouchableOpacity
          onPress={goBack}
          style={styles.headerBack}
          hitSlop={ICON_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
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
        <TouchableOpacity
          onPress={goToMembers}
          style={styles.membersStrip}
          accessibilityRole="button"
          accessibilityLabel={t("projectOverview.members")}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          {projectType !== 'MAINTENANCE' && <Ionicons name="add" size={20} color={colors.textOnDark} style={{ marginLeft: 4 }} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerMenu}
          onPress={() => (navigation as any).navigate("ProjectOverviewDashboard", { projectId, projectName, projectType })}
          hitSlop={ICON_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={t("projectOverviewDashboard.title")}
        >
          <Ionicons name="stats-chart" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.headerMenu} 
          onPress={handleMenuPress}
          hitSlop={ICON_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Ionicons name="ellipsis-vertical" size={22} color={colors.textOnDark} />
        </TouchableOpacity>
      </View>

      {/* MAINTENANCE: Equipment section first - same card pattern as Service plans, Expenses */}
      {projectType === 'MAINTENANCE' && (
        <View style={styles.equipmentSectionCard}>
          <TouchableOpacity
            style={styles.equipmentSectionHeader}
            onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName })}
            activeOpacity={0.7}
          >
            <View style={styles.equipmentSectionHeaderLeft}>
              <Ionicons name="construct-outline" size={20} color={colors.text} style={{ marginRight: spacing.sm }} />
              <Text style={styles.equipmentSectionHeaderText}>{t("equipment.title")}</Text>
              <Text style={styles.equipmentSectionCount}>({equipmentList.length})</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          {equipmentList.length === 0 ? (
            <View style={styles.equipmentEmptyContent}>
              <Text style={styles.equipmentEmptyText}>{t("equipment.noEquipment") || "Žiadne zariadenia"}</Text>
              <Text style={styles.equipmentEmptyHint}>{t("equipment.emptySubtext") || "Pridajte zariadenie pomocou tlačidla nižšie"}</Text>
            </View>
          ) : (
            <View style={styles.equipmentContent}>
              <View style={styles.equipmentListRow}>
                {equipmentList.slice(0, 3).map((eq) => (
                  <TouchableOpacity
                    key={eq.id}
                    style={styles.equipmentChip}
                    onPress={() => (navigation as any).navigate('EquipmentDetail', { projectId, projectName, equipmentId: eq.id })}
                    onLongPress={() => {
                      Alert.alert(
                        t("equipment.archiveEquipment"),
                        t("equipment.archiveConfirm", { name: eq.name }),
                        [
                          { text: t("common.cancel"), style: "cancel" },
                          {
                            text: t("common.archive"),
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await equipmentService.archiveEquipment(projectId!, eq.id);
                                onRefresh();
                              } catch (e: any) {
                                Alert.alert(t("common.error"), e.message || t("equipment.archiveFailed"));
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
                    ) : (
                      <View style={[styles.equipmentChipImage, styles.equipmentChipImagePlaceholder]}>
                        <Ionicons name="construct-outline" size={18} color={colors.textMuted} />
                      </View>
                    )}
                    <Text style={styles.equipmentChipText} numberOfLines={1}>{eq.labelCode || eq.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.equipmentViewAll}
                onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName })}
              >
                <Text style={styles.equipmentViewAllText}>{t("projectOverview.viewAll") || "Zobraziť všetko"}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Address section - for non-MAINTENANCE, show here; MAINTENANCE shows it inside scroll (after Faults) */}
      {(addressText || isOwner) && projectType !== 'MAINTENANCE' && (
        <View style={styles.addressSection}>
          <View style={styles.addressTopRow}>
            <View style={styles.addressContent}>
              <Ionicons name="location" size={20} color={colors.primary} />
              <Text style={styles.addressText} numberOfLines={1}>
                {addressText?.trim() || t("projectOverview.noAddress")}
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
                  <Text style={styles.weatherDayLabel}>{day.label === "ZAJTRA" ? t("weather.tomorrow") : day.label === "POZAJTRA" ? t("weather.dayAfterTomorrow") : t("weather.today")}</Text>
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
            <Text style={styles.weatherErrorText}>{weatherError || t("projectOverview.weatherLoadFailed")}</Text>
          )}
        </View>
      )}

      {/* Scrollable content */}
      <ScrollView 
        style={styles.scrollContent}
        contentContainerStyle={[
          styles.scrollContentContainer,
          {
            paddingBottom:
              spacing.xl * 3 +
              (showAppBottomMenu ? getAppBottomMenuExtraPadding(insets.bottom) : Math.max(insets.bottom, spacing.lg)),
          },
        ]}
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
        {/* Time section moved lower (see "Time summary" near Problems) */}

        {/*
          Post-create empty-state hero. Shown for non-MAINTENANCE projects when
          there is no meaningful content yet, so the user immediately sees
          where to start. Auto-hides as soon as anything is added; can also be
          dismissed for the current session.
        */}
        {projectType !== 'MAINTENANCE'
          && !loading
          && !emptyHeroDismissed
          && tasks.length === 0
          && expenses.length === 0
          && diaryEntries.length === 0
          && projectDocuments.length === 0
          && (
          <View style={styles.emptyHeroCard}>
            <View style={styles.emptyHeroHeaderRow}>
              <View style={styles.emptyHeroIconWrap}>
                <Ionicons
                  name={projectType === 'TRADE' ? 'briefcase-outline' : 'clipboard-outline'}
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyHeroTitle}>
                  {projectType === 'TRADE'
                    ? t('projectOverview.emptyHero.titleTrade')
                    : t('projectOverview.emptyHero.titleBuild')}
                </Text>
                <Text style={styles.emptyHeroSubtitle}>
                  {t('projectOverview.emptyHero.subtitle')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEmptyHeroDismissed(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={t('projectOverview.emptyHero.dismiss')}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.emptyHeroActions}>
              {access.canWrite ? (
                <TouchableOpacity
                  style={styles.emptyHeroBtn}
                  onPress={() => setShowNewTask(true)}
                  accessibilityRole="button"
                >
                  <Ionicons name="checkbox-outline" size={20} color={colors.primary} />
                  <Text style={styles.emptyHeroBtnText}>{t('projectOverview.emptyHero.addTask')}</Text>
                </TouchableOpacity>
              ) : null}
              {access.canWrite ? (
                <TouchableOpacity
                  style={styles.emptyHeroBtn}
                  onPress={() => setShowExpenseModal(true)}
                  accessibilityRole="button"
                >
                  <Ionicons name="cash-outline" size={20} color={colors.primary} />
                  <Text style={styles.emptyHeroBtnText}>{t('projectOverview.emptyHero.addExpense')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.emptyHeroBtn}
                onPress={() => (navigation as any).navigate('ProjectDiaryOverview', { projectId, projectName })}
                accessibilityRole="button"
              >
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.emptyHeroBtnText}>{t('projectOverview.emptyHero.addNote')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.emptyHeroBtn}
                onPress={() => (navigation as any).navigate('ProjectPhotos', { projectId, projectName })}
                accessibilityRole="button"
              >
                <Ionicons name="image-outline" size={20} color={colors.primary} />
                <Text style={styles.emptyHeroBtnText}>{t('projectOverview.emptyHero.addPhoto')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* MAINTENANCE: Service plans section - same structure as Expenses/Diary for consistent sizing */}
        {projectType === 'MAINTENANCE' && (
          <View style={styles.expensesSection}>
            <TouchableOpacity
              style={styles.expensesHeader}
              onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName, openServiceRule: true })}
              activeOpacity={0.7}
            >
              <View style={styles.expensesHeaderLeft}>
                <Ionicons name="calendar-outline" size={20} color={colors.text} style={{ marginRight: spacing.sm }} />
                <Text style={styles.expensesHeaderText}>{t("equipment.servicePlans")}</Text>
                <Text style={styles.expensesCount}>({serviceRulesCount})</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
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
                {projectType === 'MAINTENANCE' ? (t("equipment.openServiceTasks") || "Open service tasks") : (t("projectOverview.phasesSection") || "Fázy a úlohy")}
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
          ) : (projectType === 'MAINTENANCE' ? displayTasksForMaintenance.length : tasks.length) === 0 &&
            ((!showPhaseGroupedTasks && isTradeOrMaintenance) ||
              (showPhaseGroupedTasks && phasesForUi.length === 0 && !hasPhaseLinksOnTasks)) ? (
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
        ) : renderTradeLikeFlatRows ? (
          // Plain TRADE / MAINTENANCE (non–AI wizard): flat list. AI-generated plans use phased layout below when phases load.
          <>
            {(projectType === "MAINTENANCE" ? displayTasksForMaintenance : tasks)
              .slice()
              .sort((a, b) => {
                const pa = a.phaseId ?? "";
                const pb = b.phaseId ?? "";
                if (pa !== pb) return pa.localeCompare(pb);
                return (a.title || "").localeCompare(b.title || "");
              })
              .map((task) => (
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
                  <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={3}>
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
              {canMutateTasks ? (
                <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.colAssignee, styles.assigneeCell]}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                </View>
              )}
              {canMutateTasks ? (
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
                    style={styles.phaseActionButton}
                    onPress={() => handleDeleteTask(task)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel={t("projectOverview.deleteTask")}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.taskMenuButton}
                    onPress={() => showTaskActionsMenu(task, false)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </>
              ) : null}
              </View>
            ))}
          </>
        ) : phasesForUi.length === 0 ? (
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
              const phase = phasesForUi.find((p) => p.id === phaseKey);
              const phaseExistsInFirestore = phases.some((p) => p.id === phaseKey);

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
                          {phaseExistsInFirestore ? (
                            <>
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
                            </>
                          ) : null}
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
                                  <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={3}>
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
                              {canMutateTasks ? (
                                <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                                  <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={[styles.colAssignee, styles.assigneeCell]}>
                                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                                  <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                                </View>
                              )}
                              {canMutateTasks ? (
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
                                    style={styles.phaseActionButton}
                                    onPress={() => handleDeleteTask(task)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityLabel={t("projectOverview.deleteTask")}
                                  >
                                    <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.taskMenuButton}
                                    onPress={() => showTaskActionsMenu(task, true)}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                  >
                                    <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
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
                          <Text style={[styles.taskTitle, task.status === "DONE" && styles.taskTitleDone]} numberOfLines={3}>
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
                      {canMutateTasks ? (
                        <TouchableOpacity style={[styles.colAssignee, styles.assigneeCell]} onPress={() => onAssigneePress(task)}>
                          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.colAssignee, styles.assigneeCell]}>
                          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                          <Text style={styles.assigneeText} numberOfLines={1}>{assigneeDisplay(task)}</Text>
                        </View>
                      )}
                      {canMutateTasks ? (
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
                            style={styles.phaseActionButton}
                            onPress={() => handleDeleteTask(task)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityLabel={t("projectOverview.deleteTask")}
                          >
                            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.taskMenuButton}
                            onPress={() => showTaskActionsMenu(task, true)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
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
                    options: [t("common.cancel"), t("expense.typeClassic"), t("expense.typeTravel")],
                    cancelButtonIndex: 0,
                  },
                  (i) => {
                    if (i === 1) openExpenseModal(undefined, "WORK");
                    if (i === 2) openExpenseModal(undefined, "TRAVEL");
                  }
                );
              } else {
                Alert.alert(
                  t("projectOverview.expenses"),
                  undefined,
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("expense.typeClassic"), onPress: () => openExpenseModal(undefined, "WORK") },
                    { text: t("expense.typeTravel"), onPress: () => openExpenseModal(undefined, "TRAVEL") },
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
                  ? t("expense.travelDisplay", { from: expense.travel!.fromAddress, to: expense.travel!.toAddress })
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

        {/* Project time — header navigates to ProjectTimeDetail; summary always visible. */}
        {!access.loading && canViewProjectTime && (
          <View style={styles.expensesSection}>
            <TouchableOpacity
              style={styles.expensesHeader}
              activeOpacity={0.7}
              onPress={() =>
                (navigation as any).navigate("ProjectTimeDetail", {
                  projectId,
                  projectName: projectName || undefined,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={t("projectOverview.viewAllProjectTime")}
            >
              <View style={styles.expensesHeaderLeft}>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.text}
                  style={{ marginRight: spacing.sm }}
                />
                <Text style={styles.expensesHeaderText}>{t("projectOverview.timeDetailTitle")}</Text>
                <Text style={styles.expensesCount}>
                  (
                  {projectTimeWeekEntryCount > 0
                    ? projectTimeWeekEntryCount
                    : projectHoursMinutes > 0
                      ? "…"
                      : 0}
                  )
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {timeCardLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                {access.canWriteTime ? (
                  <TouchableOpacity
                    onPress={() =>
                      (navigation as any).navigate("ProjectTimeDetail", {
                        projectId,
                        projectName: projectName || undefined,
                      })
                    }
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="add-circle" size={24} color={colors.primary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </TouchableOpacity>

            <View style={styles.expensesList}>
              {isTimerRunningOnThisProject ? (
                <View
                  style={[
                    styles.timeTimerRow,
                    styles.timeTimerRowInSlim,
                    { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
                  ]}
                >
                  <View style={styles.timeTimerRowLeft}>
                    <Text style={styles.timeTimerLabel}>{t("time.timerRunning")}</Text>
                    <Text key={timerTick} style={styles.timeTimerElapsed}>
                      {formatElapsedHms(activeTimer!.startedAt)}
                    </Text>
                  </View>
                  <View style={styles.timeTimerButtons}>
                    <TouchableOpacity
                      style={[styles.timeTimerBtn, timeStopLoading && { opacity: 0.6 }]}
                      disabled={timeStopLoading}
                      onPress={async () => {
                        setTimeStopLoading(true);
                        try {
                          await timeTracking.stopTimer(undefined, { knownActive: activeTimer ?? undefined });
                        } catch (e: any) {
                          Alert.alert(t("common.error"), e?.message || t("common.error"));
                        } finally {
                          setTimeStopLoading(false);
                          await loadProjectTimeSummary();
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("time.stop")}
                    >
                      <Text style={styles.timeTimerBtnText}>{t("time.stop")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.timeTimerBtnSecondary}
                      onPress={() =>
                        (navigation as any).navigate("ProjectTimeDetail", {
                          projectId,
                          projectName: projectName || undefined,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t("time.openTime")}
                    >
                      <Text style={styles.timeTimerBtnSecondaryText}>{t("time.openTime")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.7}
                style={{ paddingHorizontal: spacing.sm }}
                onPress={() =>
                  (navigation as any).navigate("ProjectTimeDetail", {
                    projectId,
                    projectName: projectName || undefined,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={t("projectOverview.viewAllProjectTime")}
              >
                <View style={styles.timeSummaryRow}>
                  <Text style={styles.timeSummaryLabel}>{t("time.today")}</Text>
                  <Text style={styles.timeSummaryValue}>{formatMinutes(projectTodayMinutes)}</Text>
                </View>
                <View style={styles.timeSummaryRow}>
                  <Text style={styles.timeSummaryLabel}>{t("time.thisWeek")}</Text>
                  <Text style={styles.timeSummaryValue}>{formatMinutes(projectWeekMinutes)}</Text>
                </View>
                <View style={styles.timeSummaryRow}>
                  <Text style={styles.timeSummaryLabel}>{t("time.total")}</Text>
                  <Text style={styles.timeSummaryValue}>{formatMinutes(projectHoursMinutes)}</Text>
                </View>
              </TouchableOpacity>
            </View>
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
                {(projectType === 'MANAGEMENT' || isTradeOrMaintenance) ? t("projectOverview.diary") : t("projectOverview.constructionDiary")}
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
                    <TouchableOpacity
                      style={styles.expenseInfo}
                      onPress={() => openDiaryDetailModal(entry)}
                      activeOpacity={0.7}
                    >
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
                    </TouchableOpacity>
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
                          setDiaryWorkDescriptionRecordingUri(null);
                          setDiaryMaterials(entry.materials || "");
                          setDiaryPhaseId(entry.phaseId || null);
                          setDiaryAttachments([]); // Reset new attachments when editing (existing attachments are already saved)
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
                                    Alert.alert(t("common.error"), error.message || t("projectOverview.failedToDeleteDiaryEntry"));
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

        {/* Problems Section - All project types */}
        {!access.loading && (
          <View style={styles.expensesSection}>
          <TouchableOpacity 
            style={styles.expensesHeader}
            onPress={() => (navigation as any).navigate("ProblemsList", { projectId, projectName, projectType })}
          >
            <View style={styles.expensesHeaderLeft}>
              <Ionicons 
                name="document-text-outline" 
                size={20} 
                color={colors.text} 
                style={{ marginRight: spacing.sm }}
              />
              <Text style={styles.expensesHeaderText}>
                {projectType === 'MAINTENANCE' ? t("problems.titlePoruchy") : projectType === 'TRADE' ? t("problems.titleReklamacie") : (projectType === 'BUILD' || projectType === 'MANAGEMENT') ? t("problems.titleDefekty") : projectType === 'RESIDENTIAL' ? t("problems.titleProblemy") : t("problems.title")}
              </Text>
              {openProblemsCount > 0 && (
                <View style={styles.problemsBadge}>
                  <Text style={styles.problemsBadgeText}>{openProblemsCount}</Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          </View>
        )}

        {/* MAINTENANCE: Address section at end of scroll (Equipment-first hierarchy) */}
        {projectType === 'MAINTENANCE' && (addressText || isOwner) && (
          <View style={[styles.addressSection, styles.addressSectionMaintenance]}>
            <View style={styles.addressTopRow}>
              <View style={styles.addressContent}>
                <Ionicons name="location" size={20} color={colors.primary} />
                <Text style={styles.addressText} numberOfLines={1}>
                  {addressText?.trim() || t("projectOverview.noAddress")}
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
                    <Text style={styles.weatherDayLabel}>{day.label === "ZAJTRA" ? t("weather.tomorrow") : day.label === "POZAJTRA" ? t("weather.dayAfterTomorrow") : t("weather.today")}</Text>
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
              <Text style={styles.weatherErrorText}>{weatherError || t("projectOverview.weatherLoadFailed")}</Text>
            )}
          </View>
        )}

        {/* Project materials — planned vs used (separate from expenses) */}
        {!access.loading && (access.isOwner || access.isMember) && (
          <TouchableOpacity
            style={styles.expensesSection}
            activeOpacity={0.85}
            onPress={() =>
              (navigation as { navigate: (name: string, params?: object) => void }).navigate(
                "ProjectMaterials",
                { projectId, projectName }
              )
            }
          >
            <View style={styles.expensesHeader}>
              <View style={styles.expensesHeaderLeft}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} style={{ marginRight: spacing.sm }} />
                <Text style={styles.expensesHeaderText}>{t("projectOverview.materials")}</Text>
              </View>
              <Ionicons name="cube-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.expensesList}>
              <Text style={styles.expenseNote}>
                {t("projectOverview.materialsSuggested")}: {materialPlannedCount} ·{" "}
                {t("projectOverview.materialsUsed")}: {materialUsedCount}
              </Text>
              <Text style={styles.expenseTitle}>
                {t("projectOverview.materialsTotal", {
                  amount: `${materialTotalPrice.toFixed(2)} ${materialCurrency}`,
                })}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Project documents — build-like projects (BUILD / legacy MANAGEMENT) */}
        {!access.loading && isBuildLikeStorageType(projectType) && access.canReadDocuments && (
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
            {access.canWrite && (access.isOwner || access.sharedItems?.documents !== false) && (
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
                            if (!doc.attachmentId) {
                              Alert.alert(t("common.error"), t("projectOverview.failedToOpenDocument"));
                              return;
                            }
                            const attachmentMeta = await attachmentsService.getAttachment(projectId, doc.attachmentId);
                            if (!attachmentMeta?.storagePath) {
                              Alert.alert(t("common.error"), t("projectOverview.failedToOpenDocument"));
                              return;
                            }
                            const url = await attachmentsService.getAttachmentURL(attachmentMeta);
                            openAttachmentPreview(attachmentMeta, url, "projectDocumentRow");
                          } catch (error: any) {
                            console.warn("[ProjectOverview] Error opening document:", error);
                            Alert.alert(t("common.error"), t("projectOverview.failedToOpenDocument"));
                          }
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      {access.canWrite && (access.isOwner || access.sharedItems?.documents !== false) && (
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
                                    Alert.alert(t("common.error"), error.message || t("projectOverview.failedToDeleteDocument"));
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
                  <Text style={styles.activityCount}>{visibleActivityEvents.length}</Text>
                  <Ionicons
                    name={activityExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.textMuted}
                  />
                </>
              )}
            </View>
          </TouchableOpacity>

          {visibleActivityEvents.length === 0 && !activityLoading ? (
            <Text style={styles.activityEmpty}>{t("home.noRecentActivity")}</Text>
          ) : (
            (activityExpanded ? visibleActivityEvents.slice(0, 4) : visibleActivityEvents.slice(0, 1)).map((event) => (
              <View key={event.id} style={styles.activityRow}>
                <Text style={styles.activitySummary} numberOfLines={1}>{formatEventSummary(t, event)}</Text>
                <Text style={styles.activityTime}>{formatActivityAge(event.createdAt)}</Text>
              </View>
            ))
          )}
          {!activityExpanded && visibleActivityEvents.length > 1 ? (
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
      <View style={[styles.bottomBar, { paddingBottom: spacing.md }]}>
        {projectType !== 'MAINTENANCE' && (
          <TouchableOpacity style={styles.listBtn}>
            <Ionicons name="swap-vertical" size={20} color={colors.textOnDark} style={{ marginRight: 6 }} />
            <Text style={styles.listBtnText}>{t("projectOverview.viewList")}</Text>
          </TouchableOpacity>
        )}
        {access.canWrite && (access.sharedItems.tasks || access.sharedItems.phases) ? (
          isTradeOrMaintenance ? (
            // For TRADE/RESIDENTIAL: text button; MAINTENANCE shows action menu (úloha + zariadenie + servisný plán)
            projectType === 'MAINTENANCE' ? (
              <View style={[styles.addEquipmentSplitRow, styles.addEquipmentSplitRowFull]}>
                <TouchableOpacity
                  style={[styles.addTaskButton, styles.addEquipmentPrimary]}
                  onPress={() => (navigation as any).navigate('EquipmentList', { projectId, projectName })}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.addTaskButtonText}>{t("projectOverview.addEquipmentCta") || "+ Add equipment"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.addEquipmentDropdown}
                  onPress={() => {
                    if (Platform.OS === 'ios' && ActionSheetIOS) {
                      ActionSheetIOS.showActionSheetWithOptions(
                        {
                          options: [t("common.cancel"), t("projectOverview.addServicePlan"), t("projectOverview.addTaskManual")],
                          cancelButtonIndex: 0,
                        },
                        (idx) => {
                          if (idx === 1) (navigation as any).navigate('EquipmentList', { projectId, projectName, openServiceRule: true });
                          else if (idx === 2) openNewTaskModal();
                        }
                      );
                    } else {
                      Alert.alert(
                        t("projectOverview.moreActions") || "More",
                        '',
                        [
                          { text: t("common.cancel"), style: 'cancel' },
                          { text: t("projectOverview.addServicePlan"), onPress: () => (navigation as any).navigate('EquipmentList', { projectId, projectName, openServiceRule: true }) },
                          { text: t("projectOverview.addTaskManual"), onPress: () => openNewTaskModal() },
                        ]
                      );
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
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

      {showAppBottomMenu ? <AppBottomMenu activeTab="Projects" /> : null}

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
                const taskAssigneeId = assigneeTask?.assigneeId ?? null;
                const taskAssigneeName = assigneeTask?.assigneeName?.trim();
                const isPlaceholder = !taskAssigneeName || taskAssigneeName === "—" || taskAssigneeName === "\u2014" || taskAssigneeName === "â€\"";
                const isSelected =
                  candidate.assigneeId !== null
                    ? assigneeTask?.assigneeId === candidate.assigneeId
                    : taskAssigneeId === null &&
                      (candidate.assigneeName === null ? (taskAssigneeName === null || isPlaceholder) : taskAssigneeName === candidate.assigneeName);
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

      {/* Time entry actions live in the dedicated time flow (not Project Overview) */}

      {/* Edit project modal */}
      <Modal visible={showEditModal} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <View style={styles.modal}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.lg }}
            >
              <Text style={styles.modalTitle}>Upraviť projekt</Text>
              <TextInput
                style={styles.input}
                value={editProjectName}
                onChangeText={setEditProjectName}
                placeholder={t("projectOverview.projectNamePlaceholder")}
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <Text style={styles.modalLabel}>{t("projects.country")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled style={{ marginBottom: spacing.sm }}>
                {COUNTRY_CODES.slice(0, 12).map((code) => (
                  <TouchableOpacity
                    key={code}
                    style={[styles.editCountryChip, editProjectCountry === code && styles.editCountryChipActive]}
                    onPress={() => setEditProjectCountry(code)}
                  >
                    <Text style={[styles.editCountryChipText, editProjectCountry === code && styles.editCountryChipTextActive]}>
                      {getLocalizedCountryName(code, locale)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.modalLabel}>{t("projects.city")}</Text>
              <TextInput
                style={styles.input}
                value={editProjectCity}
                onChangeText={setEditProjectCity}
                placeholder={t("projects.cityPlaceholder")}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.modalLabel}>{t("projects.address")}</Text>
              <TextInput
                style={styles.input}
                value={editProjectAddress}
                onChangeText={setEditProjectAddress}
                placeholder={t("projectOverview.projectAddressPlaceholder")}
                placeholderTextColor={colors.textMuted}
              />
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => {
                  setShowEditModal(false);
                  setEditProjectName("");
                  setEditProjectAddress("");
                  setEditProjectCountry("");
                  setEditProjectCity("");
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Expense modal */}
      <Modal visible={showExpenseModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <View style={[styles.modal, styles.expenseModal]}>
            <Text style={styles.modalTitle}>
              {editingExpense ? t("expense.edit") || 'Upraviť výdavok' : t("expense.add")}
            </Text>
            <ScrollView
              ref={expenseModalScrollRef}
              style={styles.expenseModalScroll}
              contentContainerStyle={styles.expenseModalScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
            {/* First choice: Klasický výdavok vs Cestovné (A-B) – form appears only after selection */}
            <View style={styles.expenseCategorySection}>
              <Text style={styles.expenseCategoryLabel}>{t("expense.type")}</Text>
              {!expenseCategory && (
                <Text style={[styles.expenseCategoryHint, { marginBottom: spacing.sm }]}>
                  {t("expense.selectTypeClassicOrTravel") || "Vyberte typ výdavku"}
                </Text>
              )}
              <View style={styles.expenseTypeChoiceRow}>
                <TouchableOpacity
                  style={[
                    styles.expenseTypeChoiceButton,
                    (expenseCategory === 'WORK' || expenseCategory === 'MATERIAL' || expenseCategory === 'OTHER') && styles.expenseTypeChoiceButtonActive,
                  ]}
                  onPress={() => {
                    if (expenseCategory === 'TRAVEL') {
                      setExpenseTravelFromAddress("");
                      setExpenseTravelToAddress("");
                      setExpenseTravelDistanceKm("");
                      setExpenseTravelRatePerKm("0.30");
                      setExpenseTravelRoundTrip(false);
                      setKmError(undefined);
                      setExpenseTravelFromCountry(travelDefaultCountry);
                      setExpenseTravelToCountry(travelDefaultCountry);
                    }
                    setExpenseCategory('WORK');
                  }}
                >
                  {(expenseCategory === 'WORK' || expenseCategory === 'MATERIAL' || expenseCategory === 'OTHER') ? (
                    <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseTypeChoiceButtonText,
                      (expenseCategory === 'WORK' || expenseCategory === 'MATERIAL' || expenseCategory === 'OTHER') && styles.expenseTypeChoiceButtonTextActive,
                    ]}
                  >
                    {t("expense.typeClassic")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.expenseTypeChoiceButton,
                    expenseCategory === 'TRAVEL' && styles.expenseTypeChoiceButtonActive,
                  ]}
                  onPress={() => {
                    if (expenseCategory !== 'TRAVEL') {
                      setExpenseAmount("");
                    }
                    setExpenseCategory('TRAVEL');
                    setExpenseTravelFromCountry(travelDefaultCountry);
                    setExpenseTravelToCountry(travelDefaultCountry);
                  }}
                >
                  {expenseCategory === "TRAVEL" ? (
                    <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                  ) : null}
                  <Text
                    style={[
                      styles.expenseTypeChoiceButtonText,
                      expenseCategory === 'TRAVEL' && styles.expenseTypeChoiceButtonTextActive,
                    ]}
                  >
                    {t("expense.typeTravel")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Classic: Faktúra, Suma, Typ (Práca/Materiál/Práca+Materiál) */}
            {(expenseCategory === 'WORK' || expenseCategory === 'MATERIAL' || expenseCategory === 'OTHER') && (
              <>
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
                      setExpenseOcrExtractionSource(null);
                    }}
                    style={styles.expenseAttachmentRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              )}
              {expenseOcrStatus === "success" &&
                expenseOcrExtractionSource &&
                expenseOcrExtractionSource !== "none" &&
                getExtractionSourceLabel(expenseOcrExtractionSource) ? (
                <Text style={styles.expenseOcrSourceHint}>
                  {getExtractionSourceLabel(expenseOcrExtractionSource)}
                </Text>
              ) : null}
              {uploadingExpenseAttachment && (
                <View style={styles.expenseAttachmentUploading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || 'Nahrava sa...'}</Text>
                </View>
              )}
            </View>

            <View style={styles.expenseAmountRow}>
              <TextInput
                style={[styles.input, styles.expenseAmountInput]}
                value={expenseAmount}
                onChangeText={handleAmountChange}
                placeholder={t("projectOverview.expenseAmountPlaceholder")}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity
                style={styles.expenseCurrencyTouchable}
                onPress={() => setShowCurrencyDropdown(true)}
              >
                <Text style={styles.expenseCurrencyLabel}>{expenseCurrency}</Text>
                <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              <CurrencyDropdown
                visible={showCurrencyDropdown}
                onClose={() => setShowCurrencyDropdown(false)}
                value={expenseCurrency}
                onSelect={setExpenseCurrency}
              />
            </View>

            <View style={styles.expenseCategorySection}>
              <Text style={styles.expenseCategoryLabel}>{t("expense.subTypeLabel") || "Práca / Materiál / Práca + Materiál"}</Text>
              <Text style={styles.expenseCategoryHint}>{t("expense.categoryHint")}</Text>
              <View style={styles.expenseCategoryButtons}>
                <TouchableOpacity
                  style={[styles.expenseCategoryButton, expenseCategory === 'WORK' && styles.expenseCategoryButtonActive]}
                  onPress={() => setExpenseCategory('WORK')}
                >
                  {expenseCategory === "WORK" ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} /> : null}
                  <Text style={[styles.expenseCategoryButtonText, expenseCategory === 'WORK' && styles.expenseCategoryButtonTextActive]}>{t("expense.typeWork")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.expenseCategoryButton, expenseCategory === 'MATERIAL' && styles.expenseCategoryButtonActive]}
                  onPress={() => setExpenseCategory('MATERIAL')}
                >
                  {expenseCategory === "MATERIAL" ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} /> : null}
                  <Text style={[styles.expenseCategoryButtonText, expenseCategory === 'MATERIAL' && styles.expenseCategoryButtonTextActive]}>{t("expense.typeMaterial")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.expenseCategoryButton, expenseCategory === 'OTHER' && styles.expenseCategoryButtonActive]}
                  onPress={() => setExpenseCategory('OTHER')}
                >
                  {expenseCategory === "OTHER" ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} /> : null}
                  <Text style={[styles.expenseCategoryButtonText, expenseCategory === 'OTHER' && styles.expenseCategoryButtonTextActive]}>{t("expense.typeWorkMaterial")}</Text>
                </TouchableOpacity>
              </View>
            </View>
              </>
            )}

            {/* Travel expense: route → distance → trip details → summary → optional receipt */}
            {expenseCategory === "TRAVEL" && (
              <View style={styles.travelFormOuter}>
                <View style={styles.travelSectionCard}>
                  <View style={styles.travelSectionHeaderRow}>
                    <Text style={styles.travelSectionTitle}>{t("expenses.travel.routeTitle")}</Text>
                    <TouchableOpacity
                      onPress={swapTravelRoute}
                      style={styles.travelSwapBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("expenses.travel.swapRoute")}
                    >
                      <Ionicons name="swap-horizontal" size={18} color={colors.textMuted} />
                      <Text style={styles.travelSwapBtnText}>{t("expenses.travel.swapRoute")}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.travelFieldLabel}>{t("expenses.travel.from")}</Text>
                  <View style={styles.travelAddressRow}>
                    <TextInput
                      style={[styles.input, styles.travelAddressInput]}
                      value={expenseTravelFromAddress}
                      onChangeText={(text) => {
                        setExpenseTravelFromAddress(text);
                        setKmError(undefined);
                      }}
                      placeholder={t("expense.placeholderAddressFrom")}
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity
                      style={styles.travelCountryChip}
                      onPress={() => setShowCountryPicker("from")}
                      accessibilityLabel={t("expense.travelCountry")}
                    >
                      <Text style={styles.travelCountryChipText}>
                        {EUROPEAN_COUNTRIES.find((c) => c.code === expenseTravelFromCountry)?.code ?? expenseTravelFromCountry}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <TravelRouteMiniDiagram />
                  <Text style={styles.travelFieldLabel}>{t("expenses.travel.to")}</Text>
                  <View style={styles.travelAddressRow}>
                    <TextInput
                      style={[styles.input, styles.travelAddressInput]}
                      value={expenseTravelToAddress}
                      onChangeText={(text) => {
                        setExpenseTravelToAddress(text);
                        setKmError(undefined);
                      }}
                      onBlur={handleAddressBBlur}
                      placeholder={t("expense.placeholderAddressTo")}
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity
                      style={styles.travelCountryChip}
                      onPress={() => setShowCountryPicker("to")}
                      accessibilityLabel={t("expense.travelCountry")}
                    >
                      <Text style={styles.travelCountryChipText}>
                        {EUROPEAN_COUNTRIES.find((c) => c.code === expenseTravelToCountry)?.code ?? expenseTravelToCountry}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.travelSectionCard}>
                  <Text style={styles.travelSectionTitle}>{t("expenses.travel.distanceKm")}</Text>
                  <Text style={styles.travelSectionHint}>{t("expenses.travel.manualDistanceHint")}</Text>
                  <View style={styles.travelKmRow}>
                    <TextInput
                      style={[styles.input, styles.travelKmInput]}
                      value={expenseTravelDistanceKm}
                      onChangeText={(text) => {
                        setExpenseTravelDistanceKm(text.replace(/[^\d.,]/g, "").replace(",", "."));
                      }}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.travelKmSuffix}>km</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.travelCalcButton,
                      (!isOnline ||
                        expenseTravelFromAddress.trim().length < 3 ||
                        expenseTravelToAddress.trim().length < 3 ||
                        isLoadingDistance) &&
                        styles.travelCalcButtonDisabled,
                    ]}
                    onPress={handleCalculateDistanceKm}
                    disabled={
                      !isOnline ||
                      expenseTravelFromAddress.trim().length < 3 ||
                      expenseTravelToAddress.trim().length < 3 ||
                      isLoadingDistance
                    }
                  >
                    {isLoadingDistance ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Ionicons name="navigate-outline" size={18} color={colors.primary} style={{ marginRight: spacing.xs }} />
                        <Text style={styles.travelCalcButtonText}>{t("expenses.travel.calculateDistance")}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {(!isOnline ||
                    expenseTravelFromAddress.trim().length < 3 ||
                    expenseTravelToAddress.trim().length < 3 ||
                    isLoadingDistance) &&
                  travelCalcDisabledHint ? (
                    <Text style={styles.travelCalcHint}>{travelCalcDisabledHint}</Text>
                  ) : null}
                  <Text style={styles.travelOrManual}>{t("expenses.travel.orEnterManually")}</Text>
                  {kmError ? (
                    <>
                      <Text style={styles.kmErrorText}>{kmError}</Text>
                      <Text style={styles.travelCalcHint}>{t("expenses.travel.distanceFailedManual")}</Text>
                    </>
                  ) : null}
                </View>

                <View style={styles.travelSectionCard}>
                  <Text style={styles.travelSectionTitle}>{t("expenses.travel.tripDetails")}</Text>
                  <Text style={styles.travelFieldLabel}>{t("expenses.travel.tripDate")}</Text>
                  <TouchableOpacity
                    style={styles.dateInputButton}
                    onPress={() => {
                      const currentDate = expenseDate ? new Date(expenseDate) : new Date();
                      setDatePickerDate(currentDate);
                      setDatePickerMode("expense");
                      setShowDatePicker(true);
                    }}
                  >
                    <Text style={styles.dateInputText}>{expenseDate || t("projectOverview.selectDate")}</Text>
                    <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.travelRoundTripSwitchRow}>
                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                      <Text style={styles.travelRoundTripLabel}>{t("expenses.travel.roundTrip")}</Text>
                      <Text style={styles.travelRoundTripHint}>{t("expenses.travel.roundTripHint")}</Text>
                    </View>
                    <Switch
                      value={expenseTravelRoundTrip}
                      onValueChange={setExpenseTravelRoundTrip}
                      trackColor={{ false: colors.border, true: `${colors.primary}55` }}
                      thumbColor={expenseTravelRoundTrip ? colors.primary : colors.textMuted}
                    />
                  </View>
                  <Text style={styles.travelFieldLabel}>{t("expenses.travel.ratePerKm")}</Text>
                  <TextInput
                    style={[styles.input, styles.travelRateInputWide]}
                    value={expenseTravelRatePerKm}
                    onChangeText={(text) => setExpenseTravelRatePerKm(text.replace(/[^\d.,]/g, "").replace(",", "."))}
                    placeholder="0.30"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View style={styles.travelSummaryCard}>
                  <Text style={styles.travelSectionTitle}>{t("expenses.travel.summaryTitle")}</Text>
                  {(() => {
                    const km = parseFloat(expenseTravelDistanceKm.replace(",", "."));
                    const rate = parseFloat(expenseTravelRatePerKm.replace(",", "."));
                    if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(rate) || rate <= 0) {
                      return <Text style={styles.travelSummaryEmpty}>{t("expenses.travel.summaryEmpty")}</Text>;
                    }
                    const mid = expenseTravelRoundTrip ? "2 × " : "";
                    const total = Math.round(km * (expenseTravelRoundTrip ? 2 : 1) * rate * 100) / 100;
                    const kmStr = String(Math.round(km * 10) / 10);
                    const rateStr = rate.toFixed(2);
                    const totalStr = total.toFixed(2);
                    return (
                      <Text style={styles.travelSummaryFormula}>
                        {t("expenses.travel.summaryFormula", { km: kmStr, mid, rate: rateStr, total: totalStr })}
                      </Text>
                    );
                  })()}
                </View>

                <View style={[styles.expenseAttachmentSection, styles.travelReceiptSection]}>
                  <Text style={styles.expenseAttachmentLabel}>{t("expenses.travel.receiptOptional")}</Text>
                  <View style={styles.expenseAttachmentButtons}>
                    <TouchableOpacity
                      style={[
                        styles.expenseAttachmentButtonSecondary,
                        (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled,
                      ]}
                      onPress={pickExpenseImage}
                      disabled={uploadingExpenseAttachment || submitting}
                    >
                      <Ionicons name="image-outline" size={18} color={colors.text} />
                      <Text style={styles.expenseAttachmentButtonTextMuted}>{t("expense.photo")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.expenseAttachmentButtonSecondary,
                        (uploadingExpenseAttachment || submitting) && styles.expenseAttachmentButtonDisabled,
                      ]}
                      onPress={pickExpenseDocument}
                      disabled={uploadingExpenseAttachment || submitting}
                    >
                      <Ionicons name="document-outline" size={18} color={colors.text} />
                      <Text style={styles.expenseAttachmentButtonTextMuted}>{t("expense.pdf")}</Text>
                    </TouchableOpacity>
                  </View>
                  {expenseAttachment && (
                    <View style={styles.expenseAttachmentPreview}>
                      <Ionicons
                        name={expenseAttachment.kind === "image" ? "image-outline" : "document-outline"}
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
                          setExpenseOcrExtractionSource(null);
                        }}
                        style={styles.expenseAttachmentRemove}
                      >
                        <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}
                  {expenseOcrStatus === "success" &&
                  expenseOcrExtractionSource &&
                  expenseOcrExtractionSource !== "none" &&
                  getExtractionSourceLabel(expenseOcrExtractionSource) ? (
                    <Text style={styles.expenseOcrSourceHint}>{getExtractionSourceLabel(expenseOcrExtractionSource)}</Text>
                  ) : null}
                  {uploadingExpenseAttachment && (
                    <View style={styles.expenseAttachmentUploading}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || "…"}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Form fields – only after type is selected */}
            {(expenseCategory === 'WORK' || expenseCategory === 'MATERIAL' || expenseCategory === 'OTHER' || expenseCategory === 'TRAVEL') && (
              <>
            {/* Supplier */}
            <TextInput
              style={[styles.input, styles.expenseInputCompact]}
              value={expenseSupplierName}
              onChangeText={setExpenseSupplierName}
              placeholder={t("expense.supplierName") || "Meno dodávateľa (voliteľné)"}
              placeholderTextColor={colors.textMuted}
            />
            {/* Tax ID */}
            <TextInput
              style={[styles.input, styles.expenseInputCompact]}
              value={expenseSupplierIco}
              onChangeText={setExpenseSupplierIco}
              placeholder={t("expense.supplierTaxId") || "Daňové identifikačné číslo (voliteľné)"}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />

            <TextInput
              style={[styles.input, styles.expenseInputCompact]}
              value={expenseTitle}
              onChangeText={setExpenseTitle}
              placeholder={t("projectOverview.expenseTitlePlaceholder") || "Názov výdavku *"}
              placeholderTextColor={colors.textMuted}
              autoFocus={expenseCategory !== "TRAVEL"}
            />
            {expenseCategory !== 'TRAVEL' && (
            <TouchableOpacity
              style={[styles.dateInputButton, styles.expenseDateCompact]}
              onPress={() => {
                const currentDate = expenseDate ? new Date(expenseDate) : new Date();
                setDatePickerDate(currentDate);
                setDatePickerMode("expense");
                setShowDatePicker(true);
              }}
            >
              <Text style={styles.dateInputText}>
                {expenseDate || t("projectOverview.selectDate")}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            )}
            <TextInput
              style={[styles.input, styles.expenseNoteInput]}
              value={expenseNote}
              onChangeText={setExpenseNote}
              onFocus={() => {
                setTimeout(() => expenseModalScrollRef.current?.scrollToEnd({ animated: true }), 300);
              }}
              placeholder={t("projectOverview.expenseNotePlaceholder")}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={2}
            />
              </>
            )}
            
            </ScrollView>
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
                  setExpenseOcrStatus(null);
                  setExpenseOcrExtractionSource(null);
                  setExpenseTravelFromAddress("");
                  setExpenseTravelToAddress("");
                  setExpenseTravelDistanceKm("");
                  setExpenseTravelRatePerKm("0.30");
                  setExpenseTravelRoundTrip(false);
                  setExpenseTravelFromCountry(travelDefaultCountry);
                  setExpenseTravelToCountry(travelDefaultCountry);
                  setKmError(undefined);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.modalOk,
                  (!expenseCategory
                    || (expenseCategory === "TRAVEL"
                      ? (() => {
                          const kmN = parseFloat(expenseTravelDistanceKm.replace(",", "."));
                          const rateN = parseFloat(expenseTravelRatePerKm.replace(",", "."));
                          return (
                            !expenseTravelFromAddress.trim() ||
                            !expenseTravelToAddress.trim() ||
                            !Number.isFinite(kmN) ||
                            kmN <= 0 ||
                            !Number.isFinite(rateN) ||
                            rateN <= 0
                          );
                        })()
                      : !expenseTitle.trim())
                    || submitting
                    || uploadingExpenseAttachment
                    || ocrLoading
                  ) && styles.modalOkDisabled,
                ]} 
                onPress={handleSaveExpense} 
                disabled={
                  !expenseCategory
                  || (expenseCategory === "TRAVEL"
                    ? (() => {
                        const kmN = parseFloat(expenseTravelDistanceKm.replace(",", "."));
                        const rateN = parseFloat(expenseTravelRatePerKm.replace(",", "."));
                        return (
                          !expenseTravelFromAddress.trim() ||
                          !expenseTravelToAddress.trim() ||
                          !Number.isFinite(kmN) ||
                          kmN <= 0 ||
                          !Number.isFinite(rateN) ||
                          rateN <= 0
                        );
                      })()
                    : !expenseTitle.trim())
                  || submitting
                  || uploadingExpenseAttachment
                  || ocrLoading
                }
              >
                <Text style={styles.modalOkText}>
                  {submitting
                    ? t("common.saving")
                    : editingExpense
                      ? t("common.save")
                      : expenseCategory === "TRAVEL"
                        ? t("expenses.travel.addTravelExpense")
                        : t("common.add")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Country picker for travel addresses */}
      <Modal visible={showCountryPicker !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("expense.travelCountry") || "Krajina"}</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.travelCountryPickerList}
              contentContainerStyle={styles.travelCountryPickerListContent}
            >
              {EUROPEAN_COUNTRIES.map((c) => {
                const selected =
                  (showCountryPicker === "from" && expenseTravelFromCountry === c.code) ||
                  (showCountryPicker === "to" && expenseTravelToCountry === c.code);
                return (
                  <TouchableOpacity
                    key={c.code}
                    onPress={() => {
                      if (showCountryPicker === "from") setExpenseTravelFromCountry(c.code);
                      if (showCountryPicker === "to") setExpenseTravelToCountry(c.code);
                      setShowCountryPicker(null);
                    }}
                    style={[styles.travelCountryPickerRow, selected && styles.travelCountryPickerRowActive]}
                  >
                    <Text style={[styles.travelCountryPickerLabel, selected && styles.travelCountryPickerLabelActive]}>
                      {c.code} – {c.name}
                    </Text>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* OCR loading */}
      <Modal visible={ocrLoading} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.ocrModal}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.ocrText}>{t("expense.ocrAnalyzing")}</Text>
            <TouchableOpacity style={styles.ocrCancelButton} onPress={handleOcrCancel}>
              <Text style={styles.ocrCancelText}>{t("expense.proceedManually")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ExpenseLineItemsMaterialImportSheet
        visible={materialImportSheet != null}
        context={materialImportSheet}
        onDismiss={() => setMaterialImportSheet(null)}
      />

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
                  const isImage = isAttachmentImage(attachment);
                  
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

      <InAppAttachmentViewer
        visible={viewingAttachment !== null}
        onClose={() => {
          setViewingAttachment(null);
          setViewingAttachmentURL(null);
        }}
        url={viewingAttachmentURL}
        fileName={viewingAttachment?.fileName ?? ""}
        mode={viewingAttachment ? inferInAppViewerMode(viewingAttachment) : "image"}
        debugOpenSource="projectOverview"
      />

      {/* Diary entry detail modal - full overview */}
      <Modal visible={viewingDiaryEntry !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, styles.diaryDetailModal]}>
            <View style={styles.diaryDetailHeader}>
              <Text style={styles.diaryDetailTitle}>
                {viewingDiaryEntry ? formatDate(viewingDiaryEntry.date) : ""}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setViewingDiaryEntry(null);
                  setDiaryDetailAttachmentUrls(new Map());
                  setDiaryDetailAttachmentDocs(new Map());
                }}
                style={styles.diaryDetailCloseButton}
              >
                <Ionicons name="close" size={24} color={colors.textOnDark} />
              </TouchableOpacity>
            </View>
            {viewingDiaryEntry && (
              <ScrollView
                style={styles.diaryDetailScroll}
                contentContainerStyle={styles.diaryDetailContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.diaryDetailDescription}>{viewingDiaryEntry.workDescription}</Text>
                <View style={styles.diaryDetailMeta}>
                  {viewingDiaryEntry.weather && (
                    <View style={styles.diaryDetailMetaRow}>
                      <Ionicons name="partly-sunny-outline" size={18} color={colors.primary} />
                      <Text style={styles.diaryDetailMetaText}>{t("projectOverview.weather")}: {viewingDiaryEntry.weather}</Text>
                    </View>
                  )}
                  {viewingDiaryEntry.workers && (
                    <View style={styles.diaryDetailMetaRow}>
                      <Ionicons name="people-outline" size={18} color={colors.primary} />
                      <Text style={styles.diaryDetailMetaText}>{t("projectOverview.workers")}: {viewingDiaryEntry.workers}</Text>
                    </View>
                  )}
                  {viewingDiaryEntry.materials && (
                    <View style={styles.diaryDetailMetaRow}>
                      <Ionicons name="construct-outline" size={18} color={colors.primary} />
                      <Text style={styles.diaryDetailMetaText}>{t("projectOverview.materialsPlaceholder")}: {viewingDiaryEntry.materials}</Text>
                    </View>
                  )}
                  {viewingDiaryEntry.phaseId && (() => {
                    const phase = phasesForUi.find((p) => p.id === viewingDiaryEntry!.phaseId);
                    return phase ? (
                      <View style={styles.diaryDetailMetaRow}>
                        <Ionicons name="layers-outline" size={18} color={colors.primary} />
                        <Text style={styles.diaryDetailMetaText}>Fáza: {phase.name}</Text>
                      </View>
                    ) : null;
                  })()}
                </View>
                {viewingDiaryEntry.attachments && viewingDiaryEntry.attachments.length > 0 && (
                  <View style={styles.diaryDetailGallery}>
                    <Text style={styles.diaryDetailGalleryTitle}>
                      {t("taskDetail.attachments") || "Prílohy"} ({viewingDiaryEntry.attachments.length})
                    </Text>
                    <View style={styles.diaryDetailGalleryGrid}>
                      {viewingDiaryEntry.attachments.map((attId) => {
                        const url = diaryDetailAttachmentUrls.get(attId);
                        const att = diaryDetailAttachmentDocs.get(attId);
                        if (url && att && isAttachmentImage(att)) {
                          return (
                            <TouchableOpacity
                              key={attId}
                              style={styles.diaryDetailGalleryItem}
                              onPress={() => openDiaryImage(attId)}
                              activeOpacity={0.8}
                            >
                              <Image
                                source={{ uri: url }}
                                style={styles.diaryDetailGalleryImage}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          );
                        }
                        if (att) {
                          return (
                            <TouchableOpacity
                              key={attId}
                              style={[styles.diaryDetailGalleryItem, styles.diaryDetailGalleryDoc]}
                              onPress={async () => {
                                try {
                                  const u = await attachmentsService.getAttachmentURL(att);
                                  openAttachmentPreview(att, u, "diaryDocument");
                                } catch (e) {
                                  Alert.alert(t("common.error"), t("projectOverview.failedToLoadAttachments"));
                                }
                              }}
                            >
                              <Ionicons
                                name={att.fileType === "pdf" ? "document-text-outline" : "document-outline"}
                                size={32}
                                color={colors.primary}
                              />
                              <Text style={styles.diaryDetailGalleryDocName} numberOfLines={2}>{att.fileName}</Text>
                            </TouchableOpacity>
                          );
                        }
                        return null;
                      })}
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
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
                {editTaskDueDate || t("projectOverview.selectDate")}
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
                style={[styles.modalOk, (submitting || !editTaskTitle.trim()) && styles.modalOkDisabled]} 
                onPress={handleSaveEditTask} 
                disabled={submitting || !editTaskTitle.trim()}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : t("projectOverview.saveTask")}</Text>
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
                          } else if (datePickerMode === 'edit') {
                            setEditTaskDueDate(dateStr);
                          } else {
                            setExpenseDate(dateStr);
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
                    } else if (datePickerMode === 'edit') {
                      setEditTaskDueDate(dateStr);
                    } else {
                      setExpenseDate(dateStr);
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
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projectOverview.addTask")}</Text>
            
            {/* Phase selector when project uses phased tasks (BUILD or AI-generated structure). */}
            {(isBuildLikeStorageType(projectType) || templateId === "ai-generated" || hasPhaseLinksOnTasks) &&
              phasesForUi.length > 0 && (
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
                  {phasesForUi.map((phase) => (
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
            
            {/* Task description - same two-step flow as diary (Add description → modal) */}
            <Text style={styles.modalLabel}>{isTradeOrMaintenance ? t("projectOverview.workDescriptionLabel") : t("tasks.taskPlaceholder")}</Text>
            <TouchableOpacity
              style={styles.addDescriptionButton}
              onPress={() => setShowTaskDescriptionModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              <Text style={styles.addDescriptionButtonText}>
                {newTitle.trim() || recordingUri
                  ? (newTitle.trim() ? newTitle.slice(0, 50) + (newTitle.length > 50 ? "…" : "") : t("projectOverview.recordingReady"))
                  : t("projectOverview.addDescription")}
              </Text>
            </TouchableOpacity>

            <DescriptionInputModal
              visible={showTaskDescriptionModal}
              onClose={() => setShowTaskDescriptionModal(false)}
              onConfirm={(text, recUri) => {
                setNewTitle(text);
                setRecordingUri(recUri ?? null);
              }}
              initialText={newTitle}
              initialRecordingUri={recordingUri}
              placeholder={isTradeOrMaintenance ? t("projectOverview.descriptionPlaceholder") : t("tasks.taskPlaceholder")}
              title={isTradeOrMaintenance ? t("projectOverview.workDescriptionLabel") : t("projectOverview.addTask")}
            />
            
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
                {newTaskDueDate || t("projectOverview.selectDate")}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancel} 
                onPress={() => { 
                  setShowNewTask(false);
                  setNewTitle("");
                  setNewTaskDueDate("");
                  setSelectedPhaseId(null);
                  setRecordingUri(null);
                  setShowTaskDescriptionModal(false);
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Construction Diary Modal */}
      <Modal visible={showDiaryModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modal, styles.diaryModal]}>
            <Text style={styles.modalTitle}>
              {editingDiaryEntry ? t("projectOverview.editDiaryEntry") : t("projectOverview.addDiaryEntry")}
            </Text>
            <ScrollView
              style={styles.diaryModalScroll}
              contentContainerStyle={styles.diaryModalScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
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
              placeholder={t("projectOverview.weather")}
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={diaryWorkers}
              onChangeText={setDiaryWorkers}
              placeholder={t("projectOverview.workersPlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            {/* Work Description - two-step like Mobility-Work */}
            <Text style={styles.modalLabel}>{t("projectOverview.workDescriptionLabel")}:</Text>
            <TouchableOpacity
              style={styles.addDescriptionButton}
              onPress={() => setShowDiaryDescriptionModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              <Text style={styles.addDescriptionButtonText}>
                {diaryWorkDescription.trim() || diaryWorkDescriptionRecordingUri
                  ? (diaryWorkDescription.trim() ? diaryWorkDescription.slice(0, 50) + (diaryWorkDescription.length > 50 ? "…" : "") : t("projectOverview.recordingReady"))
                  : t("projectOverview.addDescription")}
              </Text>
            </TouchableOpacity>

            <DescriptionInputModal
              visible={showDiaryDescriptionModal}
              onClose={() => setShowDiaryDescriptionModal(false)}
              onConfirm={(text, recordingUri) => {
                setDiaryWorkDescription(text);
                setDiaryWorkDescriptionRecordingUri(recordingUri ?? null);
              }}
              initialText={diaryWorkDescription}
              initialRecordingUri={diaryWorkDescriptionRecordingUri}
              placeholder={t("projectOverview.descriptionPlaceholder")}
              title={t("projectOverview.workDescriptionLabel")}
            />
            <TextInput
              style={styles.input}
              value={diaryMaterials}
              onChangeText={setDiaryMaterials}
              placeholder={t("projectOverview.materialsPlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            {phasesForUi.length > 0 && (
              <View style={styles.phaseSelector}>
                <Text style={styles.phaseSelectorLabel}>{t("projectOverview.phaseOptional")}</Text>
                <ScrollView style={styles.phaseSelectorScroll} horizontal>
                  <TouchableOpacity
                    style={[styles.phaseChip, diaryPhaseId === null && styles.phaseChipSelected]}
                    onPress={() => setDiaryPhaseId(null)}
                  >
                    <Text style={[styles.phaseChipText, diaryPhaseId === null && styles.phaseChipTextSelected]}>
                      {t("projectOverview.phaseNone")}
                    </Text>
                  </TouchableOpacity>
                  {phasesForUi.map((phase) => (
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
            
            {/* Diary Photo Attachments - multiple photos */}
            <View style={styles.expenseAttachmentSection}>
              <Text style={styles.expenseAttachmentLabel}>{t("projectOverview.photoOptional")}</Text>
              <View style={styles.expenseAttachmentButtons}>
                <TouchableOpacity
                  style={[styles.expenseAttachmentButton, (uploadingDiaryAttachment || submitting) && styles.expenseAttachmentButtonDisabled]}
                  onPress={pickDiaryImage}
                  disabled={uploadingDiaryAttachment || submitting}
                >
                  <Ionicons name="image-outline" size={20} color={colors.primary} />
                  <Text style={styles.expenseAttachmentButtonText}>{t("projectOverview.addPhotos")}</Text>
                </TouchableOpacity>
              </View>
              {diaryAttachments.length > 0 && diaryAttachments.map((att, idx) => (
                <View key={`${att.uri}-${idx}`} style={styles.expenseAttachmentPreview}>
                  <Ionicons
                    name="image-outline"
                    size={20}
                    color={colors.primary}
                    style={{ marginRight: spacing.sm }}
                  />
                  <Text style={styles.expenseAttachmentPreviewText} numberOfLines={1}>
                    {att.fileName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setDiaryAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    style={styles.expenseAttachmentRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
              {uploadingDiaryAttachment && (
                <View style={styles.expenseAttachmentUploading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.expenseAttachmentUploadingText}>{t("common.uploading") || 'Nahráva sa...'}</Text>
                </View>
              )}
            </View>
            </ScrollView>
            
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
                  setDiaryWorkDescriptionRecordingUri(null);
                  setDiaryMaterials("");
                  setDiaryPhaseId(null);
                  setDiaryAttachments([]);
                }}
              >
                <Text style={styles.modalCancelText}>{t("tasks.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalOk} 
                onPress={handleSaveDiaryEntry} 
                disabled={
                  submitting || 
                  (!diaryWorkDescription.trim() && !diaryWorkDescriptionRecordingUri)
                }
              >
                <Text style={styles.modalOkText}>
                  {submitting ? t("common.saving") : (editingDiaryEntry ? t("common.save") : t("common.add"))}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Project Document Modal */}
      <Modal visible={showDocumentModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
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
        </KeyboardAvoidingView>
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
              {phasesForUi.map((phase) => (
                <TouchableOpacity
                  key={phase.id}
                  style={styles.phaseOption}
                  onPress={() => handleMoveTaskToPhase(phase.id, phase.name)}
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
    paddingBottom: spacing.xl * 3,
    flexGrow: 1,
  },
  emptyHeroCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.primary + '12',
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  emptyHeroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  emptyHeroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHeroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptyHeroSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyHeroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyHeroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  emptyHeroBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
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
    overflow: 'hidden',
  },
  addressSectionMaintenance: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  addressTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "nowrap",
    gap: spacing.sm,
    overflow: 'hidden',
  },
  addressContent: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    overflow: 'hidden',
  },
  addressText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
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
    flexShrink: 0,
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
  colAssignee: { width: 88, flexShrink: 0, textAlign: "right" },
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
    color: colors.textOnDark,
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
    color: colors.textOnDark,
  },
  phaseSelectorButtonTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 56,
  },
  taskNameCell: { flex: 1, flexDirection: "row", alignItems: "flex-start", paddingTop: 2, minWidth: 0 },
  statusToggle: { 
    padding: spacing.xs,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  taskTitleContainer: { flex: 1, minWidth: 0 },
  taskTitle: { fontSize: 16, color: colors.text, lineHeight: 22, fontWeight: "500" },
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
  assigneeCell: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, paddingTop: 2 },
  assigneeText: { fontSize: 12, color: colors.textMuted, maxWidth: 60 },
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
  equipmentSectionMaintenance: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  equipmentSectionCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  equipmentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  equipmentSectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  equipmentSectionHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  equipmentSectionCount: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  equipmentSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  servicePlansSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  equipmentEmptyContent: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  equipmentEmptyText: {
    fontSize: 15,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  equipmentEmptyHint: {
    fontSize: 13,
    color: colors.textMuted,
  },
  equipmentContent: {
    padding: spacing.md,
    paddingTop: spacing.sm,
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 0,
    flex: 1,
    maxWidth: '48%',
    gap: spacing.sm,
  },
  equipmentChipImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  equipmentChipImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  equipmentChipText: {
    flex: 1,
    fontSize: 13,
    color: colors.textOnDark,
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
  addEquipmentSplitRow: {
    flexDirection: "row",
    alignItems: "stretch",
    flex: 1,
    maxWidth: 320,
  },
  addEquipmentSplitRowFull: {
    maxWidth: undefined,
    flex: 1,
  },
  addEquipmentPrimary: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingVertical: spacing.md,
  },
  addEquipmentDropdown: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    alignItems: "center",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.3)",
    borderTopRightRadius: radius,
    borderBottomRightRadius: radius,
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
  addDescriptionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 8,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderStyle: "dashed",
  },
  addDescriptionButtonText: {
    fontSize: 15,
    color: colors.textMuted,
    flex: 1,
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

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-start", padding: spacing.md, paddingTop: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  expenseModal: {
    height: Dimensions.get("window").height * 0.92,
    alignSelf: "stretch",
    padding: spacing.lg,
  },
  expenseModalScroll: { flex: 1, minHeight: 0 },
  expenseModalScrollContent: { paddingTop: spacing.sm, paddingBottom: 280 },
  diaryModal: {
    height: Dimensions.get("window").height * 0.9,
    alignSelf: "stretch",
  },
  diaryModalScroll: { flex: 1, minHeight: 0 },
  diaryModalScrollContent: { paddingBottom: spacing.md },
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
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
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
  /** Travel country modal: dark blue rows need white text (not `colors.text`). */
  travelCountryPickerList: { maxHeight: 360, marginBottom: spacing.md },
  travelCountryPickerListContent: { gap: spacing.sm },
  travelCountryPickerRow: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: radius,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  travelCountryPickerRowActive: {
    borderColor: colors.primary,
    backgroundColor: "#162a52",
  },
  travelCountryPickerLabel: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textOnDark,
    fontWeight: "600",
  },
  travelCountryPickerLabelActive: {
    color: colors.textOnDark,
    fontWeight: "800",
  },
  modalLabel: { fontSize: 14, fontWeight: "500", color: colors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  editCountryChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editCountryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  editCountryChipText: { fontSize: 14, color: colors.text, fontWeight: "500" },
  editCountryChipTextActive: { color: "#FFFFFF", fontWeight: "600" },
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
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius, minWidth: 80 },
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
  // Time (supporting summary) styles
  timeSummarySection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  timeSummaryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  timeSummaryHeaderLeft: { flexDirection: "row", alignItems: "center" },
  timeSummaryTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  timeTimerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  timeTimerRowLeft: { flex: 1, minWidth: 0 },
  timeTimerLabel: { fontSize: 12, fontWeight: "700", color: colors.primary },
  timeTimerElapsed: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: 2 },
  timeTimerButtons: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  timeTimerBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 999 },
  timeTimerBtnText: { color: "#fff", fontWeight: "700" },
  timeTimerBtnSecondary: {
    backgroundColor: `${colors.primary}15`,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  timeTimerBtnSecondaryText: { color: colors.primary, fontWeight: "700" },
  timeSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 2 },
  timeSummaryLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  timeSummaryValue: { fontSize: 13, color: colors.text, fontWeight: "700" },
  timeSummaryCta: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  timeSummaryCtaText: { color: colors.primary, fontWeight: "700" },
  timeSlimAboveAccordion: {
    marginBottom: spacing.sm,
  },
  timeTimerRowInSlim: {
    borderBottomWidth: 0,
    marginBottom: 0,
    paddingBottom: 0,
  },
  timeAccordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  timeAccordionScroll: { maxHeight: 360 },
  timeAccordionDayBlock: { marginBottom: spacing.md },
  timeAccordionDayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  timeAccordionDayTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  timeAccordionDayTotal: { fontSize: 13, fontWeight: "700", color: colors.primary },
  timeAccordionEntry: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  timeAccordionEntryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  timeAccordionEntryTime: { fontSize: 13, fontWeight: "600", color: colors.text, flex: 1, marginRight: spacing.sm },
  timeAccordionEntryDur: { fontSize: 13, fontWeight: "700", color: colors.text },
  timeAccordionEntryMode: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  timeAccordionEntryNote: { fontSize: 12, color: colors.text, marginTop: spacing.xs },
  timeAccordionLoc: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  timeAccordionMapLink: { fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 4 },
  timeAccordionEmpty: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.md, textAlign: "center" },
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
  problemsBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
    paddingHorizontal: 6,
  },
  problemsBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
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
    marginBottom: spacing.sm,
  },
  expenseAmountInput: {
    flex: 1,
    marginRight: spacing.sm,
  },
  expenseCurrencyTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  expenseCurrencyLabel: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  expenseCategorySection: {
    marginBottom: spacing.sm,
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
    marginBottom: spacing.xs,
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
    color: colors.textOnDark,
    fontWeight: "500",
  },
  expenseCategoryButtonTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  expenseAttachmentSection: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  expenseAttachmentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  expenseAttachmentHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  expenseAttachmentButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
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
    color: colors.textOnDark,
    fontWeight: "500",
  },
  expenseAttachmentButtonSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.18)",
    gap: spacing.xs,
  },
  expenseAttachmentButtonTextMuted: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "500",
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
  expenseOcrSourceHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
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
  expenseNoteInput: {
    minHeight: 64,
    textAlignVertical: "top",
    marginBottom: spacing.sm,
  },
  expenseInputCompact: {
    marginBottom: spacing.sm,
  },
  expenseDateCompact: {
    marginBottom: spacing.sm,
    minHeight: 48,
    padding: spacing.md,
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
    color: colors.textOnDark,
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
  diaryDetailModal: {
    maxHeight: '85%',
    backgroundColor: colors.card,
    borderRadius: radius,
    overflow: 'hidden',
  },
  diaryDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  diaryDetailTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textOnDark,
  },
  diaryDetailCloseButton: {
    padding: spacing.xs,
  },
  diaryDetailScroll: {
    maxHeight: 400,
  },
  diaryDetailContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  diaryDetailDescription: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  diaryDetailMeta: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  diaryDetailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  diaryDetailMetaText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  diaryDetailGallery: {
    marginTop: spacing.sm,
  },
  diaryDetailGalleryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  diaryDetailGalleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  diaryDetailGalleryItem: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  diaryDetailGalleryImage: {
    width: '100%',
    height: '100%',
  },
  diaryDetailGalleryDoc: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.sm,
  },
  diaryDetailGalleryDocName: {
    fontSize: 10,
    color: colors.textOnDark,
    marginTop: spacing.xs,
    textAlign: 'center',
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
  kmErrorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  expenseTypeChoiceRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  expenseTypeChoiceButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  expenseTypeChoiceButtonActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  expenseTypeChoiceButtonText: {
    fontSize: 13,
    color: colors.textOnDark,
    fontWeight: "600",
  },
  expenseTypeChoiceButtonTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  travelFormSection: {
    marginBottom: spacing.md,
  },
  travelFormOuter: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  travelSectionCard: {
    backgroundColor: `${colors.primary}0e`,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(224, 103, 55, 0.22)",
    padding: spacing.md,
  },
  travelSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  travelSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    flex: 1,
  },
  travelSectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  travelFieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  travelSwapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
  },
  travelSwapBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
  },
  travelCountryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.28)",
    /** Svetlý chip na `travelSectionCard` — nie `colors.background` (modrá + čierny text). */
    backgroundColor: "#ffffff",
    minWidth: 44,
  },
  travelCountryChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  travelKmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  travelKmInput: {
    flex: 1,
    marginBottom: 0,
    fontSize: 20,
    fontWeight: "700",
    paddingVertical: spacing.sm,
  },
  travelKmSuffix: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textMuted,
    paddingRight: spacing.xs,
  },
  travelCalcButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: "transparent",
    marginBottom: spacing.xs,
  },
  travelCalcButtonDisabled: {
    borderColor: colors.border,
    opacity: 0.55,
  },
  travelCalcButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  travelCalcHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    lineHeight: 17,
  },
  travelOrManual: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
    marginTop: spacing.xs,
  },
  travelRoundTripSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(45,74,122,0.1)",
  },
  travelRoundTripLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  travelRoundTripHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 16,
  },
  travelSummaryCard: {
    backgroundColor: `${colors.primary}12`,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(224, 103, 55, 0.26)",
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  travelSummaryFormula: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 24,
  },
  travelSummaryEmpty: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  travelReceiptSection: {
    marginTop: 0,
    marginBottom: spacing.sm,
    padding: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: `${colors.primary}0a`,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(224, 103, 55, 0.18)",
  },
  travelRouteDiagramRow: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.xs,
  },
  travelRateInputWide: {
    alignSelf: "stretch",
  },
  travelAddressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  travelAddressInput: {
    flex: 1,
    marginBottom: 0,
  },
  travelCountryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 56,
  },
  travelCountryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  travelFormLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  travelDistanceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  travelDistanceInput: {
    flexGrow: 2,
    flexShrink: 0,
    minWidth: 0,
    marginBottom: 0,
  },
  travelRateRow: {
    marginBottom: spacing.sm,
  },
  travelRateInput: {
    maxWidth: 120,
  },
  travelRoundTripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  travelDateRow: {
    marginBottom: spacing.md,
  },
  travelRoundTripText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
  },
  travelCalculatedAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: `${colors.primary}14`,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: spacing.md,
  },
  travelCalculatedAmountLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  travelCalculatedAmountValue: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.primary,
  },
  calculateKmButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    minHeight: 48,
    flexShrink: 1,
    minWidth: 108,
  },
  calculateKmButtonDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.6,
  },
  calculateKmButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
});
