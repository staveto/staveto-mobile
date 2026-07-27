import { useState, useEffect, useCallback } from "react";
import { collection, doc, limit, query, where } from "../lib/rnFirestore";
import { getDocSmart, getDocsSmart } from "../services/firestoreSmartRead";
import { db, auth } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { healProjectAccessForCurrentUser } from "../services/projects";
import { getAssignedMemberIdsFromProject, isUserAssignedOnProject } from "../lib/projectAssignment";
import {
  getEffectivePermissions,
  parseCustomPermissions,
  type BusinessPermissions,
} from "../lib/businessRolePermissions";
import type { OrgRole } from "../services/organizations";

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
  /** Field crew may add diary/photo entries when they can read the construction diary. */
  canWriteDiary: boolean;
  /** Upload site photos / attachments (editors + diary-enabled field crew). */
  canWritePhotos: boolean;
  /** Assigned crew and project members may report site problems (not only editors). */
  canReportProblem: boolean;
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
  canWriteDiary: false,
  canWritePhotos: false,
  canReportProblem: false,
};

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
  /** Assigned crew editors always see tasks/phases — matches web business assign + Firestore crew rules. */
  const editorCrew = mPerm === "editor";

  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: mPerm,
    sharedItems: mSi,
    sharedPhaseIds: (mData?.sharedPhaseIds as string[]) ?? [],
    canReadTasks: mSi.tasks || editorCrew,
    canReadPhases: mSi.phases || editorCrew,
    canReadExpenses: mSi.expenses,
    canReadDiary: mSi.diary,
    canReadDocuments: mSi.documents,
    canWrite: mPerm === "editor",
    canWriteTime: mPerm === "editor" && mSi.timeTracking === true,
    canWriteDiary: diaryWriteFromMemberAccess(mSi, mSi.diary, true),
    canWritePhotos: mPerm === "editor" || diaryWriteFromMemberAccess(mSi, mSi.diary, true),
    canReportProblem: true,
  };
}

/** Members with diary access may add site diary entries (field crew), not only editors. */
function diaryWriteFromMemberAccess(
  si: ProjectAccess["sharedItems"],
  canReadDiary: boolean,
  isMember: boolean
): boolean {
  if (!canReadDiary || !isMember) return false;
  return si.diary !== false;
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
    canWriteDiary: base.canWriteDiary || extra.canWriteDiary,
    canWritePhotos: base.canWritePhotos || extra.canWritePhotos,
    canReportProblem: base.canReportProblem || extra.canReportProblem,
  };
}

type OrgAccessGate = {
  /** When false, deny phase/task/structure edits (worker default). null = no org context. */
  canEditStructure: boolean | null;
  field: Pick<
    BusinessPermissions,
    "canAddDailyReport" | "canAddPhotos" | "canAddExpense"
  > | null;
};

function normalizeOrgRole(raw: unknown): OrgRole {
  const r = String(raw ?? "").toLowerCase();
  if (r === "owner" || r === "admin" || r === "manager" || r === "worker") return r;
  if (r === "member") return "viewer";
  return "viewer";
}

function orgGateFromMembershipData(data: Record<string, unknown> | undefined): OrgAccessGate {
  if (!data) return { canEditStructure: null, field: null };
  const role = normalizeOrgRole(data.role);
  const perms = getEffectivePermissions(role, parseCustomPermissions(data.permissions));
  const canEditStructure =
    role === "owner" || role === "admin" || role === "manager" || perms.canEditProject;
  return {
    canEditStructure,
    field: {
      canAddDailyReport: perms.canAddDailyReport,
      canAddPhotos: perms.canAddPhotos,
      canAddExpense: perms.canAddExpense,
    },
  };
}

