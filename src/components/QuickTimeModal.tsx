import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors, spacing } from "../theme";
import { toYmd } from "../utils/date";
import * as timeTracking from "../services/timeTracking";
import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import type { ActiveTimer } from "../services/timeTracking";
import type { ProjectDoc } from "../services/projects";
import type { ProjectPhaseDoc } from "../services/projects";
import type { TaskDoc } from "../services/tasks";
import { isBuildLikeStorageType } from "../lib/projectTypeModel";

/** Virtual task option for "Administrativa na projekte" – not a real task, stored as taskTitleSnapshot only */
const TASK_OPTION_ADMINISTRATION = "__administration__" as const;
type TaskOption = TaskDoc | null | typeof TASK_OPTION_ADMINISTRATION;

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  projects: ProjectDoc[];
  activeTimer: ActiveTimer | null;
  onRefreshActiveTimer: () => void;
  onSaved?: () => void;
  t: (key: string, params?: Record<string, string>) => string;
};

export function QuickTimeModal({
  sheetRef,
  projects,
  activeTimer,
  onRefreshActiveTimer,
  onSaved,
  t,
}: Props) {
  const [selectedProject, setSelectedProject] = useState<ProjectDoc | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<ProjectPhaseDoc | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskOption>(null);
  const [phases, setPhases] = useState<ProjectPhaseDoc[]>([]);
  const [tasks, setTasks] = useState<TaskDoc[]>([]);
  const [loadingPhasesTasks, setLoadingPhasesTasks] = useState(false);
  const [mode, setMode] = useState<"timer" | "manual">("timer");
  const [manualDate, setManualDate] = useState(new Date());
  const [manualHours, setManualHours] = useState("1");
  const [manualMinutes, setManualMinutes] = useState("0");
  const [manualNote, setManualNote] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [elapsedDisplay, setElapsedDisplay] = useState("");
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const isBuildOrManagement = isBuildLikeStorageType(selectedProject?.projectType);

  useEffect(() => {
    if (!selectedProject?.id) {
      setPhases([]);
      setTasks([]);
      setSelectedPhase(null);
      setSelectedTask(null);
      return;
    }
    setLoadingPhasesTasks(true);
    (async () => {
      try {
        const [ph, tk] = await Promise.all([
          isBuildOrManagement ? projectsService.listProjectPhases(selectedProject.id).catch(() => []) : Promise.resolve([]),
          tasksService.listTasksByProject(selectedProject.id).catch(() => []),
        ]);
        setPhases(ph);
        setTasks(tk.filter((t) => t.isActive !== false));
        setSelectedPhase(null);
        setSelectedTask(null);
      } catch {
        setPhases([]);
        setTasks([]);
      } finally {
        setLoadingPhasesTasks(false);
      }
    })();
  }, [selectedProject?.id, isBuildOrManagement]);

  const tasksForPhase = useMemo(() => {
    if (!selectedPhase) return tasks;
    return tasks.filter((t) => t.phaseId === selectedPhase.id);
  }, [tasks, selectedPhase]);

  useEffect(() => {
    if (!activeTimer) return;
    const update = () => setElapsedDisplay(formatElapsed(activeTimer.startedAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  useEffect(() => {
    if (!activeTimer) {
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

  const filteredProjects = React.useMemo(() => {
    const active = projects.filter((p) => !p.archivedAt);
    const q = projectSearch.trim().toLowerCase();
    if (!q) return active;
    return active.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const handleStart = useCallback(async () => {
    if (!selectedProject) {
      Alert.alert(t("time.errorNoProject"));
      return;
    }
    setLoading(true);
    try {
      await timeTracking.startTimer(selectedProject.id, selectedProject.name ?? "Project", {
        phaseId: selectedPhase?.id ?? null,
        phaseNameSnapshot: selectedPhase?.name ?? null,
        taskId: selectedTask && selectedTask !== TASK_OPTION_ADMINISTRATION ? selectedTask.id : null,
        taskTitleSnapshot: selectedTask === TASK_OPTION_ADMINISTRATION ? t("time.projectAdministration") : (selectedTask && selectedTask !== TASK_OPTION_ADMINISTRATION ? selectedTask.title ?? null : null),
      });
      onRefreshActiveTimer();
    } catch (err) {
      Alert.alert(
        "Chyba",
        err instanceof Error ? err.message : t("time.errorNoPermission")
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProject, selectedPhase, selectedTask, onRefreshActiveTimer, t]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await timeTracking.stopTimer();
      onRefreshActiveTimer();
      onSaved?.();
      sheetRef.current?.dismiss();
    } catch (err) {
      Alert.alert("Chyba", err instanceof Error ? err.message : "Nepodarilo sa zastaviť časovač.");
    } finally {
      setLoading(false);
    }
  }, [onRefreshActiveTimer, onSaved, sheetRef]);

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
          phaseId: selectedPhase?.id ?? null,
          phaseNameSnapshot: selectedPhase?.name ?? null,
          taskId: selectedTask && selectedTask !== TASK_OPTION_ADMINISTRATION ? selectedTask.id : null,
          taskTitleSnapshot: selectedTask === TASK_OPTION_ADMINISTRATION ? t("time.projectAdministration") : (selectedTask && selectedTask !== TASK_OPTION_ADMINISTRATION ? selectedTask.title ?? null : null),
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
  }, [selectedProject, selectedPhase, selectedTask, manualHours, manualMinutes, manualNote, manualDate, onSaved, sheetRef, t]);

  const snapPoints = ["55%", "85%"];

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backdropComponent={(props) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      )}
      backgroundStyle={{ backgroundColor: SHEET_BG }}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
    >
      <BottomSheetScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("time.title")}</Text>

        {/* Project picker – hidden when timer is running, show only selected project */}
        {activeTimer ? (
          <View style={styles.selectedProjectChip}>
            <Ionicons name="folder-open" size={18} color={SHEET_ACTION} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedProjectName} numberOfLines={1}>
                {activeTimer.projectNameSnapshot}
              </Text>
              {(activeTimer.phaseNameSnapshot || activeTimer.taskTitleSnapshot) && (
                <Text style={styles.selectedProjectSub} numberOfLines={1}>
                  {[activeTimer.phaseNameSnapshot, activeTimer.taskTitleSnapshot].filter(Boolean).join(" › ")}
                </Text>
              )}
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.label}>{t("time.selectProject")}</Text>
            <TextInput
              style={styles.searchInput}
              value={projectSearch}
              onChangeText={setProjectSearch}
              placeholder={t("time.searchProject")}
              placeholderTextColor="rgba(255,255,255,0.4)"
            />
            <View style={styles.projectList}>
              {filteredProjects.length === 0 ? (
                <Text style={styles.projectEmpty}>{t("time.noProjectsMatch")}</Text>
              ) : (
                filteredProjects.map((p) => {
                  const isSelected = selectedProject?.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.projectRow, isSelected && styles.projectRowSelected]}
                      onPress={() => setSelectedProject(p)}
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
            </View>

            {/* Phase (optional) – len pre BUILD/MANAGEMENT */}
            {selectedProject && isBuildOrManagement && (
              <>
                <Text style={styles.label}>{t("time.selectPhaseOptional")}</Text>
                {loadingPhasesTasks ? (
                  <ActivityIndicator size="small" color={SHEET_ACTION} style={{ marginBottom: spacing.md }} />
                ) : (
                  <View style={styles.optionList}>
                    <TouchableOpacity
                      style={[styles.optionRow, !selectedPhase && styles.optionRowSelected]}
                      onPress={() => setSelectedPhase(null)}
                    >
                      <Text style={[styles.optionRowText, !selectedPhase && styles.optionRowTextSelected]}>
                        {t("time.projectOnly")}
                      </Text>
                      {!selectedPhase && <Ionicons name="checkmark-circle" size={20} color={SHEET_ACTION} />}
                    </TouchableOpacity>
                    {phases.map((ph) => {
                      const isSelected = selectedPhase?.id === ph.id;
                      return (
                        <TouchableOpacity
                          key={ph.id}
                          style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                          onPress={() => {
                            setSelectedPhase(ph);
                            setSelectedTask(null);
                          }}
                        >
                          <Text style={[styles.optionRowText, isSelected && styles.optionRowTextSelected]} numberOfLines={1}>
                            {ph.name}
                          </Text>
                          {isSelected && <Ionicons name="checkmark-circle" size={20} color={SHEET_ACTION} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {/* Task (optional) – vždy zobrazené pri vybranom projekte */}
            {selectedProject && (
              <>
                <Text style={styles.label}>{t("time.selectTaskOptional")}</Text>
                {loadingPhasesTasks ? (
                  <ActivityIndicator size="small" color={SHEET_ACTION} style={{ marginBottom: spacing.md }} />
                ) : (
                  <View style={styles.optionList}>
                    <TouchableOpacity
                      style={[styles.optionRow, selectedTask === null && styles.optionRowSelected]}
                      onPress={() => setSelectedTask(null)}
                    >
                      <Text style={[styles.optionRowText, selectedTask === null && styles.optionRowTextSelected]}>
                        {t("time.projectOnly")}
                      </Text>
                      {selectedTask === null && <Ionicons name="checkmark-circle" size={20} color={SHEET_ACTION} />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.optionRow, selectedTask === TASK_OPTION_ADMINISTRATION && styles.optionRowSelected]}
                      onPress={() => setSelectedTask(TASK_OPTION_ADMINISTRATION)}
                    >
                      <Text style={[styles.optionRowText, selectedTask === TASK_OPTION_ADMINISTRATION && styles.optionRowTextSelected]}>
                        {t("time.projectAdministration")}
                      </Text>
                      {selectedTask === TASK_OPTION_ADMINISTRATION && <Ionicons name="checkmark-circle" size={20} color={SHEET_ACTION} />}
                    </TouchableOpacity>
                    {tasksForPhase.map((tk) => {
                      const isSelected = selectedTask && selectedTask !== TASK_OPTION_ADMINISTRATION && selectedTask.id === tk.id;
                      return (
                        <TouchableOpacity
                          key={tk.id}
                          style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                          onPress={() => setSelectedTask(tk)}
                        >
                          <Text style={[styles.optionRowText, isSelected && styles.optionRowTextSelected]} numberOfLines={1}>
                            {tk.title || t("time.taskUntitled")}
                          </Text>
                          {isSelected && <Ionicons name="checkmark-circle" size={20} color={SHEET_ACTION} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* Mode segment */}
        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segmentBtn, mode === "timer" && styles.segmentBtnActive]}
            onPress={() => setMode("timer")}
          >
            <Text style={[styles.segmentText, mode === "timer" && styles.segmentTextActive]}>
              {t("time.modeTimer")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, mode === "manual" && styles.segmentBtnActive]}
            onPress={() => setMode("manual")}
          >
            <Text style={[styles.segmentText, mode === "manual" && styles.segmentTextActive]}>
              {t("time.modeManual")}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === "timer" ? (
          <>
            {activeTimer ? (
              <View style={styles.trackingBox}>
                <View style={styles.timerCircleWrap}>
                  <View style={styles.timerCircle}>
                    <Text style={styles.elapsedText}>{elapsedDisplay || "00:00"}</Text>
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
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.stopBtn]}
                  onPress={handleStop}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="stop" size={20} color="#fff" />
                      <Text style={styles.primaryBtnText}>{t("time.stop")}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleStart}
                disabled={loading}
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
            )}
          </>
        ) : (
          <View style={styles.manualForm}>
            <Text style={styles.label}>{t("time.date")}</Text>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowDatePicker(true)}
            >
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
              style={styles.primaryBtn}
              onPress={handleManualSave}
              disabled={loading}
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
    paddingBottom: spacing.xl * 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: SHEET_TEXT,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginBottom: spacing.sm,
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
  selectedProjectName: {
    fontSize: 16,
    fontWeight: "600",
    color: SHEET_TEXT,
  },
  selectedProjectSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },
  projectList: {
    marginBottom: spacing.lg,
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
  optionList: {
    marginBottom: spacing.md,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  optionRowSelected: {
    backgroundColor: "rgba(125,211,252,0.15)",
    borderLeftWidth: 3,
    borderLeftColor: SHEET_ACTION,
  },
  optionRowText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    flex: 1,
  },
  optionRowTextSelected: {
    fontWeight: "600",
  },
  segmentRow: {
    flexDirection: "row",
    marginBottom: spacing.lg,
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
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  stopBtn: {
    backgroundColor: "#dc3545",
    marginTop: spacing.md,
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
    borderColor: "rgba(125,211,252,0.4)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    overflow: "visible",
  },
  elapsedText: {
    fontSize: 32,
    fontWeight: "700",
    color: SHEET_ACTION,
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
    backgroundColor: SHEET_ACTION,
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
