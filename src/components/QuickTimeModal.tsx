import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Animated,
  ScrollView,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";
import { toYmd } from "../utils/date";
import * as timeTracking from "../services/timeTracking";
import type { ActiveTimer, GetActiveTimerReadOpts } from "../services/timeTracking";
import type { ProjectDoc } from "../services/projects";
import { useAuth } from "../context/AuthContext";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";
/** Matches home timer “running” accent. */
const RUNNING_TIMER_GREEN = "#22c55e";
/** Paused-state accent — neutral amber so it reads as "stopped between segments". */
const PAUSED_TIMER_AMBER = "#f59e0b";

/** HH:MM:SS from raw elapsed ms — used so paused timers can show frozen accumulated time. */
function formatElapsedMs(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Project-only: phase/task are always null in Firestore. */
const NO_PHASE_TASK = {
  phaseId: null as string | null,
  phaseNameSnapshot: null as string | null,
  taskId: null as string | null,
  taskTitleSnapshot: null as string | null,
};

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  projects: ProjectDoc[];
  activeTimer: ActiveTimer | null;
  onRefreshActiveTimer: (readOpts?: GetActiveTimerReadOpts) => void | Promise<void>;
  /** Called right after start succeeds with the timer snapshot (UI updates before Firestore read round-trip). */
  onTimerStarted?: (projectName: string, timer: ActiveTimer) => void;
  /** Called after pause/resume so the parent can update without waiting for a Firestore read. */
  onTimerUpdated?: (timer: ActiveTimer | null) => void;
  onSaved?: () => void;
  t: (key: string, params?: Record<string, string>) => string;
};

