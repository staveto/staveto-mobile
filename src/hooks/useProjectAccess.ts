import { useState, useEffect, useCallback } from "react";
import { doc } from "../lib/rnFirestore";
import { getDocSmart } from "../services/firestoreSmartRead";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

export type ProjectAccess = {
  loading: boolean;
  isOwner: boolean;
  isMember: boolean;
  permissionLevel: "viewer" | "editor" | "owner";
  sharedItems: {
    tasks: boolean;
    phases: boolean;
    expenses: boolean;
    diary: boolean;
    documents: boolean;
    timeTracking: boolean;
  };
  sharedPhaseIds: string[];
  canReadTasks: boolean;
  canReadPhases: boolean;
  canReadExpenses: boolean;
  canReadDiary: boolean;
  canReadDocuments: boolean;
  canWrite: boolean;
  canWriteTime: boolean;
};

const ALL_TRUE = {
  tasks: true,
  phases: true,
  expenses: true,
  diary: true,
  documents: true,
  timeTracking: true,
};

const NO_ACCESS: ProjectAccess = {
  loading: false,
  isOwner: false,
  isMember: false,
  permissionLevel: "viewer",
  sharedItems: { tasks: false, phases: false, expenses: false, diary: false, documents: false, timeTracking: false },
  sharedPhaseIds: [],
  canReadTasks: false,
  canReadPhases: false,
  canReadExpenses: false,
  canReadDiary: false,
  canReadDocuments: false,
  canWrite: false,
  canWriteTime: false,
};

function parseAssignedMemberIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim() !== "");
}

function accessFromProjectMemberData(mData: Record<string, unknown>): ProjectAccess | null {
  const mStatus = mData?.status ?? "";
  if (mStatus && mStatus !== "active") return null;

  const mShared = (mData?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
  const hasSharedItems = typeof mShared.tasks === "boolean" || typeof mShared.phases === "boolean";
  const mSi = hasSharedItems
    ? {
        tasks: mShared.tasks !== false,
        phases: mShared.phases !== false,
        expenses: mShared.expenses !== false,
        diary: mShared.diary !== false,
        documents: mShared.documents !== false,
        timeTracking: mShared.timeTracking !== false,
      }
    : ALL_TRUE;
  const mPerm = (mData?.permissionLevel === "editor" ? "editor" : "viewer") as "viewer" | "editor";

  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: mPerm,
    sharedItems: mSi,
    sharedPhaseIds: (mData?.sharedPhaseIds as string[]) ?? [],
    canReadTasks: mSi.tasks,
    canReadPhases: mSi.phases,
    canReadExpenses: mSi.expenses,
    canReadDiary: mSi.diary,
    canReadDocuments: mSi.documents,
    canWrite: mPerm === "editor",
    canWriteTime: mPerm === "editor" && mSi.timeTracking === true,
  };
}

/** Union access flags — business assign writes projects/{id}/members/{uid} with full sharedItems. */
function mergeProjectAccess(base: ProjectAccess, extra: ProjectAccess): ProjectAccess {
  const si = {
    tasks: base.sharedItems.tasks || extra.sharedItems.tasks,
    phases: base.sharedItems.phases || extra.sharedItems.phases,
    expenses: base.sharedItems.expenses || extra.sharedItems.expenses,
    diary: base.sharedItems.diary || extra.sharedItems.diary,
    documents: base.sharedItems.documents || extra.sharedItems.documents,
    timeTracking: base.sharedItems.timeTracking || extra.sharedItems.timeTracking,
  };
  const permissionLevel =
    base.permissionLevel === "editor" || extra.permissionLevel === "editor" ? "editor" : "viewer";
  return {
    loading: false,
    isOwner: base.isOwner || extra.isOwner,
    isMember: base.isMember || extra.isMember,
    permissionLevel,
    sharedItems: si,
    sharedPhaseIds: base.sharedPhaseIds.length ? base.sharedPhaseIds : extra.sharedPhaseIds,
    canReadTasks: base.canReadTasks || extra.canReadTasks,
    canReadPhases: base.canReadPhases || extra.canReadPhases,
    canReadExpenses: base.canReadExpenses || extra.canReadExpenses,
    canReadDiary: base.canReadDiary || extra.canReadDiary,
    canReadDocuments: base.canReadDocuments || extra.canReadDocuments,
    canWrite: base.canWrite || extra.canWrite,
    canWriteTime: base.canWriteTime || extra.canWriteTime,
  };
}

