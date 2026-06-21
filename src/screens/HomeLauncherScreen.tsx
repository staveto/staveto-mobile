import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CommonActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { colors, spacing } from "../theme";
import { HomeQuickActionsGrid } from "../components/HomeQuickActionsGrid";
import { QuickTimeModal } from "../components/QuickTimeModal";
import { QuickProblemProjectSheet } from "../components/QuickProblemProjectSheet";
import { HOME_LAUNCHER_ACTIONS, type HomeQuickActionId } from "../lib/homeQuickActions";
import { openInMaps } from "../lib/maps";
import { listMyProjects, type ProjectDoc, isBusinessTeamProject } from "../services/projects";
import { listTasksByProject } from "../services/tasks";
import { QuickWorkPhotoTaskSheet, type WorkPhotoFlowSelection } from "../components/QuickWorkPhotoTaskSheet";
import { QuickNoteModal } from "../components/QuickNoteModal";
import type { WorkPhotoType } from "../lib/attachmentTypes";
import * as quickNotesService from "../services/quickNotes";
import type { QuickNoteAttachment } from "../services/quickNotes";
import * as timeTracking from "../services/timeTracking";
import { showToast } from "../helpers/toast";

const LAST_USED_PROJECT_KEY = "@staveto:lastUsedProjectId";

