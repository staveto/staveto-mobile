/** Dev: LAN/localhost. Production: MUSÍ byť EXPO_PUBLIC_API_URL (nastaviť v EAS env). */
const DEV_FALLBACK = "http://127.0.0.1:8787";
const envApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const baseURL =
  envApiUrl && envApiUrl.length > 0 ? envApiUrl : (__DEV__ ? DEV_FALLBACK : "https://staveto-app-api.workers.dev");

const REQUEST_TIMEOUT_MS = 15000;

let authToken: string | null = null;
let on401: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Volá sa pri 401 – typicky logout. Nastav z AuthContext po štarte. */
export function setOn401(fn: (() => void) | null) {
  on401 = fn;
}

/** Vráti aktuálnu API URL (na Login screene napr. pre debug). */
export function getBaseURL(): string {
  return baseURL.replace(/\/$/, "");
}

function url(path: string, params?: Record<string, string>) {
  const u = getBaseURL() + path;
  if (params && Object.keys(params).length) {
    const q = new URLSearchParams(params).toString();
    return q ? `${u}?${q}` : u;
  }
  return u;
}

function needsAuth(path: string) {
  return !/^\/(health|auth\/login|auth\/register)/.test(path);
}

async function request<T>(
  path: string,
  init: RequestInit & { params?: Record<string, string> } = {}
): Promise<T> {
  const { params, ...fetchInit } = init;
  const fullUrl = url(path, params);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((fetchInit.headers as Record<string, string>) ?? {}),
  };
  if (needsAuth(path) && authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(fullUrl, { ...fetchInit, headers, signal: controller.signal });
    clearTimeout(to);
    const contentType = res.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await res.json().catch(() => ({})) : {};
    if (!res.ok) {
      if (res.status === 401 && needsAuth(path)) {
        authToken = null;
        on401?.();
      }
      let msg = (data as { error?: string }).error ?? `HTTP ${res.status}`;
      // Len pri „generickej“ 401 (bez JSON alebo typická Cloudflare stránka) ukáž Cloudflare hint
      const generic401 =
        !isJson ||
        msg === `HTTP ${res.status}` ||
        /^(401\s*[-:]?\s*)?(Unauthorized|Authentication required|Authentification required)$/i.test(String(msg).trim());
      if (res.status === 401 && /auth\/(login|register)/.test(fullUrl) && generic401) {
        msg =
          "Server alebo sieť vracia 401. Skontroluj Cloudflare (Access/WAF) a či Worker beží.";
      }
      throw new Error(msg);
    }
    return data as T;
  } catch (e) {
    clearTimeout(to);
    if (e instanceof Error) {
      if (e.name === "AbortError") throw new Error(`Timeout after ${REQUEST_TIMEOUT_MS / 1000}s – skontroluj sieť a ${getBaseURL()}`);
      throw e;
    }
    throw new Error(String(e));
  }
}

export const api = {
  healthCheck(): Promise<{ ok: boolean; ts: number }> {
    return request("/health");
  },
  login(email: string): Promise<{ token: string; user: { id: string; email: string; name?: string }; orgId: string }> {
    return request("/auth/login", { method: "POST", body: JSON.stringify({ email }) });
  },
  register(
    email: string,
    password: string
  ): Promise<{ token: string; user: { id: string; email: string; name?: string }; orgId: string }> {
    return request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
  },
  getProjects(orgId: string): Promise<{ projects: Array<{ id: string; name: string }> }> {
    return request("/projects", { params: { orgId } });
  },
  createProject(
    orgId: string,
    name: string,
    shareWithinOrg: boolean
  ): Promise<{ project: { id: string; name: string } }> {
    return request("/projects", {
      method: "POST",
      body: JSON.stringify({ orgId, name: name.trim(), shareWithinOrg }),
    });
  },
  updateProject(orgId: string, projectId: string, name: string): Promise<{ project: { id: string; name: string } }> {
    return request(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgId, name: name.trim() }),
    });
  },
  deleteProject(orgId: string, projectId: string): Promise<{ deleted: boolean; id: string }> {
    return request(`/projects/${projectId}`, { method: "DELETE", params: { orgId } });
  },
  getTasks(
    orgId: string,
    bucket: string = "today",
    includeDone: number = 0
  ): Promise<{ tasks: Array<{ id: string; title: string; status?: string; dueDate?: string; projectId?: string }> }> {
    return request("/tasks", { params: { orgId, bucket, includeDone: String(includeDone) } });
  },
  createTask(
    orgId: string,
    title: string,
    projectId?: string
  ): Promise<{ task: { id: string; title: string; status?: string; projectId?: string } }> {
    return request("/tasks", {
      method: "POST",
      body: JSON.stringify({ orgId, title: title.trim(), projectId: projectId || undefined }),
    });
  },
  updateTaskStatus(orgId: string, taskId: string, status: string): Promise<{ task: { id: string; status: string } }> {
    return request(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ orgId, status }),
    });
  },
};

export { baseURL };
