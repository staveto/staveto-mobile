import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";
import {
  type HomeSectionConfig,
  type HomeSectionId,
  loadHomeLayout,
  saveHomeLayout,
  getDefaultLayout,
  DEFAULT_HOME_LAYOUT,
} from "../services/homeLayout";

const SECTION_LABELS: Record<HomeSectionId, string> = {
  open_tasks_chip: "home.sectionOpenTasksChip",
  projects_chip: "home.sectionProjectsChip",
  time_tracking_chip: "home.sectionTimeTrackingChip",
  expenses_chip: "home.sectionExpensesChip",
  current_work: "home.sectionCurrentWork",
  project_filters: "home.sectionProjectFilters",
  other_projects: "home.sectionOtherProjects",
  calendar: "home.sectionCalendarButton",
  quick_add: "home.sectionQuickAdd",
  kpis: "home.sectionKpis",
};

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  onLayoutChanged?: (layout: { sections: HomeSectionConfig[] }) => void;
  /** When set, use Modal instead of BottomSheetModal (more reliable on some devices) */
  visible?: boolean;
  onDismiss?: () => void;
};

function SectionRow({
  item,
  drag,
  isActive,
  onToggle,
  t,
}: {
  item: HomeSectionConfig;
  drag: () => void;
  isActive: boolean;
  onToggle: (id: HomeSectionId, enabled: boolean) => void;
  t: (key: string) => string;
}) {
  const labelKey = SECTION_LABELS[item.id];
  const isLocked = item.locked === true;

  return (
    <ScaleDecorator>
      <TouchableOpacity
        onLongPress={drag}
        disabled={isActive}
        activeOpacity={1}
        style={[styles.row, isActive && styles.rowActive]}
        accessibilityRole="button"
        accessibilityLabel={t(labelKey)}
        accessibilityHint={isLocked ? "Locked section" : "Long press and drag to reorder"}
      >
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-three" size={24} color="rgba(255,255,255,0.6)" />
        </View>
        <Text style={styles.rowLabel} maxFontSizeMultiplier={1.2} numberOfLines={2}>
          {t(labelKey)}
        </Text>
        {isLocked ? (
          <Ionicons name="lock-closed" size={20} color="rgba(255,255,255,0.6)" />
        ) : (
          <Switch
            value={item.enabled}
            onValueChange={(v) => onToggle(item.id, v)}
            trackColor={{ false: "rgba(255,255,255,0.3)", true: "#22c55e" }}
            thumbColor="#fff"
          />
        )}
      </TouchableOpacity>
    </ScaleDecorator>
  );
}

export function HomeCustomizeSheet({ sheetRef, onLayoutChanged, visible, onDismiss }: Props) {
  const { t } = useI18n();
  const [sections, setSections] = useState<HomeSectionConfig[]>(DEFAULT_HOME_LAYOUT.sections);

  useEffect(() => {
    loadHomeLayout().then((layout) => setSections(layout.sections));
  }, []);

  const handleToggle = useCallback((id: HomeSectionId, enabled: boolean) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s))
    );
  }, []);

  const handleSave = useCallback(async () => {
    const layout = { sections };
    await saveHomeLayout(layout);
    onLayoutChanged?.(layout);
    if (visible !== undefined) {
      onDismiss?.();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sections, onLayoutChanged, sheetRef, visible, onDismiss]);

  const handleCancel = useCallback(() => {
    if (visible !== undefined) {
      onDismiss?.();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sheetRef, visible, onDismiss]);

  const handleReset = useCallback(() => {
    Alert.alert(
      t("home.resetToDefault"),
      t("home.resetConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.continue"),
          onPress: () => {
            const def = getDefaultLayout();
            setSections(def.sections);
          },
        },
      ]
    );
  }, [t]);

  const allDisabled = sections.filter((s) => !s.locked).every((s) => !s.enabled);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const renderContent = () => (
    <>
      <View style={[styles.header, { paddingTop: spacing.lg }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleCancel} accessibilityRole="button" accessibilityLabel={t("common.cancel")}>
          <Text style={styles.headerCancel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("common.cancel")}
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {t("home.customizeHomeTitle")}
        </Text>
        <TouchableOpacity style={styles.headerBtn} onPress={handleSave} accessibilityRole="button" accessibilityLabel={t("common.save")}>
          <Text style={styles.headerSave} maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {t("common.save")}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {allDisabled ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText} maxFontSizeMultiplier={1.2}>
              {t("home.resetToDefault")}
            </Text>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} accessibilityRole="button" accessibilityLabel={t("home.resetToDefault")}>
              <Text style={styles.resetBtnText} maxFontSizeMultiplier={1.2} numberOfLines={1}>
                {t("home.resetToDefault")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <GestureHandlerRootView style={{ flex: 1 }}>
            <DraggableFlatList
              data={sections.filter((s) => s.id !== "kpis")}
              onDragEnd={({ data }) => setSections(data)}
              keyExtractor={(item) => item.id}
              renderItem={({ item, drag, isActive }: RenderItemParams<HomeSectionConfig>) => (
                <SectionRow
                  item={item}
                  drag={drag}
                  isActive={isActive}
                  onToggle={handleToggle}
                  t={t}
                />
              )}
            />
          </GestureHandlerRootView>
        )}
      </View>
    </>
  );

  if (visible !== undefined) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={handleCancel}
      >
        <Pressable style={modalStyles.overlay} onPress={handleCancel}>
          <Pressable style={modalStyles.content} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.sheet, modalStyles.sheet]}>
              {renderContent()}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      snapPoints={["70%"]}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
      backgroundStyle={styles.sheet}
    >
      {renderContent()}
    </BottomSheetModal>
  );
}

const SHEET_BG = "#1e2530";
const SHEET_TEXT = "#ffffff";
const SHEET_ACTION = "#7dd3fc";
const SHEET_BORDER = "rgba(255,255,255,0.15)";

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  content: {
    maxHeight: "80%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  sheet: {
    minHeight: 400,
  },
});

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: SHEET_BORDER,
  },
  headerBtn: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
  },
  headerCancel: {
    fontSize: 16,
    color: SHEET_ACTION,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: SHEET_TEXT,
  },
  headerSave: {
    fontSize: 16,
    fontWeight: "600",
    color: SHEET_ACTION,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: SHEET_BORDER,
    minHeight: 56,
  },
  rowActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  dragHandle: {
    marginRight: spacing.md,
    padding: spacing.xs,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: SHEET_TEXT,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.7)",
    marginBottom: spacing.md,
  },
  resetBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  resetBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
