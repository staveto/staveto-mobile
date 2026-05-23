/**
 * Local device preferences: which job archetypes appear in the New Project picker.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NEW_JOB_ARCHETYPES,
  isNewJobArchetype,
  type NewJobArchetype,
} from "../lib/projectEnums";

export const VISIBLE_PROJECT_ARCHETYPES_KEY = "staveto_visible_project_archetypes_v1";

export function getDefaultVisibleProjectArchetypes(): NewJobArchetype[] {
  return [...NEW_JOB_ARCHETYPES];
}

/** Same as default for now; business-aware presets are a future enhancement. */
export function getRecommendedVisibleProjectArchetypes(): NewJobArchetype[] {
  // TODO: tailor presets when active business org + role/mode are available.
  return getDefaultVisibleProjectArchetypes();
}

export function orderVisibleArchetypes(ids: NewJobArchetype[]): NewJobArchetype[] {
  const set = new Set(ids);
  return NEW_JOB_ARCHETYPES.filter((id) => set.has(id));
}

export async function loadVisibleProjectArchetypes(): Promise<{
  visible: NewJobArchetype[];
  defaultUsed: boolean;
}> {
  try {
    const raw = await AsyncStorage.getItem(VISIBLE_PROJECT_ARCHETYPES_KEY);
    if (!raw) {
      return { visible: getDefaultVisibleProjectArchetypes(), defaultUsed: true };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { visible: getDefaultVisibleProjectArchetypes(), defaultUsed: true };
    }
    const valid = parsed.filter(
      (id): id is NewJobArchetype => typeof id === "string" && isNewJobArchetype(id)
    );
    const ordered = orderVisibleArchetypes(valid);
    if (ordered.length === 0) {
      return { visible: getDefaultVisibleProjectArchetypes(), defaultUsed: true };
    }
    return { visible: ordered, defaultUsed: false };
  } catch {
    return { visible: getDefaultVisibleProjectArchetypes(), defaultUsed: true };
  }
}

export async function saveVisibleProjectArchetypes(ids: NewJobArchetype[]): Promise<void> {
  const ordered = orderVisibleArchetypes(ids);
  await AsyncStorage.setItem(VISIBLE_PROJECT_ARCHETYPES_KEY, JSON.stringify(ordered));
}

export function logProjectTypePreferencesDebug(payload: Record<string, unknown>): void {
  if (__DEV__) console.log("[ProjectTypePreferencesDebug]", payload);
}
