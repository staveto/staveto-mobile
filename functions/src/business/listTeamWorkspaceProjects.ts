import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

type ListedProject = Record<string, unknown> & { id: string };

function resolveMemberRole(
  org: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData | null | undefined,
  uid: string
): string {
  if (org.ownerUid === uid) return "owner";
  const raw = String(member?.role ?? "member").toLowerCase();
  if (raw === "member") return "worker";
  return raw;
}

function isManagerRole(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

function toIso(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function serializeProject(id: string, data: FirebaseFirestore.DocumentData): ListedProject {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    projectType: data.projectType,
    workType: data.workType,
    jobArchetype: data.jobArchetype,
    jobWorkflowKind: data.jobWorkflowKind,
    addressText: data.addressText,
    city: data.city,
    countryCode: data.countryCode,
    ownerId: data.ownerId,
    orgId: data.orgId,
    workspaceType: data.workspaceType,
    workspaceId: data.workspaceId,
    archivedAt: data.archivedAt,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    phase: data.phase,
    lifecycleStatus: data.lifecycleStatus,
    salesStatus: data.salesStatus,
    quoteStatus: data.quoteStatus,
    customerId: data.customerId,
    customerName: data.customerName,
    customerCompanyName: data.customerCompanyName,
    customerEmail: data.customerEmail,
    source: data.source,
    assignedMemberIds: Array.isArray(data.assignedMemberIds) ? data.assignedMemberIds : [],
  };
}

function projectLinkedOrgId(data: FirebaseFirestore.DocumentData): string {
  const rawOrgId = typeof data.orgId === "string" ? data.orgId.trim() : "";
  if (rawOrgId) return rawOrgId;
  return typeof data.workspaceId === "string" ? data.workspaceId.trim() : "";
}

function finishMemberAccess(
  org: FirebaseFirestore.DocumentData,
  member: FirebaseFirestore.DocumentData | null | undefined,
  uid: string
): { role: string; isManager: boolean } {
  const status = String(member?.status ?? "active").toLowerCase();
  if (status === "removed" || status === "invited") {
    throw new HttpsError("permission-denied", "Organization membership is not active.");
  }
  const role = resolveMemberRole(org, member, uid);
  return { role, isManager: isManagerRole(role) };
}

function parseOrgIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 4 && parts[0] === "organizations" && parts[2] === "members") {
    return parts[1] ?? null;
  }
  return null;
}

function parseProjectIdFromMemberPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 4 && parts[0] === "projects" && parts[2] === "members") {
    return parts[1] ?? null;
  }
  return null;
}

async function resolveOrgAccess(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
  emailLower: string
): Promise<{ role: string; isManager: boolean }> {
  const orgRef = db.collection("organizations").doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const org = orgSnap.data() ?? {};
  if (org.ownerUid === uid) {
    return { role: "owner", isManager: true };
  }

  const directSnap = await orgRef.collection("members").doc(uid).get();
  if (directSnap.exists) {
    return finishMemberAccess(org, directSnap.data(), uid);
  }

  try {
    const byUserId = await orgRef.collection("members").where("userId", "==", uid).limit(1).get();
    if (!byUserId.empty) {
      return finishMemberAccess(org, byUserId.docs[0].data(), uid);
    }
  } catch {
    /* index or rules — fall through */
  }

  if (emailLower) {
    for (const field of ["emailLower", "email"] as const) {
      try {
        const byEmail = await orgRef.collection("members").where(field, "==", emailLower).limit(1).get();
        if (!byEmail.empty) {
          return finishMemberAccess(org, byEmail.docs[0].data(), uid);
        }
      } catch {
        /* fall through */
      }
    }
  }

  try {
    const cgByUser = await db.collectionGroup("members").where("userId", "==", uid).get();
    for (const memberDoc of cgByUser.docs) {
      if (parseOrgIdFromMemberPath(memberDoc.ref.path) !== orgId) continue;
      return finishMemberAccess(org, memberDoc.data(), uid);
    }
  } catch (err) {
    console.warn("[listTeamWorkspaceProjects] collectionGroup userId lookup failed", err);
  }

  if (emailLower) {
    for (const field of ["emailLower", "email"] as const) {
      try {
        const cgByEmail = await db.collectionGroup("members").where(field, "==", emailLower).get();
        for (const memberDoc of cgByEmail.docs) {
          if (parseOrgIdFromMemberPath(memberDoc.ref.path) !== orgId) continue;
          return finishMemberAccess(org, memberDoc.data(), uid);
        }
      } catch {
        /* fall through */
      }
    }
  }

  throw new HttpsError("permission-denied", "Not a member of this organization.");
}

