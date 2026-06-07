import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

type ListedOrganization = {
  orgId: string;
  orgName: string;
  role: string;
};

function parseOrgIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 4 && parts[0] === "organizations" && parts[2] === "members") {
    return parts[1] ?? null;
  }
  return null;
}

function resolveRole(
  org: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData | null,
  uid: string
): string {
  if (org.ownerUid === uid) return "owner";
  const raw = String(member?.role ?? "member").toLowerCase();
  if (raw === "member") return "worker";
  return raw;
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
      byOrgId.set(orgDoc.id, {
        orgId: orgDoc.id,
        orgName: typeof org.name === "string" ? org.name.trim() || "Firma" : "Firma",
        role: "owner",
      });
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

        byOrgId.set(orgId, {
          orgId,
          orgName: typeof org.name === "string" ? org.name.trim() || "Firma" : "Firma",
          role: resolveRole(org, member, uid),
        });
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
