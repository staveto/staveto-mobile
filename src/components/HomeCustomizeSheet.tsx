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
  type HomeDisplaySize,
  loadHomeLayout,
  saveHomeLayout,
  getDefaultLayout,
  DEFAULT_HOME_LAYOUT,
  HOME_LAYOUT_VERSION,
} from "../services/homeLayout";

const SECTION_LABELS: Record<HomeSectionId, string> = {
  open_tasks_chip: "home.customize.showKpiChips",
  projects_chip: "home.customize.showProjects",
  time_tracking_chip: "home.customize.showTimeTracking",
  expenses_chip: "home.customize.showExpenses",
  quick_capture_card: "home.customize.showQuickNote",
  service_tasks_alert: "home.customize.showServiceTasks",
  current_work: "home.customize.showCurrentProject",
  project_filters: "home.customize.showProjectFilters",
  other_projects: "home.customize.showOtherProjects",
  calendar: "home.customize.showCalendar",
  quick_add: "home.customize.showQuickAdd",
  kpis: "home.customize.showKpiLegacy",
};

const SECTION_DISPLAY_ORDER: HomeSectionId[] = [
  "quick_capture_card",
  "service_tasks_alert",
  "current_work",
  "other_projects",
  "open_tasks_chip",
  "projects_chip",
  "time_tracking_chip",
  "expenses_chip",
  "project_filters",
  "calendar",
  "quick_add",
  "kpis",
];

