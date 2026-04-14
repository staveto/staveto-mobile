/**
 * AI project generation service.
 * - generateProjectStructureWithAI: calls backend, returns validated plan
 * - createProjectFromAiPlan: calls backend to persist project + phases + tasks
 * - uploadAiDraftDocument: uploads technical docs to Storage for AI context
 */

import type { FirebaseAuthTypes } from "@react-native-firebase/auth";
import { getApp } from "@react-native-firebase/app";
import {
  validateAiProjectPlan,
  type AiProjectPlan,
} from "../lib/aiProjectSchema";
import { createProjectCreatedNotification } from "./notifications";
import { getStorage, getAuth, getFunctionsInstance } from "../firebase";
import { getExtraEnv } from "../lib/env";

const FUNCTIONS_REGION = "europe-west1";

const ERR_NOT_SIGNED_IN_SK =
  "Musíte byť prihlásený. Skúste sa odhlásiť a znova prihlásiť.";

/**
 * Resolves Firebase Auth user for callable calls. Waits briefly if persistence
 * has not restored `currentUser` yet (avoids false "not signed in" on cold start).
 */
async function resolveUserForAiCalls(): Promise<FirebaseAuthTypes.User> {
  const auth = getAuth();
  if (!auth) {
    throw new Error(ERR_NOT_SIGNED_IN_SK);
  }
  if (auth.currentUser) return auth.currentUser;
  return await new Promise((resolve, reject) => {
    const timeoutMs = 6000;
    const to = setTimeout(() => {
      unsub();
      if (auth.currentUser) resolve(auth.currentUser);
      else reject(new Error(ERR_NOT_SIGNED_IN_SK));
    }, timeoutMs);
    const unsub = auth.onAuthStateChanged((u) => {
      if (u) {
        clearTimeout(to);
        unsub();
        resolve(u);
      }
    });
  });
}

type GenStructureReq = {
  projectBrief: string;
  engineType?: string;
  workType?: string;
  documentStoragePaths?: string[];
  projectDetails?: string;
};

type GenStructureRes = { plan: unknown; raw?: string };

type CreateFromPlanReq = {
  plan: AiProjectPlan;
  originalBrief?: string;
  addressText?: string;
  countryCode?: string;
  city?: string;
};

type CreateFromPlanRes = { projectId: string };

type CallableWireError = {
  message?: string;
  status?: string;
  details?: unknown;
};

/**
 * HTTPS URL for Firebase callable (same project as {@link getApp}).
 * Optional env override for staging / emulator.
 */