/** Assigned / org-linked crew without structure-edit rights: read + field work, no phase/task admin. */
function accessAsFieldCrew(field?: OrgAccessGate["field"]): ProjectAccess {
  const diary = field?.canAddDailyReport !== false;
  const photos = field?.canAddPhotos !== false;
  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: "viewer",
    sharedItems: {
      ...ALL_TRUE,
      expenses: field?.canAddExpense === true,
    },
    sharedPhaseIds: [],
    canReadTasks: true,
    canReadPhases: true,
    canReadExpenses: field?.canAddExpense === true,
    canReadDiary: true,
    canReadDocuments: true,
    canWrite: false,
    canWriteTime: true,
    canWriteDiary: diary,
    canWritePhotos: photos || diary,
    canReportProblem: true,
  };
}

function applyOrgStructureGate(access: ProjectAccess, gate: OrgAccessGate): ProjectAccess {
  if (access.isOwner || gate.canEditStructure !== false) return access;
  return {
    ...access,
    permissionLevel: "viewer",
    canWrite: false,
    canWriteDiary: gate.field ? gate.field.canAddDailyReport : access.canWriteDiary,
    canWritePhotos: gate.field
      ? gate.field.canAddPhotos || gate.field.canAddDailyReport
      : access.canWritePhotos,
    canReadExpenses: gate.field ? gate.field.canAddExpense : access.canReadExpenses,
    sharedItems: {
      ...access.sharedItems,
      expenses: gate.field ? gate.field.canAddExpense : access.sharedItems.expenses,
    },
  };
}

/** Match Firestore crew read + time/diary; structure write stays gated by org canEditProject. */
export function finalizeProjectAccess(
  access: ProjectAccess,
  uid: string,
  projectData: Record<string, unknown>,
  ownerId?: string | null,
  gate: OrgAccessGate = { canEditStructure: null, field: null }
): ProjectAccess {
  const assigned = isUserAssignedOnProject(projectData, uid);
  const isOwner = access.isOwner || (!!ownerId && ownerId === uid);
  const editorLike = access.permissionLevel === "editor" || access.canWrite;
  const crewReader = assigned || (access.isMember && editorLike) || access.isMember;
  const timeNotBlocked = access.sharedItems.timeTracking !== false;
  const canWriteTime =
    isOwner ||
    access.canWriteTime ||
    assigned ||
    (access.isMember && editorLike && timeNotBlocked);
  const canWriteDiary =
    isOwner ||
    access.canWriteDiary ||
    (access.canReadDiary && (access.isMember || assigned));
  const isMember = access.isMember || assigned || isOwner;
  const canReportProblem =
    isOwner ||
    access.canWrite ||
    access.canReportProblem ||
    isMember ||
    canWriteTime ||
    canWriteDiary;

  const canWritePhotos =
    isOwner || access.canWrite || canWriteDiary || access.canWritePhotos || assigned;

  // Do not re-elevate structure write for assigned crew when org forbids canEditProject.
  const structureAllowed = isOwner || gate.canEditStructure !== false;
  const canWrite =
    structureAllowed && (isOwner || access.canWrite || (assigned && editorLike) || editorLike);

  return applyOrgStructureGate(
    {
      ...access,
      isOwner,
      isMember,
      canReadTasks: access.canReadTasks || crewReader,
      canReadPhases: access.canReadPhases || crewReader,
      canWrite,
      canWriteTime,
      canWriteDiary,
      canWritePhotos,
      canReportProblem,
    },
    gate
  );
}

async function readMembersDocAccess(projectId: string, uid: string): Promise<ProjectAccess | null> {
  const membersRef = doc(db, "projects", projectId, "members", uid);
  const membersSnap = await getDocSmart(membersRef);
  if (membersSnap.exists()) {
    return accessFromProjectMemberData(membersSnap.data() as Record<string, unknown>);
  }

  try {
    const memberQuery = query(
      collection(db, "projects", projectId, "members"),
      where("userId", "==", uid),
      limit(1)
    );
    const querySnap = await getDocsSmart(memberQuery);
    if (!querySnap.empty) {
      return accessFromProjectMemberData(querySnap.docs[0].data() as Record<string, unknown>);
    }
  } catch (error) {
    if (__DEV__) console.warn("[useProjectAccess] members userId query failed:", error);
  }

  return null;
}

