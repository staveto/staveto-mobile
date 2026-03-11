/**
 * Project Overview Dashboard – KPI summary screen
 * Shows Hero, Tasks KPI, Problems, Diary, Photos, Expenses cards.
 * Client-side KPI computation, no backend changes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
  Share,
  Alert,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import * as problemsService from "../services/problems";
import * as constructionDiaryService from "../services/constructionDiary";
import * as expensesService from "../services/expenses";
import * as attachmentsService from "../services/attachments";
import * as storageSmart from "../services/storageSmart";
import * as timeTracking from "../services/timeTracking";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { ProjectShareCard } from "../components/ProjectShareCard";
import { exportProjectAsProtocol } from "../services/projectProtocolExport";
import type { TaskDoc } from "../services/tasks";
import type { ProjectPhaseDoc } from "../services/projects";
import type { DiaryEntryDoc } from "../services/constructionDiary";
import type { ExpenseDoc } from "../services/expenses";
import type { AttachmentDoc } from "../services/attachments";
import type { ProblemDoc } from "../services/problems";

const TODAY = new Date().toISOString().slice(0, 10);

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export function ProjectOverviewDashboardScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user } = useAuth();
  const params = (route.params as { projectId?: string; projectName?: string; projectType?: string }) ?? {};
  const projectId = params.projectId ?? "";
  const projectName = params.projectName ?? "";
  const projectType = params.projectType ?? "";
  const { isOffline, isPoorNetwork } = useOnlineStatus();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [project, setProject] = useState<projectsService.ProjectDoc | null>(null);
  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [diaryEntries, setDiaryEntries] = useState<DiaryEntryDoc[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDoc[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [shareCardRef, setShareCardRef] = useState<View | null>(null);
  const [sharing, setSharing] = useState(false);
  const [projectHoursMinutes, setProjectHoursMinutes] = useState<number>(0);
  const [canSeeHours, setCanSeeHours] = useState(false);

  const isBuildOrManagement = projectType === "BUILD" || projectType === "MANAGEMENT";

  const load = useCallback(
    async (isRefresh = false) => {
      if (!projectId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const [proj, ph, tk, prb, diary, exp, atts] = await Promise.all([
          projectsService.getProject(projectId).catch(() => null),
          isBuildOrManagement ? projectsService.listProjectPhases(projectId).catch(() => []) : Promise.resolve([]),
          tasksService.listTasksByProject(projectId).catch(() => []),
          problemsService.listProblems(projectId).catch(() => []),
          constructionDiaryService.listDiaryEntries(projectId).catch(() => []),
          expensesService.listExpensesByProject(projectId).catch(() => []),
          attachmentsService.listAttachments(projectId).catch(() => []),
        ]);
        setProject(proj ?? null);
        setPhases(ph);
        setTasks(tk);
        setProblems(prb);
        setDiaryEntries(diary);
        setExpenses(exp);
        setAttachments(atts);

        const imageAtts = atts.filter((a) => a.fileType === "image").slice(0, 6);
        const urlMap = new Map<string, string>();
        const onlineStatus = { isOffline, isPoorNetwork };
        for (const a of imageAtts) {
          const cached = (a as AttachmentDoc & { downloadURL?: string }).downloadURL;
          if (cached) {
            urlMap.set(a.id, cached);
            continue;
          }
          try {
            const url = await storageSmart.getDownloadUrlSmart(a.storagePath, onlineStatus);
            if (url) urlMap.set(a.id, url);
          } catch {
            // skip
          }
        }
        setPhotoUrls(urlMap);

        // Hours spent on project (owner or editor with time tracking)
        if (user?.id && proj?.ownerId) {
          try {
            const access = await fetchProjectAccess(projectId, user.id, proj?.ownerId);
            if (access.isOwner || access.canWriteTime) {
              setCanSeeHours(true);
              const mins = await timeTracking.getProjectTotalMinutes(projectId);
              setProjectHoursMinutes(mins);
            } else {
              setCanSeeHours(false);
              setProjectHoursMinutes(0);
            }
          } catch {
            setCanSeeHours(false);
            setProjectHoursMinutes(0);
          }
        } else {
          setCanSeeHours(false);
          setProjectHoursMinutes(0);
        }
      } catch (e) {
        console.error("[ProjectOverviewDashboard] Load error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId, isBuildOrManagement, isOffline, isPoorNetwork, user?.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const kpis = useMemo(() => {
    const activeTasks = tasks.filter((t) => t.isActive !== false);
    const tasksTotal = activeTasks.length;
    const tasksDone = activeTasks.filter((t) => t.status === "DONE").length;
    const tasksOpen = activeTasks.filter((t) =>
      ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(t.status)
    ).length;
    const tasksOverdue = activeTasks.filter(
      (t) => t.dueDate && t.dueDate < TODAY && t.status !== "DONE"
    ).length;

    let phasesDone = 0;
    let phasesTotal = phases.length;
    if (isBuildOrManagement && phases.length > 0) {
      for (const phase of phases) {
        const phaseTasks = activeTasks.filter((t) => t.phaseId === phase.id);
        if (phaseTasks.length > 0 && phaseTasks.every((t) => t.status === "DONE")) {
          phasesDone++;
        }
      }
    }

    const openCount = problems.filter((p) => p.status === "open").length;
    const inProgressCount = problems.filter((p) => p.status === "in_progress").length;
    const fixedCount = problems.filter((p) => p.status === "fixed").length;
    const verifiedCount = problems.filter((p) => p.status === "verified").length;

    const lastDiary = [...diaryEntries].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ).slice(0, 2);

    const imageAtts = attachments.filter((a) => a.fileType === "image");
    const lastPhotos = imageAtts.slice(0, 6);

    let expensesTotal = 0;
    let expensesThisMonth = 0;
    const now = new Date();
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    for (const e of expenses) {
      const amt = e.amount ?? 0;
      expensesTotal += amt;
      if (e.date >= thisMonthStart) expensesThisMonth += amt;
    }

    const categoryTotals: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category ?? "OTHER";
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + (e.amount ?? 0);
    }
    const topCategories = Object.entries(categoryTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    let statusLabel = "projectOverviewDashboard.noData";
    let statusColor = colors.textMuted;
    if (tasksTotal === 0) {
      statusLabel = "projectOverviewDashboard.noData";
    } else if (tasksOverdue > 0) {
      statusLabel = "projectOverviewDashboard.delayed";
      statusColor = colors.error;
    } else if (tasksDone / tasksTotal >= 0.7) {
      statusLabel = "projectOverviewDashboard.onTrack";
      statusColor = "#2e7d32";
    } else {
      statusLabel = "projectOverviewDashboard.attention";
      statusColor = colors.primary;
    }

    const progressPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;

    const mostRecentOpenProblem = problems
      .filter((p) => p.status === "open")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    const completedPhases: { phase: ProjectPhaseDoc; completedAt?: string }[] = [];
    if (isBuildOrManagement && phases.length > 0) {
      for (const phase of phases) {
        const phaseTasks = activeTasks.filter((t) => t.phaseId === phase.id);
        if (phaseTasks.length > 0 && phaseTasks.every((t) => t.status === "DONE")) {
          const lastDone = phaseTasks
            .map((t) => t.updatedAt || t.createdAt)
            .filter(Boolean)
            .sort()
            .pop();
          completedPhases.push({ phase, completedAt: lastDone });
        }
      }
      completedPhases.sort(
        (a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")
      );
    }

    return {
      tasksTotal,
      tasksDone,
      tasksOpen,
      tasksOverdue,
      phasesTotal,
      phasesDone,
      openCount,
      inProgressCount,
      fixedCount,
      verifiedCount,
      lastDiary,
      lastPhotos,
      diaryCount: diaryEntries.length,
      photoCount: imageAtts.length,
      expensesTotal,
      expensesThisMonth,
      topCategories,
      statusLabel,
      statusColor,
      progressPct,
      mostRecentOpenProblem,
      completedPhases: completedPhases.slice(0, 3),
    };
  }, [
    tasks,
    phases,
    problems,
    diaryEntries,
    expenses,
    attachments,
    isBuildOrManagement,
  ]);

  const handleShare = useCallback(async () => {
    if (!shareCardRef) return;
    setSharing(true);
    try {
      const uri = await captureRef(shareCardRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width: 1080,
        height: 1920,
      });
      await Share.share({
        url: uri,
        message: `${projectName} – ${t("projectOverviewDashboard.title")}`,
        title: projectName,
      });
    } catch (e) {
      console.warn("[ProjectOverviewDashboard] Share failed:", e);
      Alert.alert(t("common.error"), t("projectOverviewDashboard.shareFailed") ?? "Nepodarilo sa zdieľať.");
    } finally {
      setSharing(false);
    }
  }, [shareCardRef, projectName, t]);

  const handleExportProtocol = useCallback(async () => {
    setSharing(true);
    try {
      const result = await exportProjectAsProtocol(projectId, {
        title: t("projectOverview.exportProtocol.title"),
        exportDate: t("projectOverview.exportProtocol.exportDate"),
        status: t("projectOverview.exportProtocol.status"),
        tasks: t("projectOverview.exportProtocol.tasks"),
        expenses: t("projectOverview.exportProtocol.expenses"),
        diary: t("projectOverview.exportProtocol.diary"),
        problems: t("projectOverview.exportProtocol.problems"),
        phase: t("projectOverview.exportProtocol.phase"),
        task: t("projectOverview.exportProtocol.task"),
        responsible: t("projectOverview.exportProtocol.responsible"),
        photos: t("projectOverview.exportProtocol.photos"),
        signature: t("projectOverview.exportProtocol.signature"),
        statusLabel: t("projectOverview.exportProtocol.statusLabel"),
        date: t("projectOverview.exportProtocol.date"),
        amount: t("projectOverview.exportProtocol.amount"),
        description: t("projectOverview.exportProtocol.description"),
        total: t("projectOverview.exportProtocol.total"),
        footer: t("projectOverview.exportProtocol.footer"),
      });
      if (!result.ok) {
        Alert.alert(t("common.error"), result.error ?? "Nepodarilo sa exportovať.");
      }
    } finally {
      setSharing(false);
    }
  }, [projectId, t]);

  const handleShareMenu = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t("common.cancel"), t("projectOverviewDashboard.shareAsImage"), t("projectOverview.exportProtocol.title")],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) handleShare();
          else if (buttonIndex === 2) handleExportProtocol();
        }
      );
    } else {
      Alert.alert(
        t("projectOverviewDashboard.exportOrShare"),
        "",
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("projectOverviewDashboard.shareAsImage"), onPress: handleShare },
          { text: t("projectOverview.exportProtocol.title"), onPress: handleExportProtocol },
        ]
      );
    }
  }, [handleShare, handleExportProtocol, t]);

  const goBack = () => (navigation as any).goBack();
  const goToProblems = () =>
    (navigation as any).navigate("ProblemsList", { projectId, projectName, projectType });
  const goToExpenses = () =>
    (navigation as any).navigate("ProjectOverview", {
      projectId,
      projectName,
      projectType,
      expandExpensesSection: true,
    });
  const goToDiary = () =>
    (navigation as any).navigate("ProjectDiaryOverview", {
      projectId,
      projectName,
      projectType,
    });
  const goToPhotos = () =>
    (navigation as any).navigate("ProjectPhotos", { projectId, projectName });

  const goToMilestonesOverview = () =>
    (navigation as any).navigate("ProjectMilestonesOverview", {
      projectId,
      projectName,
      projectType,
    });

  const problemsTitle =
    projectType === "MAINTENANCE"
      ? t("problems.titlePoruchy")
      : projectType === "TRADE" || projectType === "RESIDENTIAL"
        ? t("problems.titleReklamacie") || t("problems.title")
        : t("problems.titleDefekty") || t("problems.title");

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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={24} color={colors.textOnDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("projectOverviewDashboard.title")}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleShareMenu}
            disabled={sharing}
            style={styles.headerIcon}
          >
            {sharing ? (
              <ActivityIndicator size="small" color={colors.textOnDark} />
            ) : (
              <Ionicons name="share-outline" size={22} color={colors.textOnDark} />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => load(true)} style={styles.headerIcon}>
            <Ionicons name="refresh" size={22} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        {/* Hidden Share Card for capture */}
        <View style={styles.offscreen} collapsable={false}>
          <ProjectShareCard
            ref={setShareCardRef}
            projectName={projectName}
            address={project?.addressText ?? ""}
            statusLabel={t(kpis.statusLabel)}
            progressPct={kpis.progressPct}
            tasksDone={kpis.tasksDone}
            tasksTotal={kpis.tasksTotal}
            tasksOverdue={kpis.tasksOverdue}
            openProblems={kpis.openCount}
            expensesTotal={kpis.expensesTotal}
            lastPhotos={kpis.lastPhotos.map((a) => photoUrls.get(a.id)).filter(Boolean) as string[]}
          />
        </View>

        {/* Hero Card */}
        <View style={[styles.card, styles.heroCard]}>
          <Text style={styles.heroProjectName} numberOfLines={1}>
            {projectName || t("projects.noName")}
          </Text>
          {project?.addressText && (
            <Text style={styles.heroAddress} numberOfLines={1}>
              {project.addressText}
            </Text>
          )}
          <View style={[styles.statusPill, { backgroundColor: kpis.statusColor }]}>
            <Text style={styles.statusPillText}>{t(kpis.statusLabel)}</Text>
          </View>
          <View style={styles.heroProgressContainer}>
            <View style={styles.circularProgressWrap}>
              <Svg width={88} height={88} style={styles.circularProgressSvg}>
                <Circle
                  cx={44}
                  cy={44}
                  r={38}
                  stroke="rgba(0,0,0,0.08)"
                  strokeWidth={8}
                  fill="none"
                />
                <Circle
                  cx={44}
                  cy={44}
                  r={38}
                  stroke={kpis.statusColor}
                  strokeWidth={8}
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 38}`}
                  strokeDashoffset={2 * Math.PI * 38 * (1 - kpis.progressPct / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 44 44)"
                />
              </Svg>
              <View style={styles.heroProgressCenter}>
                <Text style={styles.heroProgressPct}>{kpis.progressPct}%</Text>
                <Text style={styles.heroProgressLabel}>{t("projectOverviewDashboard.completed")}</Text>
              </View>
            </View>
            <View style={[styles.progressBar, { backgroundColor: "rgba(0,0,0,0.06)" }]}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.min(100, kpis.progressPct)}%`,
                    backgroundColor: kpis.statusColor,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {kpis.tasksDone} {t("projectOverviewDashboard.done")} / {kpis.tasksTotal}{" "}
              {t("projectOverviewDashboard.tasks")}
            </Text>
          </View>
        </View>

        {/* Photos Card - Hero layout */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("projectOverviewDashboard.photosTitle")}</Text>
          <View style={styles.photoHeroGrid}>
            {kpis.lastPhotos.length > 0 ? (
              <>
                <View style={styles.photoHeroMain}>
                  {(() => {
                    const url = photoUrls.get(kpis.lastPhotos[0].id);
                    return url ? (
                      <Image source={{ uri: url }} style={styles.photoThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.photoThumb, styles.photoPlaceholder]}>
                        <Ionicons name="image-outline" size={40} color={colors.textMuted} />
                      </View>
                    );
                  })()}
                  <View style={styles.photoOverlay}>
                    <Ionicons name="images" size={16} color="#fff" />
                    <Text style={styles.photoOverlayText}>{kpis.photoCount}</Text>
                  </View>
                </View>
                <View style={styles.photoHeroSide}>
                  {[1, 2].map((i) => {
                    const att = kpis.lastPhotos[i];
                    if (!att) {
                      return (
                        <View key={`empty-${i}`} style={[styles.photoHeroSideCell, styles.photoPlaceholder]}>
                          <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                        </View>
                      );
                    }
                    const url = photoUrls.get(att.id);
                    return (
                      <View key={att.id} style={styles.photoHeroSideCell}>
                        {url ? (
                          <Image source={{ uri: url }} style={styles.photoThumb} resizeMode="cover" />
                        ) : (
                          <View style={[styles.photoThumb, styles.photoPlaceholder]}>
                            <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </>
            ) : (
              <View style={[styles.photoHeroEmpty, styles.photoPlaceholder]}>
                <Ionicons name="images-outline" size={48} color={colors.textMuted} />
                <Text style={styles.photoCount}>{t("taskDetail.attachments")}: 0</Text>
              </View>
            )}
          </View>
          {kpis.lastPhotos.length > 0 && (
            <Text style={styles.photoCount}>
              {t("taskDetail.attachments")}: {kpis.photoCount}
            </Text>
          )}
          <TouchableOpacity style={styles.cardButton} onPress={goToPhotos}>
            <Text style={styles.cardButtonText}>{t("projectOverviewDashboard.viewAllPhotos")}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Problems Card */}
        <View style={[styles.card, kpis.openCount > 0 && styles.problemsCardAlert]}>
          <Text style={styles.cardTitle}>{problemsTitle}</Text>
          <View style={styles.problemsRow}>
            <View style={styles.problemBadge}>
              <View style={[styles.problemDot, { backgroundColor: colors.error }]} />
              <Text style={styles.problemCount}>{kpis.openCount}</Text>
              <Text style={styles.problemLabel}>{t("projectOverviewDashboard.problemOpen")}</Text>
            </View>
            <View style={styles.problemBadge}>
              <View style={[styles.problemDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.problemCount}>{kpis.inProgressCount}</Text>
              <Text style={styles.problemLabel}>{t("projectOverviewDashboard.problemInProgress")}</Text>
            </View>
            <View style={styles.problemBadge}>
              <View style={[styles.problemDot, { backgroundColor: "#2e7d32" }]} />
              <Text style={styles.problemCount}>{kpis.fixedCount}</Text>
              <Text style={styles.problemLabel}>{t("projectOverviewDashboard.problemFixed")}</Text>
            </View>
            <View style={styles.problemBadge}>
              <View style={[styles.problemDot, { backgroundColor: "#2e7d32" }]} />
              <Text style={styles.problemCount}>{kpis.verifiedCount}</Text>
              <Text style={styles.problemLabel}>{t("projectOverviewDashboard.problemVerified")}</Text>
            </View>
          </View>
          {kpis.mostRecentOpenProblem && (
            <Text style={styles.mostRecentProblem} numberOfLines={2}>
              {kpis.mostRecentOpenProblem.shortDescription}
            </Text>
          )}
          <TouchableOpacity style={styles.cardButton} onPress={goToProblems}>
            <Text style={styles.cardButtonText}>{t("projectOverviewDashboard.viewProblems")}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* KPI Row - task done */}
        <View style={styles.card}>
          <View style={styles.kpiRow}>
            <View style={styles.kpiTile}>
              <Ionicons name="checkmark-circle" size={24} color="#2e7d32" />
              <Text style={styles.kpiValue}>{kpis.tasksDone}</Text>
              <Text style={styles.kpiLabel}>{t("projectOverviewDashboard.done")}</Text>
            </View>
            <View style={styles.kpiTile}>
              <Ionicons name="time-outline" size={24} color={colors.primary} />
              <Text style={styles.kpiValue}>{kpis.tasksOpen}</Text>
              <Text style={styles.kpiLabel}>{t("projectOverviewDashboard.open")}</Text>
            </View>
            <View style={styles.kpiTile}>
              <Ionicons name="warning-outline" size={24} color={colors.error} />
              <Text style={styles.kpiValue}>{kpis.tasksOverdue}</Text>
              <Text style={styles.kpiLabel}>{t("projectOverviewDashboard.overdue")}</Text>
            </View>
            {isBuildOrManagement && (
              <View style={styles.kpiTile}>
                <Ionicons name="layers-outline" size={24} color={colors.primary} />
                <Text style={styles.kpiValue}>
                  {kpis.phasesDone}/{kpis.phasesTotal}
                </Text>
                <Text style={styles.kpiLabel}>{t("projectOverviewDashboard.phases")}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Diary Card – klikateľné → vizuálny prehľad */}
        <TouchableOpacity
          style={styles.card}
          onPress={goToDiary}
          activeOpacity={0.95}
        >
          <View style={styles.diaryCardHeader}>
            <Text style={styles.cardTitle}>{t("projectOverviewDashboard.diaryTitle")}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </View>
          {kpis.lastDiary.length === 0 ? (
            <Text style={styles.emptyText}>{t("projectOverview.noDiaryEntries")}</Text>
          ) : (
            kpis.lastDiary.map((entry) => (
              <View key={entry.id} style={styles.diaryEntry}>
                <Text style={styles.diaryDate}>{formatDate(entry.date)}</Text>
                <Text style={styles.diaryDesc} numberOfLines={2}>
                  {entry.workDescription}
                </Text>
                {entry.weather && (
                  <Text style={styles.diaryMeta}>
                    {t("projectOverview.weather")}: {entry.weather}
                  </Text>
                )}
                {entry.workers && (
                  <Text style={styles.diaryMeta}>
                    {t("projectOverview.workers")}: {entry.workers}
                  </Text>
                )}
                {entry.attachments && entry.attachments.length > 0 && (
                  <Ionicons name="image" size={14} color={colors.primary} style={{ marginTop: 2 }} />
                )}
              </View>
            ))
          )}
          <View style={styles.cardButton}>
            <Text style={styles.cardButtonText}>{t("projectOverviewDashboard.openDiary")}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </View>
        </TouchableOpacity>

        {/* Milestones Card - dokončené fázy (klikateľné → vizuálny prehľad) */}
        {isBuildOrManagement && kpis.completedPhases.length > 0 && (
          <TouchableOpacity
            style={styles.card}
            onPress={goToMilestonesOverview}
            activeOpacity={0.95}
          >
            <View style={styles.milestonesCardHeader}>
              <Text style={styles.cardTitle}>{t("projectOverviewDashboard.milestones")}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </View>
            {kpis.completedPhases.map(({ phase }) => (
              <View key={phase.id} style={styles.milestoneRow}>
                <View style={styles.milestoneCheck}>
                  <Ionicons name="checkmark-circle" size={24} color="#2e7d32" />
                </View>
                <Text style={styles.milestoneName}>{phase.name}</Text>
                <Text style={styles.milestoneLabel}>{t("projectOverviewDashboard.phaseCompleted")}</Text>
              </View>
            ))}
          </TouchableOpacity>
        )}

        {/* Hours spent on project */}
        {canSeeHours && projectHoursMinutes > 0 && (
          <TouchableOpacity
            style={styles.card}
            onPress={() => (navigation as any).navigate("AttendanceReportScreen")}
            activeOpacity={0.95}
          >
            <View style={styles.diaryCardHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Ionicons name="time-outline" size={20} color={colors.primary} />
                <Text style={styles.cardTitle}>{t("projectOverview.hoursSpentOnProject")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </View>
            <View style={styles.expenseRow}>
              <Text style={styles.expenseLabel}>{t("projectOverviewDashboard.total")}:</Text>
              <Text style={styles.expenseValue}>
                {Math.floor(projectHoursMinutes / 60)} {t("time.hoursShort")}
              </Text>
            </View>
            <View style={styles.cardButton}>
              <Text style={styles.cardButtonText}>{t("attendance.reportTitle")}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </View>
          </TouchableOpacity>
        )}

        {/* Expenses Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("projectOverview.expenses")}</Text>
          <View style={styles.expenseRow}>
            <Text style={styles.expenseLabel}>{t("projectOverviewDashboard.total") || "Spolu"}:</Text>
            <Text style={styles.expenseValue}>
              {kpis.expensesTotal.toLocaleString("sk-SK")} €
            </Text>
          </View>
          <View style={styles.expenseRow}>
            <Text style={styles.expenseLabel}>{t("projectOverviewDashboard.thisMonth")}:</Text>
            <Text style={styles.expenseValue}>
              {kpis.expensesThisMonth.toLocaleString("sk-SK")} €
            </Text>
          </View>
          {kpis.topCategories.length > 0 && (
            <View style={styles.categoryList}>
              {kpis.topCategories.map(([cat, amt]) => (
                <Text key={cat} style={styles.categoryItem}>
                  {cat === "MATERIAL" ? t("expense.typeMaterial") : cat === "WORK" ? t("expense.typeWork") : cat === "TRAVEL" ? t("expense.typeTravel") || "Cesty" : cat}: {amt.toLocaleString("sk-SK")} €
                </Text>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.cardButton} onPress={goToExpenses}>
            <Text style={styles.cardButtonText}>{t("projectOverviewDashboard.openExpenses")}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
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
  errorText: {
    color: colors.textOnDark,
    fontSize: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  headerBack: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: colors.textOnDark,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  headerIcon: {
    padding: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  offscreen: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 360,
    height: 640,
    opacity: 0,
    pointerEvents: "none",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  milestonesCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  diaryCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  problemsCardAlert: {
    borderTopWidth: 3,
    borderTopColor: colors.error,
  },
  heroCard: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  heroProjectName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  heroAddress: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    marginTop: spacing.xs,
  },
  statusPillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  circularProgressWrap: {
    width: 88,
    height: 88,
    alignSelf: "center",
    marginTop: spacing.xs,
  },
  heroProgressCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  heroProgressPct: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  heroProgressLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  progressBar: {
    marginTop: spacing.sm,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.1)",
    overflow: "hidden",
    flexDirection: "row",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  progressPct: {
    position: "absolute",
    alignSelf: "center",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
  },
  progressLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  kpiTile: {
    flex: 1,
    minWidth: 70,
    alignItems: "center",
    padding: spacing.sm,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.xs,
  },
  kpiLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  problemsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  problemBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  problemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  problemCount: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  problemLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  mostRecentProblem: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: "italic",
    marginBottom: spacing.sm,
  },
  diaryEntry: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  diaryDate: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  diaryDesc: {
    fontSize: 13,
    color: colors.text,
    marginTop: 2,
  },
  diaryMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoHeroGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 140,
  },
  photoHeroMain: {
    flex: 2,
    aspectRatio: 1,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  photoHeroSide: {
    flex: 1,
    gap: spacing.sm,
  },
  photoHeroSideCell: {
    flex: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  photoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  photoOverlayText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  photoHeroEmpty: {
    flex: 1,
    minHeight: 120,
    borderRadius: 8,
  },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  milestoneCheck: {
    marginRight: spacing.sm,
  },
  milestoneName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  milestoneLabel: {
    fontSize: 12,
    color: "#2e7d32",
    fontWeight: "600",
  },
  photoCell: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  photoThumb: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    backgroundColor: "rgba(0,0,0,0.05)",
    justifyContent: "center",
    alignItems: "center",
  },
  photoCount: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  expenseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  expenseLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  expenseValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  categoryList: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  categoryItem: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  cardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  cardButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
});
