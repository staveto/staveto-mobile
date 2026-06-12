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
import { useActiveOrg } from "../hooks/useActiveOrg";
import { useOrgAccess } from "../hooks/useOrgAccess";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import {
  enrichProjectsWithBusinessAssignments,
  isBusinessTeamProject,
  stampBusinessTeamProject,
} from "../services/projects";
import * as projectMembersService from "../services/projectMembers";
import * as tasksService from "../services/tasks";
import * as projectCoverService from "../services/projectCover";
import type { ProjectDoc } from "../services/projects";
import { colors, radius, spacing } from "../theme";
import { ProjectBadgesRow } from "../components/ProjectBadgesRow";
import { CloneProjectModal } from "../components/CloneProjectModal";
import { UnifiedProjectCreationFlow } from "../components/UnifiedProjectCreationFlow";
import { isLegacyResidential } from "../lib/projectEnums";
import {
  getActiveProductProjectType,
  matchesProjectsTabTypeFilter,
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
import { readStoredPrimaryUsageMode } from "../lib/primaryUsageMode";
import type { InternalProjectHints } from "../services/projectCreationService";
import { openInMaps } from "../lib/maps";
import { COUNTRY_CODES, getLocalizedCountryName } from "../utils/countries";
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
  const { activeBusinessOrgId } = useActiveOrg();
  const { canViewAllProjects, restrictsToAssignedProjectsOnly, canCreateProject } = useOrgAccess();
  const authUid = user?.id ?? orgId ?? "";
  const prevAuthUidRef = useRef<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [createFlowKey, setCreateFlowKey] = useState(0);
  const [createInternalHints, setCreateInternalHints] = useState<InternalProjectHints>({});
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
    if (!authUid) {
      prevAuthUidRef.current = null;
      setProjects([]);
      setProjectStats(new Map());
      setLoading(true);
      return;
    }
    if (prevAuthUidRef.current != null && prevAuthUidRef.current !== authUid) {
      setProjects([]);
      setProjectStats(new Map());
      setLoading(true);
      setError(null);
    }
    prevAuthUidRef.current = authUid;
  }, [authUid]);

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
    if (!canCreateProject) return;
    void readStoredPrimaryUsageMode().then((m) => {
      setCreateInternalHints({ primaryUsageMode: m });
    });
    setCreateFlowKey((k) => k + 1);
    setShowNew(true);
  }, [canCreateProject]);

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
      let list = await projectsService.listAllMyProjects(orgId, { forceServerRead: isRefresh });

      if (activeBusinessOrgId && authUid) {
        list = await enrichProjectsWithBusinessAssignments(list, {
          activeBusinessOrgId,
          authUid,
          canViewAllProjects,
          restrictsToAssignedProjectsOnly,
        });
      }

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
  }, [orgId, activeBusinessOrgId, authUid, canViewAllProjects, restrictsToAssignedProjectsOnly]);

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
        (navigation as { setParams?: (params: Record<string, unknown>) => void }).setParams?.({ openNew: false });
        if (canCreateProject) {
          void readStoredPrimaryUsageMode().then((m) => {
            setCreateInternalHints({ primaryUsageMode: m });
          });
          setCreateFlowKey((k) => k + 1);
          setShowNew(true);
          setError(null);
        }
      }
    }, [canCreateProject, load, navigation, route.params])
  );

  const closeNewModal = () => {
    setShowNew(false);
    setError(null);
  };

  const handleUnifiedCreationSuccess = useCallback(
    async (payload: import("../components/UnifiedProjectCreationFlow").UnifiedProjectCreationSuccess) => {
      if (!orgId) {
        showError(t("createProject.notSignedIn"));
        return;
      }
      try {
        if (activeBusinessOrgId) {
          await stampBusinessTeamProject(payload.projectId, activeBusinessOrgId);
        }
        await AsyncStorage.setItem("@staveto:lastUsedProjectId", payload.projectId);
      } catch {
        /* ignore */
      }
      const { logProjectCreateSuccess } = await import("../services/analytics");
      logProjectCreateSuccess(payload.internalProjectType, "projects");
      closeNewModal();
      load();
      (navigation as { navigate: (name: string, params: object) => void }).navigate("ProjectOverview", {
        projectId: payload.projectId,
      });
      const { trackPaywallEvent, checkAndShowPaywall } = await import("../services/paywallTrigger");
      await trackPaywallEvent("project_created");
      await checkAndShowPaywall(user?.billing, navigation, "project_created");
    },
    [activeBusinessOrgId, load, navigation, orgId, t, user?.billing]
  );

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

  const showBusinessWorkerEmpty =
    restrictsToAssignedProjectsOnly && !loading && visibleProjects.length === 0;

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
          {showBusinessWorkerEmpty ? (
            <>
              <Text style={styles.emptyHeroTitle}>{t("business.projects.noAssigned.title")}</Text>
              <Text style={styles.emptyHeroBody}>{t("business.projects.noAssigned.body")}</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyHeroTitle}>{t("projectsTab.empty.title")}</Text>
              <Text style={styles.emptyHeroBody}>{t("projectsTab.empty.body")}</Text>
              {canCreateProject ? (
                <TouchableOpacity style={styles.emptyPrimaryCta} onPress={openCreateProject} activeOpacity={0.88}>
                  <Ionicons name="add-circle-outline" size={22} color="#fff" />
                  <Text style={styles.emptyPrimaryCtaText}>{t("projectsTab.newJob")}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
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
            {canCreateProject ? (
              <TouchableOpacity style={styles.headerPrimaryCta} onPress={openCreateProject} activeOpacity={0.88}>
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={styles.headerPrimaryCtaText}>{t("projectsTab.newJob")}</Text>
              </TouchableOpacity>
            ) : null}
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
            const typeLabel = projectsTabCardJobTypeLabel(t, item);
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
                  const typeLabel = projectsTabCardJobTypeLabel(t, item);
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
          style={[styles.modalOverlay, styles.modalOverlayHero]}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modal, styles.modalHero, { height: heroModalHeight, paddingTop: spacing.sm }]}>
            <View style={styles.createModalHeader}>
              <Text style={[styles.modalTitle, { flex: 1, textAlign: "left", marginBottom: 0 }]}>{t("projects.modalTitle")}</Text>
              <TouchableOpacity
                onPress={closeNewModal}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={t("projects.cancel")}
              >
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>
            {!orgId ? (
              <Text style={{ color: colors.text, padding: spacing.md }}>{t("createProject.notSignedIn")}</Text>
            ) : (
              <View style={{ flex: 1, minHeight: 200 }}>
                <UnifiedProjectCreationFlow
                  key={createFlowKey}
                  variant="inApp"
                  existingProjects={projects}
                  internalHints={createInternalHints}
                  submitting={submitting}
                  onSuccess={handleUnifiedCreationSuccess}
                />
              </View>
            )}
            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
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
  createModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
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
  manualSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  manualInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  manualOptionalToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  manualOptionalToggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
  },
  manualOptionalCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  manualTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  manualTypeChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manualTypeChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  manualTypeChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
  },
  manualTypeChipTextActive: {
    color: colors.primary,
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
