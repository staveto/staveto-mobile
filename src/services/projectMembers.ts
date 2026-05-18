import { collection, addDoc, query, getDocs, deleteDoc, doc, serverTimestamp, where, getDoc, writeBatch, updateDoc } from "../lib/rnFirestore";
import firestore from "@react-native-firebase/firestore";
import { getDocsSmart, getDocSmart } from "./firestoreSmartRead";
import { db, auth, getCallable } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { addProjectEvent } from "./projectEvents";
import * as projectsService from "./projects";

/**
 * Read-only: `orgId` / `workspaceType` on `projects/{projectId}` (may be absent on legacy docs).
 */
export async function getProjectOrgMetadata(
  projectId: string
): Promise<{ orgId?: string; workspaceType?: string }> {
  if (!projectId || !auth.currentUser?.uid) return {};
  try {
    const snap = await getDocSmart(doc(db, "projects", projectId));
    if (!snap.exists()) return {};
    const d = snap.data() as Record<string, unknown>;
    return {
      orgId: typeof d.orgId === "string" && d.orgId.trim() ? d.orgId.trim() : undefined,
      workspaceType:
        typeof d.workspaceType === "string" && d.workspaceType.trim()
          ? d.workspaceType.trim()
          : undefined,
    };
  } catch (e) {
    console.warn("[projectMembers] getProjectOrgMetadata failed", e);
    return {};
  }
}

export type ProjectMemberDoc = {
  id: string;
  userId: string;
  email?: string;
  emailLower?: string;
  name?: string;
  role?: 'owner' | 'member';
  status?: 'invited' | 'active';
  joinedAt?: firestore.FirebaseFirestoreTypes.Timestamp | string;
  addedAt: firestore.FirebaseFirestoreTypes.Timestamp | string;
  // Permission level: 'viewer' = read-only, 'editor' = read-write
  permissionLevel?: 'viewer' | 'editor';
  // Sharing permissions
  sharedItems?: {
    tasks?: boolean;
    phases?: boolean;
    expenses?: boolean;
    diary?: boolean;
    documents?: boolean;
    timeTracking?: boolean;
  };
  sharedPhaseIds?: string[]; // Specific phases to share (if phases=true)
  sharedEquipmentIds?: string[]; // Specific equipment to share (MAINTENANCE projects only)
  /** Hourly rate in EUR for labour cost calculation (owner sets per project) */
  hourlyRateEur?: number;
};

/**
 * List all members of a project
 * @param forceFromServer - When true, bypasses cache to get fresh data (use after add/remove member)
 */
export async function listProjectMembers(
  projectId: string,
  forceFromServer?: boolean
): Promise<ProjectMemberDoc[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na načítanie členov projektu.');
  }

  try {
    const membersRef = firestore()
      .collection("projects")
      .doc(projectId)
      .collection("members");
    // Server-only when forceFromServer: need fresh data after add/remove member.
    // getDocsSmart with forceServer uses 8s timeout to avoid UI hang.
    const snapshot = await getDocsSmart(membersRef, { forceServer: !!forceFromServer });
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const hasUserIdField = Object.prototype.hasOwnProperty.call(data, "userId");
      const parsedUserId =
        typeof data.userId === "string"
          ? data.userId
          : !hasUserIdField
          ? doc.id // backward compatibility for legacy docs where uid was document id
          : "";
      return {
        id: doc.id,
        userId: parsedUserId,
        email: data.email || undefined,
        emailLower: data.emailLower || undefined,
        name: data.name || undefined,
        role: data.role || 'member',
        status: data.status || (parsedUserId ? "active" : "invited"),
        joinedAt: data.joinedAt || undefined,
        permissionLevel: data.permissionLevel || 'editor',
        addedAt: data.addedAt || new Date().toISOString(),
        sharedItems: (() => {
          const si = data.sharedItems ?? {};
          return {
            tasks: si.tasks ?? true,
            phases: si.phases ?? true,
            expenses: si.expenses ?? true,
            diary: si.diary ?? true,
            documents: si.documents ?? true,
            timeTracking: si.timeTracking ?? true,
          };
        })(),
        sharedPhaseIds: data.sharedPhaseIds || [],
        sharedEquipmentIds: data.sharedEquipmentIds || [],
        hourlyRateEur: typeof data.hourlyRateEur === "number" ? data.hourlyRateEur : undefined,
      };
    });
  } catch (error: any) {
    console.error(`[projectMembers] Error listing members:`, error);
    throw new Error(`Nepodarilo sa načítať členov projektu: ${error.message}`);
  }
}

/**
 * Add a member to a project by email
 * Note: This creates a member document, but the actual user needs to accept the invitation
 * For now, this is a simple implementation that stores the email
 */
