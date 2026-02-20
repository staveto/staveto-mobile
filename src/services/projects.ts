import { collection, collectionGroup, addDoc, query, where, getDocs, updateDoc, doc, deleteDoc, orderBy, getDoc, setDoc, serverTimestamp, limit } from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import firestore from "@react-native-firebase/firestore";
import { getApp } from "@react-native-firebase/app";
import { paths } from "../lib/firestorePaths";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";

const COLLECTION = "projects";
let didLogProjectContext = false;

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
};

export type ProjectPhaseDoc = { id: string; name: string; description?: string; order: number };

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectDoc {
  const d = docSnap.data();
  let createdAt: string | undefined;
  const raw = d.createdAt;
  if (raw) {
    if (typeof raw === "string") createdAt = raw;
    else if (raw && typeof raw === "object" && "toDate" in raw) {
      createdAt = (raw as { toDate: () => Date }).toDate().toISOString();
    }
  }
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

export async function listProjectPhases(projectId: string): Promise<ProjectPhaseDoc[]> {
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
    const q = query(c, orderBy("order", "asc"));
    console.log(`[projects] listProjectPhases: querying phases collection...`);
    const snap = await getDocs(q);
    console.log(`[projects] Found ${snap.docs.length} phases in Firestore`);
    
    const phases = snap.docs.map((d) => {
      const x = d.data();
      const phase = {
        id: d.id,
        name: (x.name as string) ?? "",
        description: x.description as string | undefined,
        order: (x.order as number) ?? 0,
      };
      console.log(`[projects] Phase: id=${phase.id}, name="${phase.name}", order=${phase.order}`);
      return phase;
    });
    return phases;
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
    const docSnap = await getDoc(docRef);
    
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
    
    return toDoc({ id: docSnap.id, data: docSnap.data.bind(docSnap) });
  } catch (error: any) {
    console.error(`[projects] getProject error:`, error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Unknown error';
    
    if (errorCode === 'permission-denied') {
      console.error(`[projects] getProject: PERMISSION DENIED for project ${projectId}`);
      console.error(`[projects] getProject: auth.currentUser.uid = "${currentUserUid}"`);
      console.error(`[projects] getProject: Firestore rule: resource.data.ownerId == uid()`);
      throw new Error(`Nemáte oprávnenie zobraziť projekt ${projectId}. Skontrolujte Firestore rules.`);
    }
    
    throw error;
  }
}

/**
 * Internal helper to load all projects (including archived)
 */
async function listAllMyProjectsInternal(ownerId: string, forceServerRead?: boolean): Promise<ProjectDoc[]> {
  const getOptions = forceServerRead ? ({ source: "server" } as const) : undefined;
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
  
  console.log(`[projects] listAllMyProjectsInternal: querying with ownerId="${actualOwnerId}" (from auth.currentUser.uid)`);
  console.log(`[projects] Query: collection('projects'), where('ownerId', '==', '${actualOwnerId}')`);
  
  try {
    // CRITICAL: Query MUST use where('ownerId', '==', auth.currentUser.uid)
    // This ensures Firestore rules can check resource.data.ownerId == uid()
    const ownerSnap = await firestore()
      .collection(COLLECTION)
      .where("ownerId", "==", actualOwnerId)
      .get(getOptions);
    console.log(`[projects] listAllMyProjectsInternal: found ${ownerSnap.docs.length} owner projects`);
    
    // Debug: Check ownerId in each project
    ownerSnap.docs.forEach((doc) => {
      const data = doc.data();
      const docOwnerId = data.ownerId;
      console.log(`[projects] Project ${doc.id}: ownerId="${docOwnerId}", match? ${docOwnerId === actualOwnerId ? 'YES ✅' : 'NO ❌'}`);
    });

    const ownerProjects = ownerSnap.docs.map((d) => toDoc({ id: d.id, data: d.data.bind(d) })) as ProjectDoc[];

    // Include projects shared via invite claim (projectRefs) and via membership (projects/*/members).
    let memberProjectIds = new Set<string>();
    const ownerIds = new Set(ownerProjects.map((p) => p.id));

    // Source 1: users/{uid}/projectRefs (created by claimProjectInvites Cloud Function)
    try {
      const refsSnap = await getDocs(collection(db, paths.userProjectRefs(actualOwnerId)), getOptions);
      refsSnap.docs.forEach((d) => {
        const projectId = typeof d.data().projectId === "string" ? (d.data().projectId as string) : d.id;
        if (projectId && !ownerIds.has(projectId)) memberProjectIds.add(projectId);
      });
    } catch (error) {
      console.warn("[projects] Failed to load member project refs:", error);
    }

    // Source 2: collectionGroup('members') where userId == uid (fallback when projectRefs empty or member added directly)
    try {
      const membersGroup = collectionGroup(db, "members");
      const memberQuery = query(membersGroup, where("userId", "==", actualOwnerId));
      const memberSnap = await getDocs(memberQuery, getOptions);
      memberSnap.docs.forEach((d) => {
        const pathParts = d.ref.path.split("/");
        const projectId = pathParts[1];
        if (projectId && !ownerIds.has(projectId)) memberProjectIds.add(projectId);
      });
      if (memberSnap.docs.length > 0) {
        console.log(`[projects] listAllMyProjectsInternal: found ${memberSnap.docs.length} member docs via collectionGroup`);
      }
    } catch (error) {
      console.warn("[projects] Failed to load member projects via collectionGroup:", error);
    }

    const memberProjects: ProjectDoc[] = [];
    for (const projectId of memberProjectIds) {
      try {
        const snap = await getDoc(doc(db, COLLECTION, projectId), getOptions);
        if (!snap.exists()) continue;
        const p = toDoc({ id: snap.id, data: snap.data.bind(snap) }) as ProjectDoc;
        p.isSharedToMe = true;
        memberProjects.push(p);
      } catch (error) {
        console.warn(`[projects] Failed to load member project ${projectId}:`, error);
      }
    }

    const merged = [...ownerProjects, ...memberProjects].filter(
      (project, index, arr) => arr.findIndex((x) => x.id === project.id) === index
    );
    console.log(
      `[projects] listAllMyProjectsInternal: owner=${ownerProjects.length}, member=${memberProjects.length}, merged=${merged.length}`
    );
    return merged;
  } catch (error: any) {
    console.error(`[projects] listAllMyProjectsInternal error:`, error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Unknown error';
    
    if (errorCode === 'permission-denied') {
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
  const allProjects = await listAllMyProjectsInternal(ownerId, options?.forceServerRead);
  
  // Filter out archived projects (archivedAt is truthy)
  const activeProjects = allProjects.filter((project) => !project.archivedAt);
  
  console.log(`[projects] listMyProjects: ${allProjects.length} total projects, ${activeProjects.length} active (non-archived) projects`);
  
  return activeProjects;
}

/**
 * List all projects (including archived) for a user
 * Used for ProjectsScreen where archived projects should be visible
 */
export async function listAllMyProjects(ownerId: string): Promise<ProjectDoc[]> {
  return listAllMyProjectsInternal(ownerId);
}

export async function updateProject(
  _ownerId: string,
  projectId: string,
  name: string,
  addressText?: string | null,
  countryCode?: string | null,
  city?: string | null
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
  await updateDoc(ref, update);
  console.log(`[projects] Updated project ${projectId}: name="${name.trim()}"`);
}

export async function deleteProject(_ownerId: string, projectId: string): Promise<void> {
  // CRITICAL FIX: Always use auth.currentUser.uid for verification
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na vymazanie projektu.');
  }
  
  const ref = doc(db, COLLECTION, projectId);
  await deleteDoc(ref);
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
  const projectSnap = await getDoc(projectRef);
  
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
  const phasesSnapshot = await getDocs(phasesQuery);
  
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
