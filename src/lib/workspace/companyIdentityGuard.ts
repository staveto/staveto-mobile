/**
 * Phase 1.4 — client-side guard against duplicate company organization creation.
 * Read-only on existing orgs; does not merge/delete/modify organization documents.
 */
import { normalizeCompanyIdentityName } from "./workspaceContract";

export type CompanyIdentityCandidate = {
  orgId: string;
  name: string;
  legalName?: string | null;
  ownerUid?: string | null;
  projectsCount?: number;
  membersCount?: number | null;
  profileFieldCount?: number;
  source?: string | null;
  createdAt?: string | null;
  isOwner?: boolean;
  isMember?: boolean;
  matchesLastActiveWorkspace?: boolean;
  matchesActiveBusinessOrg?: boolean;
};

export type CompanyCreationGuardResult =
  | { action: "create_allowed" }
  | {
      action: "use_existing";
      orgId: string;
      displayName: string;
      reason: string;
      matchedOrgIds: string[];
      likelySource?: string | null;
    }
  | {
      action: "manual_review_required";
      canonicalOrgId: string;
      matchedOrgIds: string[];
      reason: string;
    };

const LEGACY_SOURCES = new Set(["web", "legacy", "createOrganization"]);

function appearsLegacyOrg(source: string | null | undefined): boolean {
  if (!source) return true;
  return LEGACY_SOURCES.has(source.toLowerCase());
}

function appearsEmptyOrg(input: {
  projectsCount: number;
  membersCount: number | null;
  profileFieldCount: number;
}): boolean {
  return (
    input.projectsCount === 0 &&
    (input.membersCount ?? 0) <= 1 &&
    input.profileFieldCount <= 1
  );
}

function hasImportantOrgData(input: {
  projectsCount: number;
  membersCount: number | null;
  profileFieldCount: number;
}): boolean {
  return input.projectsCount > 0 || (input.membersCount ?? 0) > 1 || input.profileFieldCount >= 3;
}

/** Mirrors web scoreOrgForCanonical for creation guard parity. */
export function scoreCandidateForCanonical(candidate: CompanyIdentityCandidate): number {
  let score = 0;
  score += (candidate.projectsCount ?? 0) * 100;
  score += (candidate.membersCount ?? 0) * 10;
  score += (candidate.profileFieldCount ?? 0) * 5;
  if (candidate.matchesLastActiveWorkspace) score += 80;
  if (candidate.matchesActiveBusinessOrg) score += 60;
  if (candidate.isOwner) score += 20;
  if (candidate.source?.includes("business") || candidate.source === "onboarding") score += 15;
  if (appearsLegacyOrg(candidate.source)) score -= 10;
  if (
    appearsEmptyOrg({
      projectsCount: candidate.projectsCount ?? 0,
      membersCount: candidate.membersCount ?? null,
      profileFieldCount: candidate.profileFieldCount ?? 0,
    })
  ) {
    score -= 25;
  }
  if (candidate.createdAt) {
    const ageMs = Date.now() - Date.parse(candidate.createdAt);
    if (!Number.isNaN(ageMs) && ageMs > 0) {
      score += Math.min(10, Math.floor(ageMs / (1000 * 60 * 60 * 24 * 30)));
    }
  }
  return score;
}

export function findMatchingCompanyCandidates(
  companyName: string,
  candidates: CompanyIdentityCandidate[],
  options?: { legalName?: string | null }
): CompanyIdentityCandidate[] {
  const searchKeys = new Set<string>();
  const primary = normalizeCompanyIdentityName(companyName);
  if (primary) searchKeys.add(primary);
  const legal = normalizeCompanyIdentityName(options?.legalName);
  if (legal) searchKeys.add(legal);
  if (searchKeys.size === 0) return [];

  return candidates.filter((candidate) => {
    const candidateKeys = [candidate.legalName, candidate.name]
      .map(normalizeCompanyIdentityName)
      .filter(Boolean);
    return candidateKeys.some((key) => searchKeys.has(key));
  });
}

export function evaluateCompanyCreationGuard(
  companyName: string,
  candidates: CompanyIdentityCandidate[],
  options?: { userId?: string; legalName?: string | null }
): CompanyCreationGuardResult {
  void options?.userId;
  const matches = findMatchingCompanyCandidates(companyName, candidates, options);
  if (matches.length === 0) {
    return { action: "create_allowed" };
  }

  const scored = matches
    .map((row) => ({ ...row, score: scoreCandidateForCanonical(row) }))
    .sort((a, b) => b.score - a.score);
  const canonical = scored[0];
  const matchedOrgIds = matches.map((row) => row.orgId);
  const displayName = canonical.legalName?.trim() || canonical.name.trim();

  const dataRichMatches = matches.filter((row) =>
    hasImportantOrgData({
      projectsCount: row.projectsCount ?? 0,
      membersCount: row.membersCount ?? null,
      profileFieldCount: row.profileFieldCount ?? 0,
    })
  );
  if (dataRichMatches.length >= 2) {
    const topScore = scored[0].score;
    const tied = scored.filter((row) => row.score >= topScore - 1).length;
    if (tied > 1) {
      return {
        action: "manual_review_required",
        canonicalOrgId: canonical.orgId,
        matchedOrgIds,
        reason:
          "Multiple organizations with the same company identity contain data. Review in diagnostics — no automatic merge or deletion.",
      };
    }
  }

  return {
    action: "use_existing",
    orgId: canonical.orgId,
    displayName,
    reason:
      matchedOrgIds.length === 1
        ? "A company with the same legal identity already exists for this account."
        : "Existing company with the same legal identity found — using canonical organization instead of creating a duplicate.",
    matchedOrgIds,
    likelySource: canonical.source ?? null,
  };
}
