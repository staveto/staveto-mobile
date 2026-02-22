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
    throw new HttpsError("not-found", "errors.project.notFound");
  }
  const ownerId = projectSnap.data()?.ownerId as string | undefined;
  if (!ownerId || ownerId !== uid) {
    throw new HttpsError("permission-denied", "errors.auth.notAllowed");
  }
  return projectRef;
}

/** Check if user has editor or owner permission (can manage members). */
async function hasEditorOrOwnerPermission(
  db: admin.firestore.Firestore,
  projectId: string,
  uid: string
): Promise<boolean> {
  const memberByUid = await db.doc(`projects/${projectId}/membersByUid/${uid}`).get();
  if (!memberByUid.exists) return false;
  const d = memberByUid.data() as { permissionLevel?: string } | undefined;
  return d?.permissionLevel === "editor";
}

export const addProjectMemberByEmail = onCall(
  { region: "europe-west1", invoker: "public" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
    }

    const { projectId, email } = request.data as AddMemberRequest;
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "errors.invalid.projectId");
    }
    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "errors.invalid.email");
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
      throw new HttpsError("failed-precondition", "errors.precondition.ownerAlreadyMember");
    }

    const memberRef = projectRef.collection("members").doc(memberUid);
    const db = admin.firestore();

    const now = admin.firestore.FieldValue.serverTimestamp();
    const defaultSharedItems = { tasks: true, phases: true, expenses: true, diary: true, documents: true };

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
          status: "active",
          joinedAt: now,
          addedBy: uid,
          permissionLevel: "editor",
          sharedItems: defaultSharedItems,
          sharedPhaseIds: [],
        },
        { merge: true }
      );

      if (isNewMember) {
        const projectSnap = await tx.get(projectRef);
        const projectData = projectSnap.data() ?? {};
        const currentSharedWithCount = (projectData.sharedWithCount as number | undefined) ?? 0;
        tx.update(projectRef, { sharedWithCount: currentSharedWithCount + 1 });

        const mirrorRef = db.doc(`projects/${projectId}/membersByUid/${memberUid}`);
        tx.set(mirrorRef, {
          uid: memberUid,
          permissionLevel: "editor",
          sharedItems: defaultSharedItems,
          sharedPhaseIds: [],
          status: "active",
          joinedAt: now,
        });

        const projectRefDoc = db.doc(`users/${memberUid}/projectRefs/${projectId}`);
        tx.set(projectRefDoc, {
          projectId,
          role: "member",
          permissionLevel: "editor",
          sharedItems: defaultSharedItems,
          sharedPhaseIds: [],
          joinedAt: now,
          source: "addMember",
        });
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
  memberUid?: string;
};