function formatTimerHms(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Full-screen quick picker shown once after app boot — above tabs / classic home. */
export function HomeLauncherScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useAuth();
  const { activeBusinessOrgId, activeOrganization } = useActiveOrg();
  const quickTimeSheetRef = useRef<BottomSheetModal | null>(null);
  const problemSheetRef = useRef<BottomSheetModal | null>(null);
  const photoSheetRef = useRef<BottomSheetModal | null>(null);
  const photoTaskSheetRef = useRef<BottomSheetModal | null>(null);
  const quickNoteSheetRef = useRef<BottomSheetModal | null>(null);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [photoPickerProject, setPhotoPickerProject] = useState<ProjectDoc | null>(null);
  const [quickNoteProject, setQuickNoteProject] = useState<ProjectDoc | null>(null);
  const [showQuickNoteModal, setShowQuickNoteModal] = useState(false);
  const [photoPickerTasks, setPhotoPickerTasks] = useState<Awaited<ReturnType<typeof listTasksByProject>>>([]);
  const [photoTasksLoading, setPhotoTasksLoading] = useState(false);
  const [lastUsedProjectId, setLastUsedProjectId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState<timeTracking.ActiveTimer | null>(null);
  const [timerTick, setTimerTick] = useState(0);

  const headerTopPadding = insets.top + (Platform.OS === "android" ? spacing.xs : spacing.sm);
  const greetingName = user?.firstName ?? user?.name ?? user?.email ?? t("home.userFallback");
  const photoURL = user?.photoURL ?? null;

  const focusProject = useMemo(() => {
    if (lastUsedProjectId) {
      const hit = projects.find((p) => p.id === lastUsedProjectId);
      if (hit) return hit;
    }
    return projects[0] ?? null;
  }, [lastUsedProjectId, projects]);

  const resolveQuickNoteProject = useCallback((): ProjectDoc | null => {
    if (activeTimer?.projectId) {
      const timerProject = projects.find((p) => p.id === activeTimer.projectId);
      if (timerProject) return timerProject;
    }
    return focusProject;
  }, [activeTimer?.projectId, focusProject, projects]);

  const openQuickNoteFlow = useCallback(() => {
    if (projects.length === 0) {
      Alert.alert(t("common.error"), t("quickNote.noProjects"));
      return;
    }
    const preset = resolveQuickNoteProject();
    if (preset) {
      setQuickNoteProject(preset);
      setShowQuickNoteModal(true);
      return;
    }
    quickNoteSheetRef.current?.present();
  }, [projects.length, resolveQuickNoteProject, t]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void quickNotesService.syncOpenBusinessFieldNotesToFirestore(user.id);
    }, [user?.id])
  );

  const refreshActiveTimer = useCallback(async () => {
    if (!user?.id) return;
    const r = await timeTracking.getActiveTimerRefreshResult(user.id);
    if (r.ok) setActiveTimer(r.timer);
  }, [user?.id]);

  const openQuickTimeSheet = useCallback(() => {
    void refreshActiveTimer().finally(() => {
      quickTimeSheetRef.current?.present();
    });
  }, [refreshActiveTimer]);

  const enterAppTabs = useCallback(
    (opts?: {
      routes?: Array<{ name: string; params?: object }>;
      index?: number;
    }) => {
      const routes = opts?.routes ?? [{ name: "HomeMain" }];
      const index = opts?.index ?? Math.max(0, routes.length - 1);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "AppTabs",
              state: {
                routes: [
                  {
                    name: "Main",
                    state: {
                      routes: [
                        {
                          name: "Home",
                          state: {
                            routes,
                            index,
                          },
                        },
                      ],
                      index: 0,
                    },
                  },
                ],
                index: 0,
              },
            },
          ],
        })
      );
    },
    [navigation]
  );

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void refreshActiveTimer();
      AsyncStorage.getItem(LAST_USED_PROJECT_KEY).then((id) => {
        if (id) setLastUsedProjectId(id);
      });
      setProjectsLoading(true);
      listMyProjects(user.id)
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setProjectsLoading(false));
    }, [refreshActiveTimer, user?.id])
  );

  useEffect(() => {
    if (!activeTimer) return;
    const interval = setInterval(() => setTimerTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  const timeSubtitle = useMemo(() => {
    if (!activeTimer) return null;
    const ms =
      activeTimer.status === "paused"
        ? timeTracking.calculateActiveTimerPauseMs(activeTimer)
        : timeTracking.calculateActiveTimerWorkMs(activeTimer);
    return formatTimerHms(ms);
  }, [activeTimer, timerTick]);

  const openProblemProjectSheet = useCallback(() => {
    problemSheetRef.current?.present();
  }, []);

  const openPhotoProjectSheet = useCallback(() => {
    photoSheetRef.current?.present();
  }, []);

  const navigateToCreateProblem = useCallback(
    (project: ProjectDoc) => {
      void AsyncStorage.setItem(LAST_USED_PROJECT_KEY, project.id);
      // CreateProblem lives on the root stack (RootNavigator), not inside HomeStack.
      // Nesting it under Home > … silently drops the screen and lands on HomeMain.
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            {
              name: "AppTabs",
              state: {
                routes: [
                  {
                    name: "Main",
                    state: {
                      routes: [
                        {
                          name: "Home",
                          state: {
                            routes: [{ name: "HomeMain" }],
                            index: 0,
                          },
                        },
                      ],
                      index: 0,
                    },
                  },
                ],
                index: 0,
              },
            },
            {
              name: "CreateProblem",
              params: {
                projectId: project.id,
                projectName: project.name,
                projectType: project.projectType ?? "BUILD",
              },
            },
          ],
        })
      );
    },
    [navigation]
  );

  const navigateToAddWorkPhoto = useCallback(
    (
      project: ProjectDoc,
      opts?: {
        taskId?: string | null;
        phaseId?: string | null;
        photoType?: WorkPhotoType;
      }
    ) => {
      void AsyncStorage.setItem(LAST_USED_PROJECT_KEY, project.id);
      const taskId = opts?.taskId === null ? undefined : opts?.taskId ?? undefined;
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            {
              name: "AppTabs",
              state: {
                routes: [
                  {
                    name: "Main",
                    state: {
                      routes: [
                        {
                          name: "Home",
                          state: {
                            routes: [{ name: "HomeMain" }],
                            index: 0,
                          },
                        },
                      ],
                      index: 0,
                    },
                  },
                ],
                index: 0,
              },
            },
            {
              name: "AddWorkPhoto",
              params: {
                projectId: project.id,
                projectName: project.name,
                taskId,
                phaseId: opts?.phaseId ?? undefined,
                photoType: opts?.photoType ?? "progress",
                initialStep: "photo",
              },
            },
          ],
        })
      );
    },
    [navigation]
  );

  const onPhotoFlowSelect = useCallback(
    (selection: WorkPhotoFlowSelection) => {
      if (!photoPickerProject) return;
      if (selection.kind === "general") {
        navigateToAddWorkPhoto(photoPickerProject, { taskId: null, photoType: "progress" });
        return;
      }
      navigateToAddWorkPhoto(photoPickerProject, {
        taskId: selection.taskId,
        phaseId: selection.phaseId,
        photoType: "progress",
      });
    },
    [navigateToAddWorkPhoto, photoPickerProject]
  );

  const onPhotoDocumentProblem = useCallback(() => {
    if (!photoPickerProject) return;
    // CreateProblem handles its own photo attachments; taskId is not supported on that screen.
    navigateToCreateProblem(photoPickerProject);
  }, [navigateToCreateProblem, photoPickerProject]);

  const onQuickNoteProjectSelected = useCallback(
    (project: ProjectDoc) => {
      if (!projects.some((p) => p.id === project.id)) {
        Alert.alert(t("common.error"), t("quickNote.permissionDenied"));
        return;
      }
      setQuickNoteProject(project);
      setShowQuickNoteModal(true);
    },
    [projects, t]
  );

  const saveLauncherQuickNote = useCallback(
    async (text: string, attachments?: QuickNoteAttachment[], options?: { shareWithManager?: boolean }) => {
      if (!user?.id || !quickNoteProject) return;
      if (!projects.some((p) => p.id === quickNoteProject.id)) {
        Alert.alert(t("common.error"), t("quickNote.permissionDenied"));
        return;
      }

      const timerTaskId =
        activeTimer && activeTimer.projectId === quickNoteProject.id ? activeTimer.taskId ?? null : null;

      const resolvedOrgId =
        activeBusinessOrgId ??
        activeOrganization?.id ??
        quickNoteProject.orgId ??
        null;

      const shareWithManager =
        options?.shareWithManager !== false &&
        (options?.shareWithManager === true || isBusinessTeamProject(quickNoteProject));

      const { sharePublished } = await quickNotesService.addQuickNote(user.id, text, attachments, {
        sourceScreen: "mobile_launcher",
        createdByUserId: user.id,
        createdByName: user.firstName ?? user.name ?? null,
        orgId: resolvedOrgId,
        taskId: timerTaskId,
        sourceProjectId: quickNoteProject.id,
        sourceProjectName: quickNoteProject.name ?? null,
        shareWithManager,
      });

      void AsyncStorage.setItem(LAST_USED_PROJECT_KEY, quickNoteProject.id);
      showToast(t("quickNote.saved"));
      if (shareWithManager && sharePublished === false) {
        showToast(t("quickNote.shareSyncFailed"));
      }
    },
    [activeBusinessOrgId, activeOrganization?.id, activeTimer, projects, quickNoteProject, t, user]
  );

  const onPhotoProjectSelected = useCallback(
    async (project: ProjectDoc) => {
      setPhotoPickerProject(project);
      setPhotoTasksLoading(true);
      setPhotoPickerTasks([]);
      photoSheetRef.current?.dismiss();
      try {
        const tasks = await listTasksByProject(project.id);
        setPhotoPickerTasks(tasks);
      } catch {
        setPhotoPickerTasks([]);
      } finally {
        setPhotoTasksLoading(false);
        photoTaskSheetRef.current?.present();
      }
    },
    []
  );

  const handleAction = useCallback(
    (id: HomeQuickActionId) => {
      switch (id) {
        case "app":
          enterAppTabs();
          break;
        case "time":
          openQuickTimeSheet();
          break;
        case "quickNote":
          openQuickNoteFlow();
          break;
        case "tasks":
          if (!focusProject) {
            Alert.alert(t("common.error"), t("home.noProjects"));
            break;
          }
          enterAppTabs({
            routes: [
              { name: "HomeMain" },
              {
                name: "ProjectOverview",
                params: {
                  projectId: focusProject.id,
                  projectName: focusProject.name,
                },
              },
            ],
            index: 1,
          });
          break;
        case "photo":
          if (projects.length === 0) {
            Alert.alert(t("common.error"), t("home.noProjects"));
            break;
          }
          openPhotoProjectSheet();
          break;
        case "problem":
          if (projects.length === 0) {
            Alert.alert(t("common.error"), t("home.noProjects"));
            break;
          }
          openProblemProjectSheet();
          break;
        case "navigation": {
          const address = focusProject?.addressText?.trim();
          if (address) {
            void openInMaps(address);
          } else {
            Alert.alert(t("home.quickActions.navigation"), t("home.quickActions.noAddress"));
          }
          break;
        }
        default:
          enterAppTabs();
          break;
      }
    },
    [enterAppTabs, focusProject, openPhotoProjectSheet, openProblemProjectSheet, openQuickNoteFlow, openQuickTimeSheet, projects, t]
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerTopPadding, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          {photoURL ? (
            <Image source={{ uri: photoURL }} style={styles.headerAvatar} accessibilityIgnoresInvertColors />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarText}>{(greetingName || "?").slice(0, 2).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.headerCenter}>
            <Text style={styles.welcomeTitle} numberOfLines={1}>
              {t("home.greeting", { name: greetingName })}
            </Text>
            {activeOrganization?.name ? (
              <Text style={styles.companyLine} numberOfLines={1}>
                {activeOrganization.name}
              </Text>
            ) : (
              <Text style={styles.subtitle} numberOfLines={2}>
                {t("home.launcher.subtitle")}
              </Text>
            )}
          </View>
        </View>

        {projectsLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <HomeQuickActionsGrid
            actions={HOME_LAUNCHER_ACTIONS}
            columns={2}
            showTitle={false}
            onAction={handleAction}
            t={t}
            timeSubtitle={timeSubtitle}
            timeActive={!!activeTimer}
            timePaused={activeTimer?.status === "paused"}
          />
        )}
      </ScrollView>

      <QuickProblemProjectSheet
        sheetRef={problemSheetRef}
        projects={projects}
        onSelectProject={navigateToCreateProblem}
        t={t}
      />

      <QuickProblemProjectSheet
        sheetRef={photoSheetRef}
        projects={projects}
        titleKey="workPhoto.title"
        onSelectProject={onPhotoProjectSelected}
        t={t}
      />

      <QuickWorkPhotoTaskSheet
        sheetRef={photoTaskSheetRef}
        project={photoPickerProject}
        tasks={photoPickerTasks}
        loading={photoTasksLoading}
        userId={user?.id}
        activeTimerTaskId={
          activeTimer && photoPickerProject && activeTimer.projectId === photoPickerProject.id
            ? activeTimer.taskId ?? null
            : null
        }
        onSelect={onPhotoFlowSelect}
        onDocumentProblem={onPhotoDocumentProblem}
        t={t}
      />

      <QuickTimeModal
        sheetRef={quickTimeSheetRef}
        projects={projects}
        activeTimer={activeTimer}
        onRefreshActiveTimer={refreshActiveTimer}
        onTimerStarted={(name, timer) => {
          setActiveTimer(timer);
          showToast(t("home.timerStartedFor", { name }));
        }}
        onTimerUpdated={(timer) => {
          setActiveTimer(timer);
          if (timer) {
            void timeTracking.syncOrgLiveTimerFromActive(timer);
          }
        }}
        onSaved={() => {}}
        t={t}
      />

      <QuickProblemProjectSheet
        sheetRef={quickNoteSheetRef}
        projects={projects}
        titleKey="quickNote.selectProject"
        onSelectProject={onQuickNoteProjectSelected}
        t={t}
      />

      <QuickNoteModal
        visible={showQuickNoteModal}
        onClose={() => {
          setShowQuickNoteModal(false);
          setQuickNoteProject(null);
        }}
        onSaved={() => {}}
        onSubmit={saveLauncherQuickNote}
        placeholder={t("quickNotes.placeholder")}
        saveLabel={t("quickNotes.save")}
        showShareWithManager
        defaultShareWithManager
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    color: colors.textOnDark,
    fontWeight: "700",
    fontSize: 14,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textOnDark,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "rgba(255,255,255,0.78)",
    lineHeight: 18,
  },
  companyLine: {
    marginTop: 4,
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
  },
  loadingWrap: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
  },
});
