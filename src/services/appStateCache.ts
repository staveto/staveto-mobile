/**
 * Lightweight AsyncStorage cache for offline startup hydration.
 * No secrets — profile/org/project summaries only.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_SUMMARY_KEY = "staveto_cache_user_summary_v1";
const BUSINESS_ORG_SUMMARY_KEY = "staveto_cache_business_org_summary_v1";
const PROJECT_LIST_KEY = "staveto_cache_project_list_v1";
const LAST_PROJECT_ID_KEY = "staveto_cache_last_project_id_v1";

export type CachedUserSummary = {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  cachedAt: number;
};

export type CachedBusinessOrgSummary = {
  id: string;
  name?: string;
  status?: string;
  businessEnabled?: boolean;
  cachedAt: number;
};

/** Serializable project list entry — matches ProjectDoc fields used offline. */
export type CachedProjectEntry = Record<string, unknown> & { id: string; name: string };

export type CachedProjectList = {
  projects: CachedProjectEntry[];
  cachedAt: number;
};

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore disk errors */
  }
}

export async function loadCachedUserSummary(userId?: string | null): Promise<CachedUserSummary | null> {
  const data = await readJson<CachedUserSummary>(USER_SUMMARY_KEY);
  if (!data?.id) return null;
  if (userId && data.id !== userId) return null;
  return data;
}

export async function saveCachedUserSummary(summary: Omit<CachedUserSummary, "cachedAt">): Promise<void> {
  await writeJson(USER_SUMMARY_KEY, { ...summary, cachedAt: Date.now() });
}

export async function loadCachedBusinessOrgSummary(
  orgId?: string | null
): Promise<CachedBusinessOrgSummary | null> {
  const data = await readJson<CachedBusinessOrgSummary>(BUSINESS_ORG_SUMMARY_KEY);
  if (!data?.id) return null;
  if (orgId && data.id !== orgId) return null;
  return data;
}

export async function saveCachedBusinessOrgSummary(
  summary: Omit<CachedBusinessOrgSummary, "cachedAt">
): Promise<void> {
  await writeJson(BUSINESS_ORG_SUMMARY_KEY, { ...summary, cachedAt: Date.now() });
}

export async function loadCachedProjectList<T extends CachedProjectEntry = CachedProjectEntry>(): Promise<T[] | null> {
  const data = await readJson<CachedProjectList>(PROJECT_LIST_KEY);
  if (!data?.projects?.length) return null;
  return data.projects as T[];
}

export async function saveCachedProjectList(projects: CachedProjectEntry[]): Promise<void> {
  if (!projects.length) return;
  await writeJson(PROJECT_LIST_KEY, { projects, cachedAt: Date.now() });
}

export async function loadLastOpenedProjectId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_PROJECT_ID_KEY);
  } catch {
    return null;
  }
}

export async function saveLastOpenedProjectId(projectId: string | null): Promise<void> {
  try {
    if (projectId) {
      await AsyncStorage.setItem(LAST_PROJECT_ID_KEY, projectId);
    } else {
      await AsyncStorage.removeItem(LAST_PROJECT_ID_KEY);
    }
  } catch {
    /* ignore */
  }
}
