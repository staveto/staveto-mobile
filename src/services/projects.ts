import type { FirebaseFirestoreTypes } from "@react-native-firebase/firestore";
import firestore from "@react-native-firebase/firestore";
import { collection, collectionGroup, addDoc, query, where, getDocs, updateDoc, doc, deleteDoc, orderBy, getDoc, setDoc, serverTimestamp, limit } from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart, type SmartReadOptions } from "./firestoreSmartRead";
import { withTimeout } from "../utils/withTimeout";
import { loadCachedProjectList, saveCachedProjectList } from "./appStateCache";
import { db, auth, getCallable } from "../firebase";
import { getApp } from "@react-native-firebase/app";
import { paths } from "../lib/firestorePaths";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";
import type { WorkType, BusinessMode, CreationMode, JobWorkflowKind, ServiceMaintenanceScope } from "../lib/projectEnums";
import { getAssignedMemberIdsFromProject } from "../lib/projectAssignment";
import { legacyPhaseIdFromName } from "../lib/projectPhases";

const COLLECTION = "projects";
const CACHE_TTL_MS = 300_000;
/** Longer than firestoreSmartRead SERVER_READ_TIMEOUT_MS — second pass when cache returned empty. */
const OWNER_QUERY_SERVER_RETRY_MS = 28_000;

/** Unwrap Firebase / firestoreSmartRead wrapped errors so permission-denied is detected. */
export function getFirestoreErrorCode(error: unknown): string {
  let e: unknown = error;
  for (let depth = 0; depth < 4 && e; depth++) {
    if (typeof e === "object" && e !== null && "code" in e) {
      const c = (e as { code?: string }).code;
      if (typeof c === "string" && c.length > 0) return c;
    }
    e =
      typeof e === "object" && e !== null && "cause" in e
        ? (e as { cause: unknown }).cause
        : null;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("permission-denied")) return "permission-denied";
  return "";
}
let didLogProjectContext = false;
let sessionCache: { projects: ProjectDoc[]; fetchedAt: number; ownerUid: string } | null = null;
let diskCacheProjects: ProjectDoc[] | null = null;
let diskCacheOwnerUid: string | null = null;
let diskCacheHydrated = false;
let inFlightPromise: Promise<ProjectDoc[]> | null = null;
let memberQueryPermissionDenied = false;
let perfCallCount = 0;

function getCachedProjects(ownerUid: string): ProjectDoc[] | null {
  const uid = ownerUid.trim();
  if (!uid) return null;
  if (
    sessionCache &&
    sessionCache.ownerUid === uid &&
    Date.now() - sessionCache.fetchedAt <= CACHE_TTL_MS
  ) {
    return sessionCache.projects;
  }
  if (diskCacheProjects?.length && diskCacheOwnerUid === uid) {
    return diskCacheProjects;
  }
  return null;
}

/** Hydrate in-memory project cache from AsyncStorage for offline startup (current user only). */
export async function hydrateProjectsFromDiskCache(ownerUid: string): Promise<void> {
  const uid = ownerUid.trim();
  if (!uid) return;
  if (diskCacheHydrated && diskCacheOwnerUid === uid && diskCacheProjects?.length) return;

  diskCacheHydrated = true;
  const projects = await loadCachedProjectList<ProjectDoc>(uid);
  if (projects?.length) {
    diskCacheProjects = projects;
    diskCacheOwnerUid = uid;
    sessionCache = { projects, fetchedAt: Date.now(), ownerUid: uid };
    if (__DEV__) console.log(`[projects] hydrated ${projects.length} projects from disk cache for uid=${uid}`);
    return;
  }
  if (diskCacheOwnerUid !== uid) {
    diskCacheProjects = null;
    sessionCache = null;
    diskCacheOwnerUid = null;
  }
}

function setCachedProjects(projects: ProjectDoc[], ownerUid: string): void {
  const uid = ownerUid.trim();
  if (!uid) return;
  // Never cache an empty list: a failed/partial first load would hide real projects for CACHE_TTL_MS.
  if (!projects.length) {
    if (sessionCache?.ownerUid === uid) sessionCache = null;
    if (diskCacheOwnerUid === uid) {
      diskCacheProjects = null;
      diskCacheOwnerUid = null;
    }
    return;
  }
  sessionCache = { projects, fetchedAt: Date.now(), ownerUid: uid };
  diskCacheProjects = projects;
  diskCacheOwnerUid = uid;
  saveCachedProjectList(projects, uid).catch(() => {});
}

/** Clears in-memory project list cache (e.g. after delete, logout, or account switch). */
export function invalidateProjectsSessionCache(): void {
  sessionCache = null;
  diskCacheProjects = null;
  diskCacheOwnerUid = null;
  diskCacheHydrated = false;
  inFlightPromise = null;
  memberQueryPermissionDenied = false;
}

/** Owner-only field patch (e.g. idempotent `projectType` migration). */
export async function patchProjectDocument(projectId: string, patch: Record<string, unknown>): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    throw new Error("Musíte byť prihlásený.");
  }
  const ref = doc(db, COLLECTION, projectId);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  invalidateProjectsSessionCache();
}

export function getProjectsPerfStats(): { callCount: number } {
  return { callCount: perfCallCount };
}

