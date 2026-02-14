import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
type MembersByUidData = {
  uid: string;
  permissionLevel: "viewer" | "editor";
  sharedItems: {
    tasks?: boolean;
    phases?: boolean;
    expenses?: boolean;
    diary?: boolean;
    documents?: boolean;
  };
  sharedPhaseIds: string[];
  status: string;
  joinedAt: admin.firestore.FieldValue;
};

/** Write or update membersByUid mirror for Firestore rules access checks. Exported for use in index.ts */
export function setMembersByUidMirror(
  batch: admin.firestore.WriteBatch,
  projectId: string,
  uid: string,
  data: Omit<MembersByUidData, "uid" | "joinedAt"> & { joinedAt?: admin.firestore.FieldValue }
) {
  const ref = admin.firestore().doc(`projects/${projectId}/membersByUid/${uid}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  batch.set(ref, {
    uid,
    permissionLevel: data.permissionLevel ?? "viewer",
    sharedItems: data.sharedItems ?? { tasks: true, phases: true, expenses: false, diary: false, documents: false },
    sharedPhaseIds: data.sharedPhaseIds ?? [],
    status: data.status ?? "active",
    joinedAt: data.joinedAt ?? now,
  });
}

/** Delete membersByUid mirror and update sharedWithCount */
function deleteMembersByUidAndUpdateCount(
  batch: admin.firestore.WriteBatch,
  projectId: string,
  uid: string,
  projectRef: admin.firestore.DocumentReference,
  currentSharedWithCount: number
) {
  const mirrorRef = admin.firestore().doc(`projects/${projectId}/membersByUid/${uid}`);
  batch.delete(mirrorRef);
  const nextCount = Math.max(0, currentSharedWithCount - 1);
  batch.update(projectRef, { sharedWithCount: nextCount });
}

type AddMemberRequest = {
  projectId?: string;
  email?: string;
};

type RemoveMemberRequest = {
  projectId?: string;
  memberUid?: string;
};

type UpdateMemberPermissionsRequest = {
  projectId?: string;
  memberId?: string;
  permissionLevel?: "viewer" | "editor";
  sharedItems?: {
    tasks?: boolean;
    phases?: boolean;
    expenses?: boolean;
    diary?: boolean;
    documents?: boolean;
  };
  sharedPhaseIds?: string[];
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

type RemoveMemberByIdRequest = {
  projectId?: string;
  memberId?: string;
};

export const removeProjectMember = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { projectId, memberId } = request.data as RemoveMemberByIdRequest;
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }
    if (!memberId || typeof memberId !== "string") {
      throw new HttpsError("invalid-argument", "memberId is required.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const projectRef = db.doc(`projects/${projectId}`);
    const memberRef = db.doc(`projects/${projectId}/members/${memberId}`);

    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new HttpsError("not-found", "Member not found.");
    }

    const memberData = memberSnap.data() as {
      userId?: string | null;
      email?: string;
      emailLower?: string;
      name?: string;
      invitedBy?: string;
    };
    const memberUserId = memberData.userId ?? null;
    const isSelf = !!memberUserId && memberUserId === uid;

    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      throw new HttpsError("not-found", "Project not found.");
    }
    const ownerId = projectSnap.data()?.ownerId as string | undefined;

    if (!isSelf && (!ownerId || ownerId !== uid)) {
      throw new HttpsError("permission-denied", "Only owner can remove members, or member can leave.");
    }

    const currentSharedWithCount = (projectSnap.data()?.sharedWithCount as number | undefined) ?? 0;
    const projectName = (projectSnap.data()?.name as string) ?? "";
    const memberEmail = (memberData.emailLower as string) ?? (memberData.email as string) ?? "";
    const memberName = (memberData.name as string) ?? memberEmail;
    const displayName = (request.auth.token?.name as string) ?? request.auth.token?.email ?? "";
    const recipientUid = (memberData.invitedBy as string) ?? ownerId ?? null;

    const batch = db.batch();
    batch.delete(memberRef);

    if (memberUserId) {
      deleteMembersByUidAndUpdateCount(batch, projectId, memberUserId, projectRef, currentSharedWithCount);
      batch.delete(db.doc(`users/${memberUserId}/projectRefs/${projectId}`));
    } else {
      // Invited member (no userId yet) - never joined, so don't decrement sharedWithCount
    }

    const eventPayload: Record<string, unknown> = {
      text: isSelf ? `${memberName || memberEmail} opustil projekt.` : `Vlastník odstránil člena ${memberName || memberEmail}.`,
    };
    if (memberUserId != null) eventPayload.targetUserId = memberUserId;
    if (memberEmail) eventPayload.targetEmail = memberEmail;
    if (memberName) eventPayload.targetName = memberName;

    batch.set(db.collection("projects").doc(projectId).collection("events").doc(), {
      type: isSelf ? "member_left" : "member_removed",
      actorId: uid,
      actorName: displayName || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      payload: eventPayload,
    });

    if (recipientUid && recipientUid !== uid) {
      batch.set(db.collection("notifications").doc(), {
        userId: recipientUid,
        type: isSelf ? "MEMBER_LEFT" : "MEMBER_REMOVED",
        projectId,
        projectName,
        message: isSelf ? `Používateľ ${memberName || memberEmail} opustil projekt.` : `Vlastník odstránil člena ${memberName || memberEmail}.`,
        fromUserId: uid,
        fromUserName: displayName || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        readAt: null,
        severity: "info",
      });
    }

    if (memberUserId) {
      const tasksSnap = await db.collection(`projects/${projectId}/tasks`).get();
      for (const taskDoc of tasksSnap.docs) {
        const d = taskDoc.data();
        if (d.assigneeId === memberUserId || d.assignedTo === memberUserId) {
          batch.update(taskDoc.ref, {
            assigneeId: null,
            assigneeName: null,
            assignedTo: null,
            assignedToEmail: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    await batch.commit();

    console.log("[team] removeProjectMember", { projectId, memberId, memberUserId, isSelf });
    return { ok: true };
  }
);

export const updateMemberPermissions = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async (request) => {
    console.log("[updateMemberPermissions] auth?", !!request.auth, "uid", request.auth?.uid);
    console.log("[updateMemberPermissions] data", request.data);

    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Auth required");
    }

    const uid = request.auth.uid;
    const data = (request.data ?? {}) as UpdateMemberPermissionsRequest;
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    const memberId = typeof data.memberId === "string" ? data.memberId.trim() : "";
    if (!projectId || !memberId) {
      throw new HttpsError("invalid-argument", "projectId and memberId are required.");
    }

    await assertOwner(projectId, uid);

    const db = admin.firestore();
    const memberRef = db.doc(`projects/${projectId}/members/${memberId}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new HttpsError("not-found", "Member not found.");
    }

    const memberData = memberSnap.data() as {
      userId?: string | null;
      permissionLevel?: "viewer" | "editor";
      sharedItems?: MembersByUidData["sharedItems"];
      sharedPhaseIds?: string[];
    };
    const memberUserId = memberData.userId ?? null;

    const permissionLevel = data.permissionLevel === "viewer" || data.permissionLevel === "editor"
      ? data.permissionLevel
      : undefined;
    const sharedItems = data.sharedItems && typeof data.sharedItems === "object"
      ? data.sharedItems
      : undefined;
    const sharedPhaseIds = Array.isArray(data.sharedPhaseIds)
      ? data.sharedPhaseIds.filter((id): id is string => typeof id === "string")
      : undefined;

    const updates: Record<string, unknown> = {};
    if (permissionLevel !== undefined) updates.permissionLevel = permissionLevel;
    if (sharedItems !== undefined) updates.sharedItems = sharedItems;
    if (sharedPhaseIds !== undefined) updates.sharedPhaseIds = sharedPhaseIds;

    if (Object.keys(updates).length === 0) {
      return { ok: true };
    }

    const batch = db.batch();
    batch.update(memberRef, updates);

    if (memberUserId) {
      const projectRefDoc = db.doc(`users/${memberUserId}/projectRefs/${projectId}`);
      const projectRefSnap = await projectRefDoc.get();
      if (projectRefSnap.exists) {
        const projectRefUpdates: Record<string, unknown> = {};
        if (permissionLevel !== undefined) projectRefUpdates.permissionLevel = permissionLevel;
        if (sharedItems !== undefined) projectRefUpdates.sharedItems = sharedItems;
        batch.update(projectRefDoc, projectRefUpdates);
      }

      const finalPermissionLevel = permissionLevel ?? memberData.permissionLevel ?? "viewer";
      const finalSharedItems = sharedItems ?? memberData.sharedItems ?? { tasks: true, phases: true, expenses: false, diary: false, documents: false };
      const finalSharedPhaseIds = sharedPhaseIds ?? memberData.sharedPhaseIds ?? [];
      setMembersByUidMirror(batch, projectId, memberUserId, {
        permissionLevel: finalPermissionLevel,
        sharedItems: finalSharedItems,
        sharedPhaseIds: finalSharedPhaseIds,
        status: "active",
      });
    }

    await batch.commit();
    return { ok: true };
  }
);