function getCallableHttpUrl(
  functionName: "generateProjectStructure" | "createProjectFromAiPlan"
): string {
  const envKey =
    functionName === "generateProjectStructure"
      ? "EXPO_PUBLIC_AI_GENERATE_PROJECT_URL"
      : "EXPO_PUBLIC_AI_CREATE_PROJECT_URL";
  const override = getExtraEnv(envKey);
  if (override?.trim()) {
    if (__DEV__) {
      console.warn(`[aiProject] Callable URL override ${envKey}=`, override.trim());
    }
    return override.trim();
  }
  const projectId = getApp().options?.projectId ?? "staveto-mvp-5f251";
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${functionName}`;
}

function mapCallableWireError(errBody: CallableWireError): Error & { code?: string; details?: unknown } {
  const st = String(errBody.status ?? "INTERNAL");
  const msg = String(errBody.message ?? st);
  const e = new Error(msg) as Error & { code?: string; details?: unknown };
  const normalized = st.toUpperCase().replace(/-/g, "_");
  e.code =
    normalized === "UNAUTHENTICATED"
      ? "functions/unauthenticated"
      : st.startsWith("functions/")
        ? st
        : `functions/${st.toLowerCase().replace(/_/g, "-")}`;
  e.details = errBody.details;
  return e;
}

/**
 * Firebase HTTPS callable with `Authorization: Bearer <idToken>`.
 * Uses `redirect: "manual"` and re-POSTs to the final URL — Gen2 often redirects
 * cloudfunctions.net → *.run.app; default fetch would drop the Bearer header on redirect → 401 HTML.
 */
async function postFirebaseCallable<TReq, TRes>(
  functionName: "generateProjectStructure" | "createProjectFromAiPlan",
  data: TReq,
  idToken: string
): Promise<TRes> {
  let url = getCallableHttpUrl(functionName);
  const bodyStr = JSON.stringify({ data });
  const headers = (): Record<string, string> => ({
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  });

  const AI_CALLABLE_TIMEOUT_MS = 120_000;

  for (let hop = 0; hop < 8; hop++) {
    if (__DEV__ && hop === 0) {
      console.log(
        "[aiProject] callable HTTP POST",
        functionName,
        url.replace(/https:\/\/[^/]+/, "https://…")
      );
    }

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), AI_CALLABLE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: bodyStr,
        redirect: "manual",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(to);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (loc) {
        url = new URL(loc, url).href;
        if (__DEV__) {
          console.log("[aiProject] callable redirect hop", hop + 1, url.replace(/https:\/\/[^/?]+/, "…"));
        }
        continue;
      }
    }

    const text = await res.text();
    let parsed: { result?: TRes; error?: CallableWireError };
    try {
      parsed = JSON.parse(text) as { result?: TRes; error?: CallableWireError };
    } catch {
      if (res.status === 401 && text.includes("<html")) {
        throw new Error(
          "AI callable: 401 bez JSON (často IAM alebo redirect bez Bearer). Skús znova; ak pretrváva, over deploy Cloud Functions."
        );
      }
      throw new Error(`AI callable: neplatná odpoveď (${res.status}). ${text.slice(0, 160)}`);
    }

    if (parsed.error) {
      throw mapCallableWireError(parsed.error);
    }
    if (parsed.result !== undefined) {
      return parsed.result;
    }
    throw new Error(`AI callable: HTTP ${res.status}, bez result. ${text.slice(0, 200)}`);
  }

  throw new Error("AI callable: príliš veľa presmerovaní.");
}

/** Native SDK (handles endpoint + redirects internally). Used when HTTP path fails. */
async function nativeHttpsCallable<TReq, TRes>(
  functionName: "generateProjectStructure" | "createProjectFromAiPlan",
  payload: TReq
): Promise<TRes> {
  const fns = getFunctionsInstance();
  if (!fns) {
    throw new Error("Firebase Functions nie sú dostupné.");
  }
  const { httpsCallable } = require("@react-native-firebase/functions") as typeof import("@react-native-firebase/functions");
  const call = httpsCallable(fns, functionName) as (d: TReq) => Promise<{ data: TRes }>;
  const out = await call(payload);
  if (out?.data === undefined) {
    throw new Error("Native callable: prázdna odpoveď.");
  }
  return out.data;
}

async function invokeAiCallable<TReq, TRes>(
  functionName: "generateProjectStructure" | "createProjectFromAiPlan",
  payload: TReq,
  idToken: string
): Promise<TRes> {
  try {
    return await postFirebaseCallable<TReq, TRes>(functionName, payload, idToken);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "");
    const retryNative =
      msg.includes("401") ||
      msg.includes("neplatná odpoveď") ||
      msg.includes("príliš veľa presmerovaní") ||
      msg.includes("Cloud Run");
    if (!retryNative) throw e;
    if (__DEV__) {
      console.warn("[aiProject] HTTP callable failed, trying native httpsCallable:", msg.slice(0, 120));
    }
    return nativeHttpsCallable<TReq, TRes>(functionName, payload);
  }
}

/** RN Firebase often reports `functions/internal`; normalize for UI mapping and logs. */
export function normalizeCallableErrorCode(code?: string): string {
  if (!code || typeof code !== "string") return "";
  const c = code.trim().toLowerCase();
  return c.startsWith("functions/") ? c.slice("functions/".length) : c;
}

function devLogAiFailure(
  stage: "callable" | "empty_plan" | "validation",
  info: Record<string, unknown>
): void {
  if (!__DEV__) return;
  console.warn(`[aiProject] ${stage}`, info);
}

export interface GenerateProjectStructureOptions {
  engineType?: "BUILD" | "TRADE" | "MAINTENANCE";
  workType?: string | null;
  /** Storage paths of uploaded technical documents (PDF, images) for AI context */
  documentStoragePaths?: string[];
  /** User-provided details: roof type, area, floor count, etc. */
  projectDetails?: string;
}

export interface AiDraftDocument {
  localUri: string;
  fileName: string;
  mimeType: string;
}

/**
 * Upload a document to Storage for AI project generation.
 * Path: users/{uid}/aiProjectDrafts/{draftId}/documents/{filename}
 * Returns the storage path for the backend to download.
 */
export async function uploadAiDraftDocument(
  doc: AiDraftDocument,
  draftId: string
): Promise<string> {
  const user = await resolveUserForAiCalls();
  const uid = user.uid;

  const storage = getStorage();
  if (!storage) throw new Error("Firebase Storage nie je dostupný.");

  const safeName = doc.fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || `doc_${Date.now()}.pdf`;
  const storagePath = `users/${uid}/aiProjectDrafts/${draftId}/documents/${safeName}`;
  const storageRef = storage.ref(storagePath);

  await storageRef.putFile(doc.localUri, { contentType: doc.mimeType });
  return storagePath;
}

/**
 * Calls Firebase Cloud Function to generate project structure from brief.
 * Optionally includes technical documents for better AI planning.
 * Returns validated AiProjectPlan or throws.
 */
export async function generateProjectStructureWithAI(
  projectBrief: string,
  options?: GenerateProjectStructureOptions
): Promise<AiProjectPlan> {
  const brief = typeof projectBrief === "string" ? projectBrief.trim() : "";
  if (!brief) {
    throw new Error("Project brief is required");
  }

  const currentUser = await resolveUserForAiCalls();
  const uid = currentUser.uid;

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken(true);
  } catch (e) {
    if (__DEV__) console.warn("[aiProject] getIdToken failed:", e);
    throw new Error(ERR_NOT_SIGNED_IN_SK);
  }

  if (__DEV__) {
    console.log("[aiProject] Calling generateProjectStructure", {
      uid,
      briefLen: brief.length,
      engineType: options?.engineType,
      workType: options?.workType,
      hasDocs: (options?.documentStoragePaths?.length ?? 0) > 0,
      hasDetails: !!options?.projectDetails,
    });
  }

  let data: GenStructureRes;
  try {
    data = await invokeAiCallable<GenStructureReq, GenStructureRes>(
      "generateProjectStructure",
      {
        projectBrief: brief,
        engineType: options?.engineType,
        workType: options?.workType ?? undefined,
        documentStoragePaths: options?.documentStoragePaths?.length
          ? options.documentStoragePaths
          : undefined,
        projectDetails: options?.projectDetails?.trim() || undefined,
      },
      idToken
    );
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; details?: unknown };
    devLogAiFailure("callable", {
      code: normalizeCallableErrorCode(err?.code) || err?.code,
      message: typeof err?.message === "string" ? err.message.slice(0, 240) : String(err),
      briefLen: brief.length,
      engineType: options?.engineType,
      workType: options?.workType,
      hasDocs: (options?.documentStoragePaths?.length ?? 0) > 0,
      hasDetails: !!options?.projectDetails?.trim(),
    });
    throw e;
  }

  if (!data?.plan) {
    devLogAiFailure("empty_plan", { briefLen: brief.length });
    throw new Error("AI returned empty response. Please try again or create manually.");
  }

  const validationErrors = validateAiProjectPlan(data.plan);
  if (validationErrors) {
    const msg = validationErrors.map((e) => `${e.path}: ${e.message}`).join("; ");
    devLogAiFailure("validation", { msg: msg.slice(0, 400) });
    throw new Error(`Invalid AI response: ${msg}`);
  }

  if (__DEV__) console.log("[aiProject] Plan generated successfully");
  return data.plan as AiProjectPlan;
}

export interface CreateProjectFromAiPlanParams {
  plan: AiProjectPlan;
  originalBrief?: string;
  addressText?: string;
  countryCode?: string;
  city?: string;
}

/**
 * Calls Firebase Cloud Function to create project + phases + tasks from AI plan.
 * All Firestore writes happen in backend.
 */
export async function createProjectFromAiPlan(
  params: CreateProjectFromAiPlanParams
): Promise<string> {
  const { plan } = params;

  if (!plan.projectTitle?.trim()) {
    throw new Error("Názov projektu je povinný");
  }

  const user = await resolveUserForAiCalls();
  let idToken: string;
  try {
    idToken = await user.getIdToken(true);
  } catch (e) {
    if (__DEV__) console.warn("[aiProject] getIdToken before createProjectFromAiPlan:", e);
    throw new Error(ERR_NOT_SIGNED_IN_SK);
  }

  const resultData = await invokeAiCallable<CreateFromPlanReq, CreateFromPlanRes>(
    "createProjectFromAiPlan",
    {
      plan,
      originalBrief: params.originalBrief?.trim().slice(0, 600) || undefined,
      addressText: params.addressText?.trim() || undefined,
      countryCode: params.countryCode?.trim() || undefined,
      city: params.city?.trim() || undefined,
    },
    idToken
  );

  const projectId = resultData?.projectId;
  if (!projectId) {
    throw new Error("Backend did not return projectId.");
  }

  const uid = getAuth()?.currentUser?.uid;
  if (uid) {
    try {
      await createProjectCreatedNotification({
        userId: uid,
        projectId,
        projectName: plan.projectTitle.trim(),
      });
    } catch {
      // non-fatal
    }
  }

  return projectId;
}
