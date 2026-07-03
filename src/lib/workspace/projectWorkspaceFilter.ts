import type { ProjectDoc } from "../../services/projects";
import { isBusinessTeamProject } from "../../services/projects";
import { SOLO_WORKSPACE_ID } from "./workspaceContract";

export function filterProjectsForSoloWorkspace(
  projects: ProjectDoc[],
  ownerUid: string
): ProjectDoc[] {
  return projects.filter(
    (project) => !isBusinessTeamProject(project) && project.ownerId === ownerUid
  );
}

export function filterProjectsForCompanyWorkspace(
  projects: ProjectDoc[],
  orgId: string
): ProjectDoc[] {
  const normalizedOrgId = orgId.trim();
  return projects.filter(
    (project) =>
      isBusinessTeamProject(project) &&
      (project.orgId?.trim() === normalizedOrgId ||
        project.workspaceId?.trim() === normalizedOrgId)
  );
}

export function resolveActiveWorkspaceMode(input: {
  lastActiveWorkspaceId?: string | null;
  activeBusinessOrgId?: string | null;
  hasCompanyMembership: boolean;
}): { kind: "solo" | "company"; workspaceId: string; orgId: string | null } {
  const lastActive = input.lastActiveWorkspaceId?.trim() || "";
  if (lastActive === SOLO_WORKSPACE_ID) {
    return { kind: "solo", workspaceId: SOLO_WORKSPACE_ID, orgId: null };
  }
  if (lastActive && lastActive !== SOLO_WORKSPACE_ID) {
    return { kind: "company", workspaceId: lastActive, orgId: lastActive };
  }
  const orgId = input.activeBusinessOrgId?.trim() || "";
  if (orgId) {
    return { kind: "company", workspaceId: orgId, orgId };
  }
  if (input.hasCompanyMembership) {
    return { kind: "solo", workspaceId: SOLO_WORKSPACE_ID, orgId: null };
  }
  return { kind: "solo", workspaceId: SOLO_WORKSPACE_ID, orgId: null };
}
