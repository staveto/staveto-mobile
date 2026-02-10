import { collection, addDoc, query, getDocs, deleteDoc, doc, serverTimestamp, where } from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import firestore from "@react-native-firebase/firestore";
import { addProjectEvent } from "./projectEvents";

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
};

/**
 * List all members of a project
 */
export async function listProjectMembers(projectId: string): Promise<ProjectMemberDoc[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na načítanie členov projektu.');
  }

  try {
    const membersRef = collection(db, paths.projectMembers(projectId));
    const snapshot = await getDocs(membersRef);
    
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
  sharedPhaseIds?: string[]
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
 * Remove a member from a project
 */
export async function removeMember(projectId: string, memberId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený na odstránenie člena.');
  }

  try {
    const memberRef = doc(db, paths.projectMember(projectId, memberId));
    await deleteDoc(memberRef);
    
    console.log(`[projectMembers] Removed member ${memberId} from project ${projectId}`);
  } catch (error: any) {
    console.error(`[projectMembers] Error removing member:`, error);
    throw new Error(`Nepodarilo sa odstrániť člena: ${error.message}`);
  }
}