function accessFromOrgProjectMembership(
  projectData: Record<string, unknown>,
  orgMemberActive: boolean,
  gate: OrgAccessGate
): ProjectAccess | null {
  const orgId = typeof projectData.orgId === "string" ? projectData.orgId.trim() : "";
  const workspaceType = projectData.workspaceType;
  const isTeamLike =
    workspaceType === "team" || workspaceType === "business" || workspaceType == null;
  if (!orgId || !isTeamLike || !orgMemberActive) return null;
  if (gate.canEditStructure === false) {
    return accessAsFieldCrew(gate.field);
  }
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
    canWriteDiary: true,
    canWritePhotos: true,
    canReportProblem: true,
  };
}

async function resolveOrgAccessGate(
  projectData: Record<string, unknown>,
  uid: string
): Promise<OrgAccessGate> {
  const orgId = typeof projectData.orgId === "string" ? projectData.orgId.trim() : "";
  if (!orgId) return { canEditStructure: null, field: null };

  const orgMemRef = doc(db, "organizations", orgId, "members", uid);
  let orgMemSnap = await getDocSmart(orgMemRef);
  const authEmail = auth.currentUser?.email?.trim().toLowerCase() ?? "";
  if (!orgMemSnap.exists() && authEmail) {
    orgMemSnap = await getDocSmart(doc(db, "organizations", orgId, "members", authEmail));
  }
  if (!orgMemSnap.exists()) return { canEditStructure: null, field: null };
  const oStatus = String(orgMemSnap.data()?.status ?? "").toLowerCase();
  const orgActive = oStatus === "active" || oStatus === "pending" || !oStatus;
  if (!orgActive) return { canEditStructure: null, field: null };
  return orgGateFromMembershipData(orgMemSnap.data() as Record<string, unknown>);
}

