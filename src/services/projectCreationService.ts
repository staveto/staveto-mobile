/**
 * User-facing project creation orchestration.
 * Hides BUILD / TRADE and other internal enums from UI; callers pass plain text + hints.
 */

import {
  collection,
  doc,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "../lib/rnFirestore";
import { db, getAuth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { ActiveProjectStorageType } from "../lib/projectTypeModel";
import { shouldUseCountryCatalogTemplate } from "../lib/projectTypeModel";
import type { PrimaryUsageMode } from "../lib/primaryUsageMode";
import { resolveTemplateIdForCountry } from "../utils/templateResolver";
import type { CreationMode, JobWorkflowKind, ServiceMaintenanceScope, WorkType } from "../lib/projectEnums";
import { createProjectFromTemplate, type CreateProjectFromTemplateParams } from "./projectFactory";
import { createProjectCreatedNotification } from "./notifications";
import type { ProjectCustomerFields } from "./customers";

export type InternalProjectHints = {
  /** From onboarding step 2 / profile — used only for optional BUILD catalog template. */
  countryCode?: string | null;
  /** From onboarding step 1 — nudges internal BUILD vs TRADE when description is thin. */
  primaryUsageMode?: PrimaryUsageMode | null;
};

export type ResolvedManualCreation = Pick<
  CreateProjectFromTemplateParams,
  "projectType" | "templateId" | "workType" | "creationMode" | "jobWorkflowKind" | "serviceMaintenanceScope"
>;

const BUILD_HINT =
  /\b(phase|phases|bau|stavba|stavebn|shell|roof|roofing|foundation|ziegel|beton|concrete|etage|stockwerk|renovation|renovierung|umbau|novostavba|neubau|generalunternehmer|gewerk|fázy|fazy|rekonstruk|rekonstrukc|sanierung|hrubá stavba|hruba stavba|montáž|montaz|elektroinstal|vodoinštal|výkop|vykop)\b/i;

/**
 * Resolves internal Firestore metadata for a blank manual project (no user-facing type pick).
 */
export function resolveManualBlankInternalMetadata(
  hints: InternalProjectHints,
  bundle: { name: string; description?: string }
): ResolvedManualCreation {
  const blob = `${bundle.name}\n${bundle.description ?? ""}`;
  const prefersBuild =
    hints.primaryUsageMode === "build" || (hints.primaryUsageMode !== "trade" && BUILD_HINT.test(blob));

  if (prefersBuild) {
    const useTemplate =
      !!hints.countryCode?.trim() &&
      shouldUseCountryCatalogTemplate({ selectedType: "BUILD", creationMethod: "template" });
    const templateId = useTemplate ? resolveTemplateIdForCountry(hints.countryCode) : "";
    const newBuildish = /\b(neubau|new build|novostavba|greenfield|nová stavba|nova stavba|rohbau|hrubá stavba)\b/i.test(blob);
    const workType: WorkType = newBuildish ? "NEW_BUILD" : "RENOVATION";
    return {
      projectType: "BUILD" as ActiveProjectStorageType,
      templateId,
      workType,
      creationMode: (templateId ? "TEMPLATE" : "MANUAL") as CreationMode,
      jobWorkflowKind: undefined,
      serviceMaintenanceScope: undefined,
    };
  }

  return {
    projectType: "TRADE" as ActiveProjectStorageType,
    templateId: "",
    workType: "REPAIR",
    creationMode: "MANUAL" as CreationMode,
    jobWorkflowKind: "STANDARD" as JobWorkflowKind,
    serviceMaintenanceScope: undefined,
  };
}

export type CreateManualBlankInput = {
  name: string;
  description?: string;
  hints: InternalProjectHints;
  /** Optional location line when caller collects it (in-app); kept separate from free-text description. */
  city?: string;
  addressText?: string;
};

/**
 * Creates a minimal Firestore project via {@link createProjectFromTemplate}.
 */
export async function createManualBlankProject(input: CreateManualBlankInput): Promise<string> {
  const meta = resolveManualBlankInternalMetadata(input.hints, {
    name: input.name,
    description: input.description,
  });
  const desc = input.description?.trim();
  const addressText =
    input.addressText?.trim() ||
    (desc && !input.city?.trim() ? desc : undefined);

  return createProjectFromTemplate({
    name: input.name.trim(),
    templateId: meta.templateId,
    projectType: meta.projectType,
    workType: meta.workType,
    creationMode: meta.creationMode,
    jobWorkflowKind: meta.jobWorkflowKind,
    serviceMaintenanceScope: meta.serviceMaintenanceScope,
    countryCode: input.hints.countryCode?.trim() || undefined,
    city: input.city?.trim() || undefined,
    addressText,
    phaseCustomizations: undefined,
  });
}

/** Matches web `SIMPLIFIED_LEGACY_WORK_TYPE` / `createDraftJob` for customer_job. */
export const SIMPLIFIED_LEGACY_JOB_ARCHETYPE = "customer_job" as const;

export type CreateDraftJobInput = {
  name: string;
  customerRequest?: string;
  addressText?: string;
  city?: string;
  countryCode?: string;
  customer?: ProjectCustomerFields;
};

/**
 * Web-aligned draft job create (phase sales / lifecycle new_request).
 * Also writes owner member so mobile access rules work immediately.
 * Company workspace is applied after create via `stampBusinessTeamProject` when needed.
 */
export async function createDraftJob(input: CreateDraftJobInput): Promise<string> {
  const currentUser = getAuth()?.currentUser ?? null;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie projektu.");
  }
  const ownerId = currentUser.uid;
  const name = input.name?.trim();
  if (!name) throw new Error("Názov zákazky je povinný.");

  const projectRef = doc(collection(db, "projects"));
  const projectId = projectRef.id;

  const projectData: Record<string, unknown> = {
    name,
    projectType: "TRADE",
    workType: "REPAIR",
    jobArchetype: SIMPLIFIED_LEGACY_JOB_ARCHETYPE,
    phase: "sales",
    lifecycleStatus: "new_request",
    salesStatus: "draft",
    quoteStatus: "none",
    creationMode: "MANUAL",
    jobsTabVisible: true,
    source: "mobile",
    ownerId,
    workspaceType: "personal",
    workspaceId: ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const customer = input.customer;
  if (customer?.customerId?.trim()) projectData.customerId = customer.customerId.trim();
  const customerRequest = input.customerRequest?.trim();
  if (customerRequest) projectData.customerRequest = customerRequest;
  if (customer?.customerName?.trim()) projectData.customerName = customer.customerName.trim();
  if (customer?.customerCompanyName?.trim()) {
    projectData.customerCompanyName = customer.customerCompanyName.trim();
  }
  if (customer?.customerContactPersonName?.trim()) {
    projectData.customerContactPersonName = customer.customerContactPersonName.trim();
  }
  if (customer?.customerEmail?.trim()) projectData.customerEmail = customer.customerEmail.trim();
  if (customer?.customerPhone?.trim()) projectData.customerPhone = customer.customerPhone.trim();
  if (input.addressText?.trim()) projectData.addressText = input.addressText.trim();
  if (input.city?.trim()) projectData.city = input.city.trim();
  if (input.countryCode?.trim()) {
    projectData.countryCode = input.countryCode.trim().toUpperCase();
  }

  await setDoc(projectRef, projectData);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, paths.projectMember(projectId, ownerId)), {
      userId: ownerId,
      role: "owner",
      addedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    /* project exists; member can be repaired later */
  }

  try {
    await createProjectCreatedNotification({
      userId: ownerId,
      projectId,
      projectName: name,
    });
  } catch {
    /* best effort */
  }

  return projectId;
}