export async function inviteMemberByEmail(
  projectId: string,
  email: string,
  name?: string,
  permissionLevel: 'viewer' | 'editor' = 'editor',
  sharedItems?: {
    tasks?: boolean;
    phases?: boolean;
    expenses?: boolean;
    diary?: boolean;
    documents?: boolean;
    timeTracking?: boolean;
  },
  sharedPhaseIds?: string[],
  sharedEquipmentIds?: string[],
  hourlyRateEur?: number
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na pozvanie člena.');
  }

  if (!email || !email.includes('@')) {
    throw new Error('Prosím zadajte platnú emailovú adresu.');
  }

  try {
    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();
    
    // Check if member already exists
    const membersRef = collection(db, paths.projectMembers(projectId));
    const existingByEmailLower = await getDocs(query(membersRef, where('emailLower', '==', normalizedEmail)));
    const existingByEmail = await getDocs(query(membersRef, where('email', '==', normalizedEmail)));
    if (!existingByEmailLower.empty || !existingByEmail.empty) {
      throw new Error('Tento používateľ je už členom projektu.');
    }

    // Create member document
    const memberData: Record<string, unknown> = {
      userId: null, // Will be set when user claims invitation
      email: normalizedEmail,
      emailLower: normalizedEmail,
      name: name?.trim() || undefined,
      role: 'member',
      status: 'invited',
      permissionLevel: permissionLevel,
      addedAt: serverTimestamp(),
      invitedBy: currentUser.uid,
      invitedAt: serverTimestamp(),
      sharedItems: sharedItems || {
        tasks: true,
        phases: true,
        expenses: true,
        diary: true,
        documents: true,
        timeTracking: permissionLevel === "editor",
      },
      sharedPhaseIds: sharedPhaseIds || [],
      sharedEquipmentIds: sharedEquipmentIds || [],
      ...(typeof hourlyRateEur === "number" && hourlyRateEur > 0 && { hourlyRateEur }),
    };

    await addDoc(membersRef, memberData);
    try {
      await addProjectEvent(
        projectId,
        "member_invited",
        { email: normalizedEmail },
        { kind: "member", id: normalizedEmail }
      );
    } catch (error) {
      console.warn("[projectMembers] Failed to create project event:", error);
    }
    
    console.log(`[projectMembers] Invited member ${normalizedEmail} to project ${projectId}`);
  } catch (error: any) {
    console.error(`[projectMembers] Error inviting member:`, error);
    throw error;
  }
}

/**
 * Remove a member from a project (or leave if self).
 * Uses Cloud Function to delete member, membersByUid mirror, sharedWithCount, events, notifications, unassign tasks.
 * @param memberUid - Optional: user ID (for backward compatibility with backends expecting memberUid)
 */
export async function removeMember(
  projectId: string,
  memberId: string,
  memberUid?: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na odstránenie člena.');
  }

  const callRemove = async (payload: { projectId: string; memberId: string; memberUid?: string }) => {
    await currentUser.getIdToken(true);
    return getCallable("removeProjectMember")(payload);
  };

  const payload = { projectId, memberId, ...(memberUid && { memberUid }) };
  console.log("[projectMembers] removeMember", { projectId, memberId, memberUid });
  try {
    const res = await callRemove(payload);
    const data = res?.data as { ok?: boolean };
    if (!data?.ok) {
      throw new Error('Nepodarilo sa odstrániť člena.');
    }
    console.log(`[projectMembers] Removed member ${memberId} from project ${projectId}`);
  } catch (err: any) {
    const code = String(err?.code ?? "").toLowerCase();
    const msg = String(err?.message ?? "");
    if (code === "unauthenticated" || msg.includes("UNAUTHENTICATED")) {
      await currentUser.reload();
      const res = await callRemove(payload);
      const data = res?.data as { ok?: boolean };
      if (!data?.ok) {
        throw new Error('Nepodarilo sa odstrániť člena.');
      }
      console.log(`[projectMembers] Removed member ${memberId} (retry ok)`);
    } else {
      throw err;
    }
  }
}

/**
 * Update a member's permission level and shared items (owner only).
 * Uses Cloud Function to also update the member's projectRef.
 */
export async function updateMemberPermissions(
  projectId: string,
  memberId: string,
  permissionLevel: "viewer" | "editor",
  sharedItems: {
    tasks?: boolean;
    phases?: boolean;
    expenses?: boolean;
    diary?: boolean;
    documents?: boolean;
    timeTracking?: boolean;
  },
  sharedPhaseIds?: string[],
  sharedEquipmentIds?: string[]
): Promise<void> {
  const u = auth.currentUser;
  console.log("[perm] currentUser", !!u, u?.uid, u?.email);
  if (!u) {
    throw new Error("NO_AUTH_USER");
  }

  const token = await u.getIdToken(true);
  console.log("[perm] tokenLen", token?.length);

  const payload = {
    projectId,
    memberId,
    permissionLevel,
    sharedItems: sharedItems || {
      tasks: true,
      phases: true,
      expenses: false,
      diary: false,
      documents: false,
      timeTracking: permissionLevel === "editor",
    },
    sharedPhaseIds: sharedPhaseIds || [],
    sharedEquipmentIds: sharedEquipmentIds || [],
  };

  const res = await getCallable("updateMemberPermissions")(payload);
  const data = res?.data as { ok?: boolean };
  if (!data?.ok) {
    throw new Error("Nepodarilo sa aktualizovať oprávnenia.");
  }

  console.log(`[projectMembers] Updated permissions for member ${memberId} in project ${projectId}`);
}

/**
 * Update a member's hourly rate (owner only).
 * Uses direct Firestore update. If rules deny, consider extending updateMemberPermissions Cloud Function.
 */
export async function updateMemberHourlyRate(
  projectId: string,
  memberId: string,
  hourlyRateEur: number | null
): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error("NO_AUTH_USER");

  const memberRef = doc(db, paths.projectMember(projectId, memberId));
  const updateData: Record<string, unknown> =
    hourlyRateEur != null && hourlyRateEur > 0
      ? { hourlyRateEur }
      : { hourlyRateEur: firestore.FieldValue.delete() };
  await updateDoc(memberRef, updateData);
  console.log(`[projectMembers] Updated hourly rate for member ${memberId} in project ${projectId}`);
}
