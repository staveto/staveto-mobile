import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "react-native";
import { TabActions, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import * as dashboardService from "../services/dashboard";
import * as projectEventsService from "../services/projectEvents";
import type { ProjectDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";
import { colors, radius, spacing } from "../theme";
import { openInMaps } from "../lib/maps";
import { RoleChip } from "../components/RoleChip";
import { ProjectTypeChip } from "../components/ProjectTypeChip";
import { normalizeRoleKey } from "../helpers/role";
import type { RoleKey } from "../helpers/role";
import { getKpiCardsWithTasks } from "../helpers/kpi/getKpiCards";
import { KpiCardComponent } from "../components/KpiCard";
import type { KpiCard } from "../helpers/kpi/getKpiCards";

// Conditional imports for image/document picker
let ImagePicker: typeof import('expo-image-picker') | null = null;
let DocumentPicker: typeof import('expo-document-picker') | null = null;

try {
  ImagePicker = require('expo-image-picker');
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.warn('expo-image-picker or expo-document-picker not installed. Attachment features will be disabled.');
}

const LAST_USED_PROJECT_KEY = "@staveto:lastUsedProjectId";
const ROLE_FILTER_KEY = "@staveto:lastRoleFilter";

type DashboardViewModel = {
  projects: ProjectDoc[];
  todayTasks: Array<TaskDoc & { projectName: string; phaseName?: string }>;
  kpis: {
    openCount: number;
    doneTodayCount: number;
    blockedCount: number;
    expensesMonthSum: number;
    expensesTotalSum: number;
  };
  projectStats: Map<string, { openCount: number; totalCount: number; progress: number }>;
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
  lastActivity: string;
  status: "OK" | "RISK" | "PROBLEM";
  onOpen: (projectId: string) => void;
  onPhoto: (projectId: string) => void;
  onTask: (projectId: string) => void;
};

const CompactProjectItem = React.memo(function CompactProjectItem({
  project,
  openTasks,
  lastActivity,
  status,
  onOpen,
  onPhoto,
  onTask,
}: CompactProjectItemProps) {
  const stripeColor =
    project.projectType === "BUILD" || project.projectType === "MANAGEMENT"
      ? "#ff9f43"
      : project.projectType === "TRADE"
      ? "#5dade2"
      : "#7dcea0";
  const statusLabel = status === "OK" ? "OK" : status === "RISK" ? "Riziko" : "Čaká";

  return (
    <TouchableOpacity
      style={styles.compactProjectRow}
      onPress={() => onOpen(project.id)}
      activeOpacity={0.8}
    >
      <View style={[styles.compactStripe, { backgroundColor: stripeColor }]} />
      <View style={styles.compactProjectBody}>
        <Text style={styles.compactProjectTitle} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.compactProjectSubline} numberOfLines={1}>
          {openTasks} {openTasks === 1 ? "otvorená úloha" : "otvorené úlohy"} • aktivita {lastActivity}
        </Text>
      </View>
      <View style={styles.compactActions}>
        <TouchableOpacity
          style={styles.compactActionBtn}
          onPress={(e) => {
            e.stopPropagation();
            onPhoto(project.id);
          }}
        >
          <Ionicons name="camera-outline" size={16} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.compactActionBtn, styles.compactActionBtnTask]}
          onPress={(e) => {
            e.stopPropagation();
            onTask(project.id);
          }}
        >
          <Ionicons name="checkmark-outline" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
      <View style={styles.statusTag}>
        <Text style={styles.statusTagText}>{statusLabel}</Text>
      </View>
    </TouchableOpacity>
  );
});

