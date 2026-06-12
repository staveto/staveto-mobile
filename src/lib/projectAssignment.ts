function parseAssignedMemberIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim() !== "");
}

/** Web may persist legacy `assignedUserIds`; mobile rules + access treat both as crew assign. */
export function getAssignedMemberIdsFromProject(projectData: Record<string, unknown>): string[] {
  const fromMember = parseAssignedMemberIds(projectData.assignedMemberIds);
  const fromUser = parseAssignedMemberIds(projectData.assignedUserIds);
  return [...new Set([...fromMember, ...fromUser])];
}

export function isUserAssignedOnProject(projectData: Record<string, unknown>, uid: string): boolean {
  if (!uid.trim()) return false;
  return getAssignedMemberIdsFromProject(projectData).includes(uid);
}
