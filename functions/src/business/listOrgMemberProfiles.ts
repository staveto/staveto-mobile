import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

type MemberProfile = {
  uid: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

function resolveDisplayName(
  user: FirebaseFirestore.DocumentData | undefined,
  member: FirebaseFirestore.DocumentData
): string | null {
  const fromUser =
    typeof user?.displayName === "string" && user.displayName.trim()
      ? user.displayName.trim()
      : [user?.firstName, user?.lastName]
          .filter((p) => typeof p === "string" && p.trim())
          .join(" ")
          .trim();
  if (fromUser) return fromUser;

  const fromMember =
    typeof member?.displayName === "string" && member.displayName.trim()
      ? member.displayName.trim()
      : "";
  return fromMember || null;
}

function resolveEmail(
  user: FirebaseFirestore.DocumentData | undefined,
  member: FirebaseFirestore.DocumentData
): string | null {
  const candidates = [
    user?.email,
    member?.email,
    member?.emailLower,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export const listOrgMemberProfiles = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<{ members: MemberProfile[] }> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const orgId =
      typeof request.data?.orgId === "string" ? request.data.orgId.trim() : "";
    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }

    const extraUserIds = Array.isArray(request.data?.extraUserIds)
      ? (request.data.extraUserIds as unknown[])
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id: string) => id.trim())
      : [];

    const uid = request.auth.uid;
    const emailLower =
      typeof request.auth.token.email === "string"
        ? request.auth.token.email.trim().toLowerCase()
        : "";

    const db = admin.firestore();

    const orgSnap = await db.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const org = orgSnap.data() ?? {};

    // Verify caller belongs to the org (owner or active member).
    let isAllowed = org.ownerUid === uid;
    if (!isAllowed) {
      const directMember = await db
        .collection("organizations")
        .doc(orgId)
        .collection("members")
        .doc(uid)
        .get();
      if (directMember.exists) {
        const status = String(directMember.data()?.status ?? "active").toLowerCase();
        isAllowed = status !== "removed";
      }
    }
    if (!isAllowed && emailLower) {
      const byEmail = await db
        .collection("organizations")
        .doc(orgId)
        .collection("members")
        .where("emailLower", "==", emailLower)
        .limit(1)
        .get();
      isAllowed = !byEmail.empty;
    }
    if (!isAllowed) {
      throw new HttpsError("permission-denied", "Not a member of this organization.");
    }

    const membersSnap = await db
      .collection("organizations")
      .doc(orgId)
      .collection("members")
      .get();

    const members: MemberProfile[] = [];
    const seenUids = new Set<string>();

    const pushMember = (
      memberUid: string,
      member: FirebaseFirestore.DocumentData,
      userData?: FirebaseFirestore.DocumentData
    ) => {
      if (!memberUid || seenUids.has(memberUid)) return;
      seenUids.add(memberUid);
      const status = String(member.status ?? "active").toLowerCase();
      if (status === "removed") return;
      members.push({
        uid: memberUid,
        displayName: resolveDisplayName(userData, member),
        email: resolveEmail(userData, member),
        role: String(member.role ?? "member").toLowerCase(),
        status,
      });
    };

    await Promise.all(
      membersSnap.docs.map(async (memberDoc) => {
        const member = memberDoc.data();
        const memberUid =
          typeof member.userId === "string" && member.userId.trim()
            ? member.userId.trim()
            : memberDoc.id;

        let userData: FirebaseFirestore.DocumentData | undefined;
        try {
          const userSnap = await db.collection("users").doc(memberUid).get();
          userData = userSnap.data();
        } catch {
          userData = undefined;
        }

        pushMember(memberUid, member, userData);
      })
    );

    // Resolve project owners / assignees that may not have an org member doc.
    await Promise.all(
      extraUserIds.map(async (extraUid: string) => {
        if (seenUids.has(extraUid)) return;
        let userData: FirebaseFirestore.DocumentData | undefined;
        try {
          const userSnap = await db.collection("users").doc(extraUid).get();
          userData = userSnap.data();
        } catch {
          userData = undefined;
        }
        pushMember(extraUid, {}, userData);
      })
    );

    return { members };
  }
);
