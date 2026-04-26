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

      const memberByUidRef = doc(db, "projects", projectId, "membersByUid", uid);
      let memberSnap = await getDocSmart(memberByUidRef);

      if (!memberSnap.exists()) {
        const membersRef = doc(db, "projects", projectId, "members", uid);
        const membersSnap = await getDocSmart(membersRef);
        if (membersSnap.exists()) {
          const mData = membersSnap.data();
          const mStatus = mData?.status ?? "";
          if (mStatus === "active" || !mStatus) {
            const mShared = (mData?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
            const hasSharedItems = typeof mShared.tasks === "boolean" || typeof mShared.phases === "boolean";
            const mSi = hasSharedItems
              ? {
                  tasks: !!mShared.tasks,
                  phases: !!mShared.phases,
                  expenses: !!mShared.expenses,
                  diary: !!mShared.diary,
                  documents: !!mShared.documents,
                  timeTracking: mShared.timeTracking ?? true,
                }
              : ALL_TRUE;
            const mPerm = (mData?.permissionLevel === "editor" ? "editor" : "viewer") as "viewer" | "editor";
            setAccess({
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
            });
            setLoading(false);
            return;
          }
        }

        const orgId = (projectSnap.data()?.orgId as string | undefined)?.trim();
        if (orgId) {
          const orgMemRef = doc(db, "organizations", orgId, "members", uid);
          const orgMemSnap = await getDocSmart(orgMemRef);
          const oStatus = orgMemSnap.data()?.status ?? "";
          if (orgMemSnap.exists() && (oStatus === "active" || !oStatus)) {
            setAccess({
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
            });
            setLoading(false);
            return;
          }
        }

        const userProjectRefDoc = doc(db, "users", uid, "projectRefs", projectId);
        const prefSnap = await getDocSmart(userProjectRefDoc);
        if (prefSnap.exists()) {
          setAccess({
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
          setLoading(false);
          return;
        }

        setAccess({ ...NO_ACCESS, loading: false });
        setLoading(false);
        return;
      }

      const data = memberSnap.data();
      const status = data?.status ?? "";
      if (status !== "active") {
        setAccess({ ...NO_ACCESS, loading: false });
        setLoading(false);
        return;
      }

      const sharedItems = (data?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
      const si = {
        tasks: !!sharedItems.tasks,
        phases: !!sharedItems.phases,
        expenses: !!sharedItems.expenses,
        diary: !!sharedItems.diary,
        documents: !!sharedItems.documents,
        timeTracking: sharedItems.timeTracking ?? true,
      };
      const permLevel = (data?.permissionLevel === "editor" ? "editor" : "viewer") as "viewer" | "editor";
      const sharedPhaseIds = (data?.sharedPhaseIds as string[]) ?? [];

      setAccess({
        loading: false,
        isOwner: false,
        isMember: true,
        permissionLevel: permLevel,
        sharedItems: si,
        sharedPhaseIds,
        canReadTasks: si.tasks,
        canReadPhases: si.phases,
        canReadExpenses: si.expenses,
        canReadDiary: si.diary,
        canReadDocuments: si.documents,
        canWrite: permLevel === "editor",
        canWriteTime: permLevel === "editor" && si.timeTracking === true,
      });
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

    const memberByUidRef = doc(db, "projects", projectId, "membersByUid", uid);
    let memberSnap = await getDocSmart(memberByUidRef);
    if (!memberSnap.exists()) {
      const membersRef = doc(db, "projects", projectId, "members", uid);
      const membersSnap = await getDocSmart(membersRef);
      if (membersSnap.exists()) {
        const mData = membersSnap.data();
        const mStatus = mData?.status ?? "";
        if (mStatus === "active" || !mStatus) {
          const mShared = (mData?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
          const hasSharedItems = typeof mShared.tasks === "boolean" || typeof mShared.phases === "boolean";
          const mSi = hasSharedItems
            ? {
                tasks: !!mShared.tasks,
                phases: !!mShared.phases,
                expenses: !!mShared.expenses,
                diary: !!mShared.diary,
                documents: !!mShared.documents,
                timeTracking: mShared.timeTracking ?? true,
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
      }

      const orgIdFetch = (projectSnap.data()?.orgId as string | undefined)?.trim();
      if (orgIdFetch) {
        const orgMemRefFetch = doc(db, "organizations", orgIdFetch, "members", uid);
        const orgMemSnapFetch = await getDocSmart(orgMemRefFetch);
        const oStatusFetch = orgMemSnapFetch.data()?.status ?? "";
        if (orgMemSnapFetch.exists() && (oStatusFetch === "active" || !oStatusFetch)) {
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
      }

      const userProjectRefDocFetch = doc(db, "users", uid, "projectRefs", projectId);
      const prefSnapFetch = await getDocSmart(userProjectRefDocFetch);
      if (prefSnapFetch.exists()) {
        return {
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
        };
      }

      return { ...NO_ACCESS, loading: false };
    }

    const data = memberSnap.data();
    const status = data?.status ?? "";
    if (status !== "active") {
      return { ...NO_ACCESS, loading: false };
    }

    const sharedItems = (data?.sharedItems as Partial<ProjectAccess["sharedItems"]>) ?? {};
    const si = {
      tasks: !!sharedItems.tasks,
      phases: !!sharedItems.phases,
      expenses: !!sharedItems.expenses,
      diary: !!sharedItems.diary,
      documents: !!sharedItems.documents,
      timeTracking: sharedItems.timeTracking ?? true,
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
  } catch (error) {
    console.warn("[fetchProjectAccess] Error:", error);
    return { ...NO_ACCESS, loading: false };
  }
}