function sortSectionsForCustomize(rows: HomeSectionConfig[]): HomeSectionConfig[] {
  const rank = new Map(SECTION_DISPLAY_ORDER.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}

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
  const label = t(labelKey);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !isLocked ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={isLocked ? t("home.customize.sectionLockedHint") : t("home.customize.sectionToggleHint")}
      onPress={() => {
        if (!isLocked) onToggle(item.id, !item.enabled);
      }}
    >
      <Text style={styles.rowLabel} maxFontSizeMultiplier={1.25} numberOfLines={2}>
        {label}
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

function DisplaySizePicker({
  value,
  onChange,
  t,
}: {
  value: HomeDisplaySize;
  onChange: (v: HomeDisplaySize) => void;
  t: (key: string) => string;
}) {
  const options: HomeDisplaySize[] = ["compact", "standard", "large"];
  return (
    <View style={styles.sizePickerRow}>
      {options.map((opt) => {
        const active = value === opt;
        const label =
          opt === "compact"
            ? t("home.customize.displaySizeCompact")
            : opt === "large"
              ? t("home.customize.displaySizeLarge")
              : t("home.customize.displaySizeStandard");
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.sizeChip, active ? styles.sizeChipActive : null]}
            onPress={() => onChange(opt)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <Text style={[styles.sizeChipText, active ? styles.sizeChipTextActive : null]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function HomeCustomizeSheet({ sheetRef, onLayoutChanged, visible, onDismiss }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const modalSheetHeight = useMemo(() => Math.round(Dimensions.get("window").height * 0.92), []);
  const [sections, setSections] = useState<HomeSectionConfig[]>(DEFAULT_HOME_LAYOUT.sections);
  const [widgets, setWidgets] = useState<HomeWidgetToggles>(DEFAULT_HOME_LAYOUT.widgets);
  const [homeDisplaySize, setHomeDisplaySize] = useState<HomeDisplaySize>("standard");

  useEffect(() => {
    loadHomeLayout().then((layout) => {
      setSections(layout.sections);
      setWidgets(layout.widgets);
      setHomeDisplaySize(layout.homeDisplaySize ?? "standard");
    });
  }, []);

  const handleToggle = useCallback((id: HomeSectionId, enabled: boolean) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  }, []);

  const handleSave = useCallback(async () => {
    const layout: HomeLayout = {
      sections,
      widgets,
      homeLayoutVersion: HOME_LAYOUT_VERSION,
      homeDisplaySize,
    };
    await saveHomeLayout(layout);
    onLayoutChanged?.(layout);
    if (visible !== undefined) {
      onDismiss?.();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sections, widgets, homeDisplaySize, onLayoutChanged, sheetRef, visible, onDismiss]);

  const handleCancel = useCallback(() => {
    if (visible !== undefined) {
      onDismiss?.();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [sheetRef, visible, onDismiss]);

  const handleReset = useCallback(() => {
    Alert.alert(t("home.resetToDefault"), t("home.resetConfirmMessage"), [
      { text: t("home.customize.cancel"), style: "cancel" },
      {
        text: t("common.continue"),
        onPress: () => {
          const def = getDefaultLayout();
          setSections(def.sections);
          setWidgets(def.widgets);
          setHomeDisplaySize(def.homeDisplaySize ?? "standard");
        },
      },
    ]);
  }, [t]);

  const allDisabled =
    sections.filter((s) => !s.locked).every((s) => !s.enabled) &&
    !widgets.showHeaderChatShortcut &&
    !widgets.showQuickTime &&
    !widgets.showTodayPriorities &&
    !widgets.showBottomQuickActions;

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );
  const snapPoints = useMemo(() => ["70%", "95%"], []);

  const visibleSections = sections.filter((s) => s.id !== "kpis");
  const sectionRows = sortSectionsForCustomize(
    visibleSections.length > 0 ? visibleSections : getDefaultLayout().sections.filter((s) => s.id !== "kpis")
  );

  const scrollContentPaddingBottom = insets.bottom + spacing.xl + spacing.md;

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: spacing.lg }]}>
      <TouchableOpacity
        style={styles.headerBtn}
        onPress={handleCancel}
        accessibilityRole="button"
        accessibilityLabel={t("home.customize.cancel")}
      >
        <Text style={styles.headerCancel} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {t("home.customize.cancel")}
        </Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle} maxFontSizeMultiplier={1.2} numberOfLines={1}>
        {t("home.customize.title")}
      </Text>
      <TouchableOpacity
        style={styles.headerBtn}
        onPress={handleSave}
        accessibilityRole="button"
        accessibilityLabel={t("home.customize.save")}
      >
        <Text style={styles.headerSave} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {t("home.customize.save")}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderScrollInner = () => (
    <>
      <View style={styles.widgetsSection}>
        <Text style={styles.widgetsSectionTitle}>{t("home.customize.displaySize")}</Text>
        <DisplaySizePicker value={homeDisplaySize} onChange={setHomeDisplaySize} t={t} />
      </View>
      <View style={styles.widgetsSection}>
        <Text style={styles.widgetsSectionTitle}>{t("home.customize.additionalWidgets")}</Text>
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
        <Text style={styles.widgetsSectionTitle}>{t("home.customize.homeSections")}</Text>
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
          <Pressable
            style={modalStyles.dismissFill}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel={t("home.customize.cancel")}
          />
          <View style={[styles.sheet, modalStyles.sheet, { height: modalSheetHeight }]}>
            {renderHeader()}
            {allDisabled ? (
              <View style={[styles.content, styles.contentBody]}>
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText} maxFontSizeMultiplier={1.25}>
                    {t("home.customize.allHiddenHint")}
                  </Text>
                  <TouchableOpacity
                    style={styles.resetBtn}
                    onPress={handleReset}
                    accessibilityRole="button"
                    accessibilityLabel={t("home.customize.resetToDefault")}
                  >
                    <Text style={styles.resetBtnText} maxFontSizeMultiplier={1.2} numberOfLines={2}>
                      {t("home.customize.resetToDefault")}
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
              <Text style={styles.emptyText} maxFontSizeMultiplier={1.25}>
                {t("home.customize.allHiddenHint")}
              </Text>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={handleReset}
                accessibilityRole="button"
                accessibilityLabel={t("home.customize.resetToDefault")}
              >
                <Text style={styles.resetBtnText} maxFontSizeMultiplier={1.2} numberOfLines={2}>
                  {t("home.customize.resetToDefault")}
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
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Text style={styles.toggleLabel} maxFontSizeMultiplier={1.25} numberOfLines={2}>
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
    fontWeight: "600",
  },
  sizePickerRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sizeChip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SHEET_BORDER,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  sizeChipActive: {
    borderColor: SHEET_ACTION,
    backgroundColor: "rgba(125,211,252,0.12)",
  },
  sizeChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
  sizeChipTextActive: {
    color: SHEET_TEXT,
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
    textAlign: "center",
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
    textAlign: "center",
  },
});
