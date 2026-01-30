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
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import * as expensesService from "../services/expenses";
import * as dashboardService from "../services/dashboard";
import type { ProjectDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";
import { colors, radius, spacing } from "../theme";
import { openInMaps } from "../lib/maps";

const LAST_USED_PROJECT_KEY = "@staveto:lastUsedProjectId";

type DashboardViewModel = {
  projects: ProjectDoc[];
  todayTasks: Array<TaskDoc & { projectName: string; phaseName?: string }>;
  kpis: {
    openCount: number;
    doneTodayCount: number;
    blockedCount: number;
    expensesMonthSum: number;
  };
  projectStats: Map<string, { openCount: number; totalCount: number; progress: number }>;
};

export function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, orgId } = useAuth();
  const [dashboardData, setDashboardData] = useState<DashboardViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [lastUsedProjectId, setLastUsedProjectId] = useState<string | null>(null);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [pendingAction, setPendingAction] = useState<"task" | "expense" | "photo" | "invoice" | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseProjectId, setExpenseProjectId] = useState<string | null>(null);
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [expenseNote, setExpenseNote] = useState("");
  const [submittingExpense, setSubmittingExpense] = useState(false);

  const stackNav = navigation as { navigate: (name: string, params?: object) => void };
  const tabNav = (navigation.getParent() as { navigate: (name: string, params?: object) => void } | undefined);
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
        data.todayTasks
          .filter((task) => {
            const project = data.projects.find((p) => p.id === task.projectId);
            // Exclude tasks from BUILD projects
            return project?.projectType !== 'BUILD';
          })
          .map(async (task) => {
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
    async (action: "task" | "expense" | "photo" | "invoice") => {
      if (!dashboardData || dashboardData.projects.length === 0) {
        Alert.alert("Chyba", "Nemáte žiadne projekty.");
        return;
      }

      // If lastUsedProjectId exists and is valid, use it with option to change
      if (lastUsedProjectId && dashboardData.projects.some((p) => p.id === lastUsedProjectId)) {
        if (Platform.OS === "ios") {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options: ["Zrušiť", "Zmeniť projekt", "Pokračovať"],
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
            "Vyberte projekt",
            `Použiť projekt "${dashboardData.projects.find((p) => p.id === lastUsedProjectId)?.name}"?`,
            [
              { text: "Zrušiť", style: "cancel" },
              { text: "Zmeniť projekt", onPress: () => {
                setPendingAction(action);
                setShowProjectSelector(true);
              }},
              { text: "Pokračovať", onPress: () => executeAction(action, lastUsedProjectId) },
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
    async (action: "task" | "expense" | "photo" | "invoice", projectId: string) => {
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
          setExpenseProjectId(projectId);
          setShowExpenseModal(true);
          break;
        case "photo":
        case "invoice":
          Alert.alert("Upozornenie", "Funkcia prichádza čoskoro.");
          break;
      }
      setPendingAction(null);
      setShowProjectSelector(false);
    },
    [dashboardData, saveLastUsedProject, stackNav]
  );

  const handleCreateExpense = useCallback(async () => {
    if (!expenseProjectId || !orgId || !expenseTitle.trim() || !expenseAmount.trim()) {
      Alert.alert("Chyba", "Vyplňte všetky povinné polia.");
      return;
    }

    setSubmittingExpense(true);
    try {
      const amount = parseFloat(expenseAmount.replace(",", "."));
      if (isNaN(amount) || amount <= 0) {
        Alert.alert("Chyba", "Zadajte platnú sumu.");
        return;
      }

      await expensesService.createExpense(orgId, expenseProjectId, {
        title: expenseTitle.trim(),
        amount,
        date: new Date(expenseDate),
        note: expenseNote.trim() || undefined,
      });

      Alert.alert("Úspech", "Výdavok bol pridaný.");
      setShowExpenseModal(false);
      setExpenseTitle("");
      setExpenseAmount("");
      setExpenseNote("");
      setExpenseDate(new Date().toISOString().split('T')[0]);
      await loadDashboard(true);
    } catch (error: any) {
      console.error("[HomeScreen] Error creating expense:", error);
      Alert.alert("Chyba", error.message || "Nepodarilo sa pridať výdavok.");
    } finally {
      setSubmittingExpense(false);
    }
  }, [expenseProjectId, orgId, expenseTitle, expenseAmount, expenseDate, expenseNote, loadDashboard]);

  // Search functionality
  const searchResults = React.useMemo(() => {
    if (!searchQuery.trim() || !dashboardData) return [];

    const query = searchQuery.toLowerCase().trim();
    const results: Array<{ type: "project" | "task"; id: string; title: string; subtitle?: string }> = [];

    // Search projects
    dashboardData.projects.forEach((project) => {
      if (project.name.toLowerCase().includes(query)) {
        results.push({
          type: "project",
          id: project.id,
          title: project.name,
        });
      }
    });

    // Search tasks
    dashboardData.todayTasks.forEach((task) => {
      if (task.title.toLowerCase().includes(query)) {
        results.push({
          type: "task",
          id: task.id,
          title: task.title,
          subtitle: `${task.projectName}${task.phaseName ? ` • ${task.phaseName}` : ""}`,
        });
      }
    });

    return results.slice(0, 10);
  }, [searchQuery, dashboardData]);

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
    kpis: { openCount: 0, doneTodayCount: 0, blockedCount: 0, expensesMonthSum: 0 },
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
          <Text style={styles.welcomeTitle}>Vitajte, {displayName.split(" ")[0]}.</Text>
          <Text style={styles.welcomeSubtitle}>
            Máte {data.kpis.openCount} otvorených úloh • Spravované projekty: {data.projects.length}
          </Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Hľadať projekt alebo úlohu..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowSearchResults(text.length > 0);
            }}
            onFocus={() => setShowSearchResults(searchQuery.length > 0)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchClear}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
        {showSearchResults && searchResults.length > 0 && (
          <View style={styles.searchResults}>
            {searchResults.map((result) => (
              <TouchableOpacity
                key={`${result.type}-${result.id}`}
                style={styles.searchResultItem}
                onPress={() => {
                  setSearchQuery("");
                  setShowSearchResults(false);
                  if (result.type === "project") {
                    handleProjectClick(result.id);
                  } else {
                    const task = data.todayTasks.find((t) => t.id === result.id);
                    if (task) handleTaskClick(task);
                  }
                }}
              >
                <Ionicons
                  name={result.type === "project" ? "folder-outline" : "checkbox-outline"}
                  size={20}
                  color={colors.primary}
                  style={{ marginRight: spacing.sm }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultTitle}>{result.title}</Text>
                  {result.subtitle && <Text style={styles.searchResultSubtitle}>{result.subtitle}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={[styles.quickActionButton, styles.quickActionActive]} onPress={() => handleQuickAction("task")}>
            <Ionicons name="checkbox-outline" size={20} color={colors.primary} />
            <Text style={styles.quickActionText}>Úloha</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => handleQuickAction("expense")}>
            <Text style={styles.quickActionEuro}>€</Text>
            <Text style={styles.quickActionText}>Výdavok</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => handleQuickAction("photo")}>
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.quickActionText}>Foto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionButton} onPress={() => handleQuickAction("invoice")}>
            <Ionicons name="document-text-outline" size={20} color={colors.primary} />
            <Text style={styles.quickActionText}>Faktúra</Text>
          </TouchableOpacity>
        </View>

        {/* Today / Next Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Dnes</Text>
            <TouchableOpacity onPress={() => tabNav?.navigate("Tasks")}>
              <Text style={styles.sectionMore}>Viac &gt;</Text>
            </TouchableOpacity>
          </View>
          {data.todayTasks.length === 0 ? (
            <Text style={styles.emptyText}>Žiadne úlohy na dnes</Text>
          ) : (
            data.todayTasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={styles.taskItem}
                onPress={() => handleTaskClick(task)}
                activeOpacity={0.7}
              >
                <View style={styles.taskCheckbox}>
                  <Ionicons name="square-outline" size={20} color={colors.textMuted} />
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
            <Text style={styles.sectionTitle}>Projekty</Text>
            <TouchableOpacity onPress={() => tabNav?.navigate("Projects")}>
              <Text style={styles.sectionMore}>Všetky &gt;</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <Text style={styles.kpiValue}>{data.kpis.openCount}</Text>
              <Text style={styles.kpiLabel}>OPEN</Text>
            </View>
            <View style={styles.kpiCard}>
              <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
              <Text style={styles.kpiValue}>{data.kpis.doneTodayCount}</Text>
              <Text style={styles.kpiLabel}>DOKONČENÉ dnes</Text>
            </View>
            <View style={styles.kpiCard}>
              <Ionicons name="alert-circle" size={20} color="#FF9800" />
              <Text style={styles.kpiValue}>{data.kpis.blockedCount}</Text>
              <Text style={styles.kpiLabel}>BLOKOVANÉ</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiEuro}>€</Text>
              <Text style={styles.kpiValue}>{data.kpis.expensesMonthSum.toFixed(0)}</Text>
              <Text style={styles.kpiLabel}>VÝDAVKY za mesiac</Text>
            </View>
          </View>
        </View>

        {/* Projects Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Projekty</Text>
            <TouchableOpacity onPress={() => tabNav?.navigate("Projects")}>
              <Text style={styles.sectionMore}>Všetky &gt;</Text>
            </TouchableOpacity>
          </View>
          {data.projects.length === 0 ? (
            <Text style={styles.emptyText}>Žiadne projekty</Text>
          ) : (
            <>
              {data.projects.slice(0, 4).map((project) => {
                const stats = data.projectStats.get(project.id) || { openCount: 0, totalCount: 0, progress: 0 };
                return (
                  <TouchableOpacity
                    key={project.id}
                    style={styles.projectCard}
                    onPress={() => handleProjectClick(project.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.projectCardHeader}>
                      <Ionicons name={getProjectIcon(project.projectType)} size={24} color={colors.primary} />
                      <View style={styles.projectCardInfo}>
                        <Text style={styles.projectCardName}>{project.name}</Text>
                        <Text style={styles.projectCardStats}>
                          {stats.openCount} otvorených • {stats.progress}%
                        </Text>
                      </View>
                      {project.addressText && (
                        <TouchableOpacity
                          style={styles.projectCardMapButton}
                          onPress={(e) => {
                            e.stopPropagation(); // Prevent card click
                            openInMaps(project.addressText!);
                          }}
                          accessibilityLabel="Otvoriť v mapách"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="location" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${stats.progress}%` }]} />
                    </View>
                  </TouchableOpacity>
                );
              })}
              {data.projects.length > 4 && (
                <TouchableOpacity style={styles.projectCardAdd} onPress={() => tabNav?.navigate("Projects")}>
                  <Ionicons name="add" size={32} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Recent Activity (Stub) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nedávna aktivita</Text>
          <Text style={styles.emptyText}>Žiadna nedávna aktivita</Text>
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        onPress={() => {
          if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
              {
                options: ["Zrušiť", "Výdavok", "Faktúra", "Foto"],
                cancelButtonIndex: 0,
              },
              (buttonIndex) => {
                if (buttonIndex === 1) handleQuickAction("expense");
                else if (buttonIndex === 2) handleQuickAction("invoice");
                else if (buttonIndex === 3) handleQuickAction("photo");
              }
            );
          } else {
            setShowActionSheet(true);
          }
        }}
      >
        <Text style={styles.fabText}>€</Text>
      </TouchableOpacity>

      {/* Android Action Sheet */}
      {Platform.OS === "android" && showActionSheet && (
        <Modal visible={showActionSheet} transparent animationType="fade" onRequestClose={() => setShowActionSheet(false)}>
          <TouchableOpacity style={styles.actionSheetOverlay} activeOpacity={1} onPress={() => setShowActionSheet(false)}>
            <View style={styles.actionSheet}>
              <TouchableOpacity style={styles.actionSheetItem} onPress={() => {
                setShowActionSheet(false);
                handleQuickAction("expense");
              }}>
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text style={styles.actionSheetText}>Výdavok</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionSheetItem} onPress={() => {
                setShowActionSheet(false);
                handleQuickAction("invoice");
              }}>
                <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                <Text style={styles.actionSheetText}>Faktúra</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionSheetItem} onPress={() => {
                setShowActionSheet(false);
                handleQuickAction("photo");
              }}>
                <Ionicons name="camera-outline" size={20} color={colors.primary} />
                <Text style={styles.actionSheetText}>Foto</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

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
                <Ionicons name="close" size={24} color={colors.text} />
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

      {/* Expense Modal */}
      <Modal visible={showExpenseModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pridať výdavok</Text>
              <TouchableOpacity onPress={() => {
                setShowExpenseModal(false);
                setExpenseProjectId(null);
                setExpenseTitle("");
                setExpenseAmount("");
                setExpenseNote("");
              }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Názov výdavku *"
              placeholderTextColor={colors.textMuted}
              value={expenseTitle}
              onChangeText={setExpenseTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="Suma (EUR) *"
              placeholderTextColor={colors.textMuted}
              value={expenseAmount}
              onChangeText={setExpenseAmount}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Dátum"
              placeholderTextColor={colors.textMuted}
              value={expenseDate}
              onChangeText={setExpenseDate}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Poznámka (voliteľné)"
              placeholderTextColor={colors.textMuted}
              value={expenseNote}
              onChangeText={setExpenseNote}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => {
                setShowExpenseModal(false);
                setExpenseProjectId(null);
                setExpenseTitle("");
                setExpenseAmount("");
                setExpenseNote("");
              }}>
                <Text style={styles.modalCancelText}>Zrušiť</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalOk, (!expenseTitle.trim() || !expenseAmount.trim() || submittingExpense) && styles.modalOkDisabled]}
                onPress={handleCreateExpense}
                disabled={!expenseTitle.trim() || !expenseAmount.trim() || submittingExpense}
              >
                <Text style={styles.modalOkText}>{submittingExpense ? "Ukladá sa..." : "Pridať"}</Text>
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
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
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
    backgroundColor: colors.card,
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
    color: colors.text,
    marginBottom: spacing.xs,
  },
  taskSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  taskDue: {
    fontSize: 12,
    color: colors.textMuted,
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
  projectCard: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  projectCardInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  projectCardMapButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  projectCardName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  projectCardStats: {
    fontSize: 14,
    color: colors.textMuted,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 3,
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
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
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
    backgroundColor: colors.card,
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
    color: colors.text,
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
    color: colors.text,
    flex: 1,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
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
    color: colors.textMuted,
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
});
