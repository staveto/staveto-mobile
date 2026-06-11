import { getOrganization } from "./organizations";
import { listMembers } from "./businessMembers";
import type { OrgRole } from "./organizations";

export type ChatTeamMember = {
  uid: string;
  displayName: string;
  email?: string;
  roleLabelKey: string;
  status: string;
};

function getRoleLabelKey(role: OrgRole | string): string {
  const r = String(role ?? "viewer").toLowerCase();
  if (r === "member") return "business.dashboard.teamLicenses.role.member";
  if (r === "owner" || r === "admin" || r === "manager" || r === "worker" || r === "viewer") {
    return `business.dashboard.teamLicenses.role.${r}`;
  }
  return "business.dashboard.teamLicenses.role.viewer";
}

function memberDisplayName(input: {
  displayName?: string;
  name?: string;
  email?: string;
  userId: string;
}): string {
  return (
    input.displayName?.trim() ||
    input.name?.trim() ||
    input.email?.trim() ||
    input.userId.trim() ||
    "User"
  );
}

function isActiveMember(status: string | undefined): boolean {
  return status === "active";
}

export async function listChatTeamMembers(
  orgId: string,
  excludeUid?: string
): Promise<ChatTeamMember[]> {
  const org = await getOrganization(orgId);
  if (!org) return [];

  const members = await listMembers(orgId);
  const ownerUid = org.ownerUid?.trim() ?? "";

  return members
    .filter((m) => {
      const memberUid = m.userId?.trim() || m.id.trim();
      if (!memberUid) return false;
      if (excludeUid && memberUid === excludeUid) return false;
      if (!isActiveMember(m.status)) return false;
      return true;
    })
    .map((m) => {
      const uid = m.userId?.trim() || m.id.trim();
      const effectiveRole = ownerUid && uid === ownerUid ? "owner" : m.role;
      return {
        uid,
        displayName: memberDisplayName(m),
        email: m.email,
        roleLabelKey: getRoleLabelKey(effectiveRole),
        status: m.status ?? "active",
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

export function filterChatTeamMembers(members: ChatTeamMember[], query: string): ChatTeamMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  return members.filter((m) => {
    const haystack = [m.displayName, m.email ?? "", m.uid].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}
