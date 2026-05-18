import AsyncStorage from "@react-native-async-storage/async-storage";

export const HOME_LAYOUT_KEY = "staveto_home_layout_v2";
export const HOME_CALENDAR_COLLAPSED_KEY = "staveto_home_calendar_collapsed_v1";

export type HomeSectionId =
  | "open_tasks_chip"
  | "projects_chip"
  | "time_tracking_chip"
  | "expenses_chip"
  | "quick_capture_card"
  | "service_tasks_alert"
  | "current_work"
  | "project_filters"
  | "other_projects"
  | "calendar"
  | "quick_add"
  | "kpis"; // legacy, migrated to chips

export type HomeWidgetToggles = {
  showHeaderChatShortcut: boolean;
  showQuickTime: boolean;
  showTodayPriorities: boolean;
  showBottomQuickActions: boolean;
};

/** Text and touch targets on Home (local to HomeScreen, not system font scale). */
export type HomeDisplaySize = "compact" | "standard" | "large";

export type HomeDisplayMetrics = {
  cardPaddingH: number;
  cardPaddingV: number;
  overviewTitleSize: number;
  overviewBodySize: number;
  taskTitleSize: number;
  taskMetaSize: number;
  sectionHeadingSize: number;
  iconSize: number;
  headerIconSize: number;
  quickActionMinHeight: number;
  quickActionMaxHeight: number;
  quickLabelSize: number;
  quickLabelLineHeight: number;
  projectThumbSize: number;
  projectRowMinHeight: number;
  projectTitleSize: number;
  projectSublineSize: number;
  metricPillFont: number;
  gap: number;
  kpiCardMinWidth: number;
  kpiLabelSize: number;
  kpiValueSize: number;
  kpiIconSize: number;
  filterChipFont: number;
  filterTypeIconSize: number;
  overviewCardMaxHeight?: number;
  bottomDockPadding: number;
};

export function getHomeDisplayMetrics(size: HomeDisplaySize | undefined): HomeDisplayMetrics {
  const s = size ?? "standard";
  if (s === "compact") {
    return {
      cardPaddingH: 10,
      cardPaddingV: 6,
      overviewTitleSize: 11,
      overviewBodySize: 11,
      taskTitleSize: 13,
      taskMetaSize: 10,
      sectionHeadingSize: 11,
      iconSize: 15,
      headerIconSize: 16,
      quickActionMinHeight: 52,
      quickActionMaxHeight: 54,
      quickLabelSize: 9,
      quickLabelLineHeight: 11,
      projectThumbSize: 34,
      projectRowMinHeight: 58,
      projectTitleSize: 13,
      projectSublineSize: 10,
      metricPillFont: 10,
      gap: 6,
      kpiCardMinWidth: 86,
      kpiLabelSize: 9,
      kpiValueSize: 13,
      kpiIconSize: 16,
      filterChipFont: 11,
      filterTypeIconSize: 15,
      overviewCardMaxHeight: 210,
      bottomDockPadding: 178,
    };
  }
  if (s === "large") {
    return {
      cardPaddingH: 16,
      cardPaddingV: 10,
      overviewTitleSize: 14,
      overviewBodySize: 14,
      taskTitleSize: 16,
      taskMetaSize: 13,
      sectionHeadingSize: 14,
      iconSize: 21,
      headerIconSize: 22,
      quickActionMinHeight: 70,
      quickActionMaxHeight: 74,
      quickLabelSize: 12,
      quickLabelLineHeight: 15,
      projectThumbSize: 42,
      projectRowMinHeight: 78,
      projectTitleSize: 16,
      projectSublineSize: 13,
      metricPillFont: 12,
      gap: 10,
      kpiCardMinWidth: 102,
      kpiLabelSize: 11,
      kpiValueSize: 16,
      kpiIconSize: 20,
      filterChipFont: 13,
      filterTypeIconSize: 19,
      overviewCardMaxHeight: undefined,
      bottomDockPadding: 196,
    };
  }
  return {
    cardPaddingH: 12,
    cardPaddingV: 8,
    overviewTitleSize: 12,
    overviewBodySize: 12,
    taskTitleSize: 14,
    taskMetaSize: 11,
    sectionHeadingSize: 12,
    iconSize: 17,
    headerIconSize: 18,
    quickActionMinHeight: 58,
    quickActionMaxHeight: 62,
    quickLabelSize: 10,
    quickLabelLineHeight: 12,
    projectThumbSize: 36,
    projectRowMinHeight: 64,
    projectTitleSize: 14,
    projectSublineSize: 11,
    metricPillFont: 11,
    gap: 8,
    kpiCardMinWidth: 92,
    kpiLabelSize: 10,
    kpiValueSize: 14,
    kpiIconSize: 18,
    filterChipFont: 12,
    filterTypeIconSize: 17,
    overviewCardMaxHeight: 240,
    bottomDockPadding: 176,
  };
}

export type HomeSectionConfig = {
  id: HomeSectionId;
  enabled: boolean;
  /** quick_add is always locked (always on, not toggleable in UI) */
  locked?: boolean;
};

/** Bumped when stored layout should be normalized (e.g. compact Home defaults). */
export const HOME_LAYOUT_VERSION = 2;

export type HomeLayout = {
  sections: HomeSectionConfig[];
  widgets: HomeWidgetToggles;
  homeLayoutVersion?: number;
  /** Local Home typography / touch targets (not global font scale). */
  homeDisplaySize?: HomeDisplaySize;
};

