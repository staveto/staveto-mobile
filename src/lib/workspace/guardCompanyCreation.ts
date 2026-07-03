/**
 * Load user organizations and run duplicate company identity guard (mobile).
 */
import { collection, limit, query } from "../../lib/rnFirestore";
import { getDocsSmart } from "../../services/firestoreSmartRead";
import { db } from "../../firebase";
import { paths } from "../firestorePaths";
import {
  evaluateCompanyCreationGuard,
  type CompanyCreationGuardResult,
  type CompanyIdentityCandidate,
} from "./companyIdentityGuard";
import {
  getOrganization,
  listMyMemberships,
  readUserActiveBusinessOrgIdHint,
  readUserLastActiveWorkspaceId,
} from "../../services/organizations";
import { listBusinessOrgProjects } from "../../services/projects";
import { SOLO_WORKSPACE_ID } from "./workspaceContract";

function formatTimestamp(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "toDate" in raw) {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

async function loadOrgMembersCount(orgId: string): Promise<number | null> {
  try {
    const snap = await getDocsSmart(
      query(collection(db, paths.organizationMembers(orgId)), limit(50))
    );
    return snap.size;
  } catch {
    return null;
  }
}

async function loadOrgProjectsCount(orgId: string): Promise<number> {
  try {
    return (await listBusinessOrgProjects(orgId)).length;
  } catch {
    return 0;
  }
}

export async function guardCompanyCreation(
  userId: string,
  input: { companyName: string; legalName?: string | null }
): Promise<CompanyCreationGuardResult> {
  const [memberships, lastActiveWorkspaceId, activeBusinessOrgId] = await Promise.all([
    listMyMemberships(userId),
    readUserLastActiveWorkspaceId(userId),
    readUserActiveBusinessOrgIdHint(userId),
  ]);
  const lastActive =
    lastActiveWorkspaceId?.trim() && lastActiveWorkspaceId.trim() !== SOLO_WORKSPACE_ID
      ? lastActiveWorkspaceId.trim()
      : null;
  const activeBusiness = activeBusinessOrgId?.trim() || null;

  const unique = new Map<string, CompanyIdentityCandidate>();

  for (const membership of memberships) {
    if (unique.has(membership.orgId)) continue;
    const org = await getOrganization(membership.orgId);
    if (!org) continue;
    const orgRecord = org as {
      legalName?: string;
      source?: string;
      profile?: { legalName?: string };
      createdAt?: unknown;
      updatedAt?: unknown;
    };
    const legalName =
      orgRecord.legalName?.trim() ||
      orgRecord.profile?.legalName?.trim() ||
      null;
    const [projectsCount, membersCount] = await Promise.all([
      loadOrgProjectsCount(org.id),
      loadOrgMembersCount(org.id),
    ]);
    unique.set(membership.orgId, {
      orgId: org.id,
      name: legalName || org.name?.trim() || membership.orgId,
      legalName,
      ownerUid: org.ownerUid ?? null,
      projectsCount,
      membersCount,
      profileFieldCount: legalName ? 1 : 0,
      source: orgRecord.source ?? null,
      createdAt: formatTimestamp(orgRecord.createdAt ?? orgRecord.updatedAt),
      isOwner: org.ownerUid === userId,
      isMember: membership.status === "active",
      matchesLastActiveWorkspace: lastActive === org.id,
      matchesActiveBusinessOrg: activeBusiness === org.id,
    });
  }

  return evaluateCompanyCreationGuard(input.companyName, [...unique.values()], {
    userId,
    legalName: input.legalName ?? input.companyName,
  });
}

export type { CompanyCreationGuardResult };