export type ProjectDoc = {
  id: string;
  name: string;
  projectType?: "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "BUILD" | "MAINTENANCE"; // Support both old and new types
  templateId?: string;
  coverImageUrl?: string;
  coverImagePath?: string;
  coverImageUpdatedAt?: number;
  addressText?: string; // Project address for navigation
  countryCode?: string; // ISO 3166-1 alpha-2 (e.g. SK, AT)
  city?: string;
  equipmentCount?: number;
  ownerId?: string; // Read-only: included from existing DB field, no schema change
  archivedAt?: unknown; // Timestamp when archived (truthy = archived)
  createdAt?: string; // ISO string when project was created
  sharedWithCount?: number; // Number of non-owner members (for badge)
  isSharedToMe?: boolean; // True when current user is invited member (not owner)
  /** New attribute fields (nullable for backward compat) */
  workType?: WorkType | null;
  businessMode?: BusinessMode | null;
  creationMode?: CreationMode | null;
  isTemplate?: boolean; // Hidden from normal list when true
  /**
   * Job workspace marker for the Projects tab. New projects set `true` in `projectFactory`.
   * Legacy `MAINTENANCE` docs used as equipment hubs omit this field and are hidden from the tab.
   */
  jobsTabVisible?: boolean;
  /** Set once when client migrates legacy `projectType` to BUILD/TRADE (traceability). */
  projectTypeBeforeProductV2?: string;
  /** TRADE: standard job vs service/maintenance workflow (optional on legacy docs). */
  jobWorkflowKind?: JobWorkflowKind | null;
  /** When jobWorkflowKind is SERVICE: property vs equipment maintenance. */
  serviceMaintenanceScope?: ServiceMaintenanceScope | null;
  /** User-entered friendly job reference (optional). */
  referenceNumber?: string;
  /** Business team workspace: organization that owns this job. */
  orgId?: string;
  /** `team` = company project with assignment-based access. */
  workspaceType?: string;
  /** UIDs of org members explicitly assigned to this team project. */
  assignedMemberIds?: string[];
};

export type AssignedMemberSnapshot = {
  uid: string;
  name?: string;
  role?: string;
};

export function isBusinessTeamProject(project: Pick<ProjectDoc, "orgId" | "workspaceType">): boolean {
  return (
    typeof project.orgId === "string" &&
    project.orgId.trim().length > 0 &&
    (project.workspaceType === "team" || project.workspaceType === "business" || !project.workspaceType)
  );
}

export type ProjectPhaseDoc = { id: string; name: string; description?: string; order: number };

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectDoc | null {
  const d = docSnap.data();
  if (!d || typeof d !== "object") {
    if (__DEV__) console.warn(`[projects] toDoc: document ${docSnap.id} has no/invalid data, skipping`);
    return null;
  }
  let createdAt: string | undefined;
  const raw = d.createdAt;
  if (raw) {
    if (typeof raw === "string") createdAt = raw;
    else if (raw && typeof raw === "object" && typeof (raw as { toDate?: unknown }).toDate === "function") {
      createdAt = (raw as { toDate: () => Date }).toDate().toISOString();
    }
  }
  const workType = d.workType as WorkType | null | undefined;
  const businessMode = d.businessMode as BusinessMode | null | undefined;
  const creationMode = d.creationMode as CreationMode | null | undefined;
  const jwk = d.jobWorkflowKind as JobWorkflowKind | null | undefined;
  const sms = d.serviceMaintenanceScope as ServiceMaintenanceScope | null | undefined;
  return {
    id: docSnap.id,
    name: (d.name as string) ?? "",
    coverImageUrl: (d.coverImageUrl as string) || undefined,
    coverImagePath: (d.coverImagePath as string) || undefined,
    coverImageUpdatedAt: typeof d.coverImageUpdatedAt === "number" ? d.coverImageUpdatedAt : undefined,
    addressText: (d.addressText as string) || undefined,
    countryCode: (d.countryCode as string) || undefined,
    city: (d.city as string) || undefined,
    equipmentCount: typeof d.equipmentCount === "number" ? d.equipmentCount : undefined,
    projectType: d.projectType as "MANAGEMENT" | "RESIDENTIAL" | "TRADE" | "BUILD" | "MAINTENANCE" | undefined,
    templateId: d.templateId as string | undefined,
    ownerId: (d.ownerId as string) || undefined, // Read-only: read from existing DB field
    archivedAt: d.archivedAt ?? undefined,
    createdAt,
    sharedWithCount: typeof d.sharedWithCount === "number" ? d.sharedWithCount : undefined,
    workType: workType ?? undefined,
    businessMode: businessMode ?? undefined,
    creationMode: creationMode ?? undefined,
    isTemplate: !!d.isTemplate,
    jobsTabVisible:
      typeof d.jobsTabVisible === "boolean" ? (d.jobsTabVisible as boolean) : undefined,
    projectTypeBeforeProductV2:
      typeof d.projectTypeBeforeProductV2 === "string" ? (d.projectTypeBeforeProductV2 as string) : undefined,
    jobWorkflowKind: jwk === "STANDARD" || jwk === "SERVICE" ? jwk : undefined,
    serviceMaintenanceScope:
      sms === "PROPERTY" || sms === "EQUIPMENT" ? sms : undefined,
    referenceNumber:
      typeof d.referenceNumber === "string" && d.referenceNumber.trim() !== ""
        ? (d.referenceNumber as string).trim()
        : undefined,
    orgId: typeof d.orgId === "string" && d.orgId.trim() !== "" ? (d.orgId as string).trim() : undefined,
    workspaceType:
      typeof d.workspaceType === "string" && d.workspaceType.trim() !== ""
        ? (d.workspaceType as string).trim()
        : undefined,
    assignedMemberIds: getAssignedMemberIdsFromProject(d as Record<string, unknown>),
  };
}