export function QuickTimeModal({
  sheetRef,
  projects,
  activeTimer,
  onRefreshActiveTimer,
  onTimerStarted,
  onTimerUpdated,
  onSaved,
  t,
}: Props) {
  const [selectedProject, setSelectedProject] = useState<ProjectDoc | null>(null);
  /** When true, show search + list (pick or change project). When false, show compact selected row + Change. */
  const [pickingProject, setPickingProject] = useState(true);
  const [mode, setMode] = useState<"timer" | "manual">("timer");
  const [manualDate, setManualDate] = useState(new Date());
  const [manualHours, setManualHours] = useState("1");
  const [manualMinutes, setManualMinutes] = useState("0");
  const [manualNote, setManualNote] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [elapsedDisplay, setElapsedDisplay] = useState("");
  const [workDisplay, setWorkDisplay] = useState("");
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const isProjectAssignedToMe = useCallback(
    (project: ProjectDoc) => {
      const uid = user?.id;
      if (!uid) return false;
      return (project.assignedMemberIds ?? []).includes(uid) || project.isSharedToMe === true;
    },
    [user?.id]
  );

  const filteredProjects = React.useMemo(() => {
    const active = projects.filter((p) => !p.archivedAt);
    const q = projectSearch.trim().toLowerCase();
    if (!q) return active;
    return active.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const showProjectPicker = !activeTimer && (!selectedProject || pickingProject);
  const showSelectedProjectRow = !activeTimer && selectedProject && !pickingProject;

  /** Running: main clock = work time. Paused: main clock = pause duration; work time shown below. */
  useEffect(() => {
    if (!activeTimer) return;
    const normalized = timeTracking.normalizeActiveTimer(activeTimer);
    const update = () => {
      if (normalized.status === "paused") {
        setElapsedDisplay(formatElapsedMs(timeTracking.calculateActiveTimerPauseMs(normalized)));
        setWorkDisplay(formatElapsedMs(timeTracking.calculateActiveTimerWorkMs(normalized)));
      } else {
        setElapsedDisplay(formatElapsedMs(timeTracking.calculateActiveTimerWorkMs(normalized)));
        setWorkDisplay("");
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  const hadActiveTimerRef = useRef(false);
  useEffect(() => {
    if (activeTimer && !hadActiveTimerRef.current) {
      hadActiveTimerRef.current = true;
      const id = requestAnimationFrame(() => sheetRef.current?.snapToIndex(1));
      return () => cancelAnimationFrame(id);
    }
    if (!activeTimer) {
      hadActiveTimerRef.current = false;
    }
  }, [activeTimer, sheetRef]);

  useEffect(() => {
    if (!activeTimer || activeTimer.status === "paused") {
      rotateAnim.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [activeTimer, rotateAnim]);

  const handleStart = useCallback(async () => {
    if (!selectedProject) {
      Alert.alert(t("time.errorNoProject"));
      return;
    }
    const projectName = selectedProject.name ?? "Project";
    setLoading(true);
    try {
      const timer = await timeTracking.startTimer(selectedProject.id, projectName, {
        ...NO_PHASE_TASK,
        projectOwnerId: selectedProject.ownerId ?? null,
        assignedToMe: isProjectAssignedToMe(selectedProject),
        orgId: selectedProject.orgId ?? null,
      });
      onTimerStarted?.(projectName, timer);
      /** Default (local) reads include pending writes — works offline; avoid server-only reads here. */
      for (let attempt = 0; attempt < 3; attempt++) {
        await Promise.resolve(onRefreshActiveTimer());
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      /** Leave sheet open so the running clock + Stop stay visible; user dismisses when done. */
    } catch (err) {
      Alert.alert(
        "Chyba",
        err instanceof Error ? err.message : t("time.errorNoPermission")
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProject, isProjectAssignedToMe, onRefreshActiveTimer, onTimerStarted, sheetRef, t]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await timeTracking.stopTimer(undefined, { knownActive: activeTimer ?? undefined });
      onRefreshActiveTimer();
      onSaved?.();
      sheetRef.current?.dismiss();
    } catch (err) {
      Alert.alert("Chyba", err instanceof Error ? err.message : "Nepodarilo sa zastaviť časovač.");
    } finally {
      setLoading(false);
    }
  }, [activeTimer, onRefreshActiveTimer, onSaved, sheetRef]);

  const handlePause = useCallback(async () => {
    if (!activeTimer || activeTimer.status === "paused") return;
    const optimisticNow = new Date().toISOString();
    const workMs = timeTracking.calculateActiveTimerWorkMs(activeTimer, optimisticNow);
    onTimerUpdated?.(
      timeTracking.normalizeActiveTimer({
        ...activeTimer,
        status: "paused",
        runningSince: null,
        accumulatedMs: workMs,
        pauses: [...(activeTimer.pauses ?? []), { startedAt: optimisticNow }],
      })
    );
    setLoading(true);
    try {
      const timer = await timeTracking.pauseTimer();
      if (timer) {
        onTimerUpdated?.(timer);
      } else {
        await Promise.resolve(onRefreshActiveTimer());
      }
    } catch (err) {
      await Promise.resolve(onRefreshActiveTimer());
      Alert.alert("Chyba", err instanceof Error ? err.message : "Nepodarilo sa pozastaviť časovač.");
    } finally {
      setLoading(false);
    }
  }, [activeTimer, onRefreshActiveTimer, onTimerUpdated]);

  const handleResume = useCallback(async () => {
    setLoading(true);
    try {
      const timer = await timeTracking.resumeTimer();
      if (timer) {
        onTimerUpdated?.(timer);
      } else {
        await Promise.resolve(onRefreshActiveTimer());
      }
    } catch (err) {
      await Promise.resolve(onRefreshActiveTimer());
      Alert.alert("Chyba", err instanceof Error ? err.message : "Nepodarilo sa obnoviť časovač.");
    } finally {
      setLoading(false);
    }
  }, [onRefreshActiveTimer, onTimerUpdated]);

  const handleManualSave = useCallback(async () => {
    if (!selectedProject) {
      Alert.alert(t("time.errorNoProject"));
      return;
    }
    const h = parseInt(manualHours, 10) || 0;
    const m = parseInt(manualMinutes, 10) || 0;
    const totalMinutes = h * 60 + m;
    if (totalMinutes <= 0) {
      Alert.alert("Chyba", "Zadajte kladný počet hodín.");
      return;
    }
    setLoading(true);
    try {
      const dateYmd = toYmd(manualDate);
      await timeTracking.addManualEntry(
        selectedProject.id,
        selectedProject.name ?? "Project",
        dateYmd,
        totalMinutes,
        manualNote.trim() || undefined,
        {
          ...NO_PHASE_TASK,
          projectOwnerId: selectedProject.ownerId ?? null,
          assignedToMe: isProjectAssignedToMe(selectedProject),
        }
      );
      onSaved?.();
      sheetRef.current?.dismiss();
      setManualHours("1");
      setManualMinutes("0");
      setManualNote("");
    } catch (err) {
      Alert.alert(
        "Chyba",
        err instanceof Error ? err.message : t("time.errorNoPermission")
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProject, manualHours, manualMinutes, manualNote, manualDate, onSaved, sheetRef, t]);

  /** Taller sheet when timer runs so Stop stays above gesture bar without hunting for scroll. */
  const snapPoints = React.useMemo(() => (activeTimer ? (["68%", "92%"] as const) : (["48%", "82%"] as const)), [activeTimer]);
  const scrollBottomPad = Math.max(insets.bottom, 20) + spacing.xl * 2;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      bottomInset={insets.bottom}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      )}
      backgroundStyle={{ backgroundColor: SHEET_BG }}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPad }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t("time.title")}</Text>

        {activeTimer ? (
          <View style={styles.selectedProjectChip}>
            <Ionicons name="folder-open" size={18} color={SHEET_ACTION} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.selectedProjectName} numberOfLines={2}>
                {activeTimer.projectNameSnapshot}
              </Text>
            </View>
            {activeTimer.status === "paused" ? (
              <View style={styles.pausedBadge}>
                <Ionicons name="pause" size={12} color={PAUSED_TIMER_AMBER} />
                <Text style={styles.pausedBadgeText}>{t("time.pauseRunning")}</Text>
              </View>
            ) : null}
          </View>
        ) : showProjectPicker ? (
          <>
            <Text style={styles.label}>{t("time.selectProject")}</Text>
            <TextInput
              style={styles.searchInput}
              value={projectSearch}
              onChangeText={setProjectSearch}
              placeholder={t("time.searchProject")}
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
            <ScrollView
              style={styles.projectList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {filteredProjects.length === 0 ? (
                <Text style={styles.projectEmpty}>{t("time.noProjectsMatch")}</Text>
              ) : (
                filteredProjects.map((p) => {
                  const isSelected = selectedProject?.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.projectRow, isSelected && styles.projectRowSelected]}
                      onPress={() => {
                        setSelectedProject(p);
                        setPickingProject(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.projectRowContent}>
                        <Text style={[styles.projectRowName, isSelected && styles.projectRowNameSelected]} numberOfLines={1}>
                          {p.name || "Project"}
                        </Text>
                        {(p.city || p.addressText) && (
                          <Text style={styles.projectRowSub} numberOfLines={1}>
                            {p.city ?? (p.addressText?.split(",")[0]?.trim() ?? "")}
                          </Text>
                        )}
                      </View>
                      {isSelected && <Ionicons name="checkmark-circle" size={22} color={SHEET_ACTION} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </>
        ) : (
          <View style={styles.selectedProjectCard}>
            <View style={styles.selectedProjectCardLeft}>
              <Ionicons name="folder-open" size={20} color={SHEET_ACTION} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.selectedProjectLabel}>{t("time.selectedProject")}</Text>
                <Text style={styles.selectedProjectName} numberOfLines={2}>
                  {selectedProject?.name || "Project"}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setPickingProject(true)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Text style={styles.changeLink}>{t("time.changeProject")}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segmentBtn, mode === "timer" && styles.segmentBtnActive]}
            onPress={() => setMode("timer")}
          >
            <Text style={[styles.segmentText, mode === "timer" && styles.segmentTextActive]}>{t("time.modeTimer")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, mode === "manual" && styles.segmentBtnActive]}
            onPress={() => setMode("manual")}
          >
            <Text style={[styles.segmentText, mode === "manual" && styles.segmentTextActive]}>{t("time.modeManual")}</Text>
          </TouchableOpacity>
        </View>

        {mode === "timer" ? (
          <>
            {activeTimer ? (
              <View style={styles.trackingBox}>
                <View style={styles.timerCircleWrap}>
                  <View
                    style={[
                      styles.timerCircle,
                      activeTimer.status === "paused" ? styles.timerCirclePaused : null,
                    ]}
                  >
                    <Ionicons
                      name={activeTimer.status === "paused" ? "pause" : "time-outline"}
                      size={22}
                      color={activeTimer.status === "paused" ? PAUSED_TIMER_AMBER : RUNNING_TIMER_GREEN}
                      style={styles.timerCircleWatchIcon}
                    />
                    <Text
                      style={[
                        styles.elapsedText,
                        activeTimer.status === "paused" ? styles.elapsedTextPaused : null,
                      ]}
                    >
                      {elapsedDisplay || "00:00:00"}
                    </Text>
                    {activeTimer.status === "paused" && workDisplay ? (
                      <Text style={styles.workTimeDuringPause} numberOfLines={1}>
                        {t("time.workTime")}: {workDisplay}
                      </Text>
                    ) : null}
                    {activeTimer.status === "paused" ? null : (
                      <Animated.View
                        style={[
                          styles.timerRunningTrack,
                          {
                            transform: [
                              {
                                rotate: rotateAnim.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ["0deg", "360deg"],
                                }),
                              },
                            ],
                          },
                        ]}
                      >
                        <View style={styles.timerRunningDot} />
                      </Animated.View>
                    )}
                  </View>
                </View>
                <View style={styles.activeTimerActions}>
                  {activeTimer.status === "paused" ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.resumeBtn, styles.actionFlexBtn]}
                      onPress={handleResume}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={t("time.resume")}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="play" size={18} color="#fff" />
                          <Text style={styles.primaryBtnText}>{t("time.resume")}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.pauseBtn, styles.actionFlexBtn]}
                      onPress={handlePause}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityLabel={t("time.pause")}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="pause" size={18} color="#fff" />
                          <Text style={styles.primaryBtnText}>{t("time.pause")}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.primaryBtn, styles.stopBtn, styles.actionFlexBtn]}
                    onPress={handleStop}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={t("time.stop")}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="stop" size={18} color="#fff" />
                        <Text style={styles.primaryBtnText}>{t("time.stop")}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {selectedProject ? (
                  <Text style={styles.hintText}>{t("time.timerQuickHint")}</Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.primaryBtn, !selectedProject && styles.primaryBtnDisabled]}
                  onPress={handleStart}
                  disabled={loading || !selectedProject}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="play" size={20} color="#fff" />
                      <Text style={styles.primaryBtnText}>{t("time.start")}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          <View style={styles.manualForm}>
            <Text style={styles.label}>{t("time.date")}</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.dateBtnText}>{toYmd(manualDate)}</Text>
              <Ionicons name="calendar-outline" size={20} color={SHEET_ACTION} />
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={manualDate}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(_, d) => {
                  setShowDatePicker(false);
                  if (d) setManualDate(d);
                }}
              />
            )}

            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>{t("time.hours")}</Text>
                <TextInput
                  style={styles.input}
                  value={manualHours}
                  onChangeText={setManualHours}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>{t("time.minutes")}</Text>
                <TextInput
                  style={styles.input}
                  value={manualMinutes}
                  onChangeText={setManualMinutes}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
              </View>
            </View>

            <Text style={styles.label}>{t("time.note")}</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              value={manualNote}
              onChangeText={setManualNote}
              placeholder={t("time.note")}
              placeholderTextColor="rgba(255,255,255,0.4)"
              multiline
            />

            <TouchableOpacity
              style={[styles.primaryBtn, !selectedProject && styles.primaryBtnDisabled]}
              onPress={handleManualSave}
              disabled={loading || !selectedProject}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#fff" />
                  <Text style={styles.primaryBtnText}>{t("time.save")}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: SHEET_TEXT,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginBottom: spacing.sm,
  },
  hintText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.65)",
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  searchInput: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    color: SHEET_TEXT,
    marginBottom: spacing.md,
  },
  selectedProjectChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(125,211,252,0.15)",
    borderRadius: 8,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: SHEET_ACTION,
  },
  selectedProjectCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(125,211,252,0.12)",
    borderRadius: 8,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.35)",
  },
  selectedProjectCardLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
  },
  selectedProjectLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    marginBottom: 2,
  },
  selectedProjectName: {
    fontSize: 16,
    fontWeight: "600",
    color: SHEET_TEXT,
  },
  changeLink: {
    fontSize: 15,
    fontWeight: "600",
    color: SHEET_ACTION,
  },
  projectList: {
    marginBottom: spacing.md,
    maxHeight: 260,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  projectRowSelected: {
    backgroundColor: "rgba(125,211,252,0.2)",
    borderLeftWidth: 3,
    borderLeftColor: SHEET_ACTION,
  },
  projectRowContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  projectRowName: {
    fontSize: 16,
    fontWeight: "500",
    color: SHEET_TEXT,
  },
  projectRowNameSelected: {
    fontWeight: "600",
  },
  projectRowSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    marginTop: 2,
  },
  projectEmpty: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    padding: spacing.lg,
    textAlign: "center",
  },
  segmentRow: {
    flexDirection: "row",
    marginBottom: spacing.md,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: 6,
  },
  segmentBtnActive: {
    backgroundColor: SHEET_ACTION,
  },
  segmentText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
  },
  segmentTextActive: {
    color: "#000",
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    gap: spacing.sm,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  stopBtn: {
    backgroundColor: "#dc3545",
  },
  pauseBtn: {
    backgroundColor: PAUSED_TIMER_AMBER,
  },
  resumeBtn: {
    backgroundColor: RUNNING_TIMER_GREEN,
  },
  activeTimerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: "stretch",
  },
  actionFlexBtn: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  pausedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.6)",
  },
  pausedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: PAUSED_TIMER_AMBER,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  timerCirclePaused: {
    borderColor: "rgba(245,158,11,0.55)",
    backgroundColor: "rgba(245,158,11,0.10)",
  },
  elapsedTextPaused: {
    color: PAUSED_TIMER_AMBER,
  },
  workTimeDuringPause: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.65)",
  },
  trackingBox: {
    padding: spacing.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    alignItems: "center",
  },
  timerCircleWrap: {
    marginBottom: spacing.lg,
  },
  timerCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: "rgba(34,197,94,0.55)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    overflow: "visible",
    backgroundColor: "rgba(34,197,94,0.08)",
  },
  timerCircleWatchIcon: {
    marginBottom: 4,
    opacity: 0.95,
  },
  elapsedText: {
    fontSize: 28,
    fontWeight: "800",
    color: RUNNING_TIMER_GREEN,
    fontVariant: ["tabular-nums"],
  },
  timerRunningTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  timerRunningDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: RUNNING_TIMER_GREEN,
    marginTop: -5,
  },
  manualForm: {
    gap: 0,
  },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.1)",
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.lg,
  },
  dateBtnText: {
    fontSize: 16,
    color: SHEET_TEXT,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  half: {
    flex: 1,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    color: SHEET_TEXT,
  },
  noteInput: {
    minHeight: 60,
    marginBottom: spacing.lg,
  },
});