async function readMembersDocAccess(projectId: string, uid: string): Promise<ProjectAccess | null> {
  const membersRef = doc(db, "projects", projectId, "members", uid);
  const membersSnap = await getDocSmart(membersRef);
  if (!membersSnap.exists()) return null;
  return accessFromProjectMemberData(membersSnap.data() as Record<string, unknown>);
}

function accessFromOrgProjectMembership(
  uid: string,
  projectData: Record<string, unknown>,
  orgMemberActive: boolean
): ProjectAccess | null {
  const orgId = typeof projectData.orgId === "string" ? projectData.orgId.trim() : "";
  const workspaceType = projectData.workspaceType;
  const isTeamLike =
    workspaceType === "team" || workspaceType === "business" || workspaceType == null;
  if (!orgId || !isTeamLike || !orgMemberActive) return null;
  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: "editor",
    sharedItems: ALL_TRUE,
    sharedPhaseIds: [],
    canReadTasks: true,
    canReadPhases: true,
    canReadExpenses: true,
    canReadDiary: true,
    canReadDocuments: true,
    canWrite: true,
    canWriteTime: true,
  };
}

async function enrichProjectAccess(
  projectId: string,
  uid: string,
  projectData: Record<string, unknown>,
  base: ProjectAccess
): Promise<ProjectAccess> {
  let resolved = base;

  const fromAssigned = accessFromAssignedMemberIds(uid, projectData);
  if (fromAssigned) resolved = mergeProjectAccess(resolved, fromAssigned);

  const fromMembersDoc = await readMembersDocAccess(projectId, uid);
  if (fromMembersDoc) resolved = mergeProjectAccess(resolved, fromMembersDoc);

  const orgId = typeof projectData.orgId === "string" ? projectData.orgId.trim() : "";
  if (orgId) {
    const orgMemRef = doc(db, "organizations", orgId, "members", uid);
    const orgMemSnap = await getDocSmart(orgMemRef);
    const oStatus = String(orgMemSnap.data()?.status ?? "").toLowerCase();
    const orgActive = orgMemSnap.exists() && (oStatus === "active" || !oStatus);
    const fromOrg = accessFromOrgProjectMembership(uid, projectData, orgActive);
    if (fromOrg) resolved = mergeProjectAccess(resolved, fromOrg);
  }

  const prefSnap = await getDocSmart(doc(db, "users", uid, "projectRefs", projectId));
  if (prefSnap.exists()) {
    resolved = mergeProjectAccess(resolved, {
      loading: false,
      isOwner: false,
      isMember: true,
      permissionLevel: "viewer",
      sharedItems: ALL_TRUE,
      sharedPhaseIds: [],
      canReadTasks: true,
      canReadPhases: true,
      canReadExpenses: true,
      canReadDiary: true,
      canReadDocuments: true,
      canWrite: false,
      canWriteTime: false,
    });
  }

  return resolved;
}

function accessFromMembersByUidDoc(data: Record<string, unknown>): ProjectAccess | null {
  const status = data?.status ?? "";
  if (status && status !== "active") return null;

  const sharedItems = (data?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
  const si = {
    tasks: sharedItems.tasks !== false,
    phases: sharedItems.phases !== false,
    expenses: sharedItems.expenses !== false,
    diary: sharedItems.diary !== false,
    documents: sharedItems.documents !== false,
    timeTracking: sharedItems.timeTracking !== false,
  };
  const permLevel = (data?.permissionLevel === "editor" ? "editor" : "viewer") as "viewer" | "editor";

  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: permLevel,
    sharedItems: si,
    sharedPhaseIds: (data?.sharedPhaseIds as string[]) ?? [],
    canReadTasks: si.tasks,
    canReadPhases: si.phases,
    canReadExpenses: si.expenses,
    canReadDiary: si.diary,
    canReadDocuments: si.documents,
    canWrite: permLevel === "editor",
    canWriteTime: permLevel === "editor" && si.timeTracking === true,
  };
}

/** Resolve access for non-owner: merges membersByUid, members/{uid}, assignedMemberIds, org, projectRefs. */
async function resolveNonOwnerProjectAccess(
  projectId: string,
  uid: string,
  projectData: Record<string, unknown>
): Promise<ProjectAccess> {
  const memberByUidRef = doc(db, "projects", projectId, "membersByUid", uid);
  const memberSnap = await getDocSmart(memberByUidRef);

  if (memberSnap.exists()) {
    const fromByUid = accessFromMembersByUidDoc(memberSnap.data() as Record<string, unknown>);
    if (fromByUid) {
      return enrichProjectAccess(projectId, uid, projectData, fromByUid);
    }
  }

  const membersRef = doc(db, "projects", projectId, "members", uid);
  const membersSnap = await getDocSmart(membersRef);
  if (membersSnap.exists()) {
    const fromMemberDoc = accessFromProjectMemberData(membersSnap.data() as Record<string, unknown>);
    if (fromMemberDoc) {
      return enrichProjectAccess(projectId, uid, projectData, fromMemberDoc);
    }
  }

  const fromAssigned = accessFromAssignedMemberIds(uid, projectData);
  if (fromAssigned) {
    return enrichProjectAccess(projectId, uid, projectData, fromAssigned);
  }

  return enrichProjectAccess(projectId, uid, projectData, NO_ACCESS);
}