export async function createProject(ownerId: string, name: string): Promise<ProjectDoc> {
  // CRITICAL FIX: Always use auth.currentUser.uid, never trust ownerId from params
  // Use the exported auth instance from firebase.ts (not getAuth())
  const currentUser = auth.currentUser;
  
  console.log(`[projects] DEBUG: auth.currentUser:`, currentUser);
  console.log(`[projects] DEBUG: params.ownerId:`, ownerId);
  
  if (!currentUser || !currentUser.uid) {
    console.error(`[projects] ERROR: auth.currentUser is null or uid is missing!`);
    throw new Error('Musíte byť prihlásený na vytvorenie projektu. auth.currentUser je null.');
  }
  
  const actualOwnerId = currentUser.uid; // Always use auth.currentUser.uid

  if (!didLogProjectContext) {
    didLogProjectContext = true;
    const app = getApp();
    console.log("[projects] RNFirebase projectId:", app?.options?.projectId);
    console.log("[projects] auth.currentUser.uid:", actualOwnerId);
  }
  
  // Debug: Verify ownerId matches auth.currentUser.uid
  if (ownerId && ownerId !== actualOwnerId) {
    console.warn(`[projects] WARNING: params.ownerId (${ownerId}) differs from auth.currentUser.uid (${actualOwnerId}). Using auth.currentUser.uid.`);
  }
  
  // Check subscription limit before creating project
  try {
    const existingProjects = await listMyProjects(actualOwnerId);
    const limitCheck = await checkLimit(actualOwnerId, "projects", existingProjects.length);
    
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.message || `Dosiahli ste limit projektov pre váš plán (${limitCheck.limit}). Zvážte upgrade na vyšší tier.`);
    }
  } catch (error: any) {
    // If limit check fails, throw error (don't create project)
    if (error.message && error.message.includes("limit")) {
      throw error;
    }
    // If it's a different error (e.g., subscription service unavailable), log but allow creation
    // Server-side rules will enforce limits as backup
    console.warn("[projects] Subscription limit check failed, allowing creation (server will enforce):", error);
  }
  
  console.log(`[projects] Creating project: name="${name}", ownerId="${actualOwnerId}" (from auth.currentUser.uid)`);
  
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, COLLECTION), {
    ownerId: actualOwnerId, // Always auth.currentUser.uid
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
  });
  return { id: ref.id, name: name.trim() };
}

export async function listProjectPhases(
  projectId: string,
  readOpts?: SmartReadOptions
): Promise<ProjectPhaseDoc[]> {
  console.log(`[projects] listProjectPhases called for projectId: ${projectId}`);
  
  // DEBUG: Check auth state
  const currentUser = auth.currentUser;
  const currentUserUid = currentUser?.uid;
  console.log(`[projects] listProjectPhases: auth.currentUser?.uid = "${currentUserUid}"`);
  
  if (!currentUserUid) {
    console.error(`[projects] listProjectPhases: auth.currentUser is null`);
    throw new Error('Musíte byť prihlásený na načítanie fáz.');
  }
  
  try {
    const c = collection(db, paths.projectPhases(projectId));
    console.log(`[projects] listProjectPhases: querying phases collection (unordered)...`);
    const snap = await getDocsSmart(c, readOpts);
    console.log(`[projects] Found ${snap.docs.length} phases in Firestore`);

    const phases = snap.docs
      .map((d) => {
        try {
          const x = d.data();
          if (!x || typeof x !== "object") {
            if (__DEV__) console.warn(`[projects] listProjectPhases: doc ${d.id} has no data, skipping`);
            return null;
          }
          return {
            id: d.id,
            name: (x.name as string) ?? "",
            description: x.description as string | undefined,
            order: (x.order as number) ?? 0,
          };
        } catch (err) {
          if (__DEV__) console.warn(`[projects] listProjectPhases: failed for doc ${d.id}:`, err);
          return null;
        }
      })
      .filter((p): p is { id: string; name: string; description?: string; order: number } => p != null);
    phases.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    if (phases.length > 0) return phases;

    // Web AI apply (`phase` string on tasks, no phases subcollection) — derive like office web.
    const taskCol = collection(db, paths.projectTasks(projectId));
    const taskSnap = await getDocsSmart(taskCol, readOpts);
    const derived = derivePhasesFromTaskDocs(taskSnap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })));
    if (__DEV__ && derived.length > 0) {
      console.log(`[projects] listProjectPhases: derived ${derived.length} phases from task.phase / phaseTitle`);
    }
    return derived;
  } catch (error: any) {
    console.error(`[projects] listProjectPhases error:`, error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Unknown error';
    
    if (errorCode === 'permission-denied') {
      console.error(`[projects] listProjectPhases: PERMISSION DENIED for project ${projectId}`);
      console.error(`[projects] listProjectPhases: auth.currentUser.uid = "${currentUserUid}"`);
      console.error(`[projects] listProjectPhases: Firestore rule: projectOwner(${projectId})`);
      console.error(`[projects] listProjectPhases: Rule check: get(projects/${projectId}).data.ownerId == ${currentUserUid}`);
      console.error(`[projects] listProjectPhases: Returning empty array instead of throwing error`);
      // Return empty array instead of throwing - allows app to continue
      return [];
    }
    
    throw error;
  }
}

function readPhaseNameFromTaskData(data: Record<string, unknown>): string {
  const fromTitle = typeof data.phaseTitle === "string" ? data.phaseTitle.trim() : "";
  if (fromTitle) return fromTitle;
  const fromLegacy = typeof data.phase === "string" ? data.phase.trim() : "";
  return fromLegacy;
}

