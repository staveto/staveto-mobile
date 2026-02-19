import AsyncStorage from "@react-native-async-storage/async-storage";

export const HOME_LAYOUT_KEY = "staveto_home_layout_v1";
export const HOME_CALENDAR_COLLAPSED_KEY = "staveto_home_calendar_collapsed_v1";

export type HomeSectionId =
  | "kpis"
  | "current_work"
  | "project_filters"
  | "other_projects"
  | "calendar"
  | "quick_add";

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
  { id: "kpis", enabled: true },
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

export async function loadHomeLayout(): Promise<HomeLayout> {
  try {
    const raw = await AsyncStorage.getItem(HOME_LAYOUT_KEY);
    if (!raw) return getDefaultLayout();
    const parsed = JSON.parse(raw) as HomeLayout;
    if (!parsed?.sections || !Array.isArray(parsed.sections)) return getDefaultLayout();
    // Merge with defaults to handle new sections
    const defaultIds = new Set(DEFAULT_SECTIONS.map((s) => s.id));
    const loadedIds = new Set(parsed.sections.map((s) => s.id));
    const merged: HomeSectionConfig[] = [];
    for (const def of DEFAULT_SECTIONS) {
      const loaded = parsed.sections.find((s) => s.id === def.id);
      if (loaded) {
        merged.push({
          ...def,
          enabled: loaded.enabled,
          locked: def.locked,
        });
      } else {
        merged.push({ ...def });
      }
    }
    for (const s of parsed.sections) {
      if (!defaultIds.has(s.id)) merged.push(s);
    }
    return { sections: merged };
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
