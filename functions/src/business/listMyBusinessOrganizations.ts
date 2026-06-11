import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

type ListedOrganization = {
  orgId: string;
  orgName: string;
  role: string;
  membershipStatus: string;
  orgStatus: string;
  businessEnabled: boolean;
  ownerUid: string;
  source?: string | null;
  onboardingSource?: string | null;
  trialEndsAt?: unknown;
  activeBusinessOrderId?: string | null;
};

function parseOrgIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 4 && parts[0] === "organizations" && parts[2] === "members") {
    return parts[1] ?? null;
  }
  return null;
}

function normalizeListedRole(raw: unknown, org: FirebaseFirestore.DocumentData, uid: string): string {
  if (org.ownerUid === uid) return "owner";
  const role = String(raw ?? "member").toLowerCase();
  if (role === "member") return "worker";
  return role;
}

function buildListedOrg(
  orgId: string,
  org: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData | null,
  uid: string
): ListedOrganization {
  return {
    orgId,
    orgName: typeof org.name === "string" ? org.name.trim() || "Firma" : "Firma",
    role: normalizeListedRole(member?.role, org, uid),
    membershipStatus: String(member?.status ?? "active").toLowerCase(),
    orgStatus: String(org.status ?? "active").toLowerCase(),
    businessEnabled: org.businessEnabled === true,
    ownerUid: typeof org.ownerUid === "string" ? org.ownerUid : "",
    source: typeof org.source === "string" ? org.source : null,
    onboardingSource: typeof org.onboardingSource === "string" ? org.onboardingSource : null,
    trialEndsAt: org.trialEndsAt ?? null,
    activeBusinessOrderId:
      typeof org.activeBusinessOrderId === "string" ? org.activeBusinessOrderId : null,
  };
}

async function runMemberQuery(
  query: Promise<FirebaseFirestore.QuerySnapshot>
): Promise<FirebaseFirestore.QuerySnapshot> {
  try {
    return await query;
  } catch (err) {
    console.warn("[listMyBusinessOrganizations] member query skipped:", err);
    return {
      docs: [],
      empty: true,
      size: 0,
    } as unknown as FirebaseFirestore.QuerySnapshot;
  }
}

export const listMyBusinessOrganizations = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<{ organizations: ListedOrganization[] }> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const uid = request.auth.uid;
    const emailLower =
      typeof request.auth.token.email === "string"
        ? request.auth.token.email.trim().toLowerCase()
        : "";

    const db = admin.firestore();
    const byOrgId = new Map<string, ListedOrganization>();

    const ownedSnap = await db.collection("organizations").where("ownerUid", "==", uid).get();
    for (const orgDoc of ownedSnap.docs) {
      const org = orgDoc.data();
      byOrgId.set(orgDoc.id, buildListedOrg(orgDoc.id, org, null, uid));
    }

    const memberQueries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      runMemberQuery(db.collectionGroup("members").where("userId", "==", uid).get()),
    ];
    if (emailLower) {
      memberQueries.push(
        runMemberQuery(db.collectionGroup("members").where("emailLower", "==", emailLower).get())
      );
      memberQueries.push(
        runMemberQuery(db.collectionGroup("members").where("email", "==", emailLower).get())
      );
    }

    const memberSnaps = await Promise.all(memberQueries);
    for (const snap of memberSnaps) {
      for (const memberDoc of snap.docs) {
        const orgId = parseOrgIdFromMemberPath(memberDoc.ref.path);
        if (!orgId || byOrgId.has(orgId)) continue;

        const member = memberDoc.data();
        const status = String(member.status ?? "active").toLowerCase();
        if (status === "removed" || status === "invited") continue;

        const orgSnap = await db.collection("organizations").doc(orgId).get();
        if (!orgSnap.exists) continue;
        const org = orgSnap.data() ?? {};

        byOrgId.set(orgId, buildListedOrg(orgId, org, member, uid));
      }
    }

    const organizations = [...byOrgId.values()];

    if (organizations.length > 0) {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const existingOrgId = userSnap.data()?.activeBusinessOrgId;
      const preferred =
        organizations.find((o) => o.role === "owner")?.orgId ?? organizations[0]?.orgId;
      if (preferred && (!existingOrgId || typeof existingOrgId !== "string")) {
        await userRef.set(
          {
            activeBusinessOrgId: preferred,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    return { organizations };
  }
);
