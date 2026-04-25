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
import { colors, spacing } from "../theme";
import { toYmd } from "../utils/date";
import * as timeTracking from "../services/timeTracking";
import type { ActiveTimer } from "../services/timeTracking";
import type { ProjectDoc } from "../services/projects";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";

/** Project-only: phase/task are always null in Firestore. */
const NO_PHASE_TASK = {
  phaseId: null as string | null,
  phaseNameSnapshot: null as string | null,
  taskId: null as string | null,
  taskTitleSnapshot: null as string | null,
};

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
  onRefreshActiveTimer: () => void | Promise<void>;
  /** Called after start succeeds, modal dismissed, and active timer refresh has been awaited. */
  onTimerStarted?: (projectName: string) => void;
  onSaved?: () => void;
  t: (key: string, params?: Record<string, string>) => string;
};

export function QuickTimeModal({
  sheetRef,
  projects,
  activeTimer,
  onRefreshActiveTimer,
  onTimerStarted,
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
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const filteredProjects = React.useMemo(() => {
    const active = projects.filter((p) => !p.archivedAt);
    const q = projectSearch.trim().toLowerCase();
    if (!q) return active;
    return active.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const showProjectPicker = !activeTimer && (!selectedProject || pickingProject);
  const showSelectedProjectRow = !activeTimer && selectedProject && !pickingProject;

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

  const handleStart = useCallback(async () => {
    if (!selectedProject) {
      Alert.alert(t("time.errorNoProject"));
      return;
    }
    const projectName = selectedProject.name ?? "Project";
    setLoading(true);
    try {
      await timeTracking.startTimer(selectedProject.id, projectName, NO_PHASE_TASK);
      for (let attempt = 0; attempt < 3; attempt++) {
        await Promise.resolve(onRefreshActiveTimer());
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      sheetRef.current?.dismiss();
      onTimerStarted?.(projectName);
    } catch (err) {
      Alert.alert(
        "Chyba",
        err instanceof Error ? err.message : t("time.errorNoPermission")
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProject, onRefreshActiveTimer, onTimerStarted, sheetRef, t]);

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
        NO_PHASE_TASK
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

  const snapPoints = ["48%", "82%"];

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
      <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t("time.title")}</Text>

        {activeTimer ? (
          <View style={styles.selectedProjectChip}>
            <Ionicons name="folder-open" size={18} color={SHEET_ACTION} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.selectedProjectName} numberOfLines={2}>
                {activeTimer.projectNameSnapshot}
              </Text>
            </View>
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
                <TouchableOpacity style={[styles.primaryBtn, styles.stopBtn]} onPress={handleStop} disabled={loading}>
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
    paddingBottom: spacing.xl * 2,
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
