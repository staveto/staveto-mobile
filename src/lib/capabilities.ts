export type PlanType = "free" | "personal_pro" | "business";

export type WorkspaceType = "personal" | "business" | "legacy";

export type CapabilityKey =
  | "canUsePersonalProFeatures"
  | "canCreateMorePersonalProjects"
  | "canUseTeamFeatures"
  | "canInviteMembers"
  | "canUseProjectMembers"
  | "canUseProjectChat"
  | "canUseBusinessProjects"
  | "canUseAttendance"
  | "canUseBusinessReports"
  | "canManageEmployees"
  | "canUseQrInvite"
  | "canUseExpenses"
  | "canUseProblems"
  | "canUseExports"
  | "canUseOcr";

export type CapabilityInput = {
  planType?: PlanType | null;
  userSubscriptionTier?: string | null;
  userSubscriptionStatus?: string | null;
  billingStatus?: string | null;
  billingIsPro?: boolean | null;
  hasPersonalProEntitlement?: boolean | null;
  projectWorkspaceType?: string | null;
  projectOrgId?: string | null;
  activeBusinessOrgId?: string | null;
  organizationStatus?: string | null;
  organizationBusinessEnabled?: boolean | null;
  membershipRole?: string | null;
  membershipStatus?: string | null;
  projectCount?: number | null;
  freeProjectLimit?: number | null;
  legacyProject?: boolean | null;
};

export type CapabilityValues = Record<CapabilityKey, boolean>;

export type CapabilityResult = {
  planType: PlanType;
  workspaceType: WorkspaceType;
  isBusinessContextActive: boolean;
  capabilities: CapabilityValues;
};

const SUBSCRIPTION_TIER_PERSONAL_PRO = new Set([
  "pro",
  "basic",
  "enterprise",
  "personal_pro",
]);

const SUBSCRIPTION_STATUS_ENTITLED = new Set([
  "active",
  "trial",
  "trialing",
]);

const ALL_FALSE_CAPABILITIES: CapabilityValues = {
  canUsePersonalProFeatures: false,
  canCreateMorePersonalProjects: false,
  canUseTeamFeatures: false,
  canInviteMembers: false,
  canUseProjectMembers: false,
  canUseProjectChat: false,
  canUseBusinessProjects: false,
  canUseAttendance: false,
  canUseBusinessReports: false,
  canManageEmployees: false,
  canUseQrInvite: false,
  canUseExpenses: false,
  canUseProblems: false,
  canUseExports: false,
  canUseOcr: false,
};

function normalize(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toWorkspaceType(input: CapabilityInput): WorkspaceType {
  const raw = normalize(input.projectWorkspaceType);
  if (raw === "business" || raw === "team") return "business";
  if (raw === "personal") return "personal";
  if (raw === "legacy") return "legacy";
  if (normalize(input.projectOrgId)) return "business";
  if (input.legacyProject === true) return "legacy";
  // Safe default for existing projects until explicit workspaceType migration lands.
  return "legacy";
}

function isBusinessContextActive(input: CapabilityInput): boolean {
  const activeBusinessOrgId = normalize(input.activeBusinessOrgId);
  const organizationStatus = normalize(input.organizationStatus);
  const membershipStatus = normalize(input.membershipStatus);
  const businessEnabled = input.organizationBusinessEnabled === true;
  return (
    !!activeBusinessOrgId &&
    organizationStatus === "active" &&
    businessEnabled &&
    membershipStatus === "active"
  );
}

function inferPlanType(input: CapabilityInput, businessActive: boolean): PlanType {
  if (input.planType) return input.planType;
  if (businessActive) return "business";

  const tier = normalize(input.userSubscriptionTier);
  const subscriptionStatus = normalize(input.userSubscriptionStatus);
  const billingStatus = normalize(input.billingStatus);
  const hasPaidTier = SUBSCRIPTION_TIER_PERSONAL_PRO.has(tier);
  const hasEntitledStatus =
    SUBSCRIPTION_STATUS_ENTITLED.has(subscriptionStatus) ||
    SUBSCRIPTION_STATUS_ENTITLED.has(billingStatus);
  const hasPersonalEntitlement =
    input.hasPersonalProEntitlement === true ||
    input.billingIsPro === true ||
    (hasPaidTier && hasEntitledStatus);

  return hasPersonalEntitlement ? "personal_pro" : "free";
}

function canCreateMorePersonalProjects(input: CapabilityInput, planType: PlanType): boolean {
  if (planType === "personal_pro" || planType === "business") return true;
  const projectCount = typeof input.projectCount === "number" ? input.projectCount : null;
  const freeLimit =
    typeof input.freeProjectLimit === "number" && input.freeProjectLimit >= 0
      ? input.freeProjectLimit
      : 1;
  // Unknown count should not silently lock existing users.
  if (projectCount == null) return true;
  return projectCount < freeLimit;
}

function teamCapabilitiesForWorkspace(
  workspaceType: WorkspaceType,
  businessActive: boolean
): {
  canUseTeamFeatures: boolean;
  canInviteMembers: boolean;
  canUseProjectMembers: boolean;
  canUseProjectChat: boolean;
  canUseBusinessProjects: boolean;
  canUseAttendance: boolean;
  canUseBusinessReports: boolean;
  canManageEmployees: boolean;
  canUseQrInvite: boolean;
} {
  if (workspaceType === "business") {
    return {
      canUseTeamFeatures: businessActive,
      canInviteMembers: businessActive,
      canUseProjectMembers: businessActive,
      canUseProjectChat: businessActive,
      canUseBusinessProjects: businessActive,
      canUseAttendance: businessActive,
      canUseBusinessReports: businessActive,
      canManageEmployees: businessActive,
      canUseQrInvite: businessActive,
    };
  }

  if (workspaceType === "legacy") {
    // Transitional compatibility: current legacy shared projects must keep behaving.
    return {
      canUseTeamFeatures: true,
      canInviteMembers: true,
      canUseProjectMembers: true,
      canUseProjectChat: false,
      canUseBusinessProjects: false,
      canUseAttendance: true,
      canUseBusinessReports: false,
      canManageEmployees: false,
      canUseQrInvite: false,
    };
  }

  return {
    canUseTeamFeatures: false,
    canInviteMembers: false,
    canUseProjectMembers: false,
    canUseProjectChat: false,
    canUseBusinessProjects: false,
    canUseAttendance: false,
    canUseBusinessReports: false,
    canManageEmployees: false,
    canUseQrInvite: false,
  };
}

export function evaluateCapabilities(input: CapabilityInput): CapabilityResult {
  const workspaceType = toWorkspaceType(input);
  const businessContextActive = isBusinessContextActive(input);
  const planType = inferPlanType(input, businessContextActive);
  const teamCaps = teamCapabilitiesForWorkspace(workspaceType, businessContextActive);

  const capabilities: CapabilityValues = {
    ...ALL_FALSE_CAPABILITIES,
    canUsePersonalProFeatures: planType === "personal_pro" || planType === "business",
    canCreateMorePersonalProjects: canCreateMorePersonalProjects(input, planType),
    canUseExpenses: true,
    canUseProblems: true,
    canUseExports: true,
    canUseOcr: true,
    ...teamCaps,
  };

  return {
    planType,
    workspaceType,
    isBusinessContextActive: businessContextActive,
    capabilities,
  };
}

export function hasCapability(
  result: CapabilityResult,
  key: CapabilityKey
): boolean {
  return result.capabilities[key] === true;
}
