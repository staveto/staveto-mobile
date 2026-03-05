import AsyncStorage from "@react-native-async-storage/async-storage";

export const HOME_LAYOUT_KEY = "staveto_home_layout_v2";
export const HOME_CALENDAR_COLLAPSED_KEY = "staveto_home_calendar_collapsed_v1";

export type HomeSectionId =
  | "open_tasks_chip"
  | "projects_chip"
  | "time_tracking_chip"
  | "expenses_chip"
  | "current_work"
  | "project_filters"
  | "other_projects"
  | "calendar"
  | "quick_add"
  | "kpis"; // legacy, migrated to chips

export type HomeSectionConfig = {
  id: HomeSectionId;
  enabled: boolean;
  /** quick_add is always locked (always on, not toggleable in UI) */
  locked?: boolean;
};

export type HomeLayout = {
  sections: HomeSectionConfig[];
};

const DEFAULT_SECTIONS: HomeSectionConfig[] = [
  { id: "open_tasks_chip", enabled: true },
  { id: "projects_chip", enabled: true },
  { id: "time_tracking_chip", enabled: true },
  { id: "expenses_chip", enabled: true },
  { id: "current_work", enabled: true },
  { id: "project_filters", enabled: true },
  { id: "other_projects", enabled: true },
  { id: "calendar", enabled: true },
  { id: "quick_add", enabled: true, locked: true },
];

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  sections: DEFAULT_SECTIONS,
};

export function getDefaultLayout(): HomeLayout {
  return { sections: [...DEFAULT_SECTIONS] };
}

const HOME_LAYOUT_KEY_V1 = "staveto_home_layout_v1";

export async function loadHomeLayout(): Promise<HomeLayout> {
  try {
    let raw = await AsyncStorage.getItem(HOME_LAYOUT_KEY);
    if (!raw) {
      raw = await AsyncStorage.getItem(HOME_LAYOUT_KEY_V1);
    }
    if (!raw) return getDefaultLayout();
    const parsed = JSON.parse(raw) as HomeLayout;
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
    const result = { sections: merged };
    if (raw && !raw.includes("open_tasks_chip")) {
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
