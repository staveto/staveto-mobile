import * as admin from "firebase-admin";
import { log } from "firebase-functions/logger";
import { findUidByEmailLower, sendPushToUser } from "./push";

type InboxType = "PROJECT_INVITED" | "MEMBER_JOINED";
type WebType = "PROJECT_INVITED" | "PROJECT_ASSIGNED";

export async function resolveMemberUid(data: Record<string, unknown>): Promise<string | null> {
  const direct = data.userId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const emailLower = (data.emailLower ?? data.email ?? "").toString().trim().toLowerCase();
  if (!emailLower) return null;

  const fromQuery = await findUidByEmailLower(emailLower);
  if (fromQuery) return fromQuery;

  try {
    const authUser = await admin.auth().getUserByEmail(emailLower);
    return authUser.uid;
  } catch {
    return null;
  }
}

export async function getProjectName(projectId: string): Promise<string> {
  const snap = await admin.firestore().doc(`projects/${projectId}`).get();
  return (typeof snap.data()?.name === "string" && snap.data()!.name.trim())
    ? snap.data()!.name.trim()
    : "Projekt";
}

async function getProjectOrgId(projectId: string): Promise<string | null> {
  const snap = await admin.firestore().doc(`projects/${projectId}`).get();
  const orgId = snap.data()?.orgId;
  return typeof orgId === "string" && orgId.trim() ? orgId.trim() : null;
}

export async function writeCrossPlatformProjectNotification(input: {
  uid: string;
  inboxType: InboxType;
  webType: WebType;
  projectId: string;
  projectName: string;
  fromUserId?: string | null;
  message: string;
  orgId?: string | null;
}): Promise<void> {
  const db = admin.firestore();
  const ts = admin.firestore.FieldValue.serverTimestamp();

  await Promise.all([
    db.collection("notifications").add({
      userId: input.uid,
      type: input.inboxType,
      createdAt: ts,
      readAt: null,
      projectId: input.projectId,
      projectName: input.projectName,
      fromUserId: input.fromUserId ?? null,
      severity: "info",
      message: input.message,
    }),
    db.collection("users").doc(input.uid).collection("notifications").add({
      type: input.webType,
      projectId: input.projectId,
      projectName: input.projectName,
      assignedBy: input.fromUserId ?? null,
      assignedByName: null,
      orgId: input.orgId ?? null,
      createdAt: ts,
      read: false,
    }),
  ]);
}

export async function notifyProjectMemberInvited(input: {
  projectId: string;
  emailLower: string;
  invitedByUid?: string | null;
  memberData: Record<string, unknown>;
}): Promise<void> {
  const uid = await resolveMemberUid(input.memberData);
  if (!uid) {
    log("[onMemberInviteCreated] No user found for email, skipping notification", input.emailLower);
    return;
  }

  const projectName = await getProjectName(input.projectId);
  const message = `${projectName} – čaká na prijatie`;

  await writeCrossPlatformProjectNotification({
    uid,
    inboxType: "PROJECT_INVITED",
    webType: "PROJECT_INVITED",
    projectId: input.projectId,
    projectName,
    fromUserId: input.invitedByUid ?? null,
    message,
  });

  log("[onMemberInviteCreated] In-app notification created for", uid, "project", input.projectId);

  await sendPushToUser(uid, "Pozvánka do projektu", message, {
    type: "PROJECT_INVITE",
    projectId: input.projectId,
  });
}

export async function notifyProjectMemberAdded(input: {
  projectId: string;
  memberUid: string;
  memberData: Record<string, unknown>;
}): Promise<void> {
  const uid = input.memberUid.trim();
  if (!uid) return;

  const addedBy =
    (typeof input.memberData.addedBy === "string" && input.memberData.addedBy.trim()) ||
    (typeof input.memberData.invitedBy === "string" && input.memberData.invitedBy.trim()) ||
    null;
  if (addedBy === uid) return;

  const projectName = await getProjectName(input.projectId);
  const orgId = await getProjectOrgId(input.projectId);
  const message = `${projectName} – boli ste pridaný do projektu`;

  await writeCrossPlatformProjectNotification({
    uid,
    inboxType: "MEMBER_JOINED",
    webType: "PROJECT_ASSIGNED",
    projectId: input.projectId,
    projectName,
    fromUserId: addedBy,
    message,
    orgId,
  });

  log("[onMemberActiveAdded] In-app notification created for", uid, "project", input.projectId);

  await sendPushToUser(uid, "Pridaný do projektu", message, {
    type: "PROJECT_MEMBER_ADDED",
    projectId: input.projectId,
  });
}
