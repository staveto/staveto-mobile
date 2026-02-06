import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
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

export function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [dashboardData, setDashboardData] = useState<DashboardViewModel | null>(null);
  const [allTasks, setAllTasks] = useState<TaskDoc[]>([]);
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
  const [pendingAction, setPendingAction] = useState<"task" | "photo" | "expense" | null>(null);
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
  const displayName = user?.name ?? user?.email ?? t("home.userFallback");

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

  const onRefresh = useCallback(() => {
    loadDashboard(true);
  }, [loadDashboard]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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
    async (action: "task" | "photo" | "expense", projectId: string) => {
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
          // For expense, always start with step 1 (project selection)
          setExpenseProjectId(null);
          setExpenseStep(1);
          setShowExpenseModal(true);
          break;
        case "photo":
          Alert.alert(t("common.warning"), t("expense.comingSoon"));
          break;
      }
      setPendingAction(null);
      setShowProjectSelector(false);
    },
    [dashboardData, saveLastUsedProject, stackNav]
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
    if (projectType === "MAINTENANCE" || projectType === "RESIDENTIAL") return "settings-outline";
    if (projectType === "TRADE") return "construct-outline";
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

  const handleTaskClick = useCallback(
    (task: TaskDoc & { projectName: string }) => {
      stackNav.navigate("ProjectOverview", {
        projectId: task.projectId,
        projectName: task.projectName,
      });
    },
    [stackNav]
  );

  if (loading && !dashboardData) {
    return (
      <View style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: insets.top + spacing.lg }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const data = dashboardData || {
    projects: [],
    todayTasks: [],
    kpis: { openCount: 0, doneTodayCount: 0, blockedCount: 0, expensesMonthSum: 0, expensesTotalSum: 0 },
    projectStats: new Map(),
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Welcome Header */}
        <View style={styles.welcomeHeader}>
          <Text style={styles.welcomeTitle}>{t("home.welcome", { name: displayName.split(" ")[0] })}</Text>
          <Text style={styles.welcomeSubtitle}>
            {t("home.openTasksCount", { count: data.kpis.openCount.toString(), projects: data.projects.length.toString() })}
          </Text>
        </View>

        {/* Create Project Button */}
        <View style={styles.createProjectSection}>
          <TouchableOpacity
            style={styles.createProjectButton}
            onPress={() => {
              // Navigate to Projects tab and open create modal
              goToProjects({ openNew: true });
            }}
          >
            <Ionicons name="add-circle" size={24} color="#FFFFFF" />
            <Text style={styles.createProjectButtonText}>{t("home.createNewProject")}</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={[styles.quickActionButton, styles.quickActionActive]} onPress={() => handleQuickAction("task")}>
            <Ionicons name="checkbox-outline" size={20} color={colors.primary} />
            <Text style={styles.quickActionText}>{t("home.quickTask")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => handleQuickAction("photo")}>
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.quickActionText}>{t("home.quickPhoto")}</Text>
          </TouchableOpacity>
        </View>

        {/* Today / Next Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.nearestTask")}</Text>
            <TouchableOpacity onPress={() => stackNav.navigate("Tasks")}>
              <Text style={styles.sectionMore}>{t("home.seeMore")} &gt;</Text>
            </TouchableOpacity>
          </View>
          {data.todayTasks.length === 0 ? (
            <Text style={styles.emptyText}>{t("home.noUpcomingTasks")}</Text>
          ) : (
            data.todayTasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={styles.taskItem}
                onPress={() => handleTaskClick(task)}
                activeOpacity={0.7}
              >
                <View style={styles.taskCheckbox}>
                  <Ionicons name="square-outline" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.taskContent}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskSubtitle}>
                    {task.projectName}
                    {task.phaseName ? ` • ${task.phaseName}` : ""}
                  </Text>
                </View>
                {task.dueDate && <Text style={styles.taskDue}>{formatDate(task.dueDate)}</Text>}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* KPI Cards */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.projectsOverview")}</Text>
            <TouchableOpacity onPress={() => goToProjects()}>
              <Text style={styles.sectionMore}>{t("home.seeAllProjects")} &gt;</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.kpiRow}>
            {getKpiCardsWithTasks(data, allTasks, t).map((card) => (
              <KpiCardComponent
                key={card.id}
                card={card}
                onPress={(card) => {
                  // Handle navigation based on card type
                  if (card.navigationTarget.screen === "Tasks") {
                    // Navigate to Tasks screen in HomeStack
                    stackNav.navigate("Tasks", card.navigationTarget.params);
                  } else if (card.navigationTarget.screen === "Projects") {
                    // Navigate to Projects tab
                    goToProjects(card.navigationTarget.params);
                  }
                }}
              />
            ))}
          </View>
        </View>

        {/* Projects Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.openProjects")}</Text>
            <TouchableOpacity onPress={() => goToProjects()}>
              <Text style={styles.sectionMore}>{t("home.seeAllProjects")} &gt;</Text>
            </TouchableOpacity>
          </View>

          {/* Role Filter Segmented Control - Top of Projects Section */}
          {data.projects.length > 0 && user?.id && (
            <View style={styles.filterContainer}>
              {(["ALL", "ADMIN", "MANAGER", "TRADE"] as const).map((filterKey) => {
                const isActive = roleFilter === filterKey;
                const label =
                  filterKey === "ALL"
                    ? t("role.all")
                    : filterKey === "ADMIN"
                    ? t("role.admin")
                    : filterKey === "MANAGER"
                    ? t("role.manager")
                    : t("role.trade");
                return (
                  <TouchableOpacity
                    key={filterKey}
                    style={[styles.filterButton, isActive && styles.filterButtonActive]}
                    onPress={() => handleRoleFilterChange(filterKey)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={label}
                  >
                    <Text style={[styles.filterButtonText, isActive && styles.filterButtonTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {(() => {
            // Filter projects by role (client-side, no DB changes)
            const filteredProjects =
              roleFilter === "ALL"
                ? data.projects
                : data.projects.filter((project) => {
                    if (!user?.id) return false;
                    return normalizeRoleKey(project, user.id) === roleFilter;
                  });

            if (filteredProjects.length === 0) {
              return <Text style={styles.emptyText}>{t("projects.empty")}</Text>;
            }

            return (
              <>
                {filteredProjects.slice(0, 4).map((project) => {
                  const stats = data.projectStats.get(project.id) || { openCount: 0, totalCount: 0, progress: 0 };
                  // Get project type label for chip
                  const projectTypeLabel =
                    project.projectType === "BUILD" || project.projectType === "MANAGEMENT"
                      ? t("projectType.build")
                      : project.projectType === "TRADE"
                      ? t("projectType.trade")
                      : project.projectType === "MAINTENANCE" || project.projectType === "RESIDENTIAL"
                      ? t("projectType.maintenance")
                      : undefined;

                  return (
                    <TouchableOpacity
                      key={project.id}
                      style={styles.projectCard}
                      onPress={() => handleProjectClick(project.id)}
                      activeOpacity={0.7}
                    >
                      {/* Row 1: Icon + Name + Overflow Menu */}
                      <View style={styles.projectCardRow1}>
                        <Ionicons name={getProjectIcon(project.projectType)} size={24} color={colors.primary} />
                        <Text style={styles.projectCardName} numberOfLines={1}>
                          {project.name}
                        </Text>
                        <TouchableOpacity
                          style={styles.projectCardOverflow}
                          onPress={(e) => {
                            e.stopPropagation();
                            // TODO: Show project menu (archive, delete, etc.)
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>

                      {/* Row 2: RoleChip + ProjectTypeChip + Location Text (no pin) */}
                      <View style={styles.projectCardRow2}>
                        {user?.id && <RoleChip project={project} currentUserId={user.id} showIcon={true} />}
                        {projectTypeLabel && (
                          <ProjectTypeChip projectType={project.projectType} label={projectTypeLabel} />
                        )}
                        {project.addressText && (
                          <Text style={styles.projectCardLocation} numberOfLines={1}>
                            {project.addressText}
                          </Text>
                        )}
                      </View>

                      {/* Row 3: Open Count + Progress Bar + Percentage */}
                      <View style={styles.projectCardRow3}>
                        <Text style={styles.projectCardStats}>
                          {stats.openCount} {stats.openCount === 1 ? t("home.openTask") || "otvorená" : t("home.openTasks") || "otvorených"}
                        </Text>
                        <View style={styles.progressBar}>
                          <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, stats.progress))}%` }]} />
                        </View>
                        <Text style={styles.projectCardProgress}>
                          {stats.progress === 100 ? t("home.completed") || "Hotovo" : `${stats.progress}%`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {filteredProjects.length > 4 && (
                  <TouchableOpacity style={styles.projectCardAdd} onPress={() => goToProjects()}>
                    <Ionicons name="add" size={32} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </>
            );
          })()}
        </View>

        {/* Recent Activity (Stub) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("home.recentActivity")}</Text>
          <Text style={styles.emptyText}>{t("home.noRecentActivity")}</Text>
        </View>
      </ScrollView>

      {/* Project Selector Modal */}
      <Modal visible={showProjectSelector} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Vyberte projekt</Text>
              <TouchableOpacity onPress={() => {
                setShowProjectSelector(false);
                setPendingAction(null);
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

      {/* Floating Action Button for Expense */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        onPress={() => {
          // Directly open expense modal with step 1 (project selection)
          if (!dashboardData || dashboardData.projects.length === 0) {
            Alert.alert(t("common.error"), t("home.noProjects"));
            return;
          }
          setExpenseStep(1);
          setExpenseProjectId(null);
          setShowExpenseModal(true);
        }}
      >
        <Text style={styles.fabText}>€</Text>
      </TouchableOpacity>

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