/** When `projects/{id}/phases` is empty, build phase rows from task `phase` / `phaseTitle` (web AI jobs). */
export function derivePhasesFromTaskDocs(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): ProjectPhaseDoc[] {
  const byKey = new Map<string, ProjectPhaseDoc>();
  let order = 0;

  for (const d of docs) {
    const x = d.data;
    if (x.isActive === false) continue;
    const phaseName = readPhaseNameFromTaskData(x);
    const phaseIdRaw = typeof x.phaseId === "string" ? x.phaseId.trim() : "";
    const key = phaseIdRaw || (phaseName ? legacyPhaseIdFromName(phaseName) : "");
    if (!key) continue;

    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: key,
      name: phaseName || key,
      order: order++,
    });
  }

  return [...byKey.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Heal members/{uid}, assignedMemberIds, and projectRefs when legacy assignment docs exist. */
export async function healProjectAccessForCurrentUser(projectId: string): Promise<void> {
  const normalized = projectId.trim();
  if (!normalized) return;
  try {
    const heal = getCallable<
      { projectId: string },
      { ok: boolean; healed?: boolean; assignedPatched?: boolean }
    >("ensureMyProjectMemberIndex");
    await heal({ projectId: normalized });
    return;
  } catch {
    /* New callable may be unavailable — fall back to deployed sync. */
  }
  try {
    const sync = getCallable<
      { projectId: string; healOnly: boolean },
      { createdCount?: number; projectCount?: number; healed?: boolean }
    >("syncMyProjectAssignmentNotifications");
    await sync({ projectId: normalized, healOnly: true });
  } catch {
    /* Best effort — rules may already allow read after heal. */
  }
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? "";
  const message = (error as { message?: string })?.message ?? "";
  return (
    code === "permission-denied" ||
    message.includes("permission-denied") ||
    message.includes("PERMISSION_DENIED") ||
    message.toLowerCase().includes("insufficient permissions")
  );
}

export async function getProject(projectId: string): Promise<ProjectDoc | null> {
  console.log(`[projects] getProject: fetching project ${projectId}`);
  
  // DEBUG: Check auth state
  const currentUser = auth.currentUser;
  const currentUserUid = currentUser?.uid;
  console.log(`[projects] getProject: auth.currentUser?.uid = "${currentUserUid}"`);
  
  if (!currentUserUid) {
    console.error(`[projects] getProject: auth.currentUser is null`);
    throw new Error('Musíte byť prihlásený na načítanie projektu.');
  }
  
  try {
    const docRef = doc(db, COLLECTION, projectId);
    let docSnap = await getDocSmart(docRef);
    
    if (!docSnap.exists()) {
      console.warn(`[projects] getProject: project ${projectId} does not exist`);
      return null;
    }
    
    const projectData = docSnap.data();
    const projectOwnerId = projectData.ownerId;
    console.log(`[projects] getProject: project ${projectId} exists`);
    console.log(`[projects] getProject: project.ownerId = "${projectOwnerId}"`);
    console.log(`[projects] getProject: currentUser.uid = "${currentUserUid}"`);
    console.log(`[projects] getProject: owner match = ${projectOwnerId === currentUserUid ? 'YES ✅' : 'NO ❌'}`);
    
    // Note: Firestore rules will block access if ownerId doesn't match
    // So if we get here, the project is accessible (rules passed)
    // But we still log for debugging
    if (projectOwnerId !== currentUserUid) {
      console.warn(`[projects] getProject: WARNING - ownerId mismatch (but rules allowed access)`);
      console.warn(`[projects] getProject: project.ownerId="${projectOwnerId}" vs currentUser.uid="${currentUserUid}"`);
      // Don't throw - Firestore rules already handled permission check
      // If rules allowed access, we can return the project
    }
    
    const project = toDoc({ id: docSnap.id, data: docSnap.data.bind(docSnap) });
    return project ?? null;
  } catch (error: any) {
    if (isPermissionDeniedError(error)) {
      await healProjectAccessForCurrentUser(projectId);
      try {
        const docRef = doc(db, COLLECTION, projectId);
        const retrySnap = await getDocSmart(docRef, { forceServer: true });
        if (!retrySnap.exists()) return null;
        const project = toDoc({ id: retrySnap.id, data: retrySnap.data.bind(retrySnap) });
        return project ?? null;
      } catch (retryError) {
        console.error(`[projects] getProject retry error:`, retryError);
        throw new Error(
          `Nemáte oprávnenie zobraziť tento projekt. Požiadajte manažéra o opätovné priradenie.`
        );
      }
    }

    console.error(`[projects] getProject error:`, error);
    throw error;
  }
}

/**
 * collectionGroup("members") matches projects/{projectId}/members/* and organizations/{orgId}/members/*.
 * Only the former is a project membership.
 */
function projectIdFromProjectMembersDoc(
  path: string,
  parent: FirebaseFirestoreTypes.CollectionReference | null | undefined
): string | null {
  if (!parent || parent.id !== "members") {
    console.log(`[projects] skipped non-project member doc: ${path}`);
    return null;
  }
  const projectDocRef = parent.parent;
  if (!projectDocRef?.id) {
    console.log(`[projects] skipped non-project member doc: ${path}`);
    return null;
  }
  const rootCollection = projectDocRef.parent;
  if (!rootCollection || rootCollection.id !== "projects") {
    console.log(`[projects] skipped non-project member doc: ${path}`);
    return null;
  }
  return projectDocRef.id;
}

/**
 * Internal helper to load all projects (including archived)
 */
async function listAllMyProjectsInternal(ownerId: string, forceServerRead?: boolean): Promise<ProjectDoc[]> {
  const smartOpts = { forceServer: forceServerRead ?? false };
  // CRITICAL FIX: Always use auth.currentUser.uid, never trust ownerId from params
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    console.warn('[projects] listAllMyProjectsInternal: auth.currentUser is null, returning empty array');
    return [];
  }
  
  const actualOwnerId = currentUser.uid; // Always use auth.currentUser.uid
  
  // Guard: ownerId must be defined
  if (!ownerId) {
    console.warn('[projects] listAllMyProjectsInternal called with undefined ownerId, using auth.currentUser.uid');
  } else if (ownerId !== actualOwnerId) {
    console.warn(`[projects] listAllMyProjectsInternal: ownerId param (${ownerId}) differs from auth.currentUser.uid (${actualOwnerId}). Using auth.currentUser.uid.`);
  }
  
  perfCallCount += 1;
  const startMs = Date.now();
  console.log(`[projects] listAllMyProjectsInternal: querying with ownerId="${actualOwnerId}" (from auth.currentUser.uid)`);
  console.log(`[projects] Query: collection('projects'), where('ownerId', '==', '${actualOwnerId}')`);
  
  try {
    // CRITICAL: Query MUST use where('ownerId', '==', auth.currentUser.uid)
    // This ensures Firestore rules can check resource.data.ownerId == uid()
    const ownerQuery = query(
      collection(db, COLLECTION),
      where("ownerId", "==", actualOwnerId)
    );
    let ownerSnap = await getDocsSmart(ownerQuery, smartOpts);
    // Empty + fromCache: first read may be stale (server timeout in smart read → empty cache). Re-fetch from server once.
    const ownerMeta = (ownerSnap as { metadata?: { fromCache?: boolean } }).metadata;
    if (
      ownerSnap.docs.length === 0 &&
      !forceServerRead &&
      ownerMeta?.fromCache === true
    ) {
      try {
        const serverPromise = getDocs(ownerQuery, { source: "server" }) as Promise<
          FirebaseFirestoreTypes.QuerySnapshot<FirebaseFirestoreTypes.DocumentData>
        >;
        const serverSnap = await withTimeout(
          serverPromise,
          OWNER_QUERY_SERVER_RETRY_MS,
          "projects:ownerQuery:serverRetry"
        );
        if (serverSnap.docs.length > 0) {
          ownerSnap = serverSnap;
          if (__DEV__) {
            console.warn(
              "[projects] Owner query: recovered projects after server-only retry (empty result was cache-only)."
            );
          }
        }
      } catch (retryErr) {
        if (__DEV__) console.warn("[projects] Owner query server retry failed:", retryErr);
      }
    }
    console.log(`[projects] listAllMyProjectsInternal: found ${ownerSnap.docs.length} owner projects`);
    
    // Debug: Check ownerId in each project
    ownerSnap.docs.forEach((doc) => {
      const data = doc.data();
      const docOwnerId = data.ownerId;
      console.log(`[projects] Project ${doc.id}: ownerId="${docOwnerId}", match? ${docOwnerId === actualOwnerId ? 'YES ✅' : 'NO ❌'}`);
    });

    const ownerProjects = ownerSnap.docs
      .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }))
      .filter((p): p is ProjectDoc => p != null);

    // Shared projects: collectionGroup(members) is authoritative when available.
    // users/{uid}/projectRefs can lag after leaving; do not list ref-only projects without a matching members doc.
    const memberProjectIds = new Set<string>();
    const ownerIds = new Set(ownerProjects.map((p) => p.id));

    // Source 1: collectionGroup('members') where userId == uid (projects/*/members only — not organizations/*/members)
    if (!memberQueryPermissionDenied) {
      try {
        const membersGroup = collectionGroup(db, "members");
        const memberQuery = query(membersGroup, where("userId", "==", actualOwnerId));
        const memberSnap = await getDocsSmart(memberQuery, smartOpts);
        memberSnap.docs.forEach((d) => {
          const projectId = projectIdFromProjectMembersDoc(d.ref.path, d.ref.parent);
          if (!projectId) return;
          if (!ownerIds.has(projectId)) memberProjectIds.add(projectId);
        });
        if (memberSnap.docs.length > 0) {
          console.log(`[projects] listAllMyProjectsInternal: found ${memberSnap.docs.length} member docs via collectionGroup`);
        }
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        const msg = (error as { message?: string })?.message ?? "";
        const isPermDenied =
          code === "permission-denied" ||
          code === "firestore/permission-denied" ||
          (typeof msg === "string" && msg.includes("permission-denied"));
        if (isPermDenied) {
          memberQueryPermissionDenied = true;
        } else {
          if (__DEV__) console.warn("[projects] Failed to load member projects via collectionGroup:", error);
        }
      }
    }

    // Source 2: users/{uid}/projectRefs — merge with membership check (skip stale refs after leave)
    try {
      const refsSnap = await getDocsSmart(
        collection(db, paths.userProjectRefs(actualOwnerId)),
        smartOpts
      );
      const refOnlyToVerify: string[] = [];
      for (const d of refsSnap.docs) {
        const raw = d.data() as Record<string, unknown>;
        const projectId =
          typeof raw.projectId === "string" && raw.projectId.trim() !== ""
            ? (raw.projectId as string)
            : d.id;
        if (!projectId || ownerIds.has(projectId)) continue;
        if (memberProjectIds.has(projectId)) continue;
        if (memberQueryPermissionDenied) {
          memberProjectIds.add(projectId);
          continue;
        }
        refOnlyToVerify.push(projectId);
      }
      for (const projectId of refOnlyToVerify) {
        try {
          const mq = query(
            collection(db, paths.projectMembers(projectId)),
            where("userId", "==", actualOwnerId),
            limit(1)
          );
          const mSnap = await getDocsSmart(mq, smartOpts);
          if (mSnap.empty) {
            if (__DEV__) {
              console.log("[projects] Skipping projectRef (no members doc for user)", projectId);
            }
            continue;
          }
          memberProjectIds.add(projectId);
        } catch (vErr) {
          console.warn("[projects] projectRef membership verify failed, keeping ref", projectId, vErr);
          memberProjectIds.add(projectId);
        }
      }
    } catch (error) {
      console.warn("[projects] Failed to load member project refs:", error);
    }

    const memberProjects: ProjectDoc[] = [];
    for (const projectId of memberProjectIds) {
      try {
        const snap = await getDocSmart(doc(db, COLLECTION, projectId), smartOpts);
        if (!snap.exists()) continue;
        const p = toDoc({ id: snap.id, data: snap.data.bind(snap) });
        if (!p) continue;
        p.isSharedToMe = true;
        memberProjects.push(p);
      } catch (error) {
        console.warn(`[projects] Failed to load member project ${projectId}:`, error);
      }
    }

    const merged = [...ownerProjects, ...memberProjects].filter(
      (project, index, arr) => arr.findIndex((x) => x.id === project.id) === index
    );
    const durationMs = Date.now() - startMs;
    if (perfCallCount === 1) {
      console.log(`[projects] perf: first load took ${durationMs}ms`);
    }
    console.log(`[projects] perf: call count this session = ${perfCallCount}`);
    console.log(
      `[projects] listAllMyProjectsInternal: owner=${ownerProjects.length}, member=${memberProjects.length}, merged=${merged.length}`
    );
    return merged;
  } catch (error: any) {
    console.error(`[projects] listAllMyProjectsInternal error:`, error);
    const errorCode = getFirestoreErrorCode(error) || error.code || "";

    if (errorCode === "permission-denied" || errorCode === "firestore/permission-denied") {
      console.error(`[projects] PERMISSION DENIED:`);
      console.error(`  - auth.currentUser.uid="${actualOwnerId}"`);
      console.error(`  - Query: where('ownerId', '==', '${actualOwnerId}')`);
      console.error(`  - Firestore rule: resource.data.ownerId == uid()`);
      console.error(`  - Check: Are projects in DB using ownerId="${actualOwnerId}"?`);
      console.error(`[projects] Returning empty array instead of throwing error`);
      // Return empty array instead of throwing - this allows app to continue
      // User might not have any projects yet, or projects have different ownerId
      return [];
    }

    const diskProjects = await loadCachedProjectList<ProjectDoc>(actualOwnerId);
    if (diskProjects?.length) {
      if (__DEV__) console.warn("[projects] load failed, using disk cache:", diskProjects.length);
      return diskProjects;
    }
    
    // For other errors, still throw
    throw error;
  }
}