/** Business assign via project.assignedMemberIds (web/mobile crew assign). */
function accessFromAssignedMemberIds(uid: string, projectData: Record<string, unknown>): ProjectAccess | null {
  const assignedIds = parseAssignedMemberIds(projectData.assignedMemberIds);
  if (!assignedIds.includes(uid)) return null;

  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: "editor",
    sharedItems: ALL_TRUE,
    sharedPhaseIds: [],
    canReadTasks: true,
    canReadPhases: true,
    canReadExpenses: true,
    canReadDiary: true,
    canReadDocuments: true,
    canWrite: true,
    canWriteTime: true,
  };
}

/**
 * Single source of truth for project access permissions.
 * - Owner: full access (all sharedItems true, canWrite true)
 * - Member: reads membersByUid, applies sharedItems
 * - Legacy `members/{uid}` when membersByUid missing
 * - `users/{uid}/projectRefs/{projectId}` or org membership (matches Firestore `isMember` / `canWriteAsEditor`)
 */
export function useProjectAccess(projectId: string, projectOwnerId?: string | null): ProjectAccess {
  const { user } = useAuth();
  const uid = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ProjectAccess>(NO_ACCESS);

  const refresh = useCallback(async () => {
    if (!projectId || !uid) {
      setAccess({ ...NO_ACCESS, loading: false });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const projectRef = doc(db, "projects", projectId);
      const projectSnap = await getDocSmart(projectRef);
      const ownerId = (projectSnap.data()?.ownerId as string) ?? projectOwnerId ?? null;

      if (!ownerId) {
        setAccess({ ...NO_ACCESS, loading: false });
        setLoading(false);
        return;
      }

      const isOwner = ownerId === uid;
      if (isOwner) {
        setAccess({
          loading: false,
          isOwner: true,
          isMember: true,
          permissionLevel: "owner",
          sharedItems: ALL_TRUE,
          sharedPhaseIds: [],
          canReadTasks: true,
          canReadPhases: true,
          canReadExpenses: true,
          canReadDiary: true,
          canReadDocuments: true,
          canWrite: true,
          canWriteTime: true,
        });
        setLoading(false);
        return;
      }

      const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
      const resolved = await resolveNonOwnerProjectAccess(projectId, uid, projectData);
      setAccess(resolved);
    } catch (error) {
      console.warn("[useProjectAccess] Error:", error);
      setAccess({ ...NO_ACCESS, loading: false });
    } finally {
      setLoading(false);
    }
  }, [projectId, uid, projectOwnerId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...access, loading };
}

/**
 * Fetch project access for a single project (for batch use, e.g. in ExpensesKpiScreen).
 * Returns the same shape as useProjectAccess but as a Promise.
 */
export async function fetchProjectAccess(
  projectId: string,
  uid: string,
  projectOwnerId?: string | null
): Promise<ProjectAccess> {
  if (!projectId || !uid) {
    return { ...NO_ACCESS, loading: false };
  }
  try {
    const projectRef = doc(db, "projects", projectId);
    const projectSnap = await getDocSmart(projectRef);
    const ownerId = (projectSnap.data()?.ownerId as string) ?? projectOwnerId ?? null;

    if (!ownerId) {
      return { ...NO_ACCESS, loading: false };
    }

    const isOwner = ownerId === uid;
    if (isOwner) {
      return {
        loading: false,
        isOwner: true,
        isMember: true,
        permissionLevel: "owner",
        sharedItems: ALL_TRUE,
        sharedPhaseIds: [],
        canReadTasks: true,
        canReadPhases: true,
        canReadExpenses: true,
        canReadDiary: true,
        canReadDocuments: true,
        canWrite: true,
        canWriteTime: true,
      };
    }

    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    return resolveNonOwnerProjectAccess(projectId, uid, projectData);
  } catch (error) {
    console.warn("[fetchProjectAccess] Error:", error);
    return { ...NO_ACCESS, loading: false };
  }
}
