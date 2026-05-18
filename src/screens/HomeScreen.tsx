import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  TextInput,
  ActionSheetIOS,
  Platform,
  Image,
  AppState,
} from "react-native";
import { DrawerActions, TabActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { useOrgAccess } from "../hooks/useOrgAccess";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import { processInvoiceAttachment } from "../services/invoiceProcessing";
import { getConfidenceAwareExpensePrefill } from "../services/documentPrefill";
import * as dashboardService from "../services/dashboard";
import type { TodaysWorkTask } from "../services/dashboard";
import * as projectEventsService from "../services/projectEvents";
import * as projectCoverService from "../services/projectCover";
import type { ProjectDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";
import { colors, radius, spacing } from "../theme";
import { db, getCallable } from "../firebase";
import { doc, getDoc } from "../lib/rnFirestore";
import { loadHomeLayout, getDefaultLayout, type HomeLayout } from "../services/homeLayout";
import { HomeCustomizeSheet } from "../components/HomeCustomizeSheet";
import { HomeCalendarSheet } from "../components/HomeCalendarSheet";
import { QuickTimeModal } from "../components/QuickTimeModal";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as timeTracking from "../services/timeTracking";
import * as timerReminders from "../services/timerReminders";
import { openInMaps } from "../lib/maps";
import { ProjectBadgesRow } from "../components/ProjectBadgesRow";
import { trackPaywallEvent, checkAndShowPaywall } from "../services/paywallTrigger";
import { logEventSafe } from "../services/analytics";
import { hasShownFirstProjectPrompt, markFirstProjectPromptShown } from "../utils/firstProjectPrompt";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { CurrencyDropdown } from "../components/CurrencyDropdown";
import { QuickNoteModal } from "../components/QuickNoteModal";
import * as quickNotesService from "../services/quickNotes";
import { useQuickNoteContext } from "../context/QuickNoteContext";
import { getCurrentPositionSafe } from "../lib/location";
import {
  getActiveProductProjectType,
  isLegacyMaintenanceEquipmentHub,
  isSoloOwnerProjectRow,
  isSharedOrCollaborativeProjectRow,
} from "../lib/projectTypeModel";
import type { PrimaryUsageMode } from "../lib/primaryUsageMode";
import { readStoredPrimaryUsageMode } from "../lib/primaryUsageMode";
import { showToast } from "../helpers/toast";
import { getUnreadChatCount } from "../services/businessChat";
import { listMyMemberships, type MembershipDoc } from "../services/organizations";

// Conditional imports for image/document picker
let ImagePicker: typeof import('expo-image-picker') | null = null;
let DocumentPicker: typeof import('expo-document-picker') | null = null;

try {
  ImagePicker = require('expo-image-picker');
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.warn('expo-image-picker or expo-document-picker not installed. Attachment features will be disabled.');
}

function formatMinutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/** Success / running timer accent (FAB + panel). */
const ACTIVE_TIMER_GREEN = "#22c55e";
const ACTIVE_TIMER_PAUSED_AMBER = "#f59e0b";

/** HH:MM:SS formatter for the home timer bar. Mirrors `formatElapsedHms` but works on raw ms. */
function formatHomeTimerHms(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const LAST_USED_PROJECT_KEY = "@staveto:lastUsedProjectId";
const PROJECTS_FILTER_KEY = "projects_filter_v1";
const TYPE_FILTER_KEY = "home_type_filter_v1";
type ProjectFilter = "all" | "mine" | "shared";
type TypeFilter = "ALL" | "BUILD" | "TRADE";

type DashboardViewModel = {
  projects: ProjectDoc[];
  todayTasks: Array<TaskDoc & { projectName: string; phaseName?: string }>;
  todaysWorkTasks: TodaysWorkTask[];
  kpis: {
    openCount: number;
    doneTodayCount: number;
    blockedCount: number;
    overdueCount: number;
    expensesMonthSum: number;
    expensesTotalSum: number;
    hasExpensesAccess: boolean;
  };
  projectStats: Map<string, { openCount: number; totalCount: number; progress: number }>;
  timeTrackingProjectIds?: string[];
};

type LiveProjectRow = {
  projectId: string;
  projectName: string;
  lastActivityLabel: string;
  newCountLabel: string;
  status: "OK" | "RISK" | "PROBLEM";
};

type CompactProjectItemProps = {
  project: ProjectDoc;
  openTasks: number;
  currentUserId?: string | null;
  lastActivity: string;
  status: "OK" | "RISK" | "PROBLEM";
  onOpen: (projectId: string) => void;
  onPhoto: (projectId: string) => void;
  onTask: (projectId: string) => void;
  onCoverPress?: (project: ProjectDoc) => void;
  /** Home list: fewer badges, calmer status, larger taps */
  minimal?: boolean;
  /** Home preview: row opens project only — no camera/task circles */
  hideSideActions?: boolean;
};

function getProjectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "PR";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function getLocationAnchor(project: ProjectDoc): string | null {
  if (project.city?.trim()) return project.city.trim();
  if (!project.addressText?.trim()) return null;
  const firstPart = project.addressText.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 24) return firstPart;
  return null;
}

const CompactProjectItem = React.memo(function CompactProjectItem({
  project,
  openTasks,
  lastActivity,
  status,
  onOpen,
  onPhoto,
  onTask,
  onCoverPress,
  currentUserId,
  minimal,
  hideSideActions,
}: CompactProjectItemProps) {
  const { t } = useI18n();
  const isOwner = !!project.ownerId && project.ownerId === currentUserId;
  const hub = isLegacyMaintenanceEquipmentHub(project);
  const active = getActiveProductProjectType(project);
  const typeStripeColor = hub ? "#7dcea0" : active === "TRADE" ? "#5dade2" : "#ff9f43";
  const typeThumbTint = hub ? "#7dcea022" : active === "TRADE" ? "#5dade220" : "#ff9f4322";
  /** Home preview: stripe reflects activity health, not project type (calmer than decorative orange). */
  const homeStripeColor =
    status === "PROBLEM" ? "#dc2626" : status === "RISK" ? "#d97706" : "rgba(148,163,184,0.5)";
  const stripeColor = hideSideActions ? homeStripeColor : typeStripeColor;
  const thumbTint = hideSideActions ? "rgba(45,74,122,0.08)" : typeThumbTint;
  const typeLabelKey = hub ? "MAINTENANCE" : active === "TRADE" ? "TRADE" : "MANAGEMENT";
  const typeLabel = t(`createProject.type.${typeLabelKey}.title`);
  const location = getLocationAnchor(project);
  const badgeColor = hub ? "#7dcea0" : active === "TRADE" ? "#5dade2" : "#ff9f43";
  const maintenanceCount =
    !minimal &&
    hub &&
    typeof project.equipmentCount === "number"
      ? t("projectCard.equipmentCount", { count: String(project.equipmentCount) })
      : null;
  const statusLabel =
    status === "OK" ? t("common.ok") : status === "RISK" ? t("home.statusRisk") : t("home.statusWaiting");
  const showStatusTag = !minimal ? status !== "OK" : status === "PROBLEM" && !hideSideActions;

  const isSharedToMe = project.isSharedToMe === true;

  return (
    <TouchableOpacity
      style={[
        styles.compactProjectRow,
        minimal && styles.compactProjectRowMinimal,
        hideSideActions && styles.compactProjectRowHome,
        !isOwner && styles.compactProjectRowMember,
        isSharedToMe && styles.compactProjectRowShared,
      ]}
      onPress={() => onOpen(project.id)}
      activeOpacity={0.8}
    >
      <View
        style={[styles.compactStripe, hideSideActions && styles.compactStripeHome, { backgroundColor: stripeColor }]}
      />
      <Pressable
        style={[
          styles.compactThumb,
          hideSideActions && styles.compactThumbHome,
          { backgroundColor: thumbTint },
        ]}
        onPress={() => {
          if (isOwner && onCoverPress) onCoverPress(project);
        }}
      >
        {!hub && project.coverImageUrl ? (
          <Image source={{ uri: project.coverImageUrl }} style={styles.compactThumbImage} resizeMode="cover" />
        ) : hub ? (
          <Ionicons name="construct-outline" size={hideSideActions ? 16 : 20} color={colors.textMuted} />
        ) : (
          <>
            <Text style={[styles.compactThumbInitials, hideSideActions && styles.compactThumbInitialsHome]}>
              {getProjectInitials(project.name || t("projects.noName"))}
            </Text>
            <Ionicons
              name={active === "TRADE" ? "briefcase-outline" : "clipboard-outline"}
              size={hideSideActions ? 9 : 11}
              color={colors.textMuted}
              style={styles.compactThumbIcon}
            />
          </>
        )}
      </Pressable>
      <View style={styles.compactProjectBody}>
        <View style={styles.compactProjectTitleRow}>
          <Text style={[styles.compactProjectTitle, minimal && styles.compactProjectTitleMinimal, hideSideActions && styles.compactProjectTitleHome]} numberOfLines={1}>
            {project.name}
          </Text>
        </View>
        {!minimal ? (
          <View style={styles.compactTypeBadgeRow}>
            <View style={[styles.compactTypeBadge, { borderColor: badgeColor }]}>
              <Text style={[styles.compactTypeBadgeText, { color: badgeColor }]} numberOfLines={1}>
                {typeLabel.toUpperCase()}
              </Text>
            </View>
            {location ? (
              <Text style={styles.compactTypeBadgeCity} numberOfLines={1}>
                {location}
              </Text>
            ) : null}
          </View>
        ) : location ? (
          <Text style={styles.compactLocationOnly} numberOfLines={1}>
            {location}
          </Text>
        ) : null}
        {!minimal ? (
          <ProjectBadgesRow isOwner={isOwner} sharedWithCount={project.sharedWithCount ?? 0} isSharedToMe={project.isSharedToMe} />
        ) : isSharedToMe ? (
          <Text style={styles.compactSharedHint} numberOfLines={1}>
            {t("home.sharedBadge")}
          </Text>
        ) : null}
        {maintenanceCount ? (
          <Text style={styles.compactMaintenanceMeta} numberOfLines={1}>
            {maintenanceCount}
          </Text>
        ) : null}
        <Text
          style={[styles.compactProjectSubline, minimal && styles.compactProjectSublineMinimal, hideSideActions && styles.compactProjectSublineHome]}
          numberOfLines={minimal ? 2 : 1}
        >
          {openTasks} {openTasks === 1 ? t("home.openTask_one") : t("home.openTask_other")}
          {minimal ? "\n" : " • "}
          {minimal ? "" : `${t("home.activityLabel")} `}
          {lastActivity}
        </Text>
      </View>
      {!hideSideActions ? (
      <View style={styles.compactActions}>
        <TouchableOpacity
          style={[styles.compactActionBtn, minimal && styles.compactActionBtnLarge]}
          onPress={(e) => {
            e.stopPropagation();
            onPhoto(project.id);
          }}
          accessibilityLabel={t("home.quickPhoto")}
        >
          <Ionicons name="camera-outline" size={minimal ? 20 : 18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.compactActionBtn, styles.compactActionBtnTask, minimal && styles.compactActionBtnLarge]}
          onPress={(e) => {
            e.stopPropagation();
            onTask(project.id);
          }}
          accessibilityLabel={t("home.quickTask")}
        >
          <Ionicons name="checkmark-outline" size={minimal ? 20 : 18} color="#fff" />
        </TouchableOpacity>
      </View>
      ) : null}
      {showStatusTag ? (
        <View style={[styles.statusTag, status === "PROBLEM" ? styles.statusTagProblem : styles.statusTagRisk]}>
          <Text style={styles.statusTagText}>{statusLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

export function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const homeHeaderTopPadding = insets.top + (Platform.OS === "android" ? spacing.xs : spacing.sm);
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const { activeBusinessOrgId, activeOrganization, activeMembership } = useActiveOrg();
  const { canAccessBusiness } = useOrgAccess();
  const { isOnline } = useOnlineStatus();
  const [dashboardData, setDashboardData] = useState<DashboardViewModel | null>(null);
  const [liveRows, setLiveRows] = useState<LiveProjectRow[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUsedProjectId, setLastUsedProjectId] = useState<string | null>(null);
  /** User equipment service work — Home shows a small alert only, not as a project. */
  const [equipmentHomeSummary, setEquipmentHomeSummary] = useState<{
    openServiceTasks: number;
    dueTodayOrOverdue: number;
  } | null>(null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<TypeFilter>("ALL");
  const [headerUsageMode, setHeaderUsageMode] = useState<PrimaryUsageMode | null>(null);

  // Firebase Analytics test event (first screen after login)
  useEffect(() => {
    (async () => {
      try {
        logEventSafe("staveto_test_event", { where: "after_login", screen: "Home" });
      } catch (e) {
        if (__DEV__) console.log("[analytics] test event failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROJECTS_FILTER_KEY).then((saved) => {
      if (saved === "mine" || saved === "shared" || saved === "all") {
        setProjectFilter(saved);
        if (__DEV__) console.log("[HomeScreen] Loaded filter:", saved);
      }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(TYPE_FILTER_KEY).then((saved) => {
      if (saved === "MANAGEMENT") {
        setSelectedTypeFilter("BUILD");
        AsyncStorage.setItem(TYPE_FILTER_KEY, "BUILD").catch(() => {});
      } else if (saved === "RESIDENTIAL" || saved === "MAINTENANCE") {
        setSelectedTypeFilter("TRADE");
        AsyncStorage.setItem(TYPE_FILTER_KEY, "TRADE").catch(() => {});
      } else if (saved === "BUILD" || saved === "TRADE" || saved === "ALL") {
        setSelectedTypeFilter(saved as TypeFilter);
      }
    });
  }, []);

  const handleProjectFilterChange = useCallback(async (filter: ProjectFilter) => {
    setProjectFilter(filter);
    try {
      await AsyncStorage.setItem(PROJECTS_FILTER_KEY, filter);
      if (__DEV__) console.log("[HomeScreen] Filter changed:", filter);
    } catch (e) {
      console.warn("[HomeScreen] Failed to persist filter:", e);
    }
  }, []);

  const handleTypeFilterChange = useCallback(async (filter: TypeFilter) => {
    setSelectedTypeFilter(filter);
    try {
      await AsyncStorage.setItem(TYPE_FILTER_KEY, filter);
    } catch (e) {
      console.warn("[HomeScreen] Failed to persist type filter:", e);
    }
  }, []);

  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showFirstProjectModal, setShowFirstProjectModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"task" | "photo" | "expense" | "voice" | "problem" | null>(null);
  const [pendingExpenseType, setPendingExpenseType] = useState<"WORK" | "TRAVEL" | null>(null);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [showExpenseTypeModal, setShowExpenseTypeModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseStep, setExpenseStep] = useState<1 | 2>(1); // 1 = select project, 2 = enter details
  const [expenseProjectId, setExpenseProjectId] = useState<string | null>(null);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<'WORK' | 'MATERIAL' | undefined>(undefined);
  const [expenseSupplierName, setExpenseSupplierName] = useState("");
  const [expenseCurrency, setExpenseCurrency] = useState<string>("EUR");
  const [expenseInvoiceImage, setExpenseInvoiceImage] = useState<{ uri: string; fileName: string } | null>(null);
  const [expenseOcrLoading, setExpenseOcrLoading] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [uploadingExpenseAttachment, setUploadingExpenseAttachment] = useState(false);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [homeLayout, setHomeLayout] = useState<HomeLayout | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [showCustomizeModal, setShowCustomizeModal] = useState(false);
  const [showTypeFilterModal, setShowTypeFilterModal] = useState(false);
  const customizeSheetRef = useRef<BottomSheetModal | null>(null);
  const calendarSheetRef = useRef<BottomSheetModal | null>(null);
  const quickTimeSheetRef = useRef<BottomSheetModal | null>(null);
  const [calendarRefreshTrigger, setCalendarRefreshTrigger] = useState(0);
  const [activeTimer, setActiveTimer] = useState<timeTracking.ActiveTimer | null>(null);
  const [timerTick, setTimerTick] = useState(0);
  const [homeStopLoading, setHomeStopLoading] = useState(false);
  const [monthlyMinutes, setMonthlyMinutes] = useState<number>(0);
  const [showQuickNoteModal, setShowQuickNoteModal] = useState(false);
  const [pendingQuickNotesCount, setPendingQuickNotesCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const quickNoteCtx = useQuickNoteContext();
  const canOpenBusinessChat = Boolean(
    activeBusinessOrgId &&
      activeOrganization &&
      activeMembership?.status === "active" &&
      canAccessBusiness
  );

  useEffect(() => {
    const unregister = quickNoteCtx?.registerOpenQuickNote(() => setShowQuickNoteModal(true));
    return () => unregister?.();
  }, [quickNoteCtx]);

  useEffect(() => {
    loadHomeLayout().then((layout) => setHomeLayout(layout));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    getDoc(doc(db, "users", user.id)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as { photoURL?: string | null };
        setPhotoURL(d.photoURL ?? null);
      }
    });
  }, [user?.id]);

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const openCustomizeSheet = useCallback(() => {
    setShowCustomizeModal(true);
  }, []);

  const refreshChatUnread = useCallback(async () => {
    const uid = user?.id ?? null;
    if (!uid || !activeBusinessOrgId || !canOpenBusinessChat) {
      setChatUnreadCount(0);
      return;
    }
    try {
      const count = await getUnreadChatCount(activeBusinessOrgId, uid);
      setChatUnreadCount(count);
    } catch {
      setChatUnreadCount(0);
    }
  }, [activeBusinessOrgId, canOpenBusinessChat, user?.id]);

  const openBusinessChat = useCallback(() => {
    if (!activeBusinessOrgId || !canOpenBusinessChat) {
      Alert.alert(
        t("business.chat.businessRequiredTitle"),
        t("business.chat.businessRequiredBody")
      );
      return;
    }
    (navigation as { navigate: (name: string, params?: object) => void }).navigate("BusinessStack", {
      screen: "BusinessChatList",
    });
  }, [activeBusinessOrgId, canOpenBusinessChat, navigation, t]);

  const openCalendarSheet = useCallback(() => {
    calendarSheetRef.current?.present();
  }, []);

  const refreshActiveTimer = useCallback(async (readOpts?: timeTracking.GetActiveTimerReadOpts) => {
    if (!user?.id) return;
    const r = await timeTracking.getActiveTimerRefreshResult(user.id, readOpts);
    if (r.ok) {
      setActiveTimer(r.timer);
    }
  }, [user?.id]);

  const openQuickTimeSheet = useCallback(() => {
    void refreshActiveTimer().finally(() => {
      quickTimeSheetRef.current?.present();
    });
  }, [refreshActiveTimer]);

  useFocusEffect(
    useCallback(() => {
      readStoredPrimaryUsageMode().then(setHeaderUsageMode);
      if (!user?.id) return;
      refreshActiveTimer();
      quickNotesService.getOpenQuickNotesCount(user.id).then(setPendingQuickNotesCount);
      void refreshChatUnread();
      timeTracking.checkAutoStopOnAppOpen().then((entry) => {
        if (entry) {
          setActiveTimer(null);
          Alert.alert(
            "Časovač zastavený",
            "Časovač sa automaticky zastavil po 12 hodinách."
          );
        }
      });
    }, [user?.id, refreshActiveTimer, refreshChatUnread])
  );

  useEffect(() => {
    if (!activeTimer) return;
    /** No live ticking while paused — the displayed elapsed equals frozen `accumulatedMs`. */
    if (activeTimer.status === "paused") return;
    const interval = setInterval(() => setTimerTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && user?.id) {
        void refreshActiveTimer();
      }
    });
    return () => sub.remove();
  }, [user?.id, refreshActiveTimer]);

  /** One persistent Android notification: clear legacy 2h schedules, then refresh body on a light interval. */
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const run = async () => {
      if (!activeTimer || activeTimer.status === "paused") {
        /** Paused timers must not show a "running" tray entry; resume re-creates it. */
        await timerReminders.clearRunningTimerNotification();
        return;
      }
      await timerReminders.cancelLegacyReminderIds(activeTimer.reminderIds ?? []);
      const tick = () =>
        timerReminders.replaceRunningTimerNotification({
          title: t("time.timerRunning"),
          projectName: activeTimer.projectNameSnapshot,
          startedAtIso: activeTimer.runningSince ?? activeTimer.startedAt,
        });
      void tick();
      intervalId = setInterval(tick, 60_000);
    };
    void run();
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTimer, t]);

  const effectiveLayout = homeLayout ?? getDefaultLayout();
  const {
    showHeaderChatShortcut,
    showQuickTime,
    showTodayPriorities,
    showBottomQuickActions,
  } = effectiveLayout.widgets;
  const enabledSectionIds = useMemo(
    () => new Set(effectiveLayout.sections.filter((s) => s.enabled).map((s) => s.id)),
    [effectiveLayout]
  );
  const allCustomSectionsDisabled = useMemo(
    () => effectiveLayout.sections.filter((s) => !s.locked).every((s) => !s.enabled),
    [effectiveLayout.sections]
  );

  const stackNav = navigation as { navigate: (name: string, params?: object) => void };

  const openTodaysWorkTask = useCallback(
    (task: TaskDoc) => {
      let nav: unknown = navigation;
      for (let i = 0; i < 8 && nav && typeof nav === "object"; i++) {
        const n = nav as {
          getState?: () => { routeNames?: string[] };
          navigate?: (name: string, params?: object) => void;
          getParent?: () => unknown;
        };
        const names = n.getState?.()?.routeNames;
        if (names?.includes("TaskDetail") && n.navigate) {
          n.navigate("TaskDetail", { task });
          return;
        }
        nav = n.getParent?.();
      }
      if (__DEV__) console.warn("[HomeScreen] TaskDetail screen not found from Home");
    },
    [navigation]
  );

  const goToProjects = useCallback(
    (params?: object) => {
      let nav: any = navigation;
      while (nav && typeof nav.getState === "function") {
        const routeNames = nav.getState?.().routeNames as string[] | undefined;
        if (routeNames?.includes("Projects")) {
          if (nav.navigate) {
            nav.navigate("Projects", params);
            return;
          }
          if (nav.dispatch) {
            nav.dispatch(TabActions.jumpTo("Projects", params));
            return;
          }
        }
        nav = nav.getParent?.();
      }
      console.warn("[HomeScreen] Unable to navigate to Projects tab");
    },
    [navigation]
  );

  const goToEquipment = useCallback(
    (params?: object) => {
      let nav: any = navigation;
      while (nav && typeof nav.getState === "function") {
        const routeNames = nav.getState?.().routeNames as string[] | undefined;
        if (routeNames?.includes("Equipment")) {
          if (nav.navigate) {
            nav.navigate("Equipment", params);
            return;
          }
          if (nav.dispatch) {
            nav.dispatch(TabActions.jumpTo("Equipment", params));
            return;
          }
        }
        nav = nav.getParent?.();
      }
      console.warn("[HomeScreen] Unable to navigate to Equipment tab");
    },
    [navigation]
  );
  const goToSearch = useCallback(() => {
    let nav: any = navigation;
    for (let i = 0; i < 10 && nav; i++) {
      const routeNames = nav.getState?.().routeNames as string[] | undefined;
      if (routeNames?.includes("GlobalSearch")) {
        nav.navigate("GlobalSearch");
        return;
      }
      nav = nav.getParent?.();
    }
  }, [navigation]);
  const [onboardingFirstName, setOnboardingFirstName] = useState<string | null>(null);
  const [onboardingDisplayName, setOnboardingDisplayName] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem("pending_onboarding").then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { firstName?: string; displayName?: string };
          if (parsed?.firstName?.trim()) setOnboardingFirstName(parsed.firstName.trim());
          if (parsed?.displayName?.trim()) setOnboardingDisplayName(parsed.displayName.trim());
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const [pendingBusinessMemberships, setPendingBusinessMemberships] = useState<MembershipDoc[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const uid = user?.id;
      if (!uid) {
        setPendingBusinessMemberships([]);
        return () => {
          cancelled = true;
        };
      }
      listMyMemberships(uid)
        .then((rows) => {
          if (!cancelled) {
            setPendingBusinessMemberships(rows.filter((m) => m.userId === uid && m.status === "pending"));
          }
        })
        .catch(() => {
          if (!cancelled) setPendingBusinessMemberships([]);
        });
      return () => {
        cancelled = true;
      };
    }, [user?.id])
  );

  const greetingName = user?.firstName ?? user?.name ?? onboardingFirstName ?? onboardingDisplayName ?? user?.email ?? t("home.userFallback");

  const formatLastActivity = useCallback(
    (date: Date | null) => {
      if (!date) return t("home.noRecentActivity");
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return t("events.justNow");
      if (diffMin < 60) return t("home.timeMinutes", { count: String(diffMin) });
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return t("home.timeHours", { count: String(diffH) });
      const diffD = Math.floor(diffH / 24);
      return t("home.timeDays", { count: String(diffD) });
    },
    [t]
  );

  const getLiveStatus = useCallback((lastEventDate: Date | null, projectCreatedAt?: string) => {
    const now = Date.now();
    if (!lastEventDate) {
      if (projectCreatedAt) {
        const created = new Date(projectCreatedAt).getTime();
        const ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        if (ageDays <= 0) return "OK" as const;
      }
      return "RISK" as const;
    }
    const ageDays = Math.floor((now - lastEventDate.getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays > 7) return "PROBLEM" as const;
    if (ageDays >= 3) return "RISK" as const;
    return "OK" as const;
  }, []);

  // Load last used project ID
  useEffect(() => {
    AsyncStorage.getItem(LAST_USED_PROJECT_KEY).then((id) => {
      if (id) setLastUsedProjectId(id);
    });
  }, []);

  // Show "Create your first project" modal when: 0 projects, loading done, prompt not yet shown
  useEffect(() => {
    if (loading || !dashboardData || dashboardData.projects.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("pending_onboarding");
        if (cancelled) return;
        if (raw) {
          const p = JSON.parse(raw) as { createdProject?: boolean };
          if (p?.createdProject) {
            await markFirstProjectPromptShown();
            return;
          }
        }
      } catch {
        /* ignore */
      }
      const shown = await hasShownFirstProjectPrompt();
      if (cancelled) return;
      if (!shown) {
        setShowFirstProjectModal(true);
        await markFirstProjectPromptShown();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, dashboardData]);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (!orgId) {
      setEquipmentHomeSummary(null);
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      if (isRefresh) {
        try {
          await getCallable("syncMyProjectsSharedCount")({});
        } catch (e) {
          console.warn("[HomeScreen] syncMyProjectsSharedCount failed:", e);
          try {
            await getCallable("backfillProjectSharedCounts")({});
          } catch (e2) {
            console.warn("[HomeScreen] backfillProjectSharedCounts failed:", e2);
          }
        }
      }
      const data = await dashboardService.loadDashboardData(orgId, { forceServerRead: isRefresh });
      let monthlyMins = 0;
      try {
        monthlyMins = user?.id
          ? await timeTracking.getMonthlyMinutes(user.id, new Date().getFullYear(), new Date().getMonth() + 1)
          : 0;
      } catch (e) {
        console.warn("[HomeScreen] getMonthlyMinutes failed:", e);
      }
      setMonthlyMinutes(monthlyMins);

      // Ensure overdue notifications exist (for tasks past due date)
      if (typeof tasksService.ensureOverdueNotificationsIfNeeded === "function") {
        tasksService.ensureOverdueNotificationsIfNeeded(orgId).catch((e) =>
          console.warn("[HomeScreen] ensureOverdueNotificationsIfNeeded failed:", e)
        );
      }
      if (user?.id) {
        const { ensureUserEquipmentServiceOverdueNotificationsIfNeeded } = await import(
          "../services/userEquipmentServiceTasks"
        );
        ensureUserEquipmentServiceOverdueNotificationsIfNeeded(user.id).catch((e) =>
          console.warn("[HomeScreen] ensureUserEquipmentServiceOverdueNotificationsIfNeeded failed:", e)
        );
      }

      // Upcoming tasks already carry projectName from dashboard — no per-task phase fetch (expensive, unused on Home).
      const enrichedTasks = data.todayTasks.map((t) => ({
        ...t,
        projectName: t.projectName || data.projects.find((p) => p.id === t.projectId)?.name || "—",
        phaseName: undefined as string | undefined,
      }));

      setDashboardData({
        projects: data.projects,
        todayTasks: enrichedTasks,
        todaysWorkTasks: data.todaysWorkTasks ?? [],
        kpis: data.kpis,
        projectStats: data.projectStats,
        timeTrackingProjectIds: data.timeTrackingProjectIds,
      });
      setLoadError(false);

      if (user?.id) {
        try {
          const { getUserEquipmentHomeSummary } = await import("../services/userEquipmentServiceTasks");
          const s = await getUserEquipmentHomeSummary(user.id);
          setEquipmentHomeSummary(s);
        } catch (e) {
          if (__DEV__) console.warn("[HomeScreen] getUserEquipmentHomeSummary failed:", e);
          setEquipmentHomeSummary({ openServiceTasks: 0, dueTodayOrOverdue: 0 });
        }
      } else {
        setEquipmentHomeSummary(null);
      }
    } catch (error: any) {
      console.error("[HomeScreen] Error loading dashboard:", error);
      setLoadError(true);
      setDashboardData({
        projects: [],
        todayTasks: [],
        todaysWorkTasks: [],
        kpis: {
          openCount: 0,
          doneTodayCount: 0,
          blockedCount: 0,
          overdueCount: 0,
          expensesMonthSum: 0,
          expensesTotalSum: 0,
          hasExpensesAccess: false,
        },
        projectStats: new Map(),
        timeTrackingProjectIds: [],
      });
      setEquipmentHomeSummary(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, user?.id]);

  // Last-opened project must be a real job workspace (legacy equipment hubs are excluded from dashboard).
  useEffect(() => {
    if (!dashboardData || !lastUsedProjectId) return;
    if (dashboardData.projects.some((p) => p.id === lastUsedProjectId)) return;
    AsyncStorage.removeItem(LAST_USED_PROJECT_KEY).catch(() => {});
    setLastUsedProjectId(null);
  }, [dashboardData, lastUsedProjectId]);

  const loadLiveActivity = useCallback(async () => {
    if (!user?.id || !dashboardData?.projects?.length) {
      setLiveRows([]);
      return;
    }
    setLiveLoading(true);
    try {
      const topProjects = dashboardData.projects.slice(0, 5);
      const rows = await Promise.all(
        topProjects.map(async (project) => {
          let lastEventDate: Date | null = null;
          let newCount = 0;
          try {
            const events = await projectEventsService.listProjectEvents(project.id, 1);
            const latest = events[0];
            if (latest) {
              const raw = latest.createdAt;
              lastEventDate =
                typeof raw === "string"
                  ? new Date(raw)
                  : raw instanceof Date
                  ? raw
                  : raw?.toDate?.() ?? null;
            }
          } catch (error) {
            console.warn(`[HomeScreen] Failed loading latest event for ${project.id}:`, error);
          }
          try {
            const lastSeenAt = await projectEventsService.getProjectLastSeenAt(project.id, user.id);
            if (lastSeenAt) {
              newCount = await projectEventsService.countNewEventsSince(project.id, lastSeenAt);
            } else {
              // If user never opened project detail, consider up to 50 recent events as "new".
              const initialEvents = await projectEventsService.listProjectEvents(project.id, 50);
              newCount = initialEvents.length;
            }
          } catch (error) {
            console.warn(`[HomeScreen] Failed loading new event count for ${project.id}:`, error);
          }
          return {
            projectId: project.id,
            projectName: project.name,
            lastActivityLabel: formatLastActivity(lastEventDate),
            newCountLabel: newCount >= 50 ? "50+" : String(newCount),
            status: getLiveStatus(lastEventDate, (project as any).createdAt),
          } as LiveProjectRow;
        })
      );
      setLiveRows(rows);
    } finally {
      setLiveLoading(false);
    }
  }, [dashboardData?.projects, formatLastActivity, getLiveStatus, user?.id]);

  const onRefresh = useCallback(() => {
    loadDashboard(true);
    loadLiveActivity();
  }, [loadDashboard, loadLiveActivity]);

  const handleHomeStopTimer = useCallback(async () => {
    if (!activeTimer) return;
    setHomeStopLoading(true);
    try {
      await timeTracking.stopTimer(undefined, { knownActive: activeTimer });
      const r = await timeTracking.getActiveTimerRefreshResult(user?.id);
      if (r.ok) {
        setActiveTimer(r.timer);
      } else {
        setActiveTimer(null);
      }
      await loadDashboard(true);
    } catch (err) {
      Alert.alert(t("time.title"), err instanceof Error ? err.message : String(err));
    } finally {
      setHomeStopLoading(false);
    }
  }, [activeTimer, loadDashboard, t]);

  const showCoverSheet = useCallback(
    (project: ProjectDoc) => {
      const hasCover = !!project.coverImageUrl;
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
          const { url, path } = await projectCoverService.uploadProjectCover(project.id, picked.uri);
          await projectCoverService.setProjectCover(project.id, { url, path }, project.coverImagePath);
          loadDashboard(true);
        } catch (e) {
          Alert.alert("", t("cover.uploadError"));
        }
      };

      const runRemove = async () => {
        try {
          await projectCoverService.removeProjectCover(project.id);
          loadDashboard(true);
        } catch (e) {
          Alert.alert("", t("cover.uploadError"));
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
    },
    [t, loadDashboard]
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadLiveActivity();
  }, [loadLiveActivity]);

  useFocusEffect(
    useCallback(() => {
      loadDashboard(false);
      if (isOnline) loadDashboard(true);
      setCalendarRefreshTrigger((prev) => prev + 1);
      (async () => {
        await trackPaywallEvent("app_opened");
        try {
          await checkAndShowPaywall(user?.billing, navigation, "app_opened");
        } catch {
          // ignore
        }
      })();
    }, [loadDashboard, navigation, user?.billing, isOnline])
  );

  // Save last used project ID
  const saveLastUsedProject = useCallback(async (projectId: string) => {
    await AsyncStorage.setItem(LAST_USED_PROJECT_KEY, projectId);
    setLastUsedProjectId(projectId);
  }, []);

  // Handle quick action with project selection
  const handleQuickAction = useCallback(
    async (action: "task" | "photo" | "expense") => {
      if (!dashboardData || dashboardData.projects.length === 0) {
        Alert.alert(t("common.error"), t("home.noProjects"));
        return;
      }

      // For expense, always open modal with step 1 (project selection)
      if (action === "expense") {
        setExpenseStep(1);
        setExpenseProjectId(null);
        setShowExpenseModal(true);
        return;
      }

      // For task and photo, use project selector with lastUsedProjectId logic
      if (lastUsedProjectId && dashboardData.projects.some((p) => p.id === lastUsedProjectId)) {
        if (Platform.OS === "ios") {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options: [t("common.cancel"), t("home.changeProject"), t("common.continue")],
              cancelButtonIndex: 0,
              destructiveButtonIndex: -1,
            },
            (buttonIndex) => {
              if (buttonIndex === 1) {
                setPendingAction(action);
                setShowProjectSelector(true);
              } else if (buttonIndex === 2) {
                executeAction(action, lastUsedProjectId);
              }
            }
          );
        } else {
          Alert.alert(
            t("home.selectProject"),
            t("projectOverview.useProjectMessage", { name: dashboardData.projects.find((p) => p.id === lastUsedProjectId)?.name || "" }),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("home.changeProject"), onPress: () => {
                setPendingAction(action);
                setShowProjectSelector(true);
              }},
              { text: t("common.continue"), onPress: () => executeAction(action, lastUsedProjectId) },
            ]
          );
        }
      } else {
        setPendingAction(action);
        setShowProjectSelector(true);
      }
    },
    [dashboardData, lastUsedProjectId]
  );

  const executeAction = useCallback(
    async (action: "task" | "photo" | "expense" | "voice" | "problem", projectId: string) => {
      await saveLastUsedProject(projectId);
      const project = dashboardData?.projects.find((p) => p.id === projectId);

      switch (action) {
        case "task":
          stackNav.navigate("ProjectOverview", {
            projectId,
            projectName: project?.name,
            openNewTask: true,
          });
          break;
        case "expense":
          stackNav.navigate("ProjectOverview", {
            projectId,
            projectName: project?.name,
            openExpenseModal: true,
          });
          break;
        case "photo":
          stackNav.navigate("ProjectOverview", {
            projectId,
            projectName: project?.name,
            openDiaryModal: true,
            diaryInputMode: "text",
          });
          break;
        case "voice":
          stackNav.navigate("ProjectOverview", {
            projectId,
            projectName: project?.name,
            openDiaryModal: true,
            diaryInputMode: "voice",
          });
          break;
        case "problem":
          stackNav.navigate("CreateProblem", {
            projectId,
            projectName: project?.name,
            projectType: project?.projectType ?? "BUILD",
          });
          break;
      }
      setPendingAction(null);
      setShowProjectSelector(false);
    },
    [dashboardData, saveLastUsedProject, stackNav]
  );

  const runContextAction = useCallback(
    (action: "task" | "photo" | "expense" | "voice" | "problem", projectId?: string) => {
      if (projectId) {
        executeAction(action, projectId);
        return;
      }
      setPendingAction(action);
      setShowProjectSelector(true);
    },
    [executeAction]
  );

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

  const pickExpenseInvoiceImage = async () => {
    if (!ImagePicker) {
      Alert.alert(t("common.error"), t("expense.imagePickerNotInstalled"));
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
              // Camera
              await launchCameraForExpense();
            } else if (buttonIndex === 2) {
              // Gallery
              await launchGalleryForExpense();
            }
          }
        );
      } else {
        // Android - show Alert with options
        Alert.alert(
          t("projectOverview.selectSource"),
          t("projectOverview.selectSourceForInvoice"),
          [
            { text: t("common.cancel"), style: 'cancel' },
            { text: t("projectOverview.takePhoto"), onPress: launchCameraForExpense },
            { text: t("projectOverview.selectFromGallery"), onPress: launchGalleryForExpense },
          ]
        );
      }
    } catch (error: any) {
      console.error(`[HomeScreen] Error picking expense image:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectImage"));
    }
  };

  const runOcrOnExpenseImage = useCallback(
    async (uri: string, fileName: string) => {
      if (!expenseProjectId) return;
      try {
        setUploadingExpenseAttachment(true);
        setExpenseOcrLoading(true);
        const attachment = await attachmentsService.uploadAttachment(expenseProjectId, {
          expenseId: null,
          taskId: null,
          phaseId: null,
          localUri: uri,
          fileName,
          mimeType: "image/jpeg",
          kind: "image",
        });
        const storagePath = attachment.storagePath?.trim();
        if (!storagePath) throw new Error("Upload returned empty path.");
        const result = await processInvoiceAttachment({
          filePath: storagePath,
          mimeType: "image/jpeg",
          attachmentId: attachment.id,
          projectId: expenseProjectId,
        });
        if (result.status === "success" && result.parsed) {
          const v = getConfidenceAwareExpensePrefill(result);
          setExpenseTitle("");
          setExpenseNote("");
          if (v.amount) setExpenseAmount(v.amount);
          if (v.currency) setExpenseCurrency(v.currency);
          if (v.supplierName) setExpenseSupplierName(v.supplierName);
          if (v.issueDate) setExpenseDate(v.issueDate);
          if (v.supplierIco) setExpenseSupplierIco(v.supplierIco);
        } else if (result.status !== "success") {
          const msg =
            result.errorCode === "ENTITLEMENT_REQUIRED"
              ? t("subscription.entitlementRequired")
              : result.errorCode === "LIMIT_REACHED"
                ? t("expense.ocrLimit")
                : t("ocr.manualFallback");
          Alert.alert(t("common.warning"), msg);
        }
      } catch (error: any) {
        console.error("[HomeScreen] OCR failed:", error);
        Alert.alert(t("common.warning"), t("ocr.manualFallback"));
      } finally {
        setUploadingExpenseAttachment(false);
        setExpenseOcrLoading(false);
      }
    },
    [expenseProjectId, t]
  );

  const launchCameraForExpense = async () => {
    if (!ImagePicker) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Oprávnenie", "Potrebujeme prístup ku kamere na fotografovanie faktúr.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const img = { uri: asset.uri, fileName: asset.fileName || `faktura_${Date.now()}.jpg` };
        setExpenseInvoiceImage(img);
        if (expenseProjectId) await runOcrOnExpenseImage(img.uri, img.fileName);
      }
    } catch (error: any) {
      console.error("[HomeScreen] Error launching camera:", error);
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenCamera"));
    }
  };

  const launchGalleryForExpense = async () => {
    if (!ImagePicker) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Oprávnenie", "Potrebujeme prístup k galérii na výber faktúr.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      });
      const asset = result?.assets?.[0];
      if (!result?.canceled && asset?.uri) {
        const img = { uri: asset.uri, fileName: asset.fileName || `faktura_${Date.now()}.jpg` };
        setExpenseInvoiceImage(img);
        if (expenseProjectId) await runOcrOnExpenseImage(img.uri, img.fileName);
      }
    } catch (error: any) {
      console.error("[HomeScreen] Error picking from gallery:", error);
      Alert.alert(t("common.error"), t("projectOverview.failedToSelectImage"));
    }
  };

  const handleCreateExpense = useCallback(async () => {
    if (!expenseProjectId || !orgId || !expenseAmount.trim()) {
      Alert.alert(t("common.error"), t("expense.fillRequiredFields"));
      return;
    }

    if (!expenseCategory) {
      Alert.alert(t("common.error"), t("expense.selectType"));
      return;
    }

    setSubmittingExpense(true);
    setUploadingExpenseAttachment(false);
    
    try {
      const amount = parseFloat(expenseAmount.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        Alert.alert(t("common.error"), t("expense.enterValidAmount"));
        return;
      }

      // Create expense
      const expenseTitleValue = expenseTitle.trim() || (expenseCategory === 'WORK' ? t("expense.typeWork") : t("expense.typeMaterial"));
      const newExpense = await expensesService.createExpense(orgId, expenseProjectId, {
        title: expenseTitleValue,
        amount,
        currency: expenseCurrency || "EUR",
        date: new Date(expenseDate),
        note: expenseNote.trim() || undefined,
        source: expenseInvoiceImage ? 'DOCUMENT' : 'MANUAL',
        status: expenseInvoiceImage ? 'PROCESSING' : 'READY',
        category: expenseCategory,
        supplierName: expenseSupplierName.trim() || undefined,
        attachments: [],
        receipt: null,
        travel: null,
      });

      // Upload invoice image if provided
      let attachmentId: string | null = null;
      if (expenseInvoiceImage && newExpense.id) {
        try {
          setUploadingExpenseAttachment(true);
          const attachment = await attachmentsService.uploadAttachment(expenseProjectId, {
            expenseId: newExpense.id,
            taskId: null,
            phaseId: null,
            localUri: expenseInvoiceImage.uri,
            fileName: expenseInvoiceImage.fileName,
            mimeType: 'image/jpeg',
            kind: 'image',
          });
          attachmentId = attachment.id;

          // Update expense with attachmentId
          await expensesService.updateExpense(expenseProjectId, newExpense.id, {
            attachmentId: attachmentId,
          });
        } catch (error: any) {
          console.error(`[HomeScreen] Error uploading expense attachment:`, error);
          Alert.alert(t("common.warning"), t("expense.savedInvoiceFailed"));
        } finally {
          setUploadingExpenseAttachment(false);
        }
      }

      Alert.alert(t("common.success"), t("expense.added"));
      
      // Reset form
      setShowExpenseModal(false);
      setExpenseStep(1);
      setExpenseProjectId(null);
      setExpenseTitle("");
      setExpenseAmount("");
      setExpenseNote("");
      setExpenseDate(new Date().toISOString().split('T')[0]);
      setExpenseCategory(undefined);
      setExpenseSupplierName("");
      setExpenseCurrency("EUR");
      setExpenseInvoiceImage(null);
      
      await loadDashboard(true);
    } catch (error: any) {
      console.error("[HomeScreen] Error creating expense:", error);
      Alert.alert(t("common.error"), error.message || t("expense.failedToAdd"));
    } finally {
      setSubmittingExpense(false);
      setUploadingExpenseAttachment(false);
    }
  }, [expenseProjectId, orgId, expenseTitle, expenseAmount, expenseDate, expenseNote, expenseCategory, expenseSupplierName, expenseCurrency, expenseInvoiceImage, loadDashboard]);



  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (date >= today && date < tomorrow) {
        return `Dnes • ${date.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}`;
      }
      if (date >= tomorrow && date < new Date(tomorrow.getTime() + 86400000)) {
        return `Zajtra • ${date.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}`;
      }
      return date.toLocaleDateString('sk-SK', { day: '2-digit', month: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const getProjectIcon = (p?: ProjectDoc): React.ComponentProps<typeof Ionicons>["name"] => {
    if (!p?.projectType) return "folder-outline";
    if (isLegacyMaintenanceEquipmentHub(p)) return "construct-outline";
    return getActiveProductProjectType(p) === "TRADE" ? "person-outline" : "clipboard-outline";
  };

  const handleProjectClick = useCallback(
    (projectId: string) => {
      saveLastUsedProject(projectId);
      const project = dashboardData?.projects.find((p) => p.id === projectId);
      stackNav.navigate("ProjectOverview", {
        projectId,
        projectName: project?.name,
      });
    },
    [dashboardData, saveLastUsedProject, stackNav]
  );

  const startFabFlow = useCallback(() => {
    setPendingAction(null);
    setPendingExpenseType(null);
    setActionProjectId(null);
    setShowExpenseTypeModal(false);
    setShowActionSheet(false);
    setShowProjectSelector(true);
  }, []);

  const data = dashboardData || {
    projects: [],
    todayTasks: [],
    todaysWorkTasks: [],
    kpis: {
      openCount: 0,
      doneTodayCount: 0,
      blockedCount: 0,
      overdueCount: 0,
      expensesMonthSum: 0,
      expensesTotalSum: 0,
      hasExpensesAccess: false,
    },
    projectStats: new Map(),
  };

  const homeListExtraData = useMemo(
    () =>
      `${selectedTypeFilter}-${projectFilter}-${
        activeTimer ? `tick-${timerTick}-${activeTimer.startedAt}-${activeTimer.projectId}` : "noTimer"
      }-${data.todaysWorkTasks[0]?.id ?? "noTw"}`,
    [selectedTypeFilter, projectFilter, activeTimer, timerTick, data.todaysWorkTasks]
  );

  const liveMap = useMemo(() => {
    const m = new Map<string, LiveProjectRow>();
    liveRows.forEach((row) => m.set(row.projectId, row));
    return m;
  }, [liveRows]);

  const filteredProjects = useMemo(() => {
    let list = data.projects;
    if (projectFilter === "mine") list = list.filter(isSoloOwnerProjectRow);
    else if (projectFilter === "shared") list = list.filter(isSharedOrCollaborativeProjectRow);
    if (selectedTypeFilter !== "ALL") {
      list = list.filter((p) => getActiveProductProjectType(p) === selectedTypeFilter);
    }
    return list;
  }, [data.projects, projectFilter, selectedTypeFilter]);

  // Focus card: job workspaces only (dashboard omits legacy MAINTENANCE equipment hubs).
  const focusProject = useMemo(() => {
    if (lastUsedProjectId) {
      const selected = data.projects.find((p) => p.id === lastUsedProjectId);
      if (selected) return selected;
    }
    return data.projects[0] ?? null;
  }, [data.projects, lastUsedProjectId]);

  const otherProjects = useMemo(() => {
    return filteredProjects.filter((p) => p.id !== focusProject?.id);
  }, [filteredProjects, focusProject?.id]);
  const isHomeEmptyByConfig =
    allCustomSectionsDisabled &&
    !showHeaderChatShortcut &&
    !showQuickTime &&
    !showTodayPriorities &&
    !showBottomQuickActions;

  const previewProjects = useMemo(() => otherProjects.slice(0, 2), [otherProjects]);

  if (loading && !dashboardData) {
    return (
      <View style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: homeHeaderTopPadding }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingHint} maxFontSizeMultiplier={1.3}>
            {t("home.loadingProjects")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Fixed header outside FlatList for reliable touch handling */}
      <View style={[styles.headerRow, styles.headerRowCompact, { paddingTop: homeHeaderTopPadding, paddingHorizontal: spacing.lg }]}>
        <TouchableOpacity
          style={styles.headerAvatarBtn}
          onPress={openDrawer}
          accessibilityLabel="Open menu"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarText}>
                {(greetingName || "?").slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.welcomeTitle, styles.welcomeTitleCompact]} numberOfLines={1}>
            {t("home.greeting", { name: greetingName })}
          </Text>
          <Text style={[styles.welcomeSubtitle, styles.welcomeSubtitleCompact]} numberOfLines={1}>
            {t(
              headerUsageMode === "trade"
                ? "home.headerHintTrade"
                : headerUsageMode === "build"
                  ? "home.headerHintBuild"
                  : "home.headerHint"
            )}
          </Text>
          {canAccessBusiness && activeOrganization?.name ? (
            <View style={[styles.businessWorkspaceChip, styles.businessWorkspaceChipCompact]} accessibilityRole="text">
              <Ionicons name="business-outline" size={12} color="rgba(255,255,255,0.88)" />
              <Text style={styles.businessWorkspaceChipTextCompact} numberOfLines={1}>
                {t("home.businessWorkspaceChip", { company: activeOrganization.name })}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerActionsRow}>
          {showHeaderChatShortcut ? (
            <Pressable
              style={styles.headerChatBtn}
              onPress={openBusinessChat}
              accessibilityLabel={t("business.chat.inboxTitle")}
              accessibilityHint={t("business.chat.inboxSubtitle")}
              accessibilityRole="button"
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textOnDark} />
              {chatUnreadCount > 0 ? (
                <View style={styles.headerChatBadge}>
                  <Text style={styles.headerChatBadgeText}>{chatUnreadCount > 99 ? "99+" : String(chatUnreadCount)}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
          <Pressable
            style={styles.headerCustomizeBtn}
            onPress={openCustomizeSheet}
            accessibilityLabel={t("home.customizeHome")}
            accessibilityRole="button"
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          >
            <Ionicons name="grid-outline" size={18} color={colors.textOnDark} />
            <Ionicons name="add" size={14} color={colors.textOnDark} style={{ marginLeft: 2 }} />
          </Pressable>
        </View>
      </View>

      {pendingBusinessMemberships.length > 0 ? (
        <View style={[styles.businessPendingBannerWrap, { paddingHorizontal: spacing.lg }]}>
          {pendingBusinessMemberships.map((m) => {
            const companyLabel = (m.organizationName?.trim() || t("home.businessCompanyFallback")).trim();
            return (
              <View key={m.orgId} style={styles.businessPendingBannerCard} accessibilityRole="alert">
                <Ionicons name="time-outline" size={20} color="#B45309" style={{ marginRight: spacing.sm }} />
                <Text style={styles.businessPendingBannerText}>
                  {t("home.businessPendingBanner", { company: companyLabel })}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <FlatList
        data={[] as ProjectDoc[]}
        keyExtractor={(_item, index) => `home-${index}`}
        extraData={homeListExtraData}
        contentContainerStyle={[
          styles.content,
          { paddingTop: 0, paddingBottom: insets.bottom + (showBottomQuickActions ? 168 : spacing.xl * 2) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        ListHeaderComponent={
          <>
            {loadError && orgId ? (
              <View style={styles.loadErrorBanner}>
                <Ionicons name="cloud-offline-outline" size={20} color="#fff" style={{ marginRight: spacing.sm }} />
                <Text style={[styles.loadErrorText, { flex: 1 }]} maxFontSizeMultiplier={1.2}>
                  {t("home.loadError")}
                </Text>
                <TouchableOpacity onPress={() => loadDashboard(true)} style={styles.loadErrorRetry} accessibilityRole="button">
                  <Text style={styles.loadErrorRetryText}>{t("home.retry")}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {orgId && enabledSectionIds.has("quick_capture_card") && pendingQuickNotesCount > 0 ? (
              <TouchableOpacity
                style={styles.quickNotesInboxHint}
                onPress={() => stackNav.navigate("QuickNotesInbox")}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("home.pendingQuickNotes", { count: String(pendingQuickNotesCount) })}
              >
                <Ionicons name="file-tray-full-outline" size={20} color="rgba(255,255,255,0.92)" />
                <Text style={styles.quickNotesInboxHintText} maxFontSizeMultiplier={1.2}>
                  {t("home.pendingQuickNotes", { count: String(pendingQuickNotesCount) })}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.78)" />
              </TouchableOpacity>
            ) : null}
            {!isHomeEmptyByConfig && orgId && data.projects.length === 0 && showTodayPriorities ? (
              <View style={[styles.proPaperCard, { marginBottom: spacing.md }]}>
                <Text style={styles.proCardSectionTitle}>{t("home.pro.startTitle")}</Text>
                <Text style={styles.proCardBody}>{t("home.pro.startBody")}</Text>
                <TouchableOpacity
                  style={styles.proCardPrimaryCta}
                  onPress={() => {
                    try {
                      goToProjects({ openNew: true });
                    } catch (e) {
                      if (__DEV__) console.warn("[HomeScreen] goToProjects failed:", e);
                      goToProjects();
                    }
                  }}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                >
                  <Text style={styles.proCardPrimaryCtaText}>{t("firstProjectPrompt.createButton")}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: spacing.sm }} />
                </TouchableOpacity>
              </View>
            ) : null}
            {isHomeEmptyByConfig ? (
              <View style={styles.homeEmptyCard}>
                <Text style={styles.homeEmptyTitle}>{t("home.customize.emptyTitle")}</Text>
                <Text style={styles.homeEmptyBody}>{t("home.customize.emptyBody")}</Text>
              </View>
            ) : null}
            {!isHomeEmptyByConfig && data.projects.length === 0 && (!orgId || !showTodayPriorities) ? (
              <TouchableOpacity
                style={styles.firstProjectCtaCard}
                onPress={() => {
                  try {
                    goToProjects({ openNew: true });
                  } catch (e) {
                    if (__DEV__) console.warn("[HomeScreen] goToProjects failed, falling back to Projects tab:", e);
                    goToProjects();
                  }
                }}
                activeOpacity={0.9}
              >
                <Ionicons name="folder-open-outline" size={32} color={colors.primary} style={{ marginBottom: spacing.sm }} />
                <Text style={styles.firstProjectCtaTitle}>{t("firstProjectPrompt.title")}</Text>
                <Text style={styles.firstProjectCtaBody}>{t("firstProjectPrompt.body")}</Text>
                <View style={styles.firstProjectCtaButton}>
                  <Text style={styles.firstProjectCtaButtonText}>{t("firstProjectPrompt.createButton")}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            ) : null}
            {!isHomeEmptyByConfig && orgId && data.projects.length > 0 && showTodayPriorities ? (
              <View style={styles.cmpOverviewCard} accessibilityRole="summary">
                <Text style={styles.cmpOverviewTitle}>{t("home.compact.todayOverview")}</Text>
                {data.todaysWorkTasks[0] ? (
                  <View style={styles.cmpOverviewRow}>
                    <TouchableOpacity
                      style={styles.cmpUrgentTap}
                      onPress={() => openTodaysWorkTask(data.todaysWorkTasks[0])}
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={t("home.compact.urgentTask")}
                    >
                      {(() => {
                        const tw = data.todaysWorkTasks[0];
                        const badgeKey =
                          tw.workKind === "overdue"
                            ? "home.todaysWorkBadgeOverdue"
                            : tw.workKind === "blocked"
                              ? "home.todaysWorkBadgeBlocked"
                              : "home.todaysWorkBadgeDueToday";
                        const badgeStyle =
                          tw.workKind === "overdue"
                            ? styles.todaysWorkBadgeOverdue
                            : tw.workKind === "blocked"
                              ? styles.todaysWorkBadgeBlocked
                              : styles.todaysWorkBadgeDueToday;
                        return (
                          <View style={styles.cmpUrgentInner}>
                            <View style={[styles.cmpChip, badgeStyle]}>
                              <Text style={styles.cmpChipText} maxFontSizeMultiplier={1.08}>
                                {t(badgeKey)}
                              </Text>
                            </View>
                            <View style={styles.cmpUrgentTextCol}>
                              <Text style={styles.cmpTaskTitle} numberOfLines={1}>
                                {tw.title}
                              </Text>
                              <Text style={styles.cmpTaskProject} numberOfLines={1}>
                                {tw.projectName}
                              </Text>
                            </View>
                          </View>
                        );
                      })()}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => stackNav.navigate("Tasks")} style={styles.cmpLinkCta} accessibilityRole="button">
                      <Text style={styles.cmpLinkCtaText}>{t("home.compact.tasks")}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.cmpCleanWrap}>
                    <Text style={styles.cmpCleanTitle} maxFontSizeMultiplier={1.12}>
                      {t("home.compact.cleanToday")}
                    </Text>
                    <Text style={styles.cmpCleanBody} numberOfLines={2} maxFontSizeMultiplier={1.1}>
                      {t("home.compact.noUrgentTasks")}
                    </Text>
                  </View>
                )}
                <View style={styles.cmpDivider} />
                {enabledSectionIds.has("current_work") && focusProject ? (
                  <View style={styles.cmpOverviewRow}>
                    <View style={styles.cmpContinueCol}>
                      <Text style={styles.cmpContinueLabel}>{t("home.compact.continue")}</Text>
                      <Text style={styles.cmpContinueName} numberOfLines={1}>
                        {focusProject.name}
                      </Text>
                      <Text style={styles.cmpContinueMeta} numberOfLines={1}>
                        {(data.projectStats.get(focusProject.id)?.openCount ?? 0)}{" "}
                        {(data.projectStats.get(focusProject.id)?.openCount ?? 0) === 1
                          ? t("home.openTask_one")
                          : t("home.openTask_other")}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleProjectClick(focusProject.id)} style={styles.cmpLinkCta} accessibilityRole="button">
                      <Text style={styles.cmpLinkCtaText}>{t("home.compact.open")}</Text>
                    </TouchableOpacity>
                  </View>
                ) : data.projects.length > 0 ? (
                  <Text style={styles.cmpPickProject} numberOfLines={1}>
                    {t("home.compact.pickProject")}
                  </Text>
                ) : null}
                <View style={styles.cmpMetricsRow}>
                  <TouchableOpacity style={styles.cmpMetricPill} onPress={() => stackNav.navigate("Tasks")} activeOpacity={0.85}>
                    <Text style={styles.cmpMetricText} numberOfLines={1}>
                      {t("home.compact.openTasks", { count: String(data.kpis.openCount) })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cmpMetricPill}
                    onPress={() => stackNav.navigate("Tasks", { dueFilter: "overdue" })}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.cmpMetricText} numberOfLines={1}>
                      {t("home.compact.overdue", { count: String(data.kpis.overdueCount ?? 0) })}
                    </Text>
                  </TouchableOpacity>
                  {enabledSectionIds.has("service_tasks_alert") &&
                  equipmentHomeSummary &&
                  (equipmentHomeSummary.openServiceTasks > 0 || equipmentHomeSummary.dueTodayOrOverdue > 0) ? (
                    <TouchableOpacity
                      style={styles.cmpMetricPill}
                      onPress={() => goToEquipment({ screen: "EquipmentMain" })}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.cmpMetricText} numberOfLines={1}>
                        {t("home.compact.service", { count: String(equipmentHomeSummary.openServiceTasks) })}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
            {user?.id &&
            !isHomeEmptyByConfig &&
            (showQuickTime || (orgId && enabledSectionIds.has("quick_capture_card")) || !!orgId) ? (
              <View style={{ marginBottom: spacing.sm }}>
                <Text style={styles.cmpSectionHeading}>{t("home.compact.quickActions")}</Text>
                <View style={styles.cmpQuickRow}>
                  {showQuickTime ? (
                    <TouchableOpacity
                      style={[styles.cmpQuickPill, activeTimer ? styles.cmpQuickPillActive : null]}
                      onPress={openQuickTimeSheet}
                      activeOpacity={0.88}
                      accessibilityRole="button"
                      accessibilityLabel={
                        activeTimer
                          ? `${activeTimer.status === "paused" ? t("time.timerPaused") : t("time.timerRunning")}: ${activeTimer.projectNameSnapshot}`
                          : t("time.title")
                      }
                    >
                      <Ionicons
                        name={activeTimer ? (activeTimer.status === "paused" ? "pause" : "time") : "time-outline"}
                        size={15}
                        color={
                          activeTimer
                            ? activeTimer.status === "paused"
                              ? ACTIVE_TIMER_PAUSED_AMBER
                              : ACTIVE_TIMER_GREEN
                            : colors.textMuted
                        }
                      />
                      <Text style={styles.cmpQuickPillLabel} numberOfLines={2} maxFontSizeMultiplier={1.08}>
                        {t("home.pro.quickTime")}
                      </Text>
                      {activeTimer ? (
                        <Text key={timerTick} style={styles.cmpQuickPillHms} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                          {formatHomeTimerHms(timeTracking.calculateActiveTimerWorkMs(activeTimer))}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ) : null}
                  {orgId && enabledSectionIds.has("quick_capture_card") ? (
                    <TouchableOpacity
                      style={styles.cmpQuickPill}
                      onPress={() => setShowQuickNoteModal(true)}
                      activeOpacity={0.88}
                      accessibilityRole="button"
                      accessibilityLabel={t("home.quickCaptureTitle")}
                    >
                      <Ionicons name="create-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.cmpQuickPillLabel} numberOfLines={2} maxFontSizeMultiplier={1.08}>
                        {t("home.pro.quickNote")}
                      </Text>
                      {pendingQuickNotesCount > 0 ? (
                        <Text style={styles.cmpQuickPillBadge} numberOfLines={1}>
                          {String(pendingQuickNotesCount)}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ) : null}
                  {orgId ? (
                    <TouchableOpacity
                      style={styles.cmpQuickPill}
                      onPress={() => runContextAction("photo")}
                      activeOpacity={0.88}
                      accessibilityRole="button"
                      accessibilityLabel={t("home.pro.quickPhoto")}
                    >
                      <Ionicons name="camera-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.cmpQuickPillLabel} numberOfLines={2} maxFontSizeMultiplier={1.08}>
                        {t("home.pro.quickPhoto")}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {showQuickTime && activeTimer ? (
                  <View style={styles.homeTimerStatusBarActions}>
                    <TouchableOpacity
                      style={styles.homeTimerStatusBarLinkBtn}
                      onPress={() =>
                        stackNav.navigate("ProjectTimeDetail", {
                          projectId: activeTimer.projectId,
                          projectName: activeTimer.projectNameSnapshot || undefined,
                        })
                      }
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t("time.openTime")}
                    >
                      <Text style={styles.homeTimerStatusBarLinkText} maxFontSizeMultiplier={1.15}>
                        {t("time.openTime")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.homeTimerStatusBarStopCompact, homeStopLoading ? styles.homeTimerStatusBarBtnDisabled : null]}
                      onPress={handleHomeStopTimer}
                      disabled={homeStopLoading}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={t("time.stop")}
                    >
                      {homeStopLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.homeTimerStatusBarStopCompactText} maxFontSizeMultiplier={1.15}>
                          {t("time.stop")}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
            {!isHomeEmptyByConfig && enabledSectionIds.has("other_projects") && data.projects.length > 0 ? (
              <>
                <Text style={styles.cmpSectionHeading}>{t("home.compact.projects")}</Text>
                {previewProjects.map((item) => {
                  const live = liveMap.get(item.id);
                  const openTasks = data.projectStats.get(item.id)?.openCount ?? 0;
                  return (
                    <View key={item.id} style={{ marginBottom: spacing.xs }}>
                      <CompactProjectItem
                        project={item}
                        openTasks={openTasks}
                        lastActivity={live?.lastActivityLabel ?? "—"}
                        status={live?.status ?? "RISK"}
                        onOpen={handleProjectClick}
                        onPhoto={(projectId) => runContextAction("photo", projectId)}
                        onTask={(projectId) => runContextAction("task", projectId)}
                        onCoverPress={showCoverSheet}
                        currentUserId={user?.id}
                        minimal
                        hideSideActions
                      />
                    </View>
                  );
                })}
                {!isHomeEmptyByConfig &&
                enabledSectionIds.has("other_projects") &&
                otherProjects.length === 0 &&
                data.projects.length > 1 ? (
                  <View style={styles.emptyListContainer}>
                    <Text style={styles.emptyListText}>
                      {projectFilter === "shared"
                        ? focusProject && (focusProject.isSharedToMe === true || (focusProject.sharedWithCount ?? 0) > 0)
                          ? t("home.onlySharedProjectAbove")
                          : t("home.noSharedProjects")
                        : t("home.noProjectsMatchFilter")}
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity style={styles.showAllButton} onPress={() => goToProjects()}>
                  <Text style={styles.showAllButtonText}>{t("home.compact.allProjects")}</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {(() => {
              return (
                <>
                  {(enabledSectionIds.has("open_tasks_chip") ||
                    enabledSectionIds.has("projects_chip") ||
                    enabledSectionIds.has("time_tracking_chip") ||
                    (enabledSectionIds.has("expenses_chip") && data.kpis.hasExpensesAccess)) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {enabledSectionIds.has("open_tasks_chip") && (
                <TouchableOpacity style={styles.statChipMuted} onPress={() => stackNav.navigate("Tasks")} activeOpacity={0.8}>
                  <Text style={styles.statChipTextMuted}>
                    {t("home.openTasksChip")} <Text style={styles.statChipValueMuted}>{data.kpis.openCount}</Text>
                  </Text>
                </TouchableOpacity>
              )}
              {enabledSectionIds.has("projects_chip") && (
                <TouchableOpacity style={styles.statChipMuted} onPress={() => goToProjects()} activeOpacity={0.8}>
                  <Text style={styles.statChipTextMuted}>
                    {t("home.projectsCount", { count: String(data.projects.length) })}
                  </Text>
                </TouchableOpacity>
              )}
              {enabledSectionIds.has("time_tracking_chip") && (
                <TouchableOpacity
                  style={styles.statChipMuted}
                  onPress={() => stackNav.navigate("AttendanceReportScreen")}
                  activeOpacity={0.8}
                >
                  <Text style={styles.statChipTextMuted}>
                    {t("home.attendanceChip", { hours: formatMinutesToHours(monthlyMinutes) })}
                  </Text>
                </TouchableOpacity>
              )}
              {enabledSectionIds.has("expenses_chip") && data.kpis.hasExpensesAccess && (
                <TouchableOpacity
                  style={styles.statChipMuted}
                  onPress={() => stackNav.navigate("ExpensesKpiScreen")}
                  activeOpacity={0.8}
                >
                  <Text style={styles.statChipTextMuted}>
                    {t("home.expensesCount", { amount: String(Math.round(data.kpis.expensesTotalSum)) })}
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
                  )}
                  {enabledSectionIds.has("project_filters") && (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRowMerged}
              >
                <TouchableOpacity
                  style={styles.filterTypeTrigger}
                  onPress={() => setShowTypeFilterModal(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t("home.filterTypeTitle")}
                >
                  <Ionicons name="options-outline" size={17} color={colors.text} />
                  <Text style={styles.filterTypeTriggerText} numberOfLines={1}>
                    {t(
                      selectedTypeFilter === "ALL"
                        ? "home.filter.type.all"
                        : selectedTypeFilter === "BUILD"
                          ? "home.filter.type.management"
                          : "home.filter.type.trade"
                    )}
                  </Text>
                  <Ionicons name="chevron-down" size={15} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, projectFilter === "all" && styles.filterChipActive]}
                  onPress={() => handleProjectFilterChange("all")}
                >
                  <Text style={[styles.filterChipText, projectFilter === "all" && styles.filterChipTextActive]}>
                    {t("home.filterAll")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, projectFilter === "mine" && styles.filterChipActive]}
                  onPress={() => handleProjectFilterChange("mine")}
                >
                  <Text style={[styles.filterChipText, projectFilter === "mine" && styles.filterChipTextActive]}>
                    {t("home.filterMine")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterChip, projectFilter === "shared" && styles.filterChipActive]}
                  onPress={() => handleProjectFilterChange("shared")}
                >
                  <Text style={[styles.filterChipText, projectFilter === "shared" && styles.filterChipTextActive]}>
                    {t("home.filterShared")}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
              <Modal visible={showTypeFilterModal} transparent animationType="fade" onRequestClose={() => setShowTypeFilterModal(false)}>
                <Pressable style={styles.typeFilterModalOverlay} onPress={() => setShowTypeFilterModal(false)}>
                  <Pressable style={styles.typeFilterModalCard} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.typeFilterModalTitle}>{t("home.filterTypeTitle")}</Text>
                    {(["ALL", "BUILD", "TRADE"] as TypeFilter[]).map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.typeFilterModalRow, selectedTypeFilter === type && styles.typeFilterModalRowActive]}
                        onPress={() => {
                          void handleTypeFilterChange(type);
                          setShowTypeFilterModal(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.typeFilterModalRowText,
                            selectedTypeFilter === type && styles.typeFilterModalRowTextActive,
                          ]}
                        >
                          {t(
                            type === "ALL"
                              ? "home.filter.type.all"
                              : type === "BUILD"
                                ? "home.filter.type.management"
                                : "home.filter.type.trade"
                          )}
                        </Text>
                        {selectedTypeFilter === type ? (
                          <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                        ) : (
                          <Ionicons name="ellipse-outline" size={22} color={colors.border} />
                        )}
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={styles.typeFilterModalClose} onPress={() => setShowTypeFilterModal(false)}>
                      <Text style={styles.typeFilterModalCloseText}>{t("common.close")}</Text>
                    </TouchableOpacity>
                  </Pressable>
                </Pressable>
              </Modal>
            </>
                  )}
                </>
              );
            })()}
          </>
        }
        renderItem={() => <View style={{ height: 0 }} />}
        ListEmptyComponent={null}
        ListFooterComponent={null}
      />

      {/* Create your first project modal - shown once when 0 projects */}
      <Modal visible={showFirstProjectModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => {}}>
          <Pressable style={styles.firstProjectModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.firstProjectModalTitle}>{t("firstProjectPrompt.title")}</Text>
            <Text style={styles.firstProjectModalBody}>{t("firstProjectPrompt.body")}</Text>
            <TouchableOpacity
              style={styles.firstProjectModalPrimary}
              onPress={() => {
                setShowFirstProjectModal(false);
                try {
                  goToProjects({ openNew: true });
                } catch (e) {
                  if (__DEV__) console.warn("[HomeScreen] goToProjects failed, falling back to Projects tab:", e);
                  goToProjects();
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.firstProjectModalPrimaryText}>{t("firstProjectPrompt.createButton")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.firstProjectModalSecondary}
              onPress={async () => {
                setShowFirstProjectModal(false);
                await markFirstProjectPromptShown();
              }}
            >
              <Text style={styles.firstProjectModalSecondaryText}>{t("firstProjectPrompt.later")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Project Selector Modal */}
      <Modal visible={showProjectSelector} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("home.projectSheetTitle")}</Text>
              <TouchableOpacity onPress={() => {
                setShowProjectSelector(false);
                setPendingAction(null);
                setActionProjectId(null);
              }}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.quickNoteSection}>
              <TouchableOpacity
                style={styles.quickNoteRow}
                onPress={() => {
                  setShowProjectSelector(false);
                  setShowQuickNoteModal(true);
                }}
              >
                <Ionicons name="create-outline" size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                <Text style={styles.quickNoteRowText}>{t("quickNotes.add") || "Rýchly zápis"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickNoteRow}
                onPress={() => {
                  setShowProjectSelector(false);
                  (stackNav as { navigate: (a: string, b?: object) => void }).navigate("QuickNotesInbox");
                }}
              >
                <Ionicons name="folder-open-outline" size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                <Text style={styles.quickNoteRowText}>
                  {t("quickNotes.viewInbox") || "Zobraziť zápisky"}
                  {pendingQuickNotesCount > 0 ? ` (${pendingQuickNotesCount})` : ""}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.projectList}>
              {(!dashboardData?.projects || dashboardData.projects.length === 0) && (
                <TouchableOpacity
                  style={styles.projectItem}
                  onPress={() => {
                    setShowProjectSelector(false);
                    goToProjects({ openNew: true });
                  }}
                >
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                  <Text style={styles.projectItemText}>{t("home.createFirstProject") || "Vytvoriť prvý projekt"}</Text>
                </TouchableOpacity>
              )}
              {dashboardData?.projects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={styles.projectItem}
                  onPress={() => {
                    if (pendingAction === "expense" && pendingExpenseType) {
                      const projectData = dashboardData?.projects.find((p) => p.id === project.id);
                      stackNav.navigate("ProjectOverview", {
                        projectId: project.id,
                        projectName: projectData?.name,
                        openExpenseModal: true,
                        initialExpenseCategory: pendingExpenseType,
                      });
                      setShowProjectSelector(false);
                      setPendingAction(null);
                      setPendingExpenseType(null);
                      return;
                    }
                    if (pendingAction) {
                      executeAction(pendingAction, project.id);
                      return;
                    }
                    setActionProjectId(project.id);
                    setShowProjectSelector(false);
                    setShowActionSheet(true);
                  }}
                >
                  <Ionicons name={getProjectIcon(project)} size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                  <Text style={styles.projectItemText}>{project.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Unified bottom dock: calendar (optional) · project actions · time */}
      {showBottomQuickActions ? (
        <View style={[styles.fabDockWrap, { bottom: insets.bottom + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.fabDockInner}>
            <View style={styles.fabDockThird}>
              {enabledSectionIds.has("calendar") ? (
                <TouchableOpacity
                  style={styles.fabDockIconBtn}
                  onPress={openCalendarSheet}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={t("home.sectionCalendar")}
                >
                  <Ionicons name="calendar-outline" size={24} color={colors.primary} />
                </TouchableOpacity>
              ) : (
                <View style={styles.fabDockIconBtn} />
              )}
            </View>
            <View style={styles.fabDockThird}>
              <TouchableOpacity
                style={styles.fabDockCenterBtn}
                onPress={startFabFlow}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t("home.fabQuickActionsA11y")}
              >
                <Ionicons name="add" size={28} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.fabDockThird}>
              <TouchableOpacity
                style={styles.fabDockIconBtn}
                onPress={openQuickTimeSheet}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={
                  activeTimer
                    ? `${activeTimer.status === "paused" ? t("time.timerPaused") : t("time.timerRunning")}, ${formatHomeTimerHms(timeTracking.calculateActiveTimerWorkMs(activeTimer))}`
                    : t("time.title")
                }
              >
                {activeTimer ? (
                  <View style={styles.fabDockTimerActiveWrap}>
                    <Ionicons
                      name={activeTimer.status === "paused" ? "pause" : "time"}
                      size={24}
                      color={activeTimer.status === "paused" ? ACTIVE_TIMER_PAUSED_AMBER : ACTIVE_TIMER_GREEN}
                    />
                    {activeTimer.status === "paused" ? null : <View style={styles.fabDockTimerBadgeDot} />}
                  </View>
                ) : (
                  <Ionicons name="time-outline" size={26} color={colors.primary} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Expense Type Selection Modal - Klasický vs Cestovné */}
      <Modal visible={showExpenseTypeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("expense.add")}</Text>
              <TouchableOpacity onPress={() => {
                setShowExpenseTypeModal(false);
                setPendingAction(null);
                setActionProjectId(null);
              }}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={[styles.expenseTypeModalHint, { marginBottom: spacing.md }]}>
              {t("expense.selectTypeClassicOrTravel") || "Vyberte typ výdavku"}
            </Text>
            <TouchableOpacity
              style={styles.expenseTypeChoice}
              onPress={() => {
                setShowExpenseTypeModal(false);
                setPendingExpenseType("WORK");
                if (actionProjectId) {
                  const projectData = dashboardData?.projects.find((p) => p.id === actionProjectId);
                  stackNav.navigate("ProjectOverview", {
                    projectId: actionProjectId,
                    projectName: projectData?.name,
                    openExpenseModal: true,
                    initialExpenseCategory: "WORK",
                  });
                  setActionProjectId(null);
                } else {
                  setShowProjectSelector(true);
                }
              }}
            >
              <Ionicons name="document-text-outline" size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
              <Text style={styles.expenseTypeChoiceText}>{t("expense.typeClassic")}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.expenseTypeChoice}
              onPress={() => {
                setShowExpenseTypeModal(false);
                setPendingExpenseType("TRAVEL");
                if (actionProjectId) {
                  const projectData = dashboardData?.projects.find((p) => p.id === actionProjectId);
                  stackNav.navigate("ProjectOverview", {
                    projectId: actionProjectId,
                    projectName: projectData?.name,
                    openExpenseModal: true,
                    initialExpenseCategory: "TRAVEL",
                  });
                  setActionProjectId(null);
                } else {
                  setShowProjectSelector(true);
                }
              }}
            >
              <Ionicons name="car-outline" size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
              <Text style={styles.expenseTypeChoiceText}>{t("expense.typeTravel")}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showActionSheet}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowActionSheet(false);
          setActionProjectId(null);
        }}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => {
          setShowActionSheet(false);
          setActionProjectId(null);
        }}>
          <Pressable style={[styles.sheetPanel, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                if (actionProjectId) {
                  executeAction("photo", actionProjectId);
                  setActionProjectId(null);
                } else {
                  setPendingAction("photo");
                  setShowProjectSelector(true);
                }
              }}
            >
              <Text style={styles.sheetActionIcon}>📷</Text>
              <Text style={styles.sheetActionText}>{t("home.addDiaryEntry")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                if (actionProjectId) {
                  executeAction("task", actionProjectId);
                  setActionProjectId(null);
                } else {
                  setPendingAction("task");
                  setShowProjectSelector(true);
                }
              }}
            >
              <Text style={styles.sheetActionIcon}>✅</Text>
              <Text style={styles.sheetActionText}>{t("home.newTask")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                if (!dashboardData?.projects?.length) {
                  Alert.alert(t("common.error"), t("home.noProjects"));
                  return;
                }
                if (actionProjectId) {
                  setPendingExpenseType(null);
                  setShowExpenseTypeModal(true);
                } else {
                  setPendingAction("expense");
                  setShowExpenseTypeModal(true);
                }
              }}
            >
              <Text style={styles.sheetActionIcon}>€</Text>
              <Text style={styles.sheetActionText}>{t("home.recordExpense")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                if (actionProjectId) {
                  executeAction("problem", actionProjectId);
                  setActionProjectId(null);
                } else {
                  setPendingAction("problem");
                  setShowProjectSelector(true);
                }
              }}
            >
              <Text style={styles.sheetActionIcon}>⚠️</Text>
              <Text style={styles.sheetActionText}>{t("home.reportProblem")}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Expense Modal - Multi-step */}
      <Modal visible={showExpenseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {expenseStep === 1 ? t("home.selectProjectForExpense") : t("expense.add")}
              </Text>
              <TouchableOpacity onPress={() => {
                setShowExpenseModal(false);
                setExpenseStep(1);
                setExpenseProjectId(null);
                setExpenseTitle("");
                setExpenseAmount("");
                setExpenseNote("");
                setExpenseDate(new Date().toISOString().split('T')[0]);
                setExpenseCategory(undefined);
                setExpenseSupplierName("");
                setExpenseInvoiceImage(null);
              }}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {expenseStep === 1 ? (
              /* Step 1: Select Project */
              <ScrollView style={styles.projectList}>
                {!dashboardData || !dashboardData.projects || dashboardData.projects.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>{t("home.noProjects")}</Text>
                  </View>
                ) : (
                  dashboardData.projects.map((project) => (
                    <TouchableOpacity
                      key={project.id}
                      style={styles.projectItem}
                      onPress={() => {
                        setExpenseProjectId(project.id);
                        setExpenseStep(2);
                      }}
                    >
                      <Ionicons name={getProjectIcon(project)} size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                      <Text style={styles.projectItemText}>{project.name}</Text>
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            ) : (
              /* Step 2: Enter Expense Details */
              <ScrollView style={styles.modalContent}>
                {/* Invoice Image */}
                <View style={styles.expenseInvoiceSection}>
                  <Text style={styles.expenseInvoiceLabel}>{t("expense.invoice")}</Text>
                  {expenseInvoiceImage ? (
                    <View style={styles.expenseInvoicePreview}>
                      <Image source={{ uri: expenseInvoiceImage.uri }} style={styles.expenseInvoiceImage} />
                      <TouchableOpacity
                        style={styles.expenseInvoiceRemove}
                        onPress={() => setExpenseInvoiceImage(null)}
                      >
                        <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.expenseInvoiceButton}
                      onPress={pickExpenseInvoiceImage}
                      disabled={uploadingExpenseAttachment || expenseOcrLoading}
                    >
                      <Ionicons name="camera-outline" size={24} color={colors.primary} />
                      <Text style={styles.expenseInvoiceButtonText}>{t("expense.takeInvoicePhoto")}</Text>
                    </TouchableOpacity>
                  )}
                  {(uploadingExpenseAttachment || expenseOcrLoading) && (
                    <View style={styles.uploadingIndicator}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.uploadingText}>
                        {expenseOcrLoading ? t("expense.ocrProcessing") : t("common.uploading")}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Amount + Currency */}
                <View style={styles.expenseAmountRow}>
                  <TextInput
                    style={[styles.input, styles.expenseAmountInput]}
                    placeholder={t("expense.amount")}
                    placeholderTextColor="#FFFFFF"
                    value={expenseAmount}
                    onChangeText={handleAmountChange}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity
                    style={styles.expenseCurrencyTouchable}
                    onPress={() => setShowCurrencyDropdown(true)}
                  >
                    <Text style={styles.expenseCurrencyLabel}>{expenseCurrency}</Text>
                    <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.7)" />
                  </TouchableOpacity>
                  <CurrencyDropdown
                    visible={showCurrencyDropdown}
                    onClose={() => setShowCurrencyDropdown(false)}
                    value={expenseCurrency}
                    onSelect={setExpenseCurrency}
                  />
                </View>

                {/* Category Selector */}
                <View style={styles.expenseCategorySection}>
                  <Text style={styles.expenseCategoryLabel}>{t("expense.type")}</Text>
                  <View style={styles.expenseCategoryButtons}>
                    <TouchableOpacity
                      style={[
                        styles.expenseCategoryButton,
                        expenseCategory === 'WORK' && styles.expenseCategoryButtonActive,
                      ]}
                      onPress={() => setExpenseCategory('WORK')}
                    >
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
                      <Text
                        style={[
                          styles.expenseCategoryButtonText,
                          expenseCategory === 'MATERIAL' && styles.expenseCategoryButtonTextActive,
                        ]}
                      >
                        {t("expense.typeMaterial")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Supplier Name */}
                <TextInput
                  style={styles.input}
                  placeholder={t("expense.supplierName")}
                  placeholderTextColor="#FFFFFF"
                  value={expenseSupplierName}
                  onChangeText={setExpenseSupplierName}
                />

                {/* Title (optional, auto-filled if empty) */}
                <TextInput
                  style={styles.input}
                  placeholder={t("expense.title")}
                  placeholderTextColor="#FFFFFF"
                  value={expenseTitle}
                  onChangeText={setExpenseTitle}
                />

                {/* Date */}
                <TextInput
                  style={styles.input}
                  placeholder={t("expense.date")}
                  placeholderTextColor="#FFFFFF"
                  value={expenseDate}
                  onChangeText={setExpenseDate}
                />

                {/* Note */}
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={t("expense.note")}
                  placeholderTextColor="#FFFFFF"
                  value={expenseNote}
                  onChangeText={setExpenseNote}
                  multiline
                  numberOfLines={3}
                />

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => {
                      setExpenseStep(1);
                      setExpenseProjectId(null);
                    }}
                  >
                    <Text style={styles.modalCancelText}>{t("common.back")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalOk,
                      (!expenseAmount.trim() || !expenseCategory || submittingExpense || uploadingExpenseAttachment) && styles.modalOkDisabled,
                    ]}
                    onPress={handleCreateExpense}
                    disabled={!expenseAmount.trim() || !expenseCategory || submittingExpense || uploadingExpenseAttachment}
                  >
                    <Text style={styles.modalOkText}>
                      {submittingExpense || uploadingExpenseAttachment ? t("common.saving") : t("common.add")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <HomeCustomizeSheet
        sheetRef={customizeSheetRef}
        onLayoutChanged={(layout) => setHomeLayout(layout)}
        visible={showCustomizeModal}
        onDismiss={() => setShowCustomizeModal(false)}
      />
      <HomeCalendarSheet
        sheetRef={calendarSheetRef}
        refreshTrigger={calendarRefreshTrigger}
        onTaskPress={(task) => {
          calendarSheetRef.current?.dismiss();
          (navigation.getParent() as { getParent: () => { navigate: (n: string, p: object) => void } } | undefined)
            ?.getParent()
            ?.getParent()
            ?.navigate("TaskDetail", {
              task,
              onSaveComplete: () => setCalendarRefreshTrigger((prev) => prev + 1),
            });
        }}
        onProblemPress={(problem) => {
          calendarSheetRef.current?.dismiss();
          (navigation.getParent() as { getParent: () => { navigate: (n: string, p: object) => void } } | undefined)
            ?.getParent()
            ?.getParent()
            ?.navigate("ProblemDetail", {
              projectId: problem.projectId,
              problemId: problem.id,
              projectName: problem.projectName,
              projectType: problem.projectType,
            });
        }}
        onSeeAllForDate={(dueDateYmd) => {
          calendarSheetRef.current?.dismiss();
          navigation.navigate("Tasks", { dueDateYmd });
        }}
      />
      <QuickTimeModal
        sheetRef={quickTimeSheetRef}
        projects={
          dashboardData?.timeTrackingProjectIds != null
            ? (dashboardData.projects ?? []).filter((p) =>
                dashboardData.timeTrackingProjectIds!.includes(p.id)
              )
            : (dashboardData?.projects ?? [])
        }
        activeTimer={activeTimer}
        onRefreshActiveTimer={refreshActiveTimer}
        onTimerStarted={(name, timer) => {
          setActiveTimer(timer);
          showToast(t("home.timerStartedFor", { name }));
        }}
        onSaved={() => {
          if (user?.id) {
            const now = new Date();
            timeTracking.getMonthlyMinutes(user.id, now.getFullYear(), now.getMonth() + 1).then(setMonthlyMinutes);
          }
        }}
        t={t}
      />
      <QuickNoteModal
        visible={showQuickNoteModal}
        onClose={() => setShowQuickNoteModal(false)}
        onSaved={() => {
          if (user?.id) quickNotesService.getOpenQuickNotesCount(user.id).then(setPendingQuickNotesCount);
        }}
        onSubmit={async (text, attachments) => {
          if (!user?.id) return;
          let suggestedProjectId: string | null = null;
          let suggestedProjectName: string | null = null;
          let latitude: number | null = null;
          let longitude: number | null = null;
          try {
            const lastId = await AsyncStorage.getItem(LAST_USED_PROJECT_KEY);
            if (lastId && dashboardData?.projects?.length) {
              const p = dashboardData.projects.find((x) => x.id === lastId);
              if (p) {
                suggestedProjectId = lastId;
                suggestedProjectName = p.name ?? null;
              }
            }
          } catch {
            /* ignore */
          }
          try {
            const pos = await getCurrentPositionSafe();
            if (pos) {
              latitude = pos.lat;
              longitude = pos.lng;
            }
          } catch {
            /* ignore */
          }
          await quickNotesService.addQuickNote(user.id, text, attachments, {
            sourceScreen: "home",
            createdByUserId: user.id,
            suggestedProjectId,
            suggestedProjectName,
            latitude,
            longitude,
          });
        }}
        placeholder={t("quickNotes.placeholder") || "Čo si chcete zapamätať?"}
        saveLabel={t("quickNotes.save") || "Uložiť"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.lg * 3,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingHint: {
    marginTop: spacing.md,
    fontSize: 15,
    color: "rgba(255,255,255,0.88)",
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  welcomeHeader: {
    marginBottom: spacing.lg,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  welcomeTitleCompact: {
    fontSize: 18,
    marginBottom: 0,
    letterSpacing: -0.2,
  },
  welcomeSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: "rgba(255,255,255,0.72)",
    fontWeight: "500",
  },
  welcomeSubtitleCompact: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1,
  },
  businessWorkspaceChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    maxWidth: "100%",
  },
  businessWorkspaceChipText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.95)",
  },
  businessPendingBannerWrap: {
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  businessPendingBannerCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFFBEB",
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(180,83,9,0.35)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  businessPendingBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: "#92400E",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  headerRowCompact: {
    marginBottom: spacing.sm,
    alignItems: "flex-start",
  },
  headerAvatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  headerAvatarPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerChatBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  headerChatBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#EA580C",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  headerChatBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  headerCustomizeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  searchAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  statChipMuted: {
    backgroundColor: "rgba(240,244,248,0.72)",
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.35)",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    minHeight: 40,
    justifyContent: "center",
  },
  statChipTextMuted: {
    color: "rgba(17,17,17,0.72)",
    fontSize: 12,
    fontWeight: "500",
  },
  statChipValueMuted: {
    fontWeight: "700",
    color: colors.text,
  },
  loadErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(220,53,69,0.92)",
    borderRadius: radius,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  loadErrorText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  loadErrorRetry: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  loadErrorRetryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  quickCaptureCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    minHeight: 72,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 5,
  },
  quickCaptureIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  quickCaptureTextCol: {
    flex: 1,
    minWidth: 0,
  },
  quickCaptureTitleText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 3,
  },
  quickCaptureSubtitleText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  focusCard: {
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.45)",
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    borderRadius: radius,
    backgroundColor: colors.card,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  focusCardSuggested: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(45,74,122,0.55)",
    backgroundColor: "rgba(248,250,252,0.98)",
  },
  focusCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  focusCaption: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  focusTrustLine: {
    flex: 1,
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  focusTrustLineMuted: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  focusSharedBadge: {
    backgroundColor: "rgba(224,103,55,0.12)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(224,103,55,0.35)",
  },
  focusSharedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.primary,
  },
  focusTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.sm,
    letterSpacing: -0.2,
  },
  focusTitleSuggested: {
    fontSize: 19,
    fontWeight: "700",
  },
  focusTasksLine: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  focusActivityLine: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  focusActivityIntro: {
    color: colors.textMuted,
    fontWeight: "500",
  },
  focusActivityDot: {
    color: colors.textMuted,
    fontWeight: "500",
  },
  focusActivityValue: {
    color: colors.textMuted,
    fontWeight: "600",
  },
  focusCta: {
    minHeight: 52,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
  },
  focusCtaSecondary: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: colors.primary,
  },
  focusCtaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  focusCtaTextSecondary: {
    color: colors.primary,
  },
  alertsSection: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  alertRow: {
    minHeight: 44,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  alertIcon: {
    marginRight: spacing.sm,
    fontSize: 14,
  },
  alertText: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  equipmentAlertHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  sectionHeaderCompact: {
    marginBottom: spacing.sm,
  },
  typeFilterWrapper: {
    marginBottom: spacing.xs,
    overflow: "hidden",
  },
  typeFilterScroll: {
    maxHeight: 40,
  },
  typeFilterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterRowMerged: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingRight: spacing.lg,
  },
  filterTypeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(240,244,248,0.72)",
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.35)",
    maxWidth: 200,
  },
  filterTypeTriggerText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    flexShrink: 1,
  },
  typeFilterModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  typeFilterModalCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeFilterModalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  typeFilterModalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  typeFilterModalRowActive: {
    backgroundColor: "rgba(224,103,55,0.08)",
  },
  typeFilterModalRowText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "600",
    flex: 1,
  },
  typeFilterModalRowTextActive: {
    color: colors.primary,
  },
  typeFilterModalClose: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  typeFilterModalCloseText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textMuted,
  },
  filterChip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(240,244,248,0.55)",
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.3)",
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: "rgba(17,17,17,0.85)",
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  compactProjectRow: {
    minHeight: 88,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  compactProjectRowMinimal: {
    minHeight: 96,
  },
  compactProjectRowShared: {
    borderLeftWidth: 3,
    borderLeftColor: "#ff9f43",
  },
  compactStripe: {
    width: 4,
    alignSelf: "stretch",
  },
  compactStripeHome: {
    width: 3,
  },
  compactProjectBody: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  compactThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  compactThumbImage: {
    width: "100%",
    height: "100%",
  },
  compactThumbInitials: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  compactThumbIcon: {
    position: "absolute",
    right: 3,
    bottom: 3,
  },
  compactProjectTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compactProjectTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  compactProjectTitleMinimal: {
    fontSize: 16,
    letterSpacing: -0.2,
  },
  compactLocationOnly: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  compactSharedHint: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
    marginTop: 2,
  },
  compactProjectRowMember: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary + "99",
  },
  compactProjectSubline: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  compactProjectSublineMinimal: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    fontWeight: "500",
  },
  compactTypeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 1,
    flexWrap: "wrap",
  },
  compactTypeBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: "transparent",
  },
  compactTypeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  compactTypeBadgeCity: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
    flexShrink: 1,
  },
  compactMaintenanceMeta: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 11,
  },
  compactActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  compactActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f80ed",
  },
  compactActionBtnLarge: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  compactActionBtnTask: {
    backgroundColor: "#27ae60",
  },
  statusTag: {
    marginRight: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    maxWidth: 88,
  },
  statusTagRisk: {
    backgroundColor: "rgba(249,168,37,0.15)",
    borderWidth: 1,
    borderColor: "rgba(249,168,37,0.45)",
  },
  statusTagProblem: {
    backgroundColor: "rgba(198,40,40,0.12)",
    borderWidth: 1,
    borderColor: "rgba(198,40,40,0.4)",
  },
  statusTagText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  showAllButton: {
    minHeight: 44,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    backgroundColor: colors.card,
  },
  showAllButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetPanel: {
    backgroundColor: "#0f1724",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  sheetActionRow: {
    minHeight: 56,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  sheetActionIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  sheetActionText: {
    color: "#f0f4f8",
    fontSize: 16,
    fontWeight: "600",
  },
  comingSoonModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
  },
  comingSoonTitle: {
    color: colors.textOnDark,
    fontSize: 18,
    fontWeight: "700",
  },
  comingSoonText: {
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  comingSoonButton: {
    minHeight: 42,
    minWidth: 80,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  comingSoonButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  liveCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  liveCardTitle: {
    color: colors.textOnDark,
    fontSize: 16,
    fontWeight: "700",
  },
  liveRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  liveRowMain: {
    flexDirection: "row",
    alignItems: "center",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  dotOk: { backgroundColor: "#2e7d32" },
  dotRisk: { backgroundColor: "#f9a825" },
  dotProblem: { backgroundColor: "#c62828" },
  liveProjectName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  liveMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  liveEmpty: {
    color: colors.textMuted,
    fontSize: 13,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: spacing.xs,
  },
  searchClear: {
    padding: spacing.xs,
  },
  searchResults: {
    backgroundColor: colors.card,
    borderRadius: radius,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 200,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  searchResultSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  createProjectSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  createProjectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
    gap: spacing.sm,
  },
  createProjectButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionActive: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  quickActionText: {
    fontSize: 12,
    color: colors.text,
    marginTop: spacing.xs,
    fontWeight: "500",
  },
  quickActionEuro: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sectionMore: {
    fontSize: 14,
    color: colors.primary,
  },
  taskItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3a5280", // Sivá farba namiesto bielej
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  taskCheckbox: {
    marginRight: spacing.md,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF", // Biely text na sivom pozadí
    marginBottom: spacing.xs,
  },
  taskSubtitle: {
    fontSize: 14,
    color: "#FFFFFF", // Biely text na sivom pozadí
  },
  taskDue: {
    fontSize: 12,
    color: "#FFFFFF", // Biely text pre dátum
    marginLeft: spacing.sm,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  kpiCard: {
    width: "48%",
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 100,
    justifyContent: "center",
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
  },
  kpiEuro: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.primary,
  },
  filterContainer: {
    flexDirection: "row",
    marginBottom: spacing.md,
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  filterButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    minWidth: 80,
    alignItems: "center",
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterButtonText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "600",
  },
  filterButtonTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  projectCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  projectCardRow1: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    minHeight: 32,
  },
  projectCardRow2: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
    minHeight: 24,
  },
  projectCardRow3: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: "hidden",
    marginHorizontal: spacing.xs,
  },
  projectCardName: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    marginLeft: spacing.md,
    letterSpacing: -0.2,
  },
  projectCardOverflow: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
    minWidth: 32,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  projectCardLocation: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: "auto",
    textAlign: "right",
  },
  projectCardStats: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "600",
    minWidth: 90,
  },
  projectCardProgress: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "700",
    minWidth: 45,
    textAlign: "right",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  projectCardAdd: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  emptyContainer: {
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#FFFFFF",
    textAlign: "center",
    padding: spacing.md,
  },
  emptyListContainer: {
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyListText: {
    fontSize: 15,
    color: "rgba(255,255,255,0.88)",
    textAlign: "center",
    lineHeight: 22,
    fontWeight: "500",
  },
  homeEmptyCard: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: spacing.lg,
  },
  homeEmptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  homeEmptyBody: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 21,
  },
  fabDockWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  fabDockInner: {
    flexDirection: "row",
    alignItems: "center",
    width: "92%",
    maxWidth: 360,
    minHeight: 58,
    backgroundColor: colors.card,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.35)",
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  fabDockThird: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  fabDockIconBtn: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  fabDockCenterBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  fabDockTimerActiveWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 2,
    borderColor: ACTIVE_TIMER_GREEN,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ACTIVE_TIMER_GREEN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  fabDockTimerBadgeDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACTIVE_TIMER_GREEN,
    borderWidth: 2,
    borderColor: "#fff",
  },
  homeTimerStatusBarWrap: {
    marginBottom: spacing.sm,
  },
  homeQuickTilesWrap: {
    marginBottom: spacing.sm,
  },
  homeQuickTilesRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  homeQuickTile: {
    flex: 1,
    minHeight: 96,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  homeQuickTileTimer: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.22)",
  },
  homeQuickTileTimerOn: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.55)",
  },
  homeQuickTileNote: {
    backgroundColor: colors.primary,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  homeQuickTileIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    marginBottom: spacing.xs,
  },
  homeQuickTileIconWrapTimerOn: {
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 2,
    borderColor: ACTIVE_TIMER_GREEN,
  },
  homeQuickTileIconWrapNote: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  homeQuickTileLiveDot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACTIVE_TIMER_GREEN,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  homeQuickTileLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  homeQuickTileHms: {
    marginTop: 2,
    color: ACTIVE_TIMER_GREEN,
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  homeQuickTileBadge: {
    marginTop: 2,
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.28)",
    overflow: "hidden",
  },
  homeTimerStatusBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
  },
  homeTimerStatusBarInnerOff: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.28)",
  },
  homeTimerStatusBarInnerOn: {
    backgroundColor: "rgba(34,197,94,0.16)",
    borderColor: "rgba(34,197,94,0.55)",
  },
  homeTimerStatusBarIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  homeTimerStatusBarIconWrapOn: {
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 2,
    borderColor: ACTIVE_TIMER_GREEN,
  },
  homeTimerStatusBarLiveDot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: ACTIVE_TIMER_GREEN,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  homeTimerStatusBarTextCol: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.xs,
  },
  homeTimerStatusBarProject: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  homeTimerStatusBarHms: {
    fontSize: 20,
    fontWeight: "800",
    color: ACTIVE_TIMER_GREEN,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  homeTimerStatusBarIdleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.92)",
    lineHeight: 20,
  },
  homeTimerStatusBarActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.xs,
  },
  homeTimerStatusBarLinkBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  homeTimerStatusBarLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.92)",
    textDecorationLine: "underline",
  },
  homeTimerStatusBarStopCompact: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.error,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  homeTimerStatusBarStopCompactText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  homeTimerStatusBarBtnDisabled: {
    opacity: 0.65,
  },
  actionSheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingBottom: spacing.lg,
  },
  actionSheetItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionSheetText: {
    fontSize: 16,
    color: colors.text,
    marginLeft: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  firstProjectModal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  firstProjectModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },
  firstProjectModalBody: {
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  firstProjectModalPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  firstProjectModalPrimaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  firstProjectModalSecondary: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  firstProjectModalSecondaryText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  firstProjectCtaCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  firstProjectCtaTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  firstProjectCtaBody: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  firstProjectCtaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
  },
  firstProjectCtaButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  modal: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.lg,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  quickNoteSection: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  quickNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.25)",
    minHeight: 52,
  },
  quickNoteRowText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: "600",
    flex: 1,
  },
  quickNotesInboxHint: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius,
  },
  quickNotesInboxHintText: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
    fontSize: 14,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "600",
  },
  todaysWorkSection: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  todaysWorkHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  todaysWorkTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    flex: 1,
  },
  todaysWorkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    minHeight: 52,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  todaysWorkBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: spacing.sm,
    maxWidth: 100,
  },
  todaysWorkBadgeOverdue: {
    backgroundColor: "rgba(211,47,47,0.15)",
  },
  todaysWorkBadgeDueToday: {
    backgroundColor: "rgba(255,159,67,0.2)",
  },
  todaysWorkBadgeBlocked: {
    backgroundColor: "rgba(142,68,173,0.18)",
  },
  todaysWorkBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
    textTransform: "uppercase",
  },
  todaysWorkTextCol: {
    flex: 1,
    minWidth: 0,
  },
  todaysWorkTaskTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  todaysWorkProject: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  todaysWorkSeeTasks: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  todaysWorkSeeTasksText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  proPaperCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.2)",
    padding: spacing.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  proCardSectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  proSectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(255,255,255,0.92)",
    letterSpacing: 0.35,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  proCardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    fontWeight: "500",
    marginBottom: spacing.md,
  },
  proTodayClearTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  proTodayTaskPress: {
    paddingVertical: spacing.xs,
  },
  proTodayTaskTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
  },
  proTodayProject: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  proTodayMeta: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  proCardPrimaryCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  proCardPrimaryCtaText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  proCardSecondaryCta: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.35)",
    backgroundColor: "transparent",
  },
  proCardSecondaryCtaText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  proContinueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  proContinueCaption: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  proContinueName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  proContinueSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  proStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  proStatusDotOk: {
    backgroundColor: "#22c55e",
  },
  proStatusDotRisk: {
    backgroundColor: "#f59e0b",
  },
  proStatusDotProblem: {
    backgroundColor: "#ef4444",
  },
  proQuickRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  proQuickTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.22)",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 88,
  },
  proQuickTilePrimary: {
    borderColor: "rgba(224,103,55,0.45)",
    borderWidth: 1.5,
  },
  proQuickTileLabel: {
    marginTop: spacing.xs,
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  proQuickTileHms: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: colors.text,
  },
  proQuickTileBadge: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
  },
  businessWorkspaceChipCompact: {
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    gap: 3,
  },
  businessWorkspaceChipTextCompact: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
  },
  cmpOverviewCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.18)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    maxHeight: 230,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cmpOverviewTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs,
    letterSpacing: 0.2,
  },
  cmpOverviewRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  cmpUrgentTap: {
    flex: 1,
    minWidth: 0,
  },
  cmpUrgentInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cmpChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
  },
  cmpChipText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.text,
    textTransform: "uppercase",
  },
  cmpUrgentTextCol: {
    flex: 1,
    minWidth: 0,
  },
  cmpTaskTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  cmpTaskProject: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  cmpLinkCta: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
    flexShrink: 0,
  },
  cmpLinkCtaText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  cmpCleanWrap: {
    marginBottom: spacing.xs,
  },
  cmpCleanTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  cmpCleanBody: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  cmpDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  cmpContinueCol: {
    flex: 1,
    minWidth: 0,
  },
  cmpContinueLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  cmpContinueName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  cmpContinueMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  cmpPickProject: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
    marginBottom: spacing.xs,
  },
  cmpMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  cmpMetricPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(45,74,122,0.08)",
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.12)",
  },
  cmpMetricText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.text,
  },
  cmpSectionHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    marginBottom: spacing.xs,
    letterSpacing: 0.15,
  },
  cmpQuickRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "stretch",
  },
  cmpQuickPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    maxHeight: 58,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.16)",
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cmpQuickPillActive: {
    borderColor: "rgba(224,103,55,0.55)",
    borderWidth: 1,
  },
  cmpQuickPillLabel: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
  cmpQuickPillHms: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
  },
  cmpQuickPillBadge: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: "800",
    color: colors.primary,
  },
  compactProjectRowHome: {
    minHeight: 64,
  },
  compactThumbHome: {
    width: 36,
    height: 36,
    borderRadius: 10,
    marginLeft: spacing.xs,
  },
  compactThumbInitialsHome: {
    fontSize: 12,
  },
  compactProjectTitleHome: {
    fontSize: 14,
  },
  compactProjectSublineHome: {
    fontSize: 11,
    lineHeight: 15,
  },
  projectList: {
    maxHeight: 400,
  },
  projectItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(45,74,122,0.25)",
    minHeight: 52,
  },
  projectItemText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: "600",
    flex: 1,
  },
  expenseTypeModalHint: {
    fontSize: 14,
    color: colors.textMuted,
  },
  expenseTypeChoice: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseTypeChoiceText: {
    fontSize: 16,
    color: "#FFFFFF",
    flex: 1,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: "#FFFFFF",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  modalCancel: {
    padding: spacing.sm,
  },
  modalCancelText: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  modalOk: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius,
  },
  modalOkDisabled: {
    opacity: 0.5,
  },
  modalOkText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  modalContent: {
    maxHeight: 500,
  },
  expenseInvoiceSection: {
    marginBottom: spacing.md,
  },
  expenseInvoiceLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: spacing.sm,
  },
  expenseInvoiceButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    gap: spacing.sm,
  },
  expenseInvoiceButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: "500",
  },
  expenseInvoicePreview: {
    position: "relative",
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  expenseInvoiceImage: {
    width: "100%",
    height: 200,
    resizeMode: "contain",
    backgroundColor: colors.background,
  },
  expenseInvoiceRemove: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.xs,
  },
  expenseAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  expenseAmountInput: {
    flex: 1,
    marginRight: spacing.sm,
    marginBottom: 0,
  },
  expenseCurrencyTouchable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  expenseCurrencyLabel: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  expenseCategorySection: {
    marginBottom: spacing.md,
  },
  expenseCategoryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: spacing.sm,
  },
  expenseCategoryButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  expenseCategoryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  expenseCategoryButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  expenseCategoryButtonText: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  expenseCategoryButtonTextActive: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  uploadingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  uploadingText: {
    fontSize: 14,
    color: "#FFFFFF",
  },
});