/**
 * List active (non-archived) projects for a user
 * Used for dashboard, expense selection, etc.
 * @param forceServerRead - When true, bypasses cache (use after sync to get fresh sharedWithCount)
 */
export async function listMyProjects(ownerId: string, options?: { forceServerRead?: boolean }): Promise<ProjectDoc[]> {
  const force = options?.forceServerRead === true;
  const uid = ownerId.trim();
  if (!force) {
    await hydrateProjectsFromDiskCache(uid);
    const cached = getCachedProjects(uid);
    if (cached) {
      const active = cached.filter((p) => !p.archivedAt);
      if (__DEV__) console.log(`[projects] listMyProjects: cache hit, ${active.length} active`);
      return active;
    }
    if (inFlightPromise) {
      const all = await inFlightPromise;
      return all.filter((p) => !p.archivedAt);
    }
  }
  const promise = listAllMyProjectsInternal(ownerId, force)
    .then((p) => {
      inFlightPromise = null;
      setCachedProjects(p, uid);
      return p;
    })
    .catch((e) => {
      inFlightPromise = null;
      throw e;
    });
  if (!force) inFlightPromise = promise;
  const allProjects = await promise;
  const activeProjects = allProjects.filter((project) => !project.archivedAt);
  console.log(`[projects] listMyProjects: ${allProjects.length} total projects, ${activeProjects.length} active (non-archived) projects`);
  return activeProjects;
}