/** Default Home: construction dashboard — KPI chips and home filters off; dock off (tabs handle navigation). */
const DEFAULT_SECTIONS: HomeSectionConfig[] = [
  { id: "open_tasks_chip", enabled: false },
  { id: "projects_chip", enabled: false },
  { id: "time_tracking_chip", enabled: false },
  { id: "expenses_chip", enabled: false },
  { id: "quick_capture_card", enabled: true },
  { id: "service_tasks_alert", enabled: true },
  { id: "current_work", enabled: true },
  { id: "project_filters", enabled: false },
  { id: "other_projects", enabled: true },
  { id: "calendar", enabled: true },
  { id: "quick_add", enabled: true, locked: true },
];

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  sections: DEFAULT_SECTIONS,
  widgets: {
    showHeaderChatShortcut: true,
    showQuickTime: true,
    showTodayPriorities: true,
    showBottomQuickActions: false,
  },
  homeLayoutVersion: HOME_LAYOUT_VERSION,
  homeDisplaySize: "standard",
};

export function getDefaultLayout(): HomeLayout {
  return {
    sections: [...DEFAULT_SECTIONS],
    widgets: { ...DEFAULT_HOME_LAYOUT.widgets },
    homeLayoutVersion: HOME_LAYOUT_VERSION,
    homeDisplaySize: "standard",
  };
}

const HOME_LAYOUT_KEY_V1 = "staveto_home_layout_v1";

export async function loadHomeLayout(): Promise<HomeLayout> {
  try {
    let raw = await AsyncStorage.getItem(HOME_LAYOUT_KEY);
    if (!raw) {
      raw = await AsyncStorage.getItem(HOME_LAYOUT_KEY_V1);
    }
    if (!raw) return getDefaultLayout();
    const parsed = JSON.parse(raw) as Partial<HomeLayout>;
    if (!parsed?.sections || !Array.isArray(parsed.sections)) return getDefaultLayout();
    // Migrate legacy "kpis" to individual chips
    const hasLegacyKpis = parsed.sections.some((s) => s.id === "kpis");
    const legacyKpisEnabled = hasLegacyKpis && (parsed.sections.find((s) => s.id === "kpis")?.enabled ?? true);
    const merged: HomeSectionConfig[] = [];
    for (const def of DEFAULT_SECTIONS) {
      const loaded = parsed.sections.find((s) => s.id === def.id);
      if (loaded) {
        merged.push({ ...def, enabled: loaded.enabled, locked: def.locked });
      } else if (hasLegacyKpis && ["open_tasks_chip", "projects_chip", "time_tracking_chip", "expenses_chip"].includes(def.id)) {
        merged.push({ ...def, enabled: legacyKpisEnabled, locked: def.locked });
      } else {
        merged.push({ ...def });
      }
    }
    const loadedWidgets: Partial<HomeWidgetToggles> = parsed.widgets ?? {};
    const parsedVersion =
      typeof (parsed as { homeLayoutVersion?: unknown }).homeLayoutVersion === "number"
        ? (parsed as { homeLayoutVersion: number }).homeLayoutVersion
        : 0;
    const rawDisplay = (parsed as { homeDisplaySize?: unknown }).homeDisplaySize;
    const homeDisplaySize: HomeDisplaySize =
      rawDisplay === "compact" || rawDisplay === "standard" || rawDisplay === "large" ? rawDisplay : "standard";

    const result: HomeLayout = {
      sections: merged,
      widgets: {
        showHeaderChatShortcut:
          typeof loadedWidgets.showHeaderChatShortcut === "boolean"
            ? loadedWidgets.showHeaderChatShortcut
            : DEFAULT_HOME_LAYOUT.widgets.showHeaderChatShortcut,
        showQuickTime:
          typeof loadedWidgets.showQuickTime === "boolean"
            ? loadedWidgets.showQuickTime
            : DEFAULT_HOME_LAYOUT.widgets.showQuickTime,
        showTodayPriorities:
          typeof loadedWidgets.showTodayPriorities === "boolean"
            ? loadedWidgets.showTodayPriorities
            : DEFAULT_HOME_LAYOUT.widgets.showTodayPriorities,
        showBottomQuickActions:
          typeof loadedWidgets.showBottomQuickActions === "boolean"
            ? loadedWidgets.showBottomQuickActions
            : DEFAULT_HOME_LAYOUT.widgets.showBottomQuickActions,
      },
      homeLayoutVersion: parsedVersion >= HOME_LAYOUT_VERSION ? parsedVersion : HOME_LAYOUT_VERSION,
      homeDisplaySize,
    };

    /** One-time migration: old homes often had filters, KPI chips, or floating dock on — compact default clears that. */
    if (parsedVersion < HOME_LAYOUT_VERSION) {
      result.sections = result.sections.map((s) => {
        if (s.id === "project_filters") return { ...s, enabled: false };
        if (["open_tasks_chip", "projects_chip", "time_tracking_chip", "expenses_chip"].includes(s.id)) {
          return { ...s, enabled: false };
        }
        return s;
      });
      result.widgets = { ...result.widgets, showBottomQuickActions: false };
      result.homeLayoutVersion = HOME_LAYOUT_VERSION;
      await AsyncStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(result));
    } else if (raw && !raw.includes("open_tasks_chip")) {
      await AsyncStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(result));
    }
    return result;
  } catch {
    return getDefaultLayout();
  }
}

export async function saveHomeLayout(layout: HomeLayout): Promise<void> {
  await AsyncStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(layout));
}

export async function loadCalendarCollapsed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(HOME_CALENDAR_COLLAPSED_KEY);
    return raw === "1";
  } catch {
    return true; // collapsed by default
  }
}

export async function saveCalendarCollapsed(collapsed: boolean): Promise<void> {
  await AsyncStorage.setItem(HOME_CALENDAR_COLLAPSED_KEY, collapsed ? "1" : "0");
}
