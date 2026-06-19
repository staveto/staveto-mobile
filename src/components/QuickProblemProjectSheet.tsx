import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme";
import type { ProjectDoc } from "../services/projects";

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  projects: ProjectDoc[];
  onSelectProject: (project: ProjectDoc) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

/** Project picker shown before CreateProblem — same pattern as QuickTimeModal. */
export function QuickProblemProjectSheet({ sheetRef, projects, onSelectProject, t }: Props) {
  const [projectSearch, setProjectSearch] = useState("");
  const insets = useSafeAreaInsets();

  const filteredProjects = useMemo(() => {
    const active = projects.filter((p) => !p.archivedAt);
    const q = projectSearch.trim().toLowerCase();
    if (!q) return active;
    return active.filter((p) => (p.name ?? "").toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const snapPoints = useMemo(() => ["48%", "82%"] as const, []);
  const scrollBottomPad = Math.max(insets.bottom, 20) + spacing.xl;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      bottomInset={insets.bottom}
      onDismiss={() => setProjectSearch("")}
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
        <Text style={styles.title}>{t("home.reportProblem")}</Text>
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
            filteredProjects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.projectRow}
                onPress={() => {
                  sheetRef.current?.dismiss();
                  onSelectProject(p);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.projectRowContent}>
                  <Text style={styles.projectRowName} numberOfLines={1}>
                    {p.name || "Project"}
                  </Text>
                  {(p.city || p.addressText) ? (
                    <Text style={styles.projectRowSub} numberOfLines={1}>
                      {p.city ?? (p.addressText?.split(",")[0]?.trim() ?? "")}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={SHEET_ACTION} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: SHEET_TEXT,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    marginBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    color: SHEET_TEXT,
    marginBottom: spacing.md,
  },
  projectList: {
    maxHeight: 360,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
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
});
