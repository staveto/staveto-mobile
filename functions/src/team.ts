import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

type AddMemberRequest = {
  projectId?: string;
  email?: string;
};

type RemoveMemberRequest = {
  projectId?: string;
  memberUid?: string;
};

type MemberSnapshot = {
  displayName?: string | null;
  emailLower?: string | null;
};

async function assertOwner(projectId: string, uid: string) {
  const projectRef = admin.firestore().doc(`projects/${projectId}`);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    throw new HttpsError("not-found", "Project not found.");
  }
  const ownerId = projectSnap.data()?.ownerId as string | undefined;
  if (!ownerId || ownerId !== uid) {
    throw new HttpsError("permission-denied", "Only the project owner can manage members.");
  }
  return projectRef;
}

export const addProjectMemberByEmail = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { projectId, email } = request.data as AddMemberRequest;
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }
    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "email is required.");
    }

    const uid = request.auth.uid;
    const emailLower = email.trim().toLowerCase();
    const projectRef = await assertOwner(projectId, uid);

    const usersSnap = await admin
      .firestore()
      .collection("users")
      .where("emailLower", "==", emailLower)
      .limit(1)
      .get();

    if (usersSnap.empty) {
      throw new HttpsError("not-found", "User not found.");
    }

    const memberDoc = usersSnap.docs[0];
    const memberUid = memberDoc.id;
    const memberData = memberDoc.data() as MemberSnapshot;

    if (memberUid === uid) {
      throw new HttpsError("failed-precondition", "Owner is already part of the project.");
    }

    const memberRef = projectRef.collection("members").doc(memberUid);
    const db = admin.firestore();

    await db.runTransaction(async (tx) => {
      const memberSnap = await tx.get(memberRef);
      const isNewMember = !memberSnap.exists;

      tx.set(
        memberRef,
        {
          userId: memberUid,
          emailLower: memberData.emailLower ?? emailLower,
          displayName: memberData.displayName ?? null,
          role: "MEMBER",
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: uid,
        },
        { merge: true }
      );

      if (isNewMember) {
        const projectSnap = await tx.get(projectRef);
        const currentCount = (projectSnap.data()?.membersCount as number | undefined) ?? 0;
        tx.update(projectRef, { membersCount: currentCount + 1 });
      }
    });

    console.log("[team] addProjectMemberByEmail", {
      projectId,
      ownerUid: uid,
      memberUid,
      emailLower,
    });

    return {
      ok: true,
      memberUid,
      displayName: memberData.displayName ?? null,
      emailLower,
    };
  }
);

export const removeProjectMember = onCall(
  { region: "europe-west1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { projectId, memberUid } = request.data as RemoveMemberRequest;
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }
    if (!memberUid || typeof memberUid !== "string") {
      throw new HttpsError("invalid-argument", "memberUid is required.");
    }

    const uid = request.auth.uid;
    const projectRef = await assertOwner(projectId, uid);
    const memberRef = projectRef.collection("members").doc(memberUid);
    const db = admin.firestore();

    await db.runTransaction(async (tx) => {
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) {
        return;
      }

      tx.delete(memberRef);

      const projectSnap = await tx.get(projectRef);
      const currentCount = (projectSnap.data()?.membersCount as number | undefined) ?? 0;
      const nextCount = currentCount > 0 ? currentCount - 1 : 0;
      tx.update(projectRef, { membersCount: nextCount });
    });

    console.log("[team] removeProjectMember", {
      projectId,
      ownerUid: uid,
      memberUid,
    });

    return { ok: true };
  }
);