/**
 * List all projects (including archived) for a user
 * Used for ProjectsScreen where archived projects should be visible
 */
export async function listAllMyProjects(ownerId: string, options?: { forceServerRead?: boolean }): Promise<ProjectDoc[]> {
  const force = options?.forceServerRead === true;
  const uid = ownerId.trim();
  if (!force) {
    await hydrateProjectsFromDiskCache(uid);
    const cached = getCachedProjects(uid);
    if (cached && cached.length > 0) {
      if (__DEV__) console.log(`[projects] listAllMyProjects: cache hit, ${cached.length} projects`);
      return cached;
    }
    if (inFlightPromise) return inFlightPromise;
  }
  const promise = listAllMyProjectsInternal(ownerId, force)
    .then((p) => {
      inFlightPromise = null;
      setCachedProjects(p, uid);
      return p;
    })
    .catch((e) => {
      inFlightPromise = null;
      throw e;
    });
  if (!force) inFlightPromise = promise;
  return promise;
}

export async function updateProject(
  _ownerId: string,
  projectId: string,
  name: string,
  addressText?: string | null,
  countryCode?: string | null,
  city?: string | null,
  isTemplate?: boolean
): Promise<void> {
  // CRITICAL FIX: Always use auth.currentUser.uid for verification
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na úpravu projektu.');
  }

  const ref = doc(db, COLLECTION, projectId);
  const update: Record<string, unknown> = {
    name: name.trim(),
    updatedAt: serverTimestamp(),
  };
  if (addressText !== undefined) update.addressText = (addressText ?? "").trim() || null;
  if (countryCode !== undefined) update.countryCode = (countryCode ?? "").trim() || null;
  if (city !== undefined) update.city = (city ?? "").trim() || null;
  if (isTemplate !== undefined) update.isTemplate = isTemplate;
  await updateDoc(ref, update);
  console.log(`[projects] Updated project ${projectId}: name="${name.trim()}"`);
}

export async function setProjectAsTemplate(_ownerId: string, projectId: string, isTemplate: boolean): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na úpravu projektu.');
  }
  const ref = doc(db, COLLECTION, projectId);
  await updateDoc(ref, { isTemplate, updatedAt: serverTimestamp() });
  console.log(`[projects] Set project ${projectId} isTemplate=${isTemplate}`);
}

export async function deleteProject(_ownerId: string, projectId: string): Promise<void> {
  // CRITICAL FIX: Always use auth.currentUser.uid for verification
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vymazanie projektu.');
  }
  
  const ref = doc(db, COLLECTION, projectId);
  await deleteDoc(ref);
  invalidateProjectsSessionCache();
  console.log(`[projects] Deleted project ${projectId}`);
}

export async function archiveProject(_ownerId: string, projectId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na archiváciu projektu.');
  }

  const ref = doc(db, COLLECTION, projectId);
  await updateDoc(ref, {
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  console.log(`[projects] Archived project ${projectId}`);
}

export async function unarchiveProject(_ownerId: string, projectId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na obnovenie projektu.');
  }

  const ref = doc(db, COLLECTION, projectId);
  await updateDoc(ref, {
    archivedAt: null,
    updatedAt: serverTimestamp(),
  });
  console.log(`[projects] Unarchived project ${projectId}`);
}

