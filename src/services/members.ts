import { collection, getDocs, Timestamp } from "../lib/rnFirestore";
import { db, getCallable } from "../firebase";

export type ProjectMemberDoc = {
  id: string;
  userId: string;
  emailLower: string;
  displayName?: string | null;
  role?: "MEMBER";
  joinedAt?: string;
  addedBy?: string | null;
};

function toDoc(docSnap: { id: string; data: () => Record<string, unknown> }): ProjectMemberDoc {
  const d = docSnap.data();
  const joinedAt = d.joinedAt instanceof Timestamp ? d.joinedAt.toDate().toISOString() : undefined;
  return {
    id: docSnap.id,
    userId: (d.userId as string) ?? docSnap.id,
    emailLower: (d.emailLower as string) ?? "",
    displayName: (d.displayName as string | null) ?? null,
    role: (d.role as "MEMBER" | undefined) ?? "MEMBER",
    joinedAt,
    addedBy: (d.addedBy as string | null) ?? null,
  };
}

export async function addMemberByEmail(projectId: string, email: string): Promise<{
  ok: boolean;
  memberUid: string;
  displayName?: string | null;
  emailLower: string;
}> {
  const result = await getCallable("addProjectMemberByEmail")({ projectId, email });
  return result.data as {
    ok: boolean;
    memberUid: string;
    displayName?: string | null;
    emailLower: string;
  };
}

export async function removeMember(projectId: string, memberUid: string): Promise<{ ok: boolean }> {
  const result = await getCallable("removeProjectMember")({ projectId, memberUid });
  return result.data as { ok: boolean };
}

export async function listMembers(projectId: string): Promise<ProjectMemberDoc[]> {
  const snap = await getDocs(collection(db, "projects", projectId, "members"));
  const members = snap.docs.map((d) =>
    toDoc({ id: d.id, data: () => d.data() as Record<string, unknown> })
  );
  members.sort((a, b) => {
    const nameA = (a.displayName ?? a.emailLower ?? "").toLowerCase();
    const nameB = (b.displayName ?? b.emailLower ?? "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
  return members;
}