/**
 * One-time backfill: set sharedWithCount on all projects based on active members (excluding owner).
 * Call once to fix projects that were shared before sharedWithCount was implemented.
 */
export const backfillProjectSharedCounts = onCall(
  { region: "europe-west1", enforceAppCheck: false },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Auth required");
    }

    const db = admin.firestore();
    const projectsSnap = await db.collection("projects").get();
    let updated = 0;

    for (const projectDoc of projectsSnap.docs) {
      const projectId = projectDoc.id;
      const projectData = projectDoc.data();
      const ownerId = (projectData.ownerId as string) ?? null;
      if (!ownerId) continue;

      const membersSnap = await db.collection(`projects/${projectId}/members`).get();
      let count = 0;
      for (const m of membersSnap.docs) {
        const d = m.data();
        const userId = d.userId ?? null;
        if (userId && userId !== ownerId && (d.status === "active" || !d.status)) {
          count++;
        }
      }

      const current = (projectData.sharedWithCount as number | undefined) ?? 0;
      if (current !== count) {
        await projectDoc.ref.update({ sharedWithCount: count });
        updated++;
        console.log("[backfillProjectSharedCounts]", projectId, "count:", count);
      }
    }

    console.log("[backfillProjectSharedCounts] done, updated", updated, "projects");
    return { ok: true, updated };
  }
);
