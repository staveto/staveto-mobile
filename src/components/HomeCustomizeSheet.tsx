import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Dimensions,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, spacing } from "../theme";
import {
  type HomeSectionConfig,
  type HomeSectionId,
  type HomeLayout,
  type HomeWidgetToggles,
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
  quick_capture_card: "home.sectionQuickCapture",
  service_tasks_alert: "home.sectionServiceTasks",
  current_work: "home.sectionCurrentWork",
  project_filters: "home.sectionProjectFilters",
  other_projects: "home.sectionOtherProjects",
  calendar: "home.sectionCalendarButton",
  quick_add: "home.sectionQuickAdd",
  kpis: "home.sectionKpis",
};

type Props = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  onLayoutChanged?: (layout: HomeLayout) => void;
  /** When set, use Modal instead of BottomSheetModal (more reliable on some devices) */
  visible?: boolean;
  onDismiss?: () => void;
};

function SectionToggleRow({
  item,
  onToggle,
  t,
}: {
  item: HomeSectionConfig;
  onToggle: (id: HomeSectionId, enabled: boolean) => void;
  t: (key: string) => string;
}) {
  const labelKey = SECTION_LABELS[item.id];
  const isLocked = item.locked === true;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !isLocked ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      accessibilityHint={isLocked ? "Locked section" : "Toggle home section visibility"}
      onPress={() => {
        if (!isLocked) onToggle(item.id, !item.enabled);
      }}
    >
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
    </Pressable>
  );
}

export function HomeCustomizeSheet({ sheetRef, onLayoutChanged, visible, onDismiss }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const modalSheetHeight = useMemo(
    () => Math.round(Dimensions.get("window").height * 0.92),
    []
  );
  const [sections, setSections] = useState<HomeSectionConfig[]>(DEFAULT_HOME_LAYOUT.sections);
  const [widgets, setWidgets] = useState<HomeWidgetToggles>(DEFAULT_HOME_LAYOUT.widgets);

  useEffect(() => {
    loadHomeLayout().then((layout) => {
      setSections(layout.sections);
      setWidgets(layout.widgets);
    });
  }, []);

  const handleToggle = useCallback((id: HomeSectionId, enabled: boolean) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s))
    );
  }, []);

  const handleSave = useCallback(async () => {
    const layout: HomeLayout = { sections, widgets };
    await saveHomeLayout(layout);
    onLayoutChanged?.(layout);
    if (visible !== undefined) {
      onDismiss?.();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sections, widgets, onLayoutChanged, sheetRef, visible, onDismiss]);

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
            setWidgets(def.widgets);
          },
        },
      ]
    );
  }, [t]);

  const allDisabled =
    sections.filter((s) => !s.locked).every((s) => !s.enabled) &&
    !widgets.showHeaderChatShortcut &&
    !widgets.showQuickTime &&
    !widgets.showTodayPriorities &&
    !widgets.showBottomQuickActions;

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
  const snapPoints = useMemo(() => ["70%", "95%"], []);

  const visibleSections = sections.filter((s) => s.id !== "kpis");
  const sectionRows = visibleSections.length > 0 ? visibleSections : getDefaultLayout().sections;

  const scrollContentPaddingBottom = insets.bottom + spacing.xl + spacing.md;

  const renderHeader = () => (
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
  );

  const renderScrollInner = () => (
    <>
      <View style={styles.widgetsSection}>
        <Text style={styles.widgetsSectionTitle}>{t("home.customizeAdditionalWidgets")}</Text>
        <ToggleRow
          label={t("home.customize.showHeaderChatShortcut")}
          value={widgets.showHeaderChatShortcut}
          onChange={(value) => setWidgets((prev) => ({ ...prev, showHeaderChatShortcut: value }))}
        />
        <ToggleRow
          label={t("home.customize.showQuickTime")}
          value={widgets.showQuickTime}
          onChange={(value) => setWidgets((prev) => ({ ...prev, showQuickTime: value }))}
        />
        <ToggleRow
          label={t("home.customize.showTodayPriorities")}
          value={widgets.showTodayPriorities}
          onChange={(value) => setWidgets((prev) => ({ ...prev, showTodayPriorities: value }))}
        />
        <ToggleRow
          label={t("home.customize.showBottomQuickActions")}
          value={widgets.showBottomQuickActions}
          onChange={(value) => setWidgets((prev) => ({ ...prev, showBottomQuickActions: value }))}
        />
      </View>
      <View style={styles.widgetsSection}>
        <Text style={styles.widgetsSectionTitle}>{t("home.customizeHomeSections")}</Text>
        {sectionRows.map((item) => (
          <SectionToggleRow key={item.id} item={item} onToggle={handleToggle} t={t} />
        ))}
      </View>
    </>
  );

  const scrollContentStyle = useMemo(
    () => [styles.sectionsListContent, { paddingHorizontal: spacing.lg, paddingBottom: scrollContentPaddingBottom }],
    [scrollContentPaddingBottom]
  );

  if (visible !== undefined) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
        <View style={modalStyles.overlay}>
          <Pressable style={modalStyles.dismissFill} onPress={handleCancel} accessibilityRole="button" accessibilityLabel={t("common.cancel")} />
          <View style={[styles.sheet, modalStyles.sheet, { height: modalSheetHeight }]}>
            {renderHeader()}
            {allDisabled ? (
              <View style={[styles.content, styles.contentBody]}>
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
              </View>
            ) : (
              <ScrollView
                style={styles.scrollBody}
                contentContainerStyle={scrollContentStyle}
                showsVerticalScrollIndicator
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                decelerationRate={Platform.OS === "ios" ? "fast" : 0.985}
                overScrollMode="always"
                bounces
              >
                {renderScrollInner()}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(255,255,255,0.5)" }}
      backgroundStyle={styles.sheet}
    >
      <View style={styles.bottomSheetInner}>
        {renderHeader()}
        {allDisabled ? (
          <View style={[styles.content, styles.contentBody]}>
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
          </View>
        ) : (
          <BottomSheetScrollView
            style={styles.bottomSheetScroll}
            contentContainerStyle={scrollContentStyle}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {renderScrollInner()}
          </BottomSheetScrollView>
        )}
      </View>
    </BottomSheetModal>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.toggleRow, pressed ? styles.rowPressed : null]}
      onPress={() => onChange(!value)}
    >
      <Text style={styles.toggleLabel} maxFontSizeMultiplier={1.2} numberOfLines={2}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "rgba(255,255,255,0.3)", true: "#22c55e" }}
        thumbColor="#fff"
      />
    </Pressable>
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
  dismissFill: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: "100%",
  },
});

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
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
  sectionsListContent: {
    flexGrow: 1,
  },
  scrollBody: {
    flex: 1,
    minHeight: 0,
  },
  bottomSheetInner: {
    flex: 1,
    minHeight: 0,
  },
  bottomSheetScroll: {
    flex: 1,
    minHeight: 0,
  },
  contentBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: "center",
  },
  widgetsSection: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  widgetsSectionTitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.65)",
    marginBottom: spacing.xs,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: SHEET_BORDER,
    minHeight: 52,
  },
  toggleLabel: {
    flex: 1,
    color: SHEET_TEXT,
    fontSize: 15,
    marginRight: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: SHEET_BORDER,
    minHeight: 56,
  },
  rowPressed: {
    backgroundColor: "rgba(255,255,255,0.06)",
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