export async function createPhase(projectId: string, name: string): Promise<ProjectPhaseDoc> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vytvorenie fázy.');
  }
  
  // Verify project exists and user is owner
  const projectRef = doc(db, paths.project(projectId));
  const projectSnap = await getDocSmart(projectRef);
  
  if (!projectSnap.exists()) {
    throw new Error(`Projekt ${projectId} neexistuje.`);
  }
  
  const projectData = projectSnap.data();
  if (projectData.ownerId !== currentUser.uid) {
    throw new Error('Nemáte oprávnenie vytvárať fázy v tomto projekte.');
  }
  
  // Calculate order (get max order + 1)
  const phasesRef = collection(db, paths.projectPhases(projectId));
  const phasesQuery = query(phasesRef, orderBy("order", "desc"), limit(1));
  const phasesSnapshot = await getDocsSmart(phasesQuery);
  
  let order = 0;
  if (!phasesSnapshot.empty) {
    const maxOrder = phasesSnapshot.docs[0].data().order ?? 0;
    order = maxOrder + 1;
  }
  
  // Create phase
  const phaseRef = doc(collection(db, paths.projectPhases(projectId)));
  const phaseData = {
    projectId,
    ownerId: currentUser.uid,
    name: name.trim(),
    order,
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  
  await setDoc(phaseRef, phaseData);
  console.log(`[projects] Created phase ${phaseRef.id} in project ${projectId}: name="${name.trim()}"`);
  
  return {
    id: phaseRef.id,
    name: name.trim(),
    order,
  };
}

export async function updatePhase(projectId: string, phaseId: string, name: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na úpravu fázy.');
  }
  
  const ref = doc(db, paths.projectPhase(projectId, phaseId));
  await updateDoc(ref, {
    name: name.trim(),
    updatedAt: serverTimestamp(),
  });
  console.log(`[projects] Updated phase ${phaseId} in project ${projectId}: name="${name.trim()}"`);
}

export async function deletePhase(projectId: string, phaseId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vymazanie fázy.');
  }
  
  const ref = doc(db, paths.projectPhase(projectId, phaseId));
  await deleteDoc(ref);
  console.log(`[projects] Deleted phase ${phaseId} from project ${projectId}`);
}

const MAX_ORG_PROJECTS = 200;

function parseAssignedSnapshots(raw: unknown): AssignedMemberSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: AssignedMemberSnapshot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const uid = typeof (row as { uid?: unknown }).uid === "string" ? (row as { uid: string }).uid.trim() : "";
    if (!uid) continue;
    out.push({
      uid,
      name:
        typeof (row as { name?: unknown }).name === "string"
          ? (row as { name: string }).name.trim()
          : undefined,
      role:
        typeof (row as { role?: unknown }).role === "string"
          ? (row as { role: string }).role.trim()
          : undefined,
    });
  }
  return out;
}

/**
 * Marks an existing project as a business team job and assigns the creator.
 */
export async function stampBusinessTeamProject(projectId: string, orgId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Musíte byť prihlásený.");
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) throw new Error("Chýba identifikátor firmy.");

  const projectRef = doc(db, COLLECTION, projectId);
  const memberRef = doc(db, paths.projectMember(projectId, uid));

  await setDoc(
    memberRef,
    {
      userId: uid,
      role: "owner",
      status: "active",
      permissionLevel: "editor",
      addedAt: serverTimestamp(),
      sharedItems: {
        tasks: true,
        phases: true,
        expenses: true,
        diary: true,
        documents: true,
        timeTracking: true,
      },
    },
    { merge: true }
  );

  await updateDoc(projectRef, {
    orgId: normalizedOrgId,
    workspaceType: "team",
    assignedMemberIds: firestore.FieldValue.arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
  invalidateProjectsSessionCache();
}

/** Lists all non-archived team projects for an organization (managers+). */
export async function listBusinessOrgProjects(orgId: string): Promise<ProjectDoc[]> {
  const normalizedOrgId = orgId.trim();
  if (!normalizedOrgId) return [];

  const q = query(
    collection(db, COLLECTION),
    where("orgId", "==", normalizedOrgId),
    limit(MAX_ORG_PROJECTS)
  );
  const snap = await getDocsSmart(q);
  return snap.docs
    .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }))
    .filter((p): p is ProjectDoc => p != null && !p.archivedAt && isBusinessTeamProject(p));
}

export type BusinessProjectsMergeContext = {
  activeBusinessOrgId?: string | null;
  authUid?: string | null;
  canViewAllProjects?: boolean;
  restrictsToAssignedProjectsOnly?: boolean;
};

/**
 * Merges org team projects into a personal project list (Home, dashboard, Projects tab).
 * Workers only see projects they own or are listed on assignedMemberIds.
 */
export async function enrichProjectsWithBusinessAssignments(
  list: ProjectDoc[],
  ctx: BusinessProjectsMergeContext
): Promise<ProjectDoc[]> {
  const orgId = ctx.activeBusinessOrgId?.trim() ?? "";
  const authUid = ctx.authUid?.trim() ?? "";
  if (!orgId || !authUid) return list;

  let merged = [...list];
  const known = new Set(merged.map((p) => p.id));

  if (ctx.canViewAllProjects) {
    const orgProjects = await listBusinessOrgProjects(orgId);
    for (const row of orgProjects) {
      if (!known.has(row.id)) {
        merged.push(row);
        known.add(row.id);
      }
    }
  } else if (ctx.restrictsToAssignedProjectsOnly) {
    const assigned = await listBusinessProjectsAssignedToMember(orgId, authUid);
    for (const row of assigned) {
      if (!known.has(row.id)) {
        row.isSharedToMe = true;
        merged.push(row);
        known.add(row.id);
      }
    }
  }

  return merged.filter((project) => {
    if (!isBusinessTeamProject(project)) return true;
    if (project.orgId !== orgId) return true;
    if (ctx.canViewAllProjects) return true;
    return (
      project.ownerId === authUid ||
      getAssignedMemberIdsFromProject(project as unknown as Record<string, unknown>).includes(authUid)
    );
  });
}

