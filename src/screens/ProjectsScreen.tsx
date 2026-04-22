import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
  Image,
  Pressable,
  ActionSheetIOS,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as projectMembersService from "../services/projectMembers";
import * as tasksService from "../services/tasks";
import * as projectCoverService from "../services/projectCover";
import * as projectFactory from "../services/projectFactory";
import * as templateService from "../services/templateService";
import type { PhaseCustomization } from "../services/projectFactory";
import type { CatalogPhase } from "../lib/types";
import type { ProjectDoc } from "../services/projects";
import { colors, radius, spacing } from "../theme";
import { ProjectBadgesRow } from "../components/ProjectBadgesRow";
import { CloneProjectModal } from "../components/CloneProjectModal";
import { CreateProjectWizard, type WizardResult } from "../components/CreateProjectWizard";
import { CreateProjectAIFlow } from "../components/CreateProjectAIFlow";
import { isLegacyResidential } from "../lib/projectEnums";
import {
  isBuildLikeStorageType,
  getActiveProductProjectType,
  getProjectEngine,
  matchesProjectsTabTypeFilter,
  shouldUseCountryCatalogTemplate,
  isSoloOwnerProjectRow,
  isSharedOrCollaborativeProjectRow,
  isProjectShownOnProjectsJobsTab,
  isLegacyMaintenanceEquipmentHub,
  isKnownStorageType,
} from "../lib/projectTypeModel";
import {
  PROJECTS_TAB_LIST_STATUS,
  PROJECTS_TAB_TYPE_FILTERS,
  projectsTabCardJobTypeLabel,
  projectsTabJobKindChipLabel,
  projectsTabListStatusLabel,
  type ProjectsTabListStatus,
  type ProjectsTabTypeFilter,
} from "../lib/projectsTabUi";
import { readStoredPrimaryUsageMode, primaryUsageToDefaultEngine } from "../lib/primaryUsageMode";
import { openInMaps } from "../lib/maps";
import { COUNTRY_CODES, getLocalizedCountryName } from "../utils/countries";
import { resolveTemplateIdForCountry, FALLBACK_TEMPLATE_ID } from "../utils/templateResolver";
import { getCallable, auth } from "../firebase";
import { showToast } from "../helpers/toast";
import { runLegacyProjectTypeBackfillOncePerSession } from "../services/projectTypeBackfill";

type Project = ProjectDoc;

function showError(msg: string) {
  Alert.alert("", msg);
}

/** Cloud Function HttpsError("not-found", "errors.member.notFound") — treat as already left. */
function isCloudMemberNotFoundError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? "").toLowerCase();
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return (
    msg === "errors.member.notFound" ||
    msg.includes("errors.member.notFound") ||
    code === "functions/not-found" ||
    code.endsWith("/not-found")
  );
}

function formatCallableUserMessage(e: unknown, translate: (key: string) => string): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const trimmed = msg.trim();
  if (trimmed.startsWith("errors.")) {
    const localized = translate(trimmed);
    return localized.trim() || trimmed;
  }
  return trimmed || translate("projectMembers.leaveError");
}

const PROJECTS_FILTER_KEY = "projects_filter_v1";
const TYPE_FILTER_KEY = "projects_type_filter_v1";
const LIST_STATUS_KEY = "projects_list_status_v1";
type ProjectFilter = "all" | "mine" | "shared";

function formatCreatedAt(isoStr?: string): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

type ProjectCreationType = "BUILD" | "TRADE";
type CreationMethod = "template" | "empty";

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