async function enrichProjectAccess(
  projectId: string,
  uid: string,
  projectData: Record<string, unknown>,
  base: ProjectAccess,
  gate: OrgAccessGate
): Promise<ProjectAccess> {
  let resolved = base;

  const orgId = typeof projectData.orgId === "string" ? projectData.orgId.trim() : "";
  if (orgId && gate.canEditStructure !== null) {
    const fromOrg = accessFromOrgProjectMembership(projectData, true, gate);
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
      canWriteDiary: true,
      canWritePhotos: true,
      canReportProblem: true,
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
  const editorCrew = permLevel === "editor";

  return {
    loading: false,
    isOwner: false,
    isMember: true,
    permissionLevel: permLevel,
    sharedItems: si,
    sharedPhaseIds: (data?.sharedPhaseIds as string[]) ?? [],
    canReadTasks: si.tasks || editorCrew,
    canReadPhases: si.phases || editorCrew,
    canReadExpenses: si.expenses,
    canReadDiary: si.diary,
    canReadDocuments: si.documents,
    canWrite: permLevel === "editor",
    canWriteTime: permLevel === "editor" && si.timeTracking === true,
    canWriteDiary: diaryWriteFromMemberAccess(si, si.diary, true),
    canWritePhotos: permLevel === "editor" || diaryWriteFromMemberAccess(si, si.diary, true),
    canReportProblem: true,
  };
}

/** Resolve access for non-owner: union assignedMemberIds, members/{uid}, membersByUid, org, projectRefs. */
async function resolveNonOwnerProjectAccess(
  projectId: string,
  uid: string,
  projectData: Record<string, unknown>
): Promise<{ access: ProjectAccess; gate: OrgAccessGate }> {
  const gate = await resolveOrgAccessGate(projectData, uid);
  let resolved: ProjectAccess = { ...NO_ACCESS, loading: false };

  const fromAssigned = accessFromAssignedMemberIds(uid, projectData, gate);
  if (fromAssigned) resolved = mergeProjectAccess(resolved, fromAssigned);

  const fromMembersDoc = await readMembersDocAccess(projectId, uid);
  if (fromMembersDoc) resolved = mergeProjectAccess(resolved, fromMembersDoc);

  const memberByUidRef = doc(db, "projects", projectId, "membersByUid", uid);
  const memberSnap = await getDocSmart(memberByUidRef);
  if (memberSnap.exists()) {
    const fromByUid = accessFromMembersByUidDoc(memberSnap.data() as Record<string, unknown>);
    if (fromByUid) resolved = mergeProjectAccess(resolved, fromByUid);
  }

  const enriched = await enrichProjectAccess(projectId, uid, projectData, resolved, gate);
  return { access: enriched, gate };
}

/** Business assign via project.assignedMemberIds (web/mobile crew assign). */
function accessFromAssignedMemberIds(
  uid: string,
  projectData: Record<string, unknown>,
  gate: OrgAccessGate
): ProjectAccess | null {
  if (!isUserAssignedOnProject(projectData, uid)) return null;
  if (gate.canEditStructure === false) {
    return accessAsFieldCrew(gate.field);
  }

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
    canWriteDiary: true,
    canWritePhotos: true,
    canReportProblem: true,
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

      // Team/org projects may have no `ownerId` (owned by the org, not a person).
      // Only bail when the project document itself is missing — otherwise fall
      // through to non-owner resolution (assigned crew + members + org + refs).
      if (!projectSnap.exists()) {
        setAccess({ ...NO_ACCESS, loading: false });
        setLoading(false);
        return;
      }
      const ownerId = (projectSnap.data()?.ownerId as string) ?? projectOwnerId ?? null;

      const isOwner = !!ownerId && ownerId === uid;
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
          canWriteDiary: true,
          canWritePhotos: true,
          canReportProblem: true,
        });
        setLoading(false);
        return;
      }

      const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
      const ownerIdForFinalize = (projectSnap.data()?.ownerId as string) ?? projectOwnerId ?? null;
      let { access: resolved, gate } = await resolveNonOwnerProjectAccess(projectId, uid, projectData);
      let finalized = finalizeProjectAccess(resolved, uid, projectData, ownerIdForFinalize, gate);

      if (!finalized.canReadTasks && !finalized.canReadPhases) {
        await healProjectAccessForCurrentUser(projectId);
        const serverSnap = await getDocSmart(projectRef, { forceServer: true });
        const serverData = (serverSnap.data() ?? {}) as Record<string, unknown>;
        ({ access: resolved, gate } = await resolveNonOwnerProjectAccess(projectId, uid, serverData));
        finalized = finalizeProjectAccess(resolved, uid, serverData, ownerIdForFinalize, gate);
      } else if (!finalized.canReportProblem) {
        const serverSnap = await getDocSmart(projectRef, { forceServer: true });
        const serverData = (serverSnap.data() ?? {}) as Record<string, unknown>;
        ({ access: resolved, gate } = await resolveNonOwnerProjectAccess(projectId, uid, serverData));
        finalized = finalizeProjectAccess(resolved, uid, serverData, ownerIdForFinalize, gate);
      }

      setAccess(finalized);
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

