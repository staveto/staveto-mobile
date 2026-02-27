import React, { useCallback, useEffect, useRef, useState } from "react";
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
import * as projectCoverService from "../services/projectCover";
import * as projectFactory from "../services/projectFactory";
import * as templateService from "../services/templateService";
import type { PhaseCustomization } from "../services/projectFactory";
import type { CatalogPhase } from "../lib/types";
import type { ProjectDoc } from "../services/projects";
import { colors, radius, spacing } from "../theme";
import { ProjectBadgesRow } from "../components/ProjectBadgesRow";
import { CloneProjectModal } from "../components/CloneProjectModal";
import { ProjectTypeCrossroad, type SelectableProjectType } from "../components/ProjectTypeCrossroad";
import { openInMaps } from "../lib/maps";
import { COUNTRY_CODES, getLocalizedCountryName } from "../utils/countries";
import { getCallable } from "../firebase";
import { showToast } from "../helpers/toast";

type Project = ProjectDoc;

function showError(msg: string) {
  Alert.alert("", msg);
}

const ALLOWED_CLONE_TYPES = ["BUILD", "RESIDENTIAL", "TRADE", "MANAGEMENT"] as const;
const PROJECTS_FILTER_KEY = "projects_filter_v1";
const TYPE_FILTER_KEY = "projects_type_filter_v1";
type ProjectFilter = "all" | "mine" | "shared";
type TypeFilter = "ALL" | "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "MAINTENANCE";

