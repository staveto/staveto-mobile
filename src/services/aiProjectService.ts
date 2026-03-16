/**
 * AI project generation service.
 * - generateProjectStructureWithAI: calls backend, returns validated plan
 * - createProjectFromAiPlan: calls backend to persist project + phases + tasks
 * - uploadAiDraftDocument: uploads technical docs to Storage for AI context
 */

import { httpsCallableFromUrl } from "@react-native-firebase/functions";
import { getApp } from "@react-native-firebase/app";
import {
  validateAiProjectPlan,
  type AiProjectPlan,
} from "../lib/aiProjectSchema";
import { createProjectCreatedNotification } from "./notifications";
import { getStorage, getAuth, getFunctionsInstance } from "../firebase";
import { getExtraEnv } from "../lib/env";

const REGION = "europe-west1";

/** v2 Callable: use explicit URL from env, or fallback to cloudfunctions.net (may not work for v2) */
function getCallableUrl(name: string): string {
  const envKey = name === "generateProjectStructure"
    ? "EXPO_PUBLIC_AI_GENERATE_PROJECT_URL"
    : "EXPO_PUBLIC_AI_CREATE_PROJECT_URL";
  const url = getExtraEnv(envKey);
  if (url?.trim()) return url.trim();
  const projectId = getApp().options?.projectId ?? "staveto-mvp-5f251";
  return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
}

export interface GenerateProjectStructureOptions {
  engineType?: "BUILD" | "TRADE" | "MAINTENANCE";
  workType?: string | null;
  /** Storage paths of uploaded technical documents (PDF, images) for AI context */
  documentStoragePaths?: string[];
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
  const auth = getAuth();
  const uid = auth?.currentUser?.uid;
  if (!uid) {
    throw new Error("Musíte byť prihlásený na nahrávanie dokumentu.");
  }

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

  const auth = getAuth();
  const currentUser = auth?.currentUser;
  if (!currentUser?.uid) {
    if (__DEV__) console.error("[aiProject] No authenticated user – auth.currentUser is null");
    throw new Error("Musíte byť prihlásený. Skúste sa odhlásiť a znova prihlásiť.");
  }
  const uid = currentUser.uid;

  // Force token refresh so Functions receive valid auth (fixes UNAUTHENTICATED)
  try {
    await currentUser.getIdToken(true);
  } catch (e) {
    if (__DEV__) console.warn("[aiProject] getIdToken refresh failed:", e);
  }

  const functions = getFunctionsInstance();
  if (!functions) {
    throw new Error("Firebase Functions nie sú dostupné.");
  }

  // v2 Callable + RN Firebase: use httpsCallableFromUrl with explicit URL (auth fix)
  const url = getCallableUrl("generateProjectStructure");
  if (__DEV__) console.log("[aiProject] Function URL:", url);
  const fn = httpsCallableFromUrl<
    {
      projectBrief: string;
      engineType?: string;
      workType?: string;
      documentStoragePaths?: string[];
    },
    { plan: unknown; raw?: string }
  >(functions, url);

  if (__DEV__) {
    console.log("[aiProject] Calling generateProjectStructure", {
      uid,
      briefLen: brief.length,
      engineType: options?.engineType,
      workType: options?.workType,
      hasDocs: (options?.documentStoragePaths?.length ?? 0) > 0,
    });
  }

  let result;
  try {
    result = await fn({
      projectBrief: brief,
      engineType: options?.engineType,
      workType: options?.workType ?? undefined,
      documentStoragePaths: options?.documentStoragePaths?.length
        ? options.documentStoragePaths
        : undefined,
    });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; details?: unknown };
    if (__DEV__) {
      console.error("[aiProject] generateProjectStructure failed:", {
        code: err?.code,
        message: err?.message,
        details: err?.details,
      });
    }
    throw e;
  }

  const data = result.data;

  if (!data?.plan) {
    if (__DEV__) console.error("[aiProject] Backend returned no plan");
    throw new Error("AI returned empty response. Please try again or create manually.");
  }

  const validationErrors = validateAiProjectPlan(data.plan);
  if (validationErrors) {
    const msg = validationErrors.map((e) => `${e.path}: ${e.message}`).join("; ");
    if (__DEV__) console.error("[aiProject] Validation failed:", msg);
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

  const functions = getFunctionsInstance();
  if (!functions) {
    throw new Error("Firebase Functions nie sú dostupné.");
  }

  const fn = httpsCallableFromUrl<
    {
      plan: AiProjectPlan;
      originalBrief?: string;
      addressText?: string;
      countryCode?: string;
      city?: string;
    },
    { projectId: string }
  >(functions, getCallableUrl("createProjectFromAiPlan"));

  const result = await fn({
    plan,
    originalBrief: params.originalBrief?.trim().slice(0, 600) || undefined,
    addressText: params.addressText?.trim() || undefined,
    countryCode: params.countryCode?.trim() || undefined,
    city: params.city?.trim() || undefined,
  });

  const projectId = result.data?.projectId;
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
