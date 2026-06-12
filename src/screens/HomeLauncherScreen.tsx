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
import { HOME_LAUNCHER_ACTIONS, type HomeQuickActionId } from "../lib/homeQuickActions";
import { openInMaps } from "../lib/maps";
import { listMyProjects, type ProjectDoc } from "../services/projects";
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
  const { activeOrganization } = useActiveOrg();
  const quickTimeSheetRef = useRef<BottomSheetModal | null>(null);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
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
    (homeScreen = "HomeMain", homeParams?: object) => {
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
                            routes: [{ name: homeScreen, params: homeParams }],
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

  const handleAction = useCallback(
    (id: HomeQuickActionId) => {
      switch (id) {
        case "app":
          enterAppTabs();
          break;
        case "time":
          openQuickTimeSheet();
          break;
        case "tasks":
          enterAppTabs("Tasks");
          break;
        case "photo":
          enterAppTabs("HomeMain", { deferQuickAction: "photo" });
          break;
        case "problem":
          enterAppTabs("HomeMain", { deferQuickAction: "problem" });
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
    [enterAppTabs, focusProject?.addressText, openQuickTimeSheet, t]
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