export const removeProjectMember = onCall(
  { region: "europe-west1", enforceAppCheck: false, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
    }

    const { projectId, memberId, memberUid } = request.data as RemoveMemberByIdRequest;
    if (!projectId || typeof projectId !== "string") {
      throw new HttpsError("invalid-argument", "errors.invalid.projectId");
    }
    let resolvedMemberId = typeof memberId === "string" && memberId.trim() ? memberId.trim() : null;
    if (!resolvedMemberId && typeof memberUid === "string" && memberUid.trim()) {
      resolvedMemberId = memberUid.trim();
    }
    if (!resolvedMemberId) {
      throw new HttpsError("invalid-argument", "errors.invalid.memberId");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const projectRef = db.doc(`projects/${projectId}`);
    let memberRef = db.doc(`projects/${projectId}/members/${resolvedMemberId}`);

    let memberSnap = await memberRef.get();
    if (!memberSnap.exists && typeof memberUid === "string" && memberUid.trim()) {
      const byUserId = await db
        .collection(`projects/${projectId}/members`)
        .where("userId", "==", memberUid.trim())
        .limit(1)
        .get();
      if (!byUserId.empty) {
        memberRef = byUserId.docs[0].ref;
        memberSnap = await memberRef.get();
      }
    }
    if (!memberSnap.exists) {
      throw new HttpsError("not-found", "errors.member.notFound");
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
      throw new HttpsError("not-found", "errors.project.notFound");
    }
    const ownerId = projectSnap.data()?.ownerId as string | undefined;

    const memberRole = (memberData as { role?: string }).role;
    const isRemovingOwner = memberRole === "owner" || memberUserId === ownerId;
    const canRemove =
      isSelf ||
      uid === ownerId ||
      (isRemovingOwner ? false : await hasEditorOrOwnerPermission(db, projectId, uid));
    if (!canRemove) {
      throw new HttpsError(
        "permission-denied",
        "Only owner or editor can remove members, or member can leave."
      );
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

    const tasksSnap = await db.collection(`projects/${projectId}/tasks`).get();
    const memberEmailLower = memberEmail.trim().toLowerCase();
    const memberNameLower = memberName.trim().toLowerCase();
    for (const taskDoc of tasksSnap.docs) {
      const d = taskDoc.data();
      const taskAssigneeId = (d.assigneeId ?? d.assignedTo) ?? "";
      const taskAssigneeName = (d.assigneeName ?? d.assignedToEmail ?? "").toString().trim().toLowerCase();
      const shouldClear =
        (memberUserId && taskAssigneeId === memberUserId) ||
        taskAssigneeId === resolvedMemberId ||
        (memberNameLower && taskAssigneeName === memberNameLower) ||
        (memberEmailLower && taskAssigneeName === memberEmailLower);
      if (shouldClear) {
        batch.update(taskDoc.ref, {
          assigneeId: null,
          assigneeName: null,
          assignedTo: null,
          assignedToEmail: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    await batch.commit();

    console.log("[team] removeProjectMember", { projectId, memberId: resolvedMemberId, memberUserId, isSelf });
    return { ok: true };
  }
);

export const updateMemberPermissions = onCall(
  { region: "europe-west1", enforceAppCheck: false, invoker: "public" },
  async (request) => {
    console.log("[updateMemberPermissions] auth?", !!request.auth, "uid", request.auth?.uid);
    console.log("[updateMemberPermissions] data", request.data);

    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
    }

    const uid = request.auth.uid;
    const data = (request.data ?? {}) as UpdateMemberPermissionsRequest;
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    const memberId = typeof data.memberId === "string" ? data.memberId.trim() : "";
    if (!projectId || !memberId) {
      throw new HttpsError("invalid-argument", "errors.invalid.memberId");
    }

    await assertOwner(projectId, uid);

    const db = admin.firestore();
    const memberRef = db.doc(`projects/${projectId}/members/${memberId}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new HttpsError("not-found", "errors.member.notFound");
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
 * Sync membersByUid from members collection for a project.
 * Ensures Firestore rules can correctly evaluate sharedItems for each member.
 * Call when invited users don't see phases/tasks despite correct permissions.
 */
export const syncMembersByUidForProject = onCall(
  { region: "europe-west1", enforceAppCheck: false, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
    }

    const uid = request.auth.uid;
    const data = (request.data ?? {}) as { projectId?: string };
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    if (!projectId) {
      throw new HttpsError("invalid-argument", "errors.invalid.projectId");
    }

    const db = admin.firestore();
    const projectRef = db.doc(`projects/${projectId}`);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      throw new HttpsError("not-found", "errors.project.notFound");
    }
    const ownerId = (projectSnap.data()?.ownerId as string) ?? null;
    if (!ownerId || ownerId !== uid) {
      throw new HttpsError("permission-denied", "errors.auth.notAllowed");
    }

    const membersSnap = await db.collection(`projects/${projectId}/members`).get();
    const batch = db.batch();
    let updated = 0;

    const fullAccessDefault = { tasks: true, phases: true, expenses: true, diary: true, documents: true };

    for (const memberDoc of membersSnap.docs) {
      const memberData = memberDoc.data() as {
        userId?: string | null;
        status?: string;
        permissionLevel?: string;
        sharedItems?: MembersByUidData["sharedItems"];
        sharedPhaseIds?: string[];
      };
      const memberUserId = memberData.userId ?? null;
      if (!memberUserId || memberUserId === ownerId) continue;
      if (memberData.status !== "active" && memberData.status !== undefined) continue;

      const mirrorRef = db.doc(`projects/${projectId}/membersByUid/${memberUserId}`);
      const mirrorSnap = await mirrorRef.get();

      const sharedItems = memberData.sharedItems && typeof memberData.sharedItems === "object"
        ? memberData.sharedItems
        : mirrorSnap.exists
          ? (mirrorSnap.data() as any)?.sharedItems ?? fullAccessDefault
          : fullAccessDefault;
      const permissionLevel = (memberData.permissionLevel === "viewer" || memberData.permissionLevel === "editor")
        ? memberData.permissionLevel
        : "viewer";
      const sharedPhaseIds = Array.isArray(memberData.sharedPhaseIds) ? memberData.sharedPhaseIds : [];

      const needsUpdate = !mirrorSnap.exists
        || JSON.stringify((mirrorSnap.data() as any)?.sharedItems) !== JSON.stringify(sharedItems)
        || (mirrorSnap.data() as any)?.permissionLevel !== permissionLevel;

      if (needsUpdate) {
        setMembersByUidMirror(batch, projectId, memberUserId, {
          permissionLevel,
          sharedItems,
          sharedPhaseIds,
          status: "active",
        });
        updated++;
      }
    }

    if (updated > 0) {
      await batch.commit();
    }
    return { ok: true, updated };
  }
);

/**
 * One-time backfill: set sharedWithCount on all projects based on active members (excluding owner).
 * Call once to fix projects that were shared before sharedWithCount was implemented.
 */
export const backfillProjectSharedCounts = onCall(
  { region: "europe-west1", enforceAppCheck: false, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
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

/**
 * Sync sharedWithCount for the current user's owned projects only.
 * Call when user pulls to refresh on Projects screen to fix stale counts.
 */
export const syncMyProjectsSharedCount = onCall(
  { region: "europe-west1", enforceAppCheck: false, invoker: "public" },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "errors.auth.required");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const projectsSnap = await db.collection("projects").where("ownerId", "==", uid).get();
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
      }
    }

    return { ok: true, updated };
  }
);
