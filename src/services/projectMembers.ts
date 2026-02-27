import { collection, addDoc, query, getDocs, deleteDoc, doc, serverTimestamp, where, getDoc, writeBatch } from "../lib/rnFirestore";
import firestore from "@react-native-firebase/firestore";
import { db, auth, getCallable } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { addProjectEvent } from "./projectEvents";
import * as projectsService from "./projects";

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
  };
  sharedPhaseIds?: string[]; // Specific phases to share (if phases=true)
  sharedEquipmentIds?: string[]; // Specific equipment to share (MAINTENANCE projects only)
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
    const snapshot = forceFromServer
      ? await membersRef.get({ source: "server" })
      : await membersRef.get();
    
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
        sharedItems: data.sharedItems || {
          tasks: true,
          phases: true,
          expenses: true,
          diary: true,
          documents: true,
        },
        sharedPhaseIds: data.sharedPhaseIds || [],
        sharedEquipmentIds: data.sharedEquipmentIds || [],
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
  },
  sharedPhaseIds?: string[],
  sharedEquipmentIds?: string[]
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
      },
      sharedPhaseIds: sharedPhaseIds || [],
      sharedEquipmentIds: sharedEquipmentIds || [],
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
  },
  sharedPhaseIds?: string[]
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
