/**
 * Vizualný prehľad dokončených míľnikov – čo ste dokončili v projekte.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import type { ProjectPhaseDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";

const DONE_COLOR = "#2e7d32";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function ProjectMilestonesOverviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const params = (route.params as { projectId?: string; projectName?: string; projectType?: string }) ?? {};
  const projectId = params.projectId ?? "";
  const projectName = params.projectName ?? "";
  const projectType = params.projectType ?? "";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);

  const isBuildOrManagement = projectType === "BUILD" || projectType === "MANAGEMENT";

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [ph, tk] = await Promise.all([
          isBuildOrManagement ? projectsService.listProjectPhases(projectId).catch(() => []) : [],
          tasksService.listTasksByProject(projectId).catch(() => []),
        ]);
        setPhases(ph);
        setTasks(tk);
      } catch (e) {
        console.error("[ProjectMilestonesOverview] Load error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, isBuildOrManagement]
  );

  useEffect(() => {
    load();
  }, [load]);

  const { completedPhases, phasesTotal, phasesDone, progressPct } = useMemo(() => {
    const activeTasks = tasks.filter((t) => t.isActive !== false);
    let phasesDone = 0;
    const phasesTotal = phases.length;
    const completedPhases: { phase: ProjectPhaseDoc; completedAt?: string; taskCount: number }[] = [];

    if (isBuildOrManagement && phases.length > 0) {
      for (const phase of phases) {
        const phaseTasks = activeTasks.filter((t) => t.phaseId === phase.id);
        if (phaseTasks.length > 0 && phaseTasks.every((t) => t.status === "DONE")) {
          phasesDone++;
          const lastDone = phaseTasks
            .map((t) => t.updatedAt || t.createdAt)
            .filter(Boolean)
            .sort()
            .pop();
          completedPhases.push({
            phase,
            completedAt: lastDone,
            taskCount: phaseTasks.length,
          });
        }
      }
      completedPhases.sort(
        (a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")
      );
    }

    const progressPct = phasesTotal > 0 ? Math.round((phasesDone / phasesTotal) * 100) : 0;

    return { completedPhases, phasesTotal, phasesDone, progressPct };
  }, [tasks, phases, isBuildOrManagement]);

  const goBack = () => (navigation as any).goBack();
  const goToProjectOverview = () =>
    (navigation as any).navigate("ProjectOverview", { projectId, projectName, projectType });

  if (!projectId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{t("projectOverview.projectNotFound")}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("milestonesOverview.title") || "Čo ste dokončili"}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        {/* Hero – projekt + progress */}
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="trophy" size={48} color="#f5a623" />
          </View>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {projectName || t("projects.noName")}
          </Text>
          <Text style={styles.heroSubtitle}>
            {t("milestonesOverview.subtitle") || "Dokončené fázy projektu"}
          </Text>

          {isBuildOrManagement && phasesTotal > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.circularProgressWrap}>
                <Svg width={140} height={140} style={styles.circularProgressSvg}>
                  <Circle
                    cx={70}
                    cy={70}
                    r={60}
                    stroke="rgba(255,255,255,0.25)"
                    strokeWidth={12}
                    fill="none"
                  />
                  <Circle
                    cx={70}
                    cy={70}
                    r={60}
                    stroke={DONE_COLOR}
                    strokeWidth={12}
                    fill="none"
                    strokeDasharray={`${2 * Math.PI * 60}`}
                    strokeDashoffset={2 * Math.PI * 60 * (1 - progressPct / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 70 70)"
                  />
                </Svg>
                <View style={styles.progressCenter}>
                  <Text style={styles.progressPct}>{progressPct}%</Text>
                  <Text style={styles.progressLabel}>
                    {phasesDone}/{phasesTotal} {t("projectOverviewDashboard.phases")}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Zoznam dokončených míľnikov */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("projectOverviewDashboard.milestones")}
          </Text>

          {completedPhases.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="flag-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {t("milestonesOverview.noCompleted") || "Zatiaľ žiadne dokončené fázy"}
              </Text>
              <Text style={styles.emptyHint}>
                {t("milestonesOverview.noCompletedHint") ||
                  "Dokončte všetky úlohy vo fáze a fáza sa tu zobrazí."}
              </Text>
            </View>
          ) : (
            completedPhases.map(({ phase, completedAt, taskCount }, index) => (
              <View key={phase.id} style={styles.milestoneCard}>
                <View style={styles.milestoneNumber}>
                  <Text style={styles.milestoneNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.milestoneContent}>
                  <View style={styles.milestoneCheck}>
                    <Ionicons name="checkmark-circle" size={28} color={DONE_COLOR} />
                  </View>
                  <View style={styles.milestoneText}>
                    <Text style={styles.milestoneName}>{phase.name}</Text>
                    <Text style={styles.milestoneMeta}>
                      {taskCount} {t("projectOverviewDashboard.tasks")}
                      {completedAt && ` • ${formatDate(completedAt)}`}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        <TouchableOpacity style={styles.ctaButton} onPress={goToProjectOverview} activeOpacity={0.8}>
          <Text style={styles.ctaButtonText}>
            {t("milestonesOverview.viewFullProject") || "Prehľad projektu"}
          </Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  headerBack: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroIconWrap: {
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textOnDark,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginTop: spacing.xs,
  },
  progressSection: {
    marginTop: spacing.lg,
  },
  circularProgressWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  circularProgressSvg: {
    transform: [{ scale: 1 }],
  },
  progressCenter: {
    position: "absolute",
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  progressPct: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.textOnDark,
  },
  progressLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textOnDark,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  emptyCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radius,
    padding: spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.9)",
    marginTop: spacing.md,
  },
  emptyHint: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    marginTop: spacing.xs,
    textAlign: "center",
  },
  milestoneCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  milestoneNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  milestoneNumberText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  milestoneContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  milestoneCheck: {
    marginRight: spacing.sm,
  },
  milestoneText: {
    flex: 1,
  },
  milestoneName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textOnDark,
  },
  milestoneMeta: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    marginTop: 2,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  errorText: {
    color: colors.textOnDark,
    padding: spacing.lg,
  },
});