export function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [dashboardData, setDashboardData] = useState<DashboardViewModel | null>(null);
  const [allTasks, setAllTasks] = useState<TaskDoc[]>([]);
  const [liveRows, setLiveRows] = useState<LiveProjectRow[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUsedProjectId, setLastUsedProjectId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleKey | "ALL">("ALL");

  // Load persisted role filter on mount
  useEffect(() => {
    const loadPersistedFilter = async () => {
      try {
        const savedFilter = await AsyncStorage.getItem(ROLE_FILTER_KEY);
        if (savedFilter && (savedFilter === "ALL" || ["ADMIN", "MANAGER", "TRADE"].includes(savedFilter))) {
          setRoleFilter(savedFilter as RoleKey | "ALL");
        }
      } catch (error) {
        console.warn("[HomeScreen] Failed to load persisted role filter:", error);
      }
    };
    loadPersistedFilter();
  }, []);

  // Persist role filter when it changes
  const handleRoleFilterChange = useCallback(async (filter: RoleKey | "ALL") => {
    setRoleFilter(filter);
    try {
      await AsyncStorage.setItem(ROLE_FILTER_KEY, filter);
    } catch (error) {
      console.warn("[HomeScreen] Failed to persist role filter:", error);
    }
  }, []);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [pendingAction, setPendingAction] = useState<"task" | "photo" | "expense" | "voice" | null>(null);
  const [fabProjectSelectionMode, setFabProjectSelectionMode] = useState(false);
  const [actionProjectId, setActionProjectId] = useState<string | null>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseStep, setExpenseStep] = useState<1 | 2>(1); // 1 = select project, 2 = enter details
  const [expenseProjectId, setExpenseProjectId] = useState<string | null>(null);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<'WORK' | 'MATERIAL' | undefined>(undefined);
  const [expenseSupplierName, setExpenseSupplierName] = useState("");
  const [expenseInvoiceImage, setExpenseInvoiceImage] = useState<{ uri: string; fileName: string } | null>(null);
  const [uploadingExpenseAttachment, setUploadingExpenseAttachment] = useState(false);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);

  const stackNav = navigation as { navigate: (name: string, params?: object) => void };
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
  const goToSearch = useCallback(() => {
    let nav: any = navigation;
    while (nav && typeof nav.getState === "function") {
      const routeNames = nav.getState?.().routeNames as string[] | undefined;
      if (routeNames?.includes("Search")) {
        if (nav.navigate) {
          nav.navigate("Search");
          return;
        }
        if (nav.dispatch) {
          nav.dispatch(TabActions.jumpTo("Search"));
          return;
        }
      }
      nav = nav.getParent?.();
    }
  }, [navigation]);
  const [onboardingDisplayName, setOnboardingDisplayName] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem("pending_onboarding").then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { displayName?: string };
          if (parsed?.displayName?.trim()) setOnboardingDisplayName(parsed.displayName.trim());
        } catch {
          // ignore
        }
      }
    });
  }, []);
  const displayName = user?.name ?? onboardingDisplayName ?? user?.email ?? t("home.userFallback");

  const formatLastActivity = useCallback((date: Date | null) => {
    if (!date) return "No activity";
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }, []);

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

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await dashboardService.loadDashboardData(orgId);

      // Enrich today tasks with project names and phase names
      // Filter out tasks from BUILD projects
      const enrichedTasks = await Promise.all(
        data.todayTasks.map(async (task) => {
          const project = data.projects.find((p) => p.id === task.projectId);
          let phaseName: string | undefined;
          if (task.phaseId && project) {
            try {
              const phases = await projectsService.listProjectPhases(project.id);
              const phase = phases.find((p) => p.id === task.phaseId);
              phaseName = phase?.name;
            } catch (error) {
              // Ignore phase loading errors
            }
          }
          return {
            ...task,
            projectName: project?.name || "Unknown",
            phaseName,
          };
        })
      );

      setDashboardData({
        projects: data.projects,
        todayTasks: enrichedTasks,
        kpis: data.kpis,
        projectStats: data.projectStats,
      });
    } catch (error: any) {
      console.error("[HomeScreen] Error loading dashboard:", error);
      setDashboardData({
        projects: [],
        todayTasks: [],
        kpis: {
          openCount: 0,
          doneTodayCount: 0,
          blockedCount: 0,
          expensesMonthSum: 0,
          expensesTotalSum: 0,
        },
        projectStats: new Map(),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

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

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadLiveActivity();
  }, [loadLiveActivity]);

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
    async (action: "task" | "photo" | "expense" | "voice", projectId: string) => {
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
      }
      setPendingAction(null);
      setShowProjectSelector(false);
    },
    [dashboardData, saveLastUsedProject, stackNav]
  );

  const runContextAction = useCallback(
    (action: "task" | "photo" | "expense" | "voice", projectId?: string) => {
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

  const launchCameraForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      // Request camera permissions
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
        setExpenseInvoiceImage({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
        });
      }
    } catch (error: any) {
      console.error(`[HomeScreen] Error launching camera:`, error);
      Alert.alert(t("common.error"), t("projectOverview.failedToOpenCamera"));
    }
  };

  const launchGalleryForExpense = async () => {
    if (!ImagePicker) return;
    
    try {
      // Request media library permissions
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
        setExpenseInvoiceImage({
          uri: asset.uri,
          fileName: asset.fileName || `faktura_${Date.now()}.jpg`,
        });
      }
    } catch (error: any) {
      console.error(`[HomeScreen] Error picking from gallery:`, error);
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
        date: new Date(expenseDate),
        note: expenseNote.trim() || undefined,
        source: expenseInvoiceImage ? 'DOCUMENT' : 'MANUAL',
        status: expenseInvoiceImage ? 'PROCESSING' : 'READY',
        category: expenseCategory,
        supplierName: expenseSupplierName.trim() || undefined,
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
      setExpenseInvoiceImage(null);
      
      await loadDashboard(true);
    } catch (error: any) {
      console.error("[HomeScreen] Error creating expense:", error);
      Alert.alert(t("common.error"), error.message || t("expense.failedToAdd"));
    } finally {
      setSubmittingExpense(false);
      setUploadingExpenseAttachment(false);
    }
  }, [expenseProjectId, orgId, expenseTitle, expenseAmount, expenseDate, expenseNote, expenseCategory, expenseSupplierName, expenseInvoiceImage, loadDashboard]);



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

  const getProjectIcon = (projectType?: string): React.ComponentProps<typeof Ionicons>["name"] => {
    if (projectType === "BUILD" || projectType === "MANAGEMENT") return "clipboard-outline";
    if (projectType === "MAINTENANCE") return "construct-outline";
    if (projectType === "RESIDENTIAL") return "home-outline";
    if (projectType === "TRADE") return "person-outline";
    return "folder-outline";
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
    if (!dashboardData || dashboardData.projects.length === 0) {
      Alert.alert(t("common.error"), t("home.noProjects"));
      return;
    }
    setPendingAction(null);
    setFabProjectSelectionMode(true);
    setShowProjectSelector(true);
  }, [dashboardData, t]);

  const handleTaskClick = useCallback(
    (task: TaskDoc & { projectName: string }) => {
      stackNav.navigate("ProjectOverview", {
        projectId: task.projectId,
        projectName: task.projectName,
      });
    },
    [stackNav]
  );

  const data = dashboardData || {
    projects: [],
    todayTasks: [],
    kpis: { openCount: 0, doneTodayCount: 0, blockedCount: 0, expensesMonthSum: 0, expensesTotalSum: 0 },
    projectStats: new Map(),
  };

  const liveMap = useMemo(() => {
    const m = new Map<string, LiveProjectRow>();
    liveRows.forEach((row) => m.set(row.projectId, row));
    return m;
  }, [liveRows]);

  const focusProject = useMemo(() => {
    if (lastUsedProjectId) {
      const selected = data.projects.find((p) => p.id === lastUsedProjectId);
      if (selected) return selected;
    }
    return data.projects[0] ?? null;
  }, [data.projects, lastUsedProjectId]);

  const otherProjects = useMemo(
    () => data.projects.filter((p) => p.id !== focusProject?.id),
    [data.projects, focusProject?.id]
  );

  const overdueCount = useMemo(
    () =>
      data.todayTasks.filter((task) => {
        if (!task.dueDate) return false;
        if (task.status === "DONE") return false;
        return new Date(task.dueDate).getTime() < Date.now();
      }).length,
    [data.todayTasks]
  );

  const alerts = useMemo(() => {
    const rows: Array<{ id: string; icon: string; text: string; onPress: () => void }> = [];
    if (data.kpis.blockedCount > 0) {
      rows.push({
        id: "blocked",
        icon: "⚠️",
        text: `${data.kpis.blockedCount} veci čakajú na materiál`,
        onPress: () => stackNav.navigate("Tasks", { status: "BLOCKED" }),
      });
    }
    if (overdueCount > 0) {
      rows.push({
        id: "overdue",
        icon: "⏱️",
        text: `${overdueCount} úloha mešká`,
        onPress: () => stackNav.navigate("Tasks", { overdue: true }),
      });
    }
    return rows.slice(0, 2);
  }, [data.kpis.blockedCount, overdueCount, stackNav]);

  if (loading && !dashboardData) {
    return (
      <View style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: insets.top + spacing.lg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={otherProjects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 120 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.welcomeTitle}>{t("home.greeting", { name: displayName })}</Text>
                <Text style={styles.welcomeSubtitle}>Prehľad projektov</Text>
              </View>
              <TouchableOpacity style={styles.searchAction} onPress={goToSearch} accessibilityLabel="Search">
                <Ionicons name="search" size={22} color={colors.textOnDark} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <TouchableOpacity style={styles.statChip} onPress={() => stackNav.navigate("Tasks")} activeOpacity={0.8}>
                <Text style={styles.statChipText}>{t("home.openTasksChip")} {data.kpis.openCount}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.statChip} onPress={() => goToProjects()} activeOpacity={0.8}>
                <Text style={styles.statChipText}>Projekty {data.projects.length}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.statChip}
                onPress={() => {
                  setPendingAction("expense");
                  setShowProjectSelector(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.statChipText}>Výdavky {Math.round(data.kpis.expensesTotalSum)}€</Text>
              </TouchableOpacity>
            </ScrollView>

            {focusProject ? (
              <View style={styles.focusCard}>
                <Text style={styles.focusCaption}>Práve robím</Text>
                <Text style={styles.focusTitle} numberOfLines={1}>
                  {focusProject.name}
                </Text>
                <Text style={styles.focusSubline}>
                  {(data.projectStats.get(focusProject.id)?.openCount ?? 0)} otvorené úlohy • posledná aktivita pred{" "}
                  {liveMap.get(focusProject.id)?.lastActivityLabel ?? "—"}
                </Text>
                <TouchableOpacity
                  style={styles.focusCta}
                  onPress={() => handleProjectClick(focusProject.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.focusCtaText}>Pokračovať v práci</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {alerts.length > 0 ? (
              <View style={styles.alertsSection}>
                {alerts.map((row) => (
                  <TouchableOpacity key={row.id} style={styles.alertRow} onPress={row.onPress} activeOpacity={0.8}>
                    <Text style={styles.alertIcon}>{row.icon}</Text>
                    <Text style={styles.alertText}>{row.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <View style={styles.sectionHeaderCompact}>
              <Text style={styles.sectionTitle}>Ostatné projekty</Text>
            </View>
          </>
        }
        renderItem={({ item }) => {
          const live = liveMap.get(item.id);
          const openTasks = data.projectStats.get(item.id)?.openCount ?? 0;
          return (
            <CompactProjectItem
              project={item}
              openTasks={openTasks}
              lastActivity={live?.lastActivityLabel ?? "—"}
              status={live?.status ?? "RISK"}
              onOpen={handleProjectClick}
              onPhoto={(projectId) => runContextAction("photo", projectId)}
              onTask={(projectId) => runContextAction("task", projectId)}
            />
          );
        }}
        ListFooterComponent={
          <TouchableOpacity style={styles.showAllButton} onPress={() => goToProjects()}>
            <Text style={styles.showAllButtonText}>Zobraziť všetky projekty</Text>
          </TouchableOpacity>
        }
      />

      {/* Project Selector Modal */}
      <Modal visible={showProjectSelector} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Vyberte projekt</Text>
              <TouchableOpacity onPress={() => {
                setShowProjectSelector(false);
                setPendingAction(null);
                setFabProjectSelectionMode(false);
              }}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.projectList}>
              {dashboardData?.projects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={styles.projectItem}
                  onPress={() => {
                    if (pendingAction) {
                      executeAction(pendingAction, project.id);
                      return;
                    }
                    if (fabProjectSelectionMode) {
                      setActionProjectId(project.id);
                      setShowProjectSelector(false);
                      setFabProjectSelectionMode(false);
                      setShowActionSheet(true);
                    }
                  }}
                >
                  <Ionicons name={getProjectIcon(project.projectType)} size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
                  <Text style={styles.projectItemText}>{project.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Central FAB */}
      <TouchableOpacity
        style={[styles.fab, styles.fabCenter, { bottom: insets.bottom + spacing.md }]}
        onPress={startFabFlow}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal
        visible={showActionSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowActionSheet(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowActionSheet(false)}>
          <Pressable style={[styles.sheetPanel, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                runContextAction("photo", actionProjectId ?? undefined);
              }}
            >
              <Text style={styles.sheetActionIcon}>📷</Text>
              <Text style={styles.sheetActionText}>Pridať zápis do denníka</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                runContextAction("task", actionProjectId ?? undefined);
              }}
            >
              <Text style={styles.sheetActionIcon}>✅</Text>
              <Text style={styles.sheetActionText}>Nová úloha</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetActionRow}
              onPress={() => {
                setShowActionSheet(false);
                runContextAction("expense", actionProjectId ?? undefined);
              }}
            >
              <Text style={styles.sheetActionIcon}>€</Text>
              <Text style={styles.sheetActionText}>Zapísať výdavok</Text>
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
                      <Ionicons name={getProjectIcon(project.projectType)} size={24} color={colors.primary} style={{ marginRight: spacing.md }} />
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
                      disabled={uploadingExpenseAttachment}
                    >
                      <Ionicons name="camera-outline" size={24} color={colors.primary} />
                      <Text style={styles.expenseInvoiceButtonText}>{t("expense.takeInvoicePhoto")}</Text>
                    </TouchableOpacity>
                  )}
                  {uploadingExpenseAttachment && (
                    <View style={styles.uploadingIndicator}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.uploadingText}>Nahráva sa...</Text>
                    </View>
                  )}
                </View>

                {/* Amount */}
                <TextInput
                  style={styles.input}
                  placeholder={t("expense.amount")}
                  placeholderTextColor="#FFFFFF"
                  value={expenseAmount}
                  onChangeText={handleAmountChange}
                  keyboardType="decimal-pad"
                />

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
  welcomeHeader: {
    marginBottom: spacing.lg,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
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
    paddingBottom: spacing.md,
  },
  statChip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: "center",
  },
  statChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  focusCard: {
    borderWidth: 1.5,
    borderColor: "#ff9f43",
    borderRadius: radius,
    backgroundColor: colors.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  focusCaption: {
    color: "#ffb266",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  focusTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  focusSubline: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  focusCta: {
    minHeight: 46,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  focusCtaText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
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
  sectionHeaderCompact: {
    marginBottom: spacing.sm,
  },
  compactProjectRow: {
    minHeight: 64,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  compactStripe: {
    width: 4,
    alignSelf: "stretch",
  },
  compactProjectBody: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  compactProjectTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
  },
  compactProjectSubline: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  compactActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  compactActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2f80ed",
  },
  compactActionBtnTask: {
    backgroundColor: "#27ae60",
  },
  statusTag: {
    marginRight: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,159,67,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,159,67,0.45)",
  },
  statusTagText: {
    color: "#ffb266",
    fontSize: 11,
    fontWeight: "700",
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
  fabCenter: {
    alignSelf: "center",
    right: undefined,
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
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  sheetActionIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  sheetActionText: {
    color: "#111111",
    fontSize: 15,
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
    fontSize: 18,
    fontWeight: "600",
    color: colors.textOnDark,
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
  fab: {
    position: "absolute",
    right: spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabText: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFFFFF",
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
  projectList: {
    maxHeight: 400,
  },
  projectItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectItemText: {
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
