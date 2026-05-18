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
};

export function getDefaultLayout(): HomeLayout {
  return {
    sections: [...DEFAULT_SECTIONS],
    widgets: { ...DEFAULT_HOME_LAYOUT.widgets },
    homeLayoutVersion: HOME_LAYOUT_VERSION,
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