export function ProjectsScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t, locale } = useI18n();
  const { orgId, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newStep, setNewStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<ProjectCreationType | null>(null);
  const [wizardResult, setWizardResult] = useState<WizardResult | null>(null);
  const [creationMethod, setCreationMethod] = useState<CreationMethod>("template");
  const [creationPath, setCreationPath] = useState<"ai" | "manual">("manual");
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCountry, setNewCountry] = useState<string>("SK");
  const [newCity, setNewCity] = useState("");
  const [newNote, setNewNote] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [templatePhases, setTemplatePhases] = useState<CatalogPhase[]>([]);
  const [phaseCustomizations, setPhaseCustomizations] = useState<Map<string, PhaseCustomization>>(new Map());
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneSourceProject, setCloneSourceProject] = useState<Project | null>(null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<ProjectsTabTypeFilter>("ALL");
  const [listStatusFilter, setListStatusFilter] = useState<ProjectsTabListStatus>("ALL");
  const [wizardInitialEngine, setWizardInitialEngine] = useState<"BUILD" | "TRADE" | null>(null);
  /** Remount wizard when opening create so step state does not leak between sessions. */
  const [wizardModalKey, setWizardModalKey] = useState(0);
  const [projectStats, setProjectStats] = useState<Map<string, { progress: number }>>(new Map());
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const menuBottomInset = Platform.OS === "android" ? Math.max(insets.bottom, 48) : insets.bottom;
  const heroModalHeightRef = useRef<number | null>(null);
  if (showNew && heroModalHeightRef.current === null) {
    heroModalHeightRef.current = Math.min(Math.max(Math.round(windowHeight * 0.86), 520), windowHeight - spacing.md);
  } else if (!showNew) {
    heroModalHeightRef.current = null;
  }
  const heroModalHeight = heroModalHeightRef.current ?? Math.min(Math.max(Math.round(windowHeight * 0.86), 520), windowHeight - spacing.md);

  const resetTemplateSelectionState = useCallback(() => {
    setTemplateId("");
    setTemplatePhases([]);
    setPhaseCustomizations(new Map());
    setLoadingPhases(false);
  }, []);

  const loadTemplatePhasesForCountry = useCallback(async (countryCode: string | undefined) => {
    const templateIdToLoad = resolveTemplateIdForCountry(countryCode);
    setTemplateId(templateIdToLoad);
    setLoadingPhases(true);
    try {
      const phases = await templateService.getTemplatePhases(templateIdToLoad);
      setTemplatePhases(phases);

      const customizations = new Map<string, PhaseCustomization>();
      phases.forEach((phase) => {
        customizations.set(phase.id, {
          phaseId: phase.id,
          enabled: true,
          status: "active",
        });
      });
      setPhaseCustomizations(customizations);
    } catch (e) {
      console.warn("[ProjectsScreen] Could not load template", templateIdToLoad, e);
      if (templateIdToLoad !== FALLBACK_TEMPLATE_ID) {
        try {
          const fallbackPhases = await templateService.getTemplatePhases(FALLBACK_TEMPLATE_ID);
          setTemplateId(templateIdToLoad);
          setTemplatePhases(fallbackPhases);
          const customizations = new Map<string, PhaseCustomization>();
          fallbackPhases.forEach((phase) => {
            customizations.set(phase.id, {
              phaseId: phase.id,
              enabled: true,
              status: "active",
            });
          });
          setPhaseCustomizations(customizations);
        } catch (fbErr) {
          console.warn("[ProjectsScreen] Fallback template also failed:", fbErr);
          setTemplatePhases([]);
          setPhaseCustomizations(new Map());
        }
      } else {
        setTemplatePhases([]);
        setPhaseCustomizations(new Map());
      }
    } finally {
      setLoadingPhases(false);
    }
  }, []);

  const getCreateFlowTypeTitle = useCallback(
    (type: ProjectCreationType | null) => {
      if (!type) return "";
      const i18nKey = type === "BUILD" ? "MANAGEMENT" : "TRADE";
      return t(`createProject.type.${i18nKey}.title`);
    },
    [t]
  );

  const getContainsItems = useCallback((type: ProjectCreationType | null) => {
    const items = ["tasks", "expenses", "diary"];
    if (isBuildLikeStorageType(type)) {
      items.push("phases", "documents");
    }
    return items;
  }, []);

  const getThumbTint = useCallback((project: ProjectDoc) => {
    if (isLegacyMaintenanceEquipmentHub(project)) return "#7dcea022";
    return getActiveProductProjectType(project) === "TRADE" ? "#5dade220" : "#ff9f4322";
  }, []);

  const getThumbIcon = useCallback((project: ProjectDoc): React.ComponentProps<typeof Ionicons>["name"] => {
    if (isLegacyMaintenanceEquipmentHub(project)) return "construct-outline";
    return getActiveProductProjectType(project) === "TRADE" ? "briefcase-outline" : "clipboard-outline";
  }, []);

  const getBadgeColor = useCallback((project: ProjectDoc) => {
    if (isLegacyMaintenanceEquipmentHub(project)) return "#7dcea0";
    return getActiveProductProjectType(project) === "TRADE" ? "#5dade2" : "#ff9f43";
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PROJECTS_FILTER_KEY).then((saved) => {
      if (saved === "mine" || saved === "shared" || saved === "all") {
        setProjectFilter(saved);
        if (__DEV__) console.log("[ProjectsScreen] Loaded filter:", saved);
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
        setSelectedTypeFilter(saved as ProjectsTabTypeFilter);
      }
    });
  }, []);

  useEffect(() => {
    readStoredPrimaryUsageMode().then((m) => {
      setWizardInitialEngine(primaryUsageToDefaultEngine(m));
    });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(LIST_STATUS_KEY).then((saved) => {
      if (saved === "ALL" || saved === "ACTIVE" || saved === "COMPLETED" || saved === "ARCHIVED") {
        setListStatusFilter(saved);
      }
    });
  }, []);

  const handleFilterChange = useCallback(async (filter: ProjectFilter) => {
    setProjectFilter(filter);
    try {
      await AsyncStorage.setItem(PROJECTS_FILTER_KEY, filter);
      if (__DEV__) console.log("[ProjectsScreen] Filter changed:", filter);
    } catch (e) {
      console.warn("[ProjectsScreen] Failed to persist filter:", e);
    }
  }, []);

  const handleTypeFilterChange = useCallback(async (filter: ProjectsTabTypeFilter) => {
    setSelectedTypeFilter(filter);
    try {
      await AsyncStorage.setItem(TYPE_FILTER_KEY, filter);
    } catch (e) {
      console.warn("[ProjectsScreen] Failed to persist type filter:", e);
    }
  }, []);

  const handleListStatusChange = useCallback(async (status: ProjectsTabListStatus) => {
    setListStatusFilter(status);
    try {
      await AsyncStorage.setItem(LIST_STATUS_KEY, status);
    } catch (e) {
      console.warn("[ProjectsScreen] Failed to persist list status filter:", e);
    }
  }, []);

  const openCreateProject = useCallback(() => {
    readStoredPrimaryUsageMode().then((m) => {
      setWizardInitialEngine(primaryUsageToDefaultEngine(m));
    });
    setWizardModalKey((k) => k + 1);
    setShowNew(true);
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    // Guard: orgId must be defined and not empty
    if (!orgId || orgId.trim() === '') {
      console.warn('[ProjectsScreen] load() called with invalid orgId:', orgId);
      setLoading(false);
      setRefreshing(false);
      setProjects([]);
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
          console.warn("[ProjectsScreen] syncMyProjectsSharedCount failed:", e);
          try {
            await getCallable("backfillProjectSharedCounts")({});
          } catch (e2) {
            console.warn("[ProjectsScreen] backfillProjectSharedCounts failed:", e2);
          }
        }
      }
      console.log('[ProjectsScreen] Loading projects for orgId:', orgId);
      const list = await projectsService.listAllMyProjects(orgId, { forceServerRead: isRefresh });
      console.log('[ProjectsScreen] Loaded', list.length, 'projects');
      setProjects(list);
      void runLegacyProjectTypeBackfillOncePerSession(list);

      // Load task stats for progress (100% = green in list)
      const stats = new Map<string, { progress: number }>();
      const taskPromises = list.map(async (project) => {
        try {
          const tasks = await tasksService.listTasksByProject(project.id);
          const totalCount = tasks.length;
          const doneCount = tasks.filter((t) => t.status === "DONE").length;
          const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
          return { projectId: project.id, progress };
        } catch (e) {
          if (__DEV__) console.warn("[ProjectsScreen] Failed to load tasks for", project.id, e);
          return { projectId: project.id, progress: 0 };
        }
      });
      const results = await Promise.all(taskPromises);
      results.forEach((r) => stats.set(r.projectId, { progress: r.progress }));
      setProjectStats(stats);
    } catch (e: unknown) {
      console.error('[ProjectsScreen] Error loading projects:', e);
      setProjects([]);
      const msg = (e as { code?: string; message?: string }).code === "permission-denied"
        ? "Nemáte oprávnenie na čítanie projektov."
        : (e instanceof Error ? e.message : "Sieťová chyba.");
      showError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  const onRefresh = useCallback(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const filterProjects = useCallback(
    (list: Project[]) => {
      let result = list;
      // Hide templates from normal list (no "Templates" filter yet)
      result = result.filter((p) => !p.isTemplate);
      if (projectFilter === "mine") result = result.filter(isSoloOwnerProjectRow);
      else if (projectFilter === "shared") result = result.filter(isSharedOrCollaborativeProjectRow);
      if (selectedTypeFilter !== "ALL") {
        result = result.filter((p) => matchesProjectsTabTypeFilter(p.projectType, selectedTypeFilter));
      }
      return result;
    },
    [projectFilter, selectedTypeFilter]
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      if ((route.params as { openNew?: boolean })?.openNew) {
        readStoredPrimaryUsageMode().then((m) => {
          setWizardInitialEngine(primaryUsageToDefaultEngine(m));
        });
        setWizardModalKey((k) => k + 1);
        setShowNew(true);
        setNewStep(1);
        setSelectedType(null);
        setWizardResult(null);
        setCreationMethod("template");
        setCreationPath("manual");
        setNewName("");
        resetTemplateSelectionState();
        setError(null);
        (navigation as { setParams?: (params: Record<string, unknown>) => void }).setParams?.({ openNew: false });
      }
    }, [load, navigation, resetTemplateSelectionState, route.params])
  );

  const closeNewModal = () => {
    setShowNew(false);
    setNewStep(1);
    setNewCountry("SK");
    setNewCity("");
    setNewNote("");
    setSelectedType(null);
    setWizardResult(null);
    setCreationMethod("template");
    setCreationPath("manual");
    setNewName("");
    setNewAddress("");
    resetTemplateSelectionState();
    setError(null);
  };

  const handleWizardComplete = useCallback(
    (result: WizardResult) => {
      setWizardResult(result);
      setSelectedType(result.engineType === "BUILD" ? "BUILD" : "TRADE");
      if (result.creationMode === "AI" && (result.engineType === "BUILD" || result.engineType === "TRADE")) {
        setCreationPath("ai");
        setCreationMethod("empty");
      } else {
        setCreationMethod(result.creationMode === "TEMPLATE" ? "template" : "empty");
        if (result.creationMode === "TEMPLATE" && result.engineType === "BUILD") {
          setCreationMethod("template");
        } else if (result.creationMode === "MANUAL") {
          setCreationMethod("empty");
        }
      }
      setError(null);
      setNewStep(2);
    },
    []
  );

  useEffect(() => {
    if (
      selectedType === "BUILD" &&
      newStep === 2 &&
      creationMethod === "template" &&
      !loadingPhases &&
      (!templatePhases.length || templateId !== resolveTemplateIdForCountry(newCountry?.trim() || undefined))
    ) {
      loadTemplatePhasesForCountry(newCountry?.trim() || undefined);
      return;
    }

    if (selectedType !== "BUILD" || creationMethod === "empty") {
      resetTemplateSelectionState();
    }
  }, [
    selectedType,
    newStep,
    creationMethod,
    newCountry,
    loadingPhases,
    templatePhases.length,
    templateId,
    loadTemplatePhasesForCountry,
    resetTemplateSelectionState,
  ]);

  const onNext = async () => {
    if (newStep === 1) {
      // Step 1 is now CreateProjectWizard - it calls handleWizardComplete which goes to step 2
      return;
    } else if (newStep === 2) {
      if (!newName.trim()) {
        setError(t("createProject.nameRequired"));
        return;
      }

      setError(null);
      setNewStep(3);
    }
  };

  const onBack = () => {
    if (newStep === 2) {
      setNewStep(1);
      setSelectedType(null);
      setWizardResult(null);
      setError(null);
    } else if (newStep === 3) {
      setNewStep(2);
      setError(null);
    } else {
      closeNewModal();
    }
  };

  const onCreate = async () => {
    // Validácia
    if (!orgId) {
      const errorMsg = t("createProject.notSignedIn");
      setError(errorMsg);
      showError(errorMsg);
      return;
    }
    
    if (!selectedType) {
      const errorMsg = t("createProject.selectTypeRequired");
      setError(errorMsg);
      return;
    }
    
    if (!newName.trim()) {
      const errorMsg = t("createProject.nameRequired");
      setError(errorMsg);
      return;
    }
    
    setError(null);
    setSubmitting(true);
    
    try {
      const shouldUseTemplate = shouldUseCountryCatalogTemplate({ selectedType, creationMethod });
      const countryCodeForCreate = newCountry.trim() || undefined;
      const finalTemplateId = shouldUseTemplate
        ? resolveTemplateIdForCountry(countryCodeForCreate)
        : "";

      console.log(
        `[ProjectsScreen] Creating project: type="${selectedType}", name="${newName.trim()}", templateId="${finalTemplateId}"`
      );
      
      // Prepare phase customizations array
      const customizationsArray = shouldUseTemplate && phaseCustomizations.size > 0
        ? Array.from(phaseCustomizations.values())
        : undefined;
      
      console.log(`[ProjectsScreen] Phase customizations:`, customizationsArray);
      
      // Vytvor projekt - ownerId sa automaticky použije z auth.currentUser.uid v projectFactory
      const addressTextForCreate = newAddress.trim() || undefined;
      const cityForCreate = newCity.trim() || undefined;

      await projectFactory.createProjectFromTemplate({
        projectType: selectedType,
        templateId: finalTemplateId,
        name: newName.trim(),
        addressText: addressTextForCreate,
        countryCode: countryCodeForCreate,
        city: cityForCreate,
        phaseCustomizations: customizationsArray,
        workType: wizardResult?.workType ?? undefined,
        businessMode: wizardResult?.businessMode ?? undefined,
        creationMode: wizardResult?.creationMode ?? undefined,
      });
      const { logProjectCreateSuccess } = await import("../services/analytics");
      logProjectCreateSuccess(selectedType, "projects");
      console.log(`${selectedType} project created successfully`);
      closeNewModal();
      load();
      const { trackPaywallEvent, checkAndShowPaywall } = await import("../services/paywallTrigger");
      await trackPaywallEvent("project_created");
      await checkAndShowPaywall(user?.billing, navigation, "project_created");
    } catch (e: unknown) {
      console.error('Error creating project:', e);
      const error = e as { code?: string; message?: string };
      const errorCode = error.code;
      const errorMessage = error.message || 'Neznáma chyba';
      
      // Detailed error message with location
      let userMessage = '';
      if (errorCode === "permission-denied") {
        // Parse error message to find where it failed
        if (errorMessage.includes('projects/') && errorMessage.includes('/phases')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť fázy projektu.\n\nKde: projects/{projectId}/phases\nSkontrolujte Firestore rules.`;
        } else if (errorMessage.includes('projects/') && errorMessage.includes('/tasks')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť úlohy projektu.\n\nKde: projects/{projectId}/tasks\nSkontrolujte Firestore rules.`;
        } else if (errorMessage.includes('documents/projects/') || errorMessage.includes('projekt documents')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť projekt.\n\nKde: projects/{projectId}\nSkontrolujte Firestore rules a či ste prihlásený.`;
        } else {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť projekt.\n\n${errorMessage}\n\nSkontrolujte Firestore rules.`;
        }
      } else if (errorCode === "not-found") {
        userMessage = `⚠️ Template nebol nájdený. Projekt sa vytvorí bez šablóny.\n\n${errorMessage}`;
      } else if (errorMessage.includes('template') || errorMessage.includes('šablón')) {
        userMessage = `⚠️ Chyba pri načítaní šablóny:\n\n${errorMessage}`;
      } else {
        userMessage = `❌ Chyba: ${errorMessage}`;
      }
      
      setError(userMessage);
      showError(userMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const renderContainsChecklist = () => {
    const items = getContainsItems(selectedType);
    return (
      <View style={styles.containsSection}>
        <Text style={styles.containsTitle}>{t("createProject.containsTitle")}</Text>
        {items.map((itemKey) => (
          <View key={itemKey} style={styles.containsItem}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.containsItemText}>{t(`createProject.contains.${itemKey}`)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const openProjectMenu = (item: Project) => {
    setMenuProject(item);
    setShowMenu(true);
  };

  const closeProjectMenu = () => {
    setShowMenu(false);
    setMenuProject(null);
  };

  const onMenuEdit = () => {
    if (!menuProject) return;
    setEditProject(menuProject);
    setEditName(menuProject.name || "");
    setShowEdit(true);
    closeProjectMenu();
  };

  const onMenuShareMembers = () => {
    if (!menuProject) return;
    closeProjectMenu();
    (navigation as any).navigate("ProjectMembers", {
      projectId: menuProject.id,
      projectName: menuProject.name || t("projects.noName"),
    });
  };

  const onMenuClone = () => {
    if (!menuProject) return;
    setCloneSourceProject(menuProject);
    setShowCloneModal(true);
    closeProjectMenu();
  };

  const onMenuSaveAsTemplate = async () => {
    if (!menuProject || !orgId) return;
    const isTemplate = !!menuProject.isTemplate;
    try {
      await projectsService.setProjectAsTemplate(orgId, menuProject.id, !isTemplate);
      load();
      showToast(isTemplate ? t("projects.templateRemoved") : t("projects.templateSaved"));
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      closeProjectMenu();
    }
  };

  const onCloneSuccess = useCallback(
    (newProjectId: string) => {
      setShowCloneModal(false);
      setCloneSourceProject(null);
      load();
      showToast(t("projects.cloneSuccess"));
      (navigation as any).navigate("ProjectOverview", { projectId: newProjectId });
    },
    [load, navigation, t, showToast]
  );

  const onMenuArchive = async () => {
    if (!menuProject || !orgId) return;
    const isArchived = !!menuProject.archivedAt;
    try {
      if (isArchived) {
        await projectsService.unarchiveProject(orgId, menuProject.id);
      } else {
        await projectsService.archiveProject(orgId, menuProject.id);
      }
      load();
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      closeProjectMenu();
    }
  };

  const onMenuLeaveProject = () => {
    if (!menuProject) return;
    const projectId = menuProject.id;
    Alert.alert(
      t("projectMembers.leaveConfirm"),
      t("projectMembers.leaveConfirmMessage"),
      [
        { text: t("projects.cancel"), style: "cancel" },
        {
          text: t("projectMembers.leaveProject"),
          style: "destructive",
          onPress: () => {
            closeProjectMenu();
            void (async () => {
              const uid = auth.currentUser?.uid;
              if (!uid) {
                showError(t("createProject.notSignedIn"));
                return;
              }
              try {
                const finishLeaveOk = async () => {
                  projectsService.invalidateProjectsSessionCache();
                  await load(true);
                  showToast(t("projectMembers.leaveSuccess"));
                };

                const members = await projectMembersService.listProjectMembers(projectId, true);
                const self = members.find((m) => m.userId === uid);
                try {
                  if (self) {
                    await projectMembersService.removeMember(projectId, self.id, self.userId);
                  } else {
                    await projectMembersService.removeMember(projectId, uid, uid);
                  }
                } catch (inner: unknown) {
                  if (isCloudMemberNotFoundError(inner)) {
                    await finishLeaveOk();
                    return;
                  }
                  throw inner;
                }
                await finishLeaveOk();
              } catch (e: unknown) {
                showError(formatCallableUserMessage(e, t));
              }
            })();
          },
        },
      ]
    );
  };

  const onMenuDelete = () => {
    if (!menuProject) return;
    const projectId = menuProject.id;
    Alert.alert(
      t("projects.deleteConfirm"),
      "",
      [
        { text: t("projects.cancel"), style: "cancel" },
        {
          text: t("projects.delete"),
          style: "destructive",
          onPress: () => {
            closeProjectMenu();
            void (async () => {
              const uid = auth.currentUser?.uid;
              if (!uid) {
                showError(t("createProject.notSignedIn"));
                return;
              }
              try {
                await projectsService.deleteProject(orgId ?? uid, projectId);
                await load(true);
              } catch (e: unknown) {
                const c = projectsService.getFirestoreErrorCode(e);
                const denied =
                  c === "permission-denied" ||
                  c === "firestore/permission-denied" ||
                  c.includes("permission-denied");
                showError(
                  denied ? t("projectOverview.noPermission") : e instanceof Error ? e.message : "Chyba."
                );
              }
            })();
          },
        },
      ]
    );
  };

  const onSaveEdit = async () => {
    if (!orgId || !editProject || !editName.trim()) return;
    setSubmitting(true);
    try {
      await projectsService.updateProject(orgId, editProject.id, editName.trim());
      setShowEdit(false);
      setEditProject(null);
      setEditName("");
      load();
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  const showCoverSheet = useCallback(
    (item: Project) => {
      const hasCover = !!item.coverImageUrl;
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
          const { url, path } = await projectCoverService.uploadProjectCover(item.id, picked.uri);
          await projectCoverService.setProjectCover(item.id, { url, path }, item.coverImagePath);
          load();
        } catch (e) {
          showError(t("cover.uploadError"));
        }
      };

      const runRemove = async () => {
        try {
          await projectCoverService.removeProjectCover(item.id);
          load();
        } catch (e) {
          showError(t("cover.uploadError"));
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
    [t, load]
  );

  const visibleProjects = useMemo(
    () => projects.filter((p) => isProjectShownOnProjectsJobsTab(p)),
    [projects]
  );
  const activeProjects = useMemo(
    () => filterProjects(visibleProjects.filter((p) => !p.archivedAt)),
    [visibleProjects, filterProjects]
  );
  const archivedProjects = useMemo(
    () => filterProjects(visibleProjects.filter((p) => !!p.archivedAt)),
    [visibleProjects, filterProjects]
  );
  const mainListProjects = useMemo(() => {
    if (listStatusFilter === "ARCHIVED") return archivedProjects;
    if (listStatusFilter === "ACTIVE") {
      return activeProjects.filter((p) => (projectStats.get(p.id)?.progress ?? 0) < 100);
    }
    if (listStatusFilter === "COMPLETED") {
      return activeProjects.filter((p) => (projectStats.get(p.id)?.progress ?? 0) === 100);
    }
    return activeProjects;
  }, [activeProjects, archivedProjects, listStatusFilter, projectStats]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!visibleProjects.length && !loading ? (
        <View style={[styles.emptyHero, { paddingTop: insets.top + spacing.xl }]}>
          <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} style={styles.emptyHeroIcon} />
          <Text style={styles.emptyHeroTitle}>{t("projectsTab.empty.title")}</Text>
          <Text style={styles.emptyHeroBody}>{t("projectsTab.empty.body")}</Text>
          <TouchableOpacity style={styles.emptyPrimaryCta} onPress={openCreateProject} activeOpacity={0.88}>
            <Ionicons name="add-circle-outline" size={22} color="#fff" />
            <Text style={styles.emptyPrimaryCtaText}>{t("projectsTab.newJob")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.emptySecondaryTap} onPress={onRefresh} disabled={refreshing}>
            <Text style={styles.emptySecondaryTapText}>
              {refreshing ? t("common.refreshing") : t("common.refresh")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
        <View style={[styles.screenTop, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.pageHeaderRow}>
            <Text style={styles.pageTitle} accessibilityRole="header">
              {t("projectsTab.title")}
            </Text>
            <TouchableOpacity style={styles.headerPrimaryCta} onPress={openCreateProject} activeOpacity={0.88}>
              <Ionicons name="add" size={22} color="#fff" />
              <Text style={styles.headerPrimaryCtaText}>{t("projectsTab.newJob")}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.typeFilterWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.typeFilterRow, { paddingRight: spacing.xl }]}
              style={[styles.typeFilterScroll, { width: windowWidth - 2 * spacing.md }]}
            >
              {PROJECTS_TAB_LIST_STATUS.map((status) => (
                <TouchableOpacity
                  key={status}
                  style={[styles.filterChipCompact, listStatusFilter === status && styles.filterChipActive]}
                  onPress={() => handleListStatusChange(status)}
                >
                  <Text
                    style={[
                      styles.filterChipTextCompact,
                      listStatusFilter === status && styles.filterChipTextActive,
                    ]}
                  >
                    {projectsTabListStatusLabel(t, status)}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.filterDivider} />
              {(["all", "mine", "shared"] as const).map((scope) => (
                <TouchableOpacity
                  key={scope}
                  style={[styles.filterChipCompact, projectFilter === scope && styles.filterChipActive]}
                  onPress={() => handleFilterChange(scope)}
                >
                  <Text
                    style={[
                      styles.filterChipTextCompact,
                      projectFilter === scope && styles.filterChipTextActive,
                    ]}
                  >
                    {scope === "all"
                      ? t("projectsTab.scope.all")
                      : scope === "mine"
                        ? t("projectsTab.scope.mine")
                        : t("projectsTab.scope.team")}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.typeFilterWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.typeFilterRow, { paddingRight: spacing.xl }]}
              style={[styles.typeFilterScroll, { width: windowWidth - 2 * spacing.md }]}
            >
              {PROJECTS_TAB_TYPE_FILTERS.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.filterChipCompact, selectedTypeFilter === type && styles.filterChipActive]}
                  onPress={() => handleTypeFilterChange(type)}
                >
                  <Text
                    style={[
                      styles.filterChipTextCompact,
                      selectedTypeFilter === type && styles.filterChipTextActive,
                    ]}
                  >
                    {projectsTabJobKindChipLabel(t, type)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
        <FlatList
          data={mainListProjects}
          keyExtractor={(p) => p.id}
          extraData={`${listStatusFilter}-${selectedTypeFilter}-${projectFilter}-${projectStats.size}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            mainListProjects.length > 0 ? null : listStatusFilter === "ARCHIVED" ? (
              <View style={styles.emptyFiltered}>
                <Text style={styles.emptyFilteredText}>{t("projectsTab.empty.noArchived")}</Text>
              </View>
            ) : listStatusFilter === "COMPLETED" ? (
              <View style={styles.emptyFiltered}>
                <Text style={styles.emptyFilteredText}>{t("projectsTab.empty.noCompleted")}</Text>
              </View>
            ) : listStatusFilter === "ACTIVE" ? (
              <View style={styles.emptyFiltered}>
                <Text style={styles.emptyFilteredText}>{t("projectsTab.empty.noInProgress")}</Text>
              </View>
            ) : visibleProjects.length > 0 && activeProjects.length === 0 && archivedProjects.length === 0 ? (
              <View style={styles.emptyFiltered}>
                <Text style={styles.emptyFilteredText}>{t("projects.noProjectsInCategory")}</Text>
              </View>
            ) : archivedProjects.length ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>{t("projects.noActive")}</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => {
            const hub = isLegacyMaintenanceEquipmentHub(item);
            const typeLabel = projectsTabCardJobTypeLabel(t, item.projectType);
            const location = getLocationAnchor(item);
            const badgeColor = getBadgeColor(item);
            const progress = projectStats.get(item.id)?.progress ?? 0;
            const showCover = !hub && !!item.coverImageUrl;
            const isCompleted = progress === 100;
            
            const isOwner = !!item.ownerId && item.ownerId === user?.id;
            return (
              <TouchableOpacity
                style={[styles.card, !isOwner && styles.cardMember, isCompleted && styles.cardCompleted]}
                onPress={() => {
                  // Navigate to ProjectOverview screen
                  (navigation as any).navigate('ProjectOverview', {
                    projectId: item.id,
                    projectName: item.name || t("projects.noName"),
                  });
                }}
                activeOpacity={0.7}
              >
                <View style={styles.cardContent}>
                  <Pressable
                    style={[styles.projectThumb, { backgroundColor: isCompleted ? "#22c55e22" : getThumbTint(item) }]}
                    onPress={() => {
                      if (isOwner) showCoverSheet(item);
                    }}
                  >
                    {showCover ? (
                      <Image source={{ uri: item.coverImageUrl! }} style={styles.projectThumbImage} resizeMode="cover" />
                    ) : hub ? (
                      <Ionicons name="construct-outline" size={20} color={colors.textMuted} />
                    ) : (
                      <>
                        <Text style={styles.projectThumbInitials}>{getProjectInitials(item.name || t("projects.noName"))}</Text>
                        <Ionicons name={getThumbIcon(item)} size={11} color={colors.textMuted} style={styles.projectThumbIcon} />
                      </>
                    )}
                  </Pressable>
                  <View style={styles.cardMain}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                    </View>
                    <ProjectBadgesRow isOwner={isOwner} sharedWithCount={item.sharedWithCount ?? 0} isSharedToMe={item.isSharedToMe} showLegacyBadge={isLegacyResidential(item.projectType)} />
                    <View style={styles.typeBadgeRow}>
                      <View style={[styles.typeBadge, { borderColor: badgeColor }]}>
                        <Text style={[styles.typeBadgeText, { color: badgeColor }]} numberOfLines={1}>
                          {typeLabel}
                        </Text>
                      </View>
                      {location ? (
                        <Text style={styles.typeBadgeCity} numberOfLines={1}>{location}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.progressMeta} numberOfLines={1}>
                      {t("projectsTab.card.progress", { pct: String(progress) })}
                    </Text>
                    {item.createdAt && (
                      <Text style={styles.createdAt}>{t("projects.createdAt")}: {formatCreatedAt(item.createdAt)}</Text>
                    )}
                  </View>
                  <View style={styles.cardActions}>
                    {item.addressText && (
                      <TouchableOpacity
                        style={styles.cardMapButton}
                        onPress={(e) => {
                          e.stopPropagation(); // Prevent card click
                          openInMaps(item.addressText!);
                        }}
                        accessibilityLabel={t("maps.openInMaps")}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="location" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.cardMenu}
                      onPress={(e) => {
                        e.stopPropagation(); // Prevent card click when menu is clicked
                        openProjectMenu(item);
                      }}
                      accessibilityLabel={t("projects.edit")}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Text style={styles.cardMenuText}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            listStatusFilter === "ALL" && archivedProjects.length ? (
              <View style={styles.archivedSection}>
                <Text style={styles.archivedTitle}>{t("projects.archiveSection")}</Text>
                {archivedProjects.map((item) => {
                  const hub = isLegacyMaintenanceEquipmentHub(item);
                  const typeLabel = projectsTabCardJobTypeLabel(t, item.projectType);
                  const location = getLocationAnchor(item);
                  const badgeColor = getBadgeColor(item);
                  const progress = projectStats.get(item.id)?.progress ?? 0;
                  const showCover = !hub && !!item.coverImageUrl;
                  const isOwnerArchived = !!item.ownerId && item.ownerId === user?.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.card, styles.archivedCard, !isOwnerArchived && styles.cardMember]}
                      onPress={() => {
                        (navigation as any).navigate('ProjectOverview', {
                          projectId: item.id,
                          projectName: item.name || t("projects.noName"),
                        });
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.cardContent}>
                        <Pressable
                          style={[styles.projectThumb, styles.archivedThumb, { backgroundColor: getThumbTint(item) }]}
                          onPress={() => {
                            if (isOwnerArchived) showCoverSheet(item);
                          }}
                        >
                          {showCover ? (
                            <Image source={{ uri: item.coverImageUrl! }} style={styles.projectThumbImage} resizeMode="cover" />
                          ) : hub ? (
                            <Ionicons name="construct-outline" size={20} color={colors.textMuted} />
                          ) : (
                            <>
                              <Text style={styles.projectThumbInitials}>{getProjectInitials(item.name || t("projects.noName"))}</Text>
                              <Ionicons name={getThumbIcon(item)} size={11} color={colors.textMuted} style={styles.projectThumbIcon} />
                            </>
                          )}
                        </Pressable>
                        <View style={styles.cardMain}>
                          <View style={styles.nameRow}>
                            <Text style={[styles.name, styles.archivedText]} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                          </View>
                          <ProjectBadgesRow isOwner={isOwnerArchived} sharedWithCount={item.sharedWithCount ?? 0} isSharedToMe={item.isSharedToMe} showLegacyBadge={isLegacyResidential(item.projectType)} />
                          <View style={styles.typeBadgeRow}>
                            <View style={[styles.typeBadge, styles.typeBadgeArchived, { borderColor: badgeColor }]}>
                              <Text style={[styles.typeBadgeText, styles.typeBadgeTextArchived, { color: badgeColor }]} numberOfLines={1}>
                                {typeLabel}
                              </Text>
                            </View>
                            {location ? (
                              <Text style={[styles.typeBadgeCity, styles.archivedText]} numberOfLines={1}>{location}</Text>
                            ) : null}
                          </View>
                          <Text style={[styles.progressMeta, styles.archivedText]} numberOfLines={1}>
                            {t("projectsTab.card.progress", { pct: String(progress) })}
                          </Text>
                          {item.createdAt && (
                            <Text style={[styles.createdAt, styles.archivedText]}>{t("projects.createdAt")}: {formatCreatedAt(item.createdAt)}</Text>
                          )}
                        </View>
                        <View style={styles.cardActions}>
                          {item.addressText && (
                            <TouchableOpacity
                              style={styles.cardMapButton}
                              onPress={(e) => {
                                e.stopPropagation();
                                openInMaps(item.addressText!);
                              }}
                              accessibilityLabel={t("maps.openInMaps")}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="location" size={18} color={colors.textMuted} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={styles.cardMenu}
                            onPress={(e) => {
                              e.stopPropagation();
                              openProjectMenu(item);
                            }}
                            accessibilityLabel={t("projects.edit")}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          >
                            <Text style={[styles.cardMenuText, styles.archivedText]}>⋯</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null
          }
        />
        </>
      )}
      <CloneProjectModal
        visible={showCloneModal}
        onClose={() => {
          setShowCloneModal(false);
          setCloneSourceProject(null);
        }}
        sourceProjectId={cloneSourceProject?.id ?? ""}
        sourceProjectName={cloneSourceProject?.name ?? ""}
        sourceProjectType={cloneSourceProject?.projectType}
        sourceJobsTabVisible={cloneSourceProject?.jobsTabVisible}
        sourceCountryCode={cloneSourceProject?.countryCode}
        sourceCity={cloneSourceProject?.city}
        sourceAddressText={cloneSourceProject?.addressText}
        isOwner={!!cloneSourceProject?.ownerId && cloneSourceProject.ownerId === user?.id}
        onSuccess={onCloneSuccess}
      />
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={closeProjectMenu}>
          <View style={[styles.menuCard, { paddingBottom: menuBottomInset + spacing.md }]}>
            <Text style={styles.menuTitle}>{menuProject?.name || t("projects.noName")}</Text>
            <TouchableOpacity style={styles.menuItem} onPress={closeProjectMenu}>
              <Text style={styles.menuText}>{t("projects.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={onMenuEdit}>
              <Text style={styles.menuText}>{t("projects.edit")}</Text>
            </TouchableOpacity>
            {menuProject &&
              !!menuProject.ownerId &&
              menuProject.ownerId === user?.id && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuShareMembers}>
                  <Text style={styles.menuText}>{t("projects.shareMembers")}</Text>
                </TouchableOpacity>
              )}
            {menuProject &&
              !!menuProject.ownerId &&
              menuProject.ownerId === user?.id &&
              menuProject.projectType &&
              isKnownStorageType(menuProject.projectType) &&
              !isLegacyMaintenanceEquipmentHub(menuProject) && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuClone}>
                  <Text style={styles.menuText}>{t("projects.duplicate")}</Text>
                </TouchableOpacity>
              )}
            {menuProject &&
              !!menuProject.ownerId &&
              menuProject.ownerId === user?.id && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuSaveAsTemplate}>
                  <Text style={styles.menuText}>{menuProject.isTemplate ? t("projects.removeFromTemplates") : t("projects.saveAsTemplate")}</Text>
                </TouchableOpacity>
              )}
            <TouchableOpacity style={styles.menuItem} onPress={onMenuArchive}>
              <Text style={styles.menuText}>
                {menuProject?.archivedAt ? t("projects.unarchive") : t("projects.archive")}
              </Text>
            </TouchableOpacity>
            {menuProject?.isSharedToMe === true &&
              (!menuProject.ownerId || menuProject.ownerId !== auth.currentUser?.uid) && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuLeaveProject}>
                  <Text style={styles.menuTextDanger}>{t("projectMembers.leaveProject")}</Text>
                </TouchableOpacity>
              )}
            {menuProject &&
              (!menuProject.isSharedToMe || menuProject.ownerId === auth.currentUser?.uid) && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuDelete}>
                  <Text style={styles.menuTextDanger}>{t("projects.delete")}</Text>
                </TouchableOpacity>
              )}
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={showNew} transparent animationType="slide">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, (creationPath === "ai" || newStep === 1) && styles.modalOverlayHero]}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modal, (creationPath === "ai" || newStep === 1) && styles.modalHero, (creationPath === "ai" || newStep === 1) && { height: heroModalHeight }]}>
            <Text style={styles.modalTitle}>
              {creationPath === "ai" ? t("createProject.ai.title") : t("projects.modalTitle")}
            </Text>
            {creationPath === "ai" ? (
              <View style={styles.stepOneBody}>
                <CreateProjectAIFlow
                  engineType={getProjectEngine(selectedType ?? undefined)}
                  workType={wizardResult?.workType ?? undefined}
                  onCreated={(projectId) => {
                    closeNewModal();
                    load();
                    navigation.navigate("ProjectOverview", { projectId });
                  }}
                  onManual={() => {
                    setCreationPath("manual");
                    setCreationMethod("empty");
                    setNewStep(2);
                  }}
                  onUseTemplate={
                    wizardResult?.engineType === "BUILD"
                      ? () => {
                          setCreationPath("manual");
                          setCreationMethod("template");
                          setNewStep(2);
                        }
                      : undefined
                  }
                  onCancel={closeNewModal}
                />
              </View>
            ) : newStep === 1 ? (
              <View style={styles.stepOneBody}>
                <CreateProjectWizard
                  key={wizardModalKey}
                  initialEngineType={wizardInitialEngine ?? undefined}
                  onComplete={handleWizardComplete}
                  onCancel={closeNewModal}
                />
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </View>
            ) : (
              <ScrollView 
                style={styles.modalContent}
                showsVerticalScrollIndicator={true}
                scrollEnabled={true}
                keyboardShouldPersistTaps="handled"
              >
              {newStep === 2 ? (
              <>
                    <Text style={styles.modalLabel}>{t("projects.namePlaceholder")} *</Text>
                    <TextInput
                      style={styles.inputWhite}
                      value={newName}
                      onChangeText={(text) => {
                        setNewName(text);
                        setError(null);
                      }}
                      placeholder={t("projects.namePlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                      autoFocus={true}
                    />
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>{t("projects.country")}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                      {COUNTRY_CODES.slice(0, 12).map((code) => (
                        <TouchableOpacity
                          key={code}
                          style={[styles.countryChip, newCountry === code && styles.countryChipActive]}
                          onPress={() => {
                            setNewCountry(code);
                            if (
                              selectedType === "BUILD" &&
                              creationMethod === "template"
                            ) {
                              resetTemplateSelectionState();
                            }
                          }}
                        >
                          <Text style={[styles.countryChipText, newCountry === code && styles.countryChipTextActive]}>
                            {getLocalizedCountryName(code, locale)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={[styles.modalLabel, { marginTop: spacing.xs }]}>{t("projects.city")}</Text>
                    <TextInput
                      style={styles.inputWhite}
                      value={newCity}
                      onChangeText={(text) => { setNewCity(text); setError(null); }}
                      placeholder={t("projects.cityPlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                    />
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>{t("projects.address")}</Text>
                    <TextInput
                      style={styles.inputWhite}
                      value={newAddress}
                      onChangeText={(text) => {
                        setNewAddress(text);
                        setError(null);
                      }}
                      placeholder={t("createProject.addressPlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                    />

                {selectedType === "BUILD" && (
                  <>
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>{t("createProject.howToStart")}</Text>
                    <View style={styles.templateChoiceColumn}>
                      <TouchableOpacity
                        style={[styles.templateChoiceCard, creationMethod === "template" && styles.templateChoiceCardActive]}
                        onPress={() => {
                          setCreationMethod("template");
                          setError(null);
                        }}
                      >
                        <View style={styles.templateChoiceHeader}>
                          <Ionicons
                            name={creationMethod === "template" ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={creationMethod === "template" ? colors.primary : colors.textMuted}
                          />
                          <Text style={[styles.templateChoiceText, creationMethod === "template" && styles.templateChoiceTextActive]}>
                            {t("createProject.method.template.title", { country: newCountry || "SK" })}
                          </Text>
                        </View>
                        <Text style={styles.templateChoiceSubtext}>{t("createProject.method.template.helper")}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.templateChoiceCard, creationMethod === "empty" && styles.templateChoiceCardActive]}
                        onPress={() => {
                          setCreationMethod("empty");
                          setError(null);
                        }}
                      >
                        <View style={styles.templateChoiceHeader}>
                          <Ionicons
                            name={creationMethod === "empty" ? "radio-button-on" : "radio-button-off"}
                            size={18}
                            color={creationMethod === "empty" ? colors.primary : colors.textMuted}
                          />
                          <Text style={[styles.templateChoiceText, creationMethod === "empty" && styles.templateChoiceTextActive]}>
                            {t("createProject.method.empty.title")}
                          </Text>
                        </View>
                        <Text style={styles.templateChoiceSubtext}>{t("createProject.method.empty.helper")}</Text>
                      </TouchableOpacity>
                    </View>

                    {creationMethod === "template" && (
                      <View style={styles.templatePreview}>
                        {loadingPhases ? (
                          <ActivityIndicator color={colors.primary} size="small" />
                        ) : (
                          <Ionicons name="layers-outline" size={16} color={colors.textMuted} />
                        )}
                        <Text style={styles.templatePreviewText}>
                          {templatePhases.length > 0
                            ? t("createProject.templatePreview", { count: templatePhases.length.toString() })
                            : t("createProject.templatePreviewGeneric")}
                        </Text>
                      </View>
                    )}
                  </>
                )}

                {/* Error message */}
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </>
              ) : (
              <>
                <Text style={styles.modalLabel}>{t("createProject.summaryTitle")}</Text>
                <View style={styles.summaryContainer}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t("projects.namePlaceholder")}:</Text>
                    <Text style={styles.summaryValue}>{newName}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t("createProject.summaryYouSelected")}</Text>
                    <Text style={styles.summaryValue}>{getCreateFlowTypeTitle(selectedType)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t("createProject.summaryStructure")}</Text>
                    <Text style={styles.summaryValue}>
                      {selectedType === "BUILD"
                        ? t("createProject.structureWithPhases")
                        : t("createProject.structureNoPhases")}
                    </Text>
                  </View>
                  {newAddress.trim() ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>{t("projects.address")}:</Text>
                      <Text style={styles.summaryValue}>{newAddress.trim()}</Text>
                    </View>
                  ) : null}
                  {selectedType === "BUILD" && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>{t("createProject.howToStart")}</Text>
                      <Text style={styles.summaryValue}>
                        {creationMethod === "template"
                          ? t("createProject.method.template.short")
                          : t("createProject.method.empty.short")}
                      </Text>
                    </View>
                  )}
                </View>
                {renderContainsChecklist()}
                
                {/* Error message */}
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </>
              )}
              </ScrollView>
            )}
            
            {/* AI flow má vlastné tlačidlá; krok 1 = wizard; krok 2+ len manuálny tok */}
            {creationPath === "ai" ? null : newStep === 1 ? null : newStep === 2 ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={onBack}
                  disabled={submitting || loadingPhases}
                >
                  <Text style={styles.modalCancelText}>{t("projects.back")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOk, (!newName.trim() || submitting) && styles.modalOkDisabled]}
                  onPress={onNext}
                  disabled={!newName.trim() || submitting}
                >
                  <Text style={styles.modalOkText}>{t("projects.next")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={onBack}
                  disabled={submitting}
                >
                  <Text style={styles.modalCancelText}>{t("projects.back")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOk, submitting && styles.modalOkDisabled]}
                  onPress={onCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalOkText}>{t("createProject.createButton")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEdit} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projects.editTitle")}</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder={t("projects.namePlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowEdit(false); setEditProject(null); setEditName(""); }}
              >
                <Text style={styles.modalCancelText}>{t("projects.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalOk}
                onPress={onSaveEdit}
                disabled={submitting || !editName.trim()}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : t("projects.save")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },
  screenTop: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  pageHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  pageTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
  },
  headerPrimaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
  },
  headerPrimaryCtaText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  emptyHero: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHeroIcon: { marginBottom: spacing.md, opacity: 0.85 },
  emptyHeroTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  emptyHeroBody: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.lg,
    maxWidth: 320,
  },
  emptyPrimaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius,
  },
  emptyPrimaryCtaText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  emptySecondaryTap: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  emptySecondaryTapText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 15,
  },
  progressMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  list: { padding: spacing.md, paddingBottom: 60 },
  typeFilterWrapper: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    overflow: "hidden",
  },
  typeFilterScroll: {
    maxHeight: 46,
  },
  typeFilterRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipCompact: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipTextCompact: {
    fontSize: 13,
    color: colors.text,
  },
  filterDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
    marginVertical: 4,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 14,
    color: colors.text,
  },
  filterChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  emptyFiltered: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyFilteredText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardCompleted: {
    borderColor: "#22c55e",
    borderWidth: 2,
    backgroundColor: "#22c55e08",
  },
  archivedSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  archivedTitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontWeight: "600",
  },
  archivedCard: {
    opacity: 0.7,
  },
  archivedText: {
    color: colors.textMuted,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  menuCard: {
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  menuItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuText: {
    fontSize: 15,
    color: colors.text,
  },
  menuTextDanger: {
    fontSize: 15,
    color: "#c00",
    fontWeight: "600",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  projectThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginTop: 2,
    position: "relative",
    borderWidth: 1,
    borderColor: colors.border,
  },
  archivedThumb: {
    opacity: 0.85,
  },
  projectThumbImage: {
    width: "100%",
    height: "100%",
  },
  projectThumbInitials: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  projectThumbIcon: {
    position: "absolute",
    right: 3,
    bottom: 3,
  },
  cardMain: {
    flex: 1,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cardMapButton: {
    padding: spacing.xs,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, flex: 1 },
  category: { fontSize: 13, color: colors.textMuted },
  categoryMeta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  typeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
    flexWrap: "wrap",
  },
  typeBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: "transparent",
  },
  typeBadgeArchived: {
    opacity: 0.85,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  typeBadgeTextArchived: {
    opacity: 0.9,
  },
  typeBadgeCity: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
    flexShrink: 1,
  },
  cardMember: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary + "99",
  },
  createdAt: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  cardMenu: { padding: spacing.xs ?? 4 },
  cardMenuText: { fontSize: 18, color: colors.textMuted, fontWeight: "600" },
  emptyText: { fontSize: 16, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modalOverlayHero: {
    padding: spacing.sm,
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "96%",
    minHeight: 460,
    flexDirection: "column",
  },
  modalHero: {
    minHeight: 520,
    maxHeight: "94%",
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 9,
  },
  modalContent: { flex: 1, maxHeight: "82%" },
  stepOneBody: {
    flex: 1,
    minHeight: 420,
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  modalLabel: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  createHeader: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  createSubtext: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  createSubtextHero: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    lineHeight: 20,
  },
  typeBtn: {
    flex: 1,
    minWidth: "48%",
    paddingVertical: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  typeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeBtnText: { fontSize: 14, fontWeight: "600", color: colors.text },
  typeBtnTextActive: { color: "#fff" },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputWhite: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: "#fff",
    marginBottom: spacing.md,
  },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  modalCancel: { padding: spacing.sm },
  modalCancelText: { color: colors.textMuted },
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius },
  modalOkDisabled: { backgroundColor: colors.textMuted, opacity: 0.5 },
  modalOkText: { color: "#fff", fontWeight: "600" },
  errorContainer: {
    backgroundColor: "#fee",
    borderWidth: 1,
    borderColor: "#fcc",
    borderRadius: radius,
    padding: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: "#c00",
    fontSize: 14,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  refreshButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius,
  },
  refreshButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  containsSection: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  containsTitle: {
    fontSize: 14,
    color: colors.textOnDark,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  containsItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  containsItemText: {
    fontSize: 13,
    color: colors.textOnDark,
  },
  templateChoiceColumn: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  templateChoiceCard: {
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  templateChoiceCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  templateChoiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  templateChoiceText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  templateChoiceTextActive: {
    color: colors.primary,
  },
  templateChoiceSubtext: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  templatePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  templatePreviewText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  countryChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  countryChipText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
  },
  countryChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  summaryContainer: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.textOnDark,
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 14,
    color: colors.textOnDark,
    fontWeight: "600",
  },
});