/** All non-archived projects where the signed-in user is on assignedMemberIds (any org). */
export async function listProjectsAssignedToCurrentUser(): Promise<ProjectDoc[]> {
  const uid = auth.currentUser?.uid?.trim() ?? "";
  if (!uid) return [];

  const q = query(
    collection(db, COLLECTION),
    where("assignedMemberIds", "array-contains", uid),
    limit(MAX_ORG_PROJECTS)
  );
  const snap = await getDocsSmart(q);
  return snap.docs
    .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }))
    .filter((p): p is ProjectDoc => p != null && !p.archivedAt);
}

/** Lists team projects assigned to a member within an organization. */
export async function listBusinessProjectsAssignedToMember(
  orgId: string,
  memberUid: string
): Promise<ProjectDoc[]> {
  const normalizedOrgId = orgId.trim();
  const uid = memberUid.trim();
  if (!normalizedOrgId || !uid) return [];

  const q = query(
    collection(db, COLLECTION),
    where("assignedMemberIds", "array-contains", uid),
    limit(MAX_ORG_PROJECTS)
  );
  const snap = await getDocsSmart(q);
  return snap.docs
    .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }))
    .filter(
      (p): p is ProjectDoc =>
        p != null &&
        !p.archivedAt &&
        p.orgId === normalizedOrgId &&
        isBusinessTeamProject(p)
    );
}

export async function assignMemberToBusinessProject(input: {
  orgId: string;
  projectId: string;
  memberUid: string;
  memberName?: string;
  memberRole?: string;
}): Promise<void> {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("Musíte byť prihlásený.");

  const orgId = input.orgId.trim();
  const projectId = input.projectId.trim();
  const memberUid = input.memberUid.trim();
  if (!orgId || !projectId || !memberUid) throw new Error("Neplatné parametre priradenia.");

  const projectRef = doc(db, COLLECTION, projectId);
  const projectSnap = await getDocSmart(projectRef);
  if (!projectSnap.exists()) throw new Error("Projekt sa nenašiel.");
  const project = toDoc({ id: projectSnap.id, data: projectSnap.data.bind(projectSnap) });
  if (!project || project.orgId !== orgId || !isBusinessTeamProject(project)) {
    throw new Error("Projekt nepatrí tejto firme.");
  }

  const memberRef = doc(db, paths.projectMember(projectId, memberUid));
  await setDoc(
    memberRef,
    {
      userId: memberUid,
      role: "member",
      status: "active",
      pendingAcknowledgment: true,
      permissionLevel: "editor",
      addedAt: serverTimestamp(),
      addedBy: actorUid,
      name: input.memberName?.trim() || undefined,
      sharedItems: {
        tasks: true,
        phases: true,
        expenses: true,
        diary: true,
        documents: true,
        timeTracking: true,
      },
    },
    { merge: true }
  );

  const patch: Record<string, unknown> = {
    assignedMemberIds: firestore.FieldValue.arrayUnion(memberUid),
    updatedAt: serverTimestamp(),
  };
  if (input.memberName?.trim() || input.memberRole?.trim()) {
    const existing = parseAssignedSnapshots(projectSnap.data()?.assignedMemberSnapshots);
    const next = existing.filter((row) => row.uid !== memberUid);
    next.push({
      uid: memberUid,
      name: input.memberName?.trim() || undefined,
      role: input.memberRole?.trim() || undefined,
    });
    patch.assignedMemberSnapshots = next;
  }

  await updateDoc(projectRef, patch);
  invalidateProjectsSessionCache();
}

export async function unassignMemberFromBusinessProject(input: {
  orgId: string;
  projectId: string;
  memberUid: string;
}): Promise<void> {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("Musíte byť prihlásený.");

  const orgId = input.orgId.trim();
  const projectId = input.projectId.trim();
  const memberUid = input.memberUid.trim();
  if (!orgId || !projectId || !memberUid) throw new Error("Neplatné parametre.");

  const projectRef = doc(db, COLLECTION, projectId);
  const projectSnap = await getDocSmart(projectRef);
  if (!projectSnap.exists()) throw new Error("Projekt sa nenašiel.");
  const raw = projectSnap.data();
  if (raw?.orgId !== orgId) throw new Error("Projekt nepatrí tejto firme.");

  const memberRef = doc(db, paths.projectMember(projectId, memberUid));
  try {
    await deleteDoc(memberRef);
  } catch {
    // Member doc may already be missing; assignment array is authoritative.
  }

  const existing = parseAssignedSnapshots(raw?.assignedMemberSnapshots);
  const patch: Record<string, unknown> = {
    assignedMemberIds: firestore.FieldValue.arrayRemove(memberUid),
    updatedAt: serverTimestamp(),
  };
  if (existing.length > 0) {
    patch.assignedMemberSnapshots = existing.filter((row) => row.uid !== memberUid);
  }

  await updateDoc(projectRef, patch);
  invalidateProjectsSessionCache();
}

/** Whether the signed-in user may open a business team project. */
export function canAccessBusinessTeamProject(
  project: ProjectDoc,
  options: {
    uid: string;
    orgRole: string | null;
    canViewAllProjects: boolean;
  }
): boolean {
  if (!isBusinessTeamProject(project)) return true;
  const uid = options.uid;
  if (project.ownerId === uid) return true;
  if (options.canViewAllProjects) return true;
  if (options.orgRole === "owner" || options.orgRole === "admin" || options.orgRole === "manager") {
    return true;
  }
  return getAssignedMemberIdsFromProject(project as unknown as Record<string, unknown>).includes(uid);
}