function formatCreatedAt(isoStr?: string): string {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

type ProjectCreationType = NonNullable<ProjectDoc["projectType"]>;
type CreationMethod = "template" | "empty";
type DisplayProjectType = "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "MAINTENANCE";

const DEFAULT_TEMPLATE_ID = "eu-construction-v1";

function normalizeProjectType(projectType?: ProjectDoc["projectType"]): DisplayProjectType {
  if (projectType === "RESIDENTIAL" || projectType === "TRADE" || projectType === "MAINTENANCE") return projectType;
  return "MANAGEMENT";
}

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
  const [creationMethod, setCreationMethod] = useState<CreationMethod>("template");
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
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<TypeFilter>("ALL");
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

  const loadDefaultTemplatePhases = useCallback(async () => {
    setTemplateId(DEFAULT_TEMPLATE_ID);
    setLoadingPhases(true);
    try {
      const phases = await templateService.getTemplatePhases(DEFAULT_TEMPLATE_ID);
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
      console.warn("[ProjectsScreen] Could not load default template phases:", e);
      setTemplatePhases([]);
      setPhaseCustomizations(new Map());
    } finally {
      setLoadingPhases(false);
    }
  }, []);

  const getCreateFlowTypeTitle = useCallback(
    (type: ProjectCreationType | null) => {
      if (!type) return "";
      const normalizedType = type === "BUILD" ? "MANAGEMENT" : type;
      return t(`createProject.type.${normalizedType}.title`);
    },
    [t]
  );

  const getContainsItems = useCallback(
    (type: ProjectCreationType | null) => {
      if (type === "MAINTENANCE") {
        return ["equipment", "serviceSchedules", "maintenanceHistory", "costs"];
      }
      const items = ["tasks", "expenses", "diary"];
      if (type === "MANAGEMENT" || type === "BUILD") {
        items.push("phases", "documents");
      }
      return items;
    },
    []
  );

  const getProjectTypeLabel = useCallback(
    (projectType?: ProjectDoc["projectType"]) => {
      const normalized = normalizeProjectType(projectType);
      return t(`createProject.type.${normalized}.title`);
    },
    [t]
  );

  const getThumbTint = useCallback((projectType?: ProjectDoc["projectType"]) => {
    const normalized = normalizeProjectType(projectType);
    if (normalized === "TRADE") return "#5dade220";
    if (normalized === "MAINTENANCE") return "#7dcea022";
    if (normalized === "RESIDENTIAL") return "#8ea7ff22";
    return "#ff9f4322";
  }, []);

  const getThumbIcon = useCallback((projectType?: ProjectDoc["projectType"]): React.ComponentProps<typeof Ionicons>["name"] => {
    const normalized = normalizeProjectType(projectType);
    if (normalized === "RESIDENTIAL") return "home-outline";
    if (normalized === "TRADE") return "briefcase-outline";
    if (normalized === "MAINTENANCE") return "construct-outline";
    return "clipboard-outline";
  }, []);

  const getBadgeColor = useCallback((projectType?: ProjectDoc["projectType"]) => {
    const normalized = normalizeProjectType(projectType);
    if (normalized === "TRADE") return "#5dade2";
    if (normalized === "MAINTENANCE") return "#7dcea0";
    if (normalized === "RESIDENTIAL") return "#8ea7ff";
    return "#ff9f43";
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
      if (saved === "MANAGEMENT" || saved === "RESIDENTIAL" || saved === "TRADE" || saved === "MAINTENANCE" || saved === "ALL") {
        setSelectedTypeFilter(saved);
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

  const handleTypeFilterChange = useCallback(async (filter: TypeFilter) => {
    setSelectedTypeFilter(filter);
    try {
      await AsyncStorage.setItem(TYPE_FILTER_KEY, filter);
    } catch (e) {
      console.warn("[ProjectsScreen] Failed to persist type filter:", e);
    }
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
      if (projectFilter === "mine") result = result.filter((p) => p.isSharedToMe !== true && (p.sharedWithCount ?? 0) === 0);
      else if (projectFilter === "shared") result = result.filter((p) => p.isSharedToMe === true || (p.sharedWithCount ?? 0) > 0);
      if (selectedTypeFilter !== "ALL") {
        result = result.filter((p) => normalizeProjectType(p.projectType) === selectedTypeFilter);
      }
      return result;
    },
    [projectFilter, selectedTypeFilter]
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
      if ((route.params as { openNew?: boolean })?.openNew) {
        setShowNew(true);
        setNewStep(1);
        setSelectedType(null);
        setCreationMethod("template");
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
    setCreationMethod("template");
    setNewName("");
    setNewAddress("");
    resetTemplateSelectionState();
    setError(null);
  };

  const handleSelectType = useCallback(
    (type: SelectableProjectType) => {
      setSelectedType(type);
      setError(null);
      setCreationMethod("template");
      resetTemplateSelectionState();
    },
    [resetTemplateSelectionState]
  );

  useEffect(() => {
    if (
      selectedType === "MANAGEMENT" &&
      newStep === 2 &&
      creationMethod === "template" &&
      !loadingPhases &&
      !templatePhases.length &&
      !templateId
    ) {
      loadDefaultTemplatePhases();
      return;
    }

    if ((selectedType !== "MANAGEMENT" && selectedType !== "BUILD") || (selectedType === "MANAGEMENT" && creationMethod === "empty")) {
      resetTemplateSelectionState();
    }
  }, [
    selectedType,
    newStep,
    creationMethod,
    loadingPhases,
    templatePhases.length,
    templateId,
    loadDefaultTemplatePhases,
    resetTemplateSelectionState,
  ]);

  const onNext = async () => {
    if (newStep === 1) {
      if (!selectedType) {
        setError(t("createProject.selectTypeRequired"));
        return;
      }

      setError(null);
      setNewStep(2);
    } else if (newStep === 2) {
      if (!newName.trim()) {
        setError(selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.groupNameRequired") : t("createProject.nameRequired"));
        return;
      }

      setError(null);
      setNewStep(3);
    }
  };

  const onBack = () => {
    if (newStep === 2) {
      setNewStep(1);
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
      const errorMsg = selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.groupNameRequired") : t("createProject.nameRequired");
      setError(errorMsg);
      return;
    }
    
    setError(null);
    setSubmitting(true);
    
    try {
      const shouldUseTemplate =
        selectedType === "BUILD" || (selectedType === "MANAGEMENT" && creationMethod === "template");
      const finalTemplateId = shouldUseTemplate ? DEFAULT_TEMPLATE_ID : "";

      console.log(
        `[ProjectsScreen] Creating project: type="${selectedType}", name="${newName.trim()}", templateId="${finalTemplateId}"`
      );
      
      // Prepare phase customizations array
      const customizationsArray = shouldUseTemplate && phaseCustomizations.size > 0
        ? Array.from(phaseCustomizations.values())
        : undefined;
      
      console.log(`[ProjectsScreen] Phase customizations:`, customizationsArray);
      
      // Vytvor projekt - ownerId sa automaticky použije z auth.currentUser.uid v projectFactory
      const addressTextForCreate =
        selectedType === "MAINTENANCE"
          ? [newAddress.trim(), newNote.trim()].filter(Boolean).join("\n") || undefined
          : newAddress.trim() || undefined;
      const countryCodeForCreate = selectedType === "MAINTENANCE" ? undefined : (newCountry.trim() || undefined);
      const cityForCreate = selectedType === "MAINTENANCE" ? undefined : (newCity.trim() || undefined);

      await projectFactory.createProjectFromTemplate({
        projectType: selectedType,
        templateId: finalTemplateId,
        name: newName.trim(),
        addressText: addressTextForCreate,
        countryCode: countryCodeForCreate,
        city: cityForCreate,
        phaseCustomizations: customizationsArray,
      });
      
      console.log(`${selectedType} project created successfully`);
      closeNewModal();
      load();
      const { trackPaywallEvent, checkAndShowPaywall } = await import("../services/paywallTrigger");
      await trackPaywallEvent("project_created");
      await checkAndShowPaywall(user?.billing, navigation);
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

  const onMenuClone = () => {
    if (!menuProject) return;
    setCloneSourceProject(menuProject);
    setShowCloneModal(true);
    closeProjectMenu();
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

  const onMenuDelete = () => {
    if (!menuProject) return;
    Alert.alert(
      t("projects.deleteConfirm"),
      "",
      [
        { text: t("projects.cancel"), style: "cancel" },
        {
          text: t("projects.delete"),
          style: "destructive",
          onPress: async () => {
            if (!orgId) return;
            try {
              await projectsService.deleteProject(orgId, menuProject.id);
              load();
            } catch (e: unknown) {
              const c = (e as { code?: string }).code;
              showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : "Chyba."));
            }
          },
        },
      ]
    );
    closeProjectMenu();
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

  const activeProjects = filterProjects(projects.filter((p) => !p.archivedAt));
  const archivedProjects = filterProjects(projects.filter((p) => !!p.archivedAt));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.fab} onPress={() => setShowNew(true)}>
        <Text style={styles.fabText}>+ {t("projects.fab")}</Text>
      </TouchableOpacity>
      {!projects.length && !loading ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("projects.empty")}</Text>
          <TouchableOpacity 
            style={styles.refreshButton}
            onPress={onRefresh}
            disabled={refreshing}
          >
            <Text style={styles.refreshButtonText}>
              {refreshing ? t("common.refreshing") : t("common.refresh")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
        <View style={styles.typeFilterWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.typeFilterRow, { paddingRight: spacing.xl }]}
            style={[styles.typeFilterScroll, { width: windowWidth - 2 * spacing.md }]}
          >
            {(["ALL", "MANAGEMENT", "RESIDENTIAL", "TRADE", "MAINTENANCE"] as TypeFilter[]).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.filterChip, selectedTypeFilter === type && styles.filterChipActive]}
                onPress={() => handleTypeFilterChange(type)}
              >
                <Text style={[styles.filterChipText, selectedTypeFilter === type && styles.filterChipTextActive]}>
                  {t(`home.filter.type.${type.toLowerCase()}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, projectFilter === "all" && styles.filterChipActive]}
            onPress={() => handleFilterChange("all")}
          >
            <Text style={[styles.filterChipText, projectFilter === "all" && styles.filterChipTextActive]}>{t("home.filterAll")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, projectFilter === "mine" && styles.filterChipActive]}
            onPress={() => handleFilterChange("mine")}
          >
            <Text style={[styles.filterChipText, projectFilter === "mine" && styles.filterChipTextActive]}>{t("home.filterMine")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, projectFilter === "shared" && styles.filterChipActive]}
            onPress={() => handleFilterChange("shared")}
          >
            <Text style={[styles.filterChipText, projectFilter === "shared" && styles.filterChipTextActive]}>{t("home.filterShared")}</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={activeProjects}
          keyExtractor={(p) => p.id}
          extraData={`${selectedTypeFilter}-${projectFilter}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            projects.length > 0 && activeProjects.length === 0 && archivedProjects.length === 0 ? (
              <View style={styles.emptyFiltered}>
                <Text style={styles.emptyFilteredText}>{t("projects.noProjectsInCategory")}</Text>
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
            const normalizedType = normalizeProjectType(item.projectType);
            const typeLabel = getProjectTypeLabel(item.projectType);
            const location = getLocationAnchor(item);
            const badgeColor = getBadgeColor(item.projectType);
            const maintenanceCount =
              normalizedType === "MAINTENANCE" && typeof item.equipmentCount === "number"
                ? t("projectCard.equipmentCount", { count: String(item.equipmentCount) })
                : null;
            const showCover = normalizedType !== "MAINTENANCE" && !!item.coverImageUrl;
            
            const isOwner = !!item.ownerId && item.ownerId === user?.id;
            return (
              <TouchableOpacity
                style={[styles.card, !isOwner && styles.cardMember]}
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
                    style={[styles.projectThumb, { backgroundColor: getThumbTint(item.projectType) }]}
                    onPress={() => {
                      if (isOwner) showCoverSheet(item);
                    }}
                  >
                    {showCover ? (
                      <Image source={{ uri: item.coverImageUrl! }} style={styles.projectThumbImage} resizeMode="cover" />
                    ) : normalizedType === "MAINTENANCE" ? (
                      <Ionicons name="construct-outline" size={20} color={colors.textSecondary} />
                    ) : (
                      <>
                        <Text style={styles.projectThumbInitials}>{getProjectInitials(item.name || t("projects.noName"))}</Text>
                        <Ionicons name={getThumbIcon(item.projectType)} size={11} color={colors.textMuted} style={styles.projectThumbIcon} />
                      </>
                    )}
                  </Pressable>
                  <View style={styles.cardMain}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                    </View>
                    <ProjectBadgesRow isOwner={isOwner} sharedWithCount={item.sharedWithCount ?? 0} isSharedToMe={item.isSharedToMe} />
                    <View style={styles.typeBadgeRow}>
                      <View style={[styles.typeBadge, { borderColor: badgeColor }]}>
                        <Text style={[styles.typeBadgeText, { color: badgeColor }]} numberOfLines={1}>
                          {typeLabel.toUpperCase()}
                        </Text>
                      </View>
                      {location ? (
                        <Text style={styles.typeBadgeCity} numberOfLines={1}>{location}</Text>
                      ) : null}
                    </View>
                    {maintenanceCount && <Text style={styles.categoryMeta} numberOfLines={1}>{maintenanceCount}</Text>}
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
          ListEmptyComponent={
            archivedProjects.length ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>{t("projects.noActive")}</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            archivedProjects.length ? (
              <View style={styles.archivedSection}>
                <Text style={styles.archivedTitle}>{t("projects.archiveSection")}</Text>
                {archivedProjects.map((item) => {
                  const normalizedType = normalizeProjectType(item.projectType);
                  const typeLabel = getProjectTypeLabel(item.projectType);
                  const location = getLocationAnchor(item);
                  const badgeColor = getBadgeColor(item.projectType);
                  const maintenanceCount =
                    normalizedType === "MAINTENANCE" && typeof item.equipmentCount === "number"
                      ? t("projectCard.equipmentCount", { count: String(item.equipmentCount) })
                      : null;
                  const showCover = normalizedType !== "MAINTENANCE" && !!item.coverImageUrl;
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
                          style={[styles.projectThumb, styles.archivedThumb, { backgroundColor: getThumbTint(item.projectType) }]}
                          onPress={() => {
                            if (isOwnerArchived) showCoverSheet(item);
                          }}
                        >
                          {showCover ? (
                            <Image source={{ uri: item.coverImageUrl! }} style={styles.projectThumbImage} resizeMode="cover" />
                          ) : normalizedType === "MAINTENANCE" ? (
                            <Ionicons name="construct-outline" size={20} color={colors.textMuted} />
                          ) : (
                            <>
                              <Text style={styles.projectThumbInitials}>{getProjectInitials(item.name || t("projects.noName"))}</Text>
                              <Ionicons name={getThumbIcon(item.projectType)} size={11} color={colors.textMuted} style={styles.projectThumbIcon} />
                            </>
                          )}
                        </Pressable>
                        <View style={styles.cardMain}>
                          <View style={styles.nameRow}>
                            <Text style={[styles.name, styles.archivedText]} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                          </View>
                          <ProjectBadgesRow isOwner={isOwnerArchived} sharedWithCount={item.sharedWithCount ?? 0} isSharedToMe={item.isSharedToMe} />
                          <View style={styles.typeBadgeRow}>
                            <View style={[styles.typeBadge, styles.typeBadgeArchived, { borderColor: badgeColor }]}>
                              <Text style={[styles.typeBadgeText, styles.typeBadgeTextArchived, { color: badgeColor }]} numberOfLines={1}>
                                {typeLabel.toUpperCase()}
                              </Text>
                            </View>
                            {location ? (
                              <Text style={[styles.typeBadgeCity, styles.archivedText]} numberOfLines={1}>{location}</Text>
                            ) : null}
                          </View>
                          {maintenanceCount && <Text style={[styles.categoryMeta, styles.archivedText]} numberOfLines={1}>{maintenanceCount}</Text>}
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
              menuProject.ownerId === user?.id &&
              ALLOWED_CLONE_TYPES.includes(menuProject.projectType as (typeof ALLOWED_CLONE_TYPES)[number]) && (
                <TouchableOpacity style={styles.menuItem} onPress={onMenuClone}>
                  <Text style={styles.menuText}>{t("projects.cloneStructure")}</Text>
                </TouchableOpacity>
              )}
            <TouchableOpacity style={styles.menuItem} onPress={onMenuArchive}>
              <Text style={styles.menuText}>
                {menuProject?.archivedAt ? t("projects.unarchive") : t("projects.archive")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={onMenuDelete}>
              <Text style={styles.menuTextDanger}>{t("projects.delete")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={showNew} transparent animationType="slide">
        <KeyboardAvoidingView
          style={[styles.modalOverlay, newStep === 1 && styles.modalOverlayHero]}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modal, newStep === 1 && styles.modalHero, newStep === 1 && { height: heroModalHeight }]}>
            <Text style={styles.modalTitle}>
              {selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.header") : t("projects.modalTitle")}
            </Text>
            {newStep === 1 ? (
              <View style={styles.stepOneBody}>
                <Text style={styles.createHeader}>
                  {selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.header") : t("createProject.header")}
                </Text>
                <ProjectTypeCrossroad
                  selectedType={selectedType as SelectableProjectType | null}
                  onSelectType={handleSelectType}
                />
                <Text style={styles.createSubtextHero}>
                  {selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.subtitle") : t("createProject.mainDirectionHint")}
                </Text>
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
                {selectedType === "MAINTENANCE" ? (
                  <>
                    <Text style={styles.modalLabel}>{t("createProject.maintenanceGroup.groupNameLabel")} *</Text>
                    <TextInput
                      style={styles.inputWhite}
                      value={newName}
                      onChangeText={(text) => {
                        setNewName(text);
                        setError(null);
                      }}
                      placeholder={t("createProject.maintenanceGroup.groupNamePlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                      autoFocus={true}
                    />
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>{t("createProject.maintenanceGroup.baseLocationLabel")}</Text>
                    <TextInput
                      style={styles.inputWhite}
                      value={newAddress}
                      onChangeText={(text) => {
                        setNewAddress(text);
                        setError(null);
                      }}
                      placeholder={t("createProject.maintenanceGroup.baseLocationPlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                    />
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>{t("createProject.maintenanceGroup.noteLabel")}</Text>
                    <TextInput
                      style={[styles.inputWhite, { minHeight: 64 }]}
                      value={newNote}
                      onChangeText={(text) => {
                        setNewNote(text);
                        setError(null);
                      }}
                      placeholder={t("createProject.maintenanceGroup.notePlaceholder")}
                      placeholderTextColor="rgba(255, 255, 255, 0.7)"
                      editable={!submitting}
                      multiline
                      numberOfLines={3}
                    />
                  </>
                ) : (
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
                          onPress={() => setNewCountry(code)}
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
                  </>
                )}

                {renderContainsChecklist()}

                {selectedType === "MANAGEMENT" && (
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
                            {t("createProject.method.template.title")}
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
                    <Text style={styles.summaryLabel}>
                      {selectedType === "MAINTENANCE" ? t("createProject.maintenanceGroup.groupNameLabel") : t("projects.namePlaceholder")}:
                    </Text>
                    <Text style={styles.summaryValue}>{newName}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t("createProject.summaryYouSelected")}</Text>
                    <Text style={styles.summaryValue}>{getCreateFlowTypeTitle(selectedType)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{t("createProject.summaryStructure")}</Text>
                    <Text style={styles.summaryValue}>
                      {selectedType === "MANAGEMENT" || selectedType === "BUILD"
                        ? t("createProject.structureWithPhases")
                        : t("createProject.structureNoPhases")}
                    </Text>
                  </View>
                  {selectedType === "MAINTENANCE" ? (
                    <>
                      {newAddress.trim() && (
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>{t("createProject.maintenanceGroup.baseLocationLabel")}:</Text>
                          <Text style={styles.summaryValue}>{newAddress.trim()}</Text>
                        </View>
                      )}
                      {newNote.trim() && (
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>{t("createProject.maintenanceGroup.noteLabel")}:</Text>
                          <Text style={styles.summaryValue}>{newNote.trim()}</Text>
                        </View>
                      )}
                    </>
                  ) : newAddress.trim() ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>{t("projects.address")}:</Text>
                      <Text style={styles.summaryValue}>{newAddress.trim()}</Text>
                    </View>
                  ) : null}
                  {selectedType === "MANAGEMENT" && (
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
            
            {/* Tlačidlá - vždy viditeľné mimo ScrollView */}
            {newStep === 1 ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={closeNewModal}
                >
                  <Text style={styles.modalCancelText}>{t("projects.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalOk, 
                    !selectedType && styles.modalOkDisabled
                  ]}
                  onPress={onNext}
                  disabled={!selectedType}
                >
                  <Text style={styles.modalOkText}>{t("common.continue")}</Text>
                </TouchableOpacity>
              </View>
            ) : newStep === 2 ? (
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

      <Modal visible={showEdit} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
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
  list: { padding: spacing.md, paddingBottom: 60 },
  typeFilterWrapper: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    overflow: "hidden",
  },
  typeFilterScroll: {
    maxHeight: 40,
  },
  typeFilterRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 14,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
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
  fab: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    zIndex: 1,
  },
  fabText: { color: "#fff", fontWeight: "600" },
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