function canIncludeProject(
  data: FirebaseFirestore.DocumentData,
  uid: string,
  orgId: string,
  isManager: boolean,
  founderUid?: string
): boolean {
  if (data.ownerId === uid) return true;
  if (!isManager) {
    const assigned = Array.isArray(data.assignedMemberIds) ? data.assignedMemberIds : [];
    return assigned.includes(uid);
  }
  const linkedOrgId = projectLinkedOrgId(data);
  if (!linkedOrgId) {
    return (
      data.ownerId === uid ||
      (!!founderUid && typeof data.ownerId === "string" && data.ownerId === founderUid)
    );
  }
  return linkedOrgId === orgId;
}

export const listTeamWorkspaceProjects = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (
    request
  ): Promise<{ projects: ListedProject[]; diagnostics?: Record<string, unknown> }> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const uid = request.auth.uid;
    const emailLower =
      typeof request.auth.token.email === "string"
        ? request.auth.token.email.trim().toLowerCase()
        : "";
    const orgId = typeof request.data?.orgId === "string" ? request.data.orgId.trim() : "";
    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }

    const db = admin.firestore();
    const access = await resolveOrgAccess(db, orgId, uid, emailLower);
    const orgSnap = await db.collection("organizations").doc(orgId).get();
    const org = orgSnap.data() ?? {};
    const founderUid = typeof org.ownerUid === "string" ? org.ownerUid.trim() : "";

    const merged = new Map<string, ListedProject>();
    const linkCandidates = new Set<string>();

    const addProject = (
      id: string,
      data: FirebaseFirestore.DocumentData,
      fromOrgScopedQuery: boolean
    ) => {
      if (!id) return;
      if (fromOrgScopedQuery && access.isManager) {
        merged.set(id, serializeProject(id, data));
        if (!projectLinkedOrgId(data) && access.isManager) {
          const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
          if (ownerId === uid || (founderUid && ownerId === founderUid)) {
            linkCandidates.add(id);
          }
        }
        return;
      }
      if (!canIncludeProject(data, uid, orgId, access.isManager, founderUid)) return;
      merged.set(id, serializeProject(id, data));
      if (!projectLinkedOrgId(data)) {
        const ownerId = typeof data.ownerId === "string" ? data.ownerId : "";
        if (ownerId === uid || (founderUid && ownerId === founderUid)) {
          linkCandidates.add(id);
        }
      }
    };

    const ownerQueries = [uid];
    if (access.isManager && founderUid && founderUid !== uid) {
      ownerQueries.push(founderUid);
    }

    const queryJobs: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      db.collection("projects").where("orgId", "==", orgId).limit(100).get(),
      db.collection("projects").where("workspaceId", "==", orgId).limit(100).get(),
      ...ownerQueries.map((ownerId) =>
        db.collection("projects").where("ownerId", "==", ownerId).limit(100).get()
      ),
    ];

    const querySnaps = await Promise.all(queryJobs);
    for (const snap of querySnaps) {
      const fromOrgScoped = snap === querySnaps[0] || snap === querySnaps[1];
      for (const doc of snap.docs) {
        addProject(doc.id, doc.data(), fromOrgScoped);
      }
    }

    const refsSnap = await db.collection("users").doc(uid).collection("projectRefs").limit(100).get();
    const refIds = refsSnap.docs
      .map((refDoc) => {
        const raw = refDoc.data();
        const fromField =
          typeof raw.projectId === "string" && raw.projectId.trim() ? raw.projectId.trim() : "";
        return fromField || refDoc.id;
      })
      .filter(Boolean);

    await Promise.all(
      refIds.map(async (projectId) => {
        if (merged.has(projectId)) return;
        const snap = await db.collection("projects").doc(projectId).get();
        if (!snap.exists) return;
        addProject(snap.id, snap.data() ?? {}, false);
      })
    );

    try {
      const memberSnap = await db.collectionGroup("members").where("userId", "==", uid).get();
      await Promise.all(
        memberSnap.docs.map(async (memberDoc) => {
          const projectId = parseProjectIdFromMemberPath(memberDoc.ref.path);
          if (!projectId || merged.has(projectId)) return;
          const snap = await db.collection("projects").doc(projectId).get();
          if (!snap.exists) return;
          addProject(snap.id, snap.data() ?? {}, false);
        })
      );
    } catch (err) {
      console.warn("[listTeamWorkspaceProjects] project members collectionGroup failed", err);
    }

    // Projects referenced by this org's quotes (recovers legacy jobs without orgId/workspaceId).
    const quoteProjectIds = new Set<string>();
    if (access.isManager) {
      try {
        const [quotesByOrg, quotesByWs] = await Promise.all([
          db.collection("quotes").where("orgId", "==", orgId).limit(200).get(),
          db.collection("quotes").where("workspaceId", "==", orgId).limit(200).get(),
        ]);
        for (const snap of [quotesByOrg, quotesByWs]) {
          for (const quoteDoc of snap.docs) {
            const pid = quoteDoc.data().projectId;
            if (typeof pid === "string" && pid.trim()) quoteProjectIds.add(pid.trim());
          }
        }
      } catch (err) {
        console.warn("[listTeamWorkspaceProjects] quote scan failed", err);
      }

      await Promise.all(
        [...quoteProjectIds].map(async (projectId) => {
          if (merged.has(projectId)) return;
          const snap = await db.collection("projects").doc(projectId).get();
          if (!snap.exists) return;
          const data = snap.data() ?? {};
          merged.set(snap.id, serializeProject(snap.id, data));
          if (!projectLinkedOrgId(data)) linkCandidates.add(snap.id);
        })
      );
    }

    if (access.isManager && linkCandidates.size > 0) {
      const batch = db.batch();
      let writes = 0;
      for (const projectId of linkCandidates) {
        if (writes >= 20) break;
        const ref = db.collection("projects").doc(projectId);
        batch.set(
          ref,
          {
            orgId,
            workspaceId: orgId,
            workspaceType: "team",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        writes += 1;
      }
      if (writes > 0) {
        await batch.commit().catch((err) => {
          console.warn("[listTeamWorkspaceProjects] org link batch failed", err);
        });
      }
    }

    const projects = [...merged.values()].sort((a, b) => {
      const aTime = String(a.updatedAt ?? a.createdAt ?? "");
      const bTime = String(b.updatedAt ?? b.createdAt ?? "");
      return bTime.localeCompare(aTime);
    });

    let diagnostics: Record<string, unknown> | undefined;
    if (projects.length === 0) {
      const [allByOrg, allByWs, allByOwner] = await Promise.all([
        db.collection("projects").where("orgId", "==", orgId).limit(1).get(),
        db.collection("projects").where("workspaceId", "==", orgId).limit(1).get(),
        db.collection("projects").where("ownerId", "==", uid).limit(1).get(),
      ]);
      diagnostics = {
        uid,
        orgId,
        founderUid,
        role: access.role,
        isManager: access.isManager,
        countByOrgId: allByOrg.size,
        countByWorkspaceId: allByWs.size,
        countByOwnerId: allByOwner.size,
        quoteProjectIds: [...quoteProjectIds],
        projectRefs: refIds,
      };
      console.warn("[listTeamWorkspaceProjects] empty result diagnostics", diagnostics);
    }

    return { projects: projects.slice(0, 50), diagnostics };
  }
);