async function isTimeTrackingExplicitlyBlocked(projectId: string, uid: string): Promise<boolean> {
  const membersRef = doc(db, "projects", projectId, "members", uid);
  const membersSnap = await getDocSmart(membersRef);
  if (!membersSnap.exists()) return false;
  const data = membersSnap.data() as Record<string, unknown>;
  const status = data?.status ?? "";
  if (status && status !== "active") return true;
  const shared = (data?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
  return shared.timeTracking === false;
}

/**
 * Authoritative check for starting timer / manual time entry.
 * Matches Firestore `canWriteAsEditor` for assigned crew; members/{uid} may opt out via sharedItems.timeTracking === false.
 */
export async function resolveCanWriteTimeForProject(
  projectId: string,
  uid: string,
  projectOwnerIdHint?: string | null,
  opts?: { forceServer?: boolean }
): Promise<boolean> {
  const normalizedId = projectId.trim();
  if (!normalizedId || !uid) return false;
  if (projectOwnerIdHint && projectOwnerIdHint === uid) return true;

  const access = await fetchProjectAccess(normalizedId, uid, projectOwnerIdHint ?? undefined);
  if (access.canWriteTime) return true;

  const readOpts = opts?.forceServer ? { forceServer: true } : undefined;
  const projectRef = doc(db, "projects", normalizedId);
  const projectSnap = await getDocSmart(projectRef, readOpts);
  if (!projectSnap.exists()) return false;

  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  const ownerId = (projectData.ownerId as string) ?? projectOwnerIdHint ?? null;
  if (ownerId === uid) return true;

  if (isUserAssignedOnProject(projectData, uid)) {
    return !(await isTimeTrackingExplicitlyBlocked(normalizedId, uid));
  }

  const fromMembersDoc = await readMembersDocAccess(normalizedId, uid);
  return fromMembersDoc?.canWriteTime === true;
}

/** Authoritative check before reporting a site problem (field crew, not only editors). */
export async function resolveCanReportProblemForProject(
  projectId: string,
  uid: string,
  projectOwnerIdHint?: string | null,
  opts?: { forceServer?: boolean }
): Promise<boolean> {
  const normalizedId = projectId.trim();
  if (!normalizedId || !uid) return false;
  if (projectOwnerIdHint && projectOwnerIdHint === uid) return true;

  const access = await fetchProjectAccess(normalizedId, uid, projectOwnerIdHint ?? undefined, opts);
  if (access.canReportProblem) return true;

  const readOpts = opts?.forceServer ? { forceServer: true } : undefined;
  const projectRef = doc(db, "projects", normalizedId);
  const projectSnap = await getDocSmart(projectRef, readOpts);
  if (!projectSnap.exists()) return false;

  const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
  const ownerId = (projectData.ownerId as string) ?? projectOwnerIdHint ?? null;
  if (ownerId === uid) return true;

  if (isUserAssignedOnProject(projectData, uid)) return true;

  const fromMembersDoc = await readMembersDocAccess(normalizedId, uid);
  return fromMembersDoc?.canReportProblem === true || fromMembersDoc?.isMember === true;
}

/**
 * Fetch project access for a single project (for batch use, e.g. in ExpensesKpiScreen).
 * Returns the same shape as useProjectAccess but as a Promise.
 */
export async function fetchProjectAccess(
  projectId: string,
  uid: string,
  projectOwnerId?: string | null,
  opts?: { forceServer?: boolean }
): Promise<ProjectAccess> {
  if (!projectId || !uid) {
    return { ...NO_ACCESS, loading: false };
  }
  try {
    const readOpts = opts?.forceServer ? { forceServer: true as const } : undefined;
    const projectRef = doc(db, "projects", projectId);
    const projectSnap = await getDocSmart(projectRef, readOpts);

    // Team/org projects may have no `ownerId`; only bail when the document is missing.
    if (!projectSnap.exists()) {
      return { ...NO_ACCESS, loading: false };
    }
    const ownerId = (projectSnap.data()?.ownerId as string) ?? projectOwnerId ?? null;

    const isOwner = !!ownerId && ownerId === uid;
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
        canWriteDiary: true,
        canWritePhotos: true,
        canReportProblem: true,
      };
    }

    const projectData = (projectSnap.data() ?? {}) as Record<string, unknown>;
    const { access: resolved, gate } = await resolveNonOwnerProjectAccess(projectId, uid, projectData);
    return finalizeProjectAccess(resolved, uid, projectData, ownerId, gate);
  } catch (error) {
    console.warn("[fetchProjectAccess] Error:", error);
    return { ...NO_ACCESS, loading: false };
  }
}

export { getAssignedMemberIdsFromProject, isUserAssignedOnProject } from "../lib/projectAssignment";
