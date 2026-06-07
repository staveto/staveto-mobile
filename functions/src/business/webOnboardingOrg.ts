import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { LEGACY_PLAN, seatsForPlan } from "./orgPlanConfig";

const db = admin.firestore();

type WebOnboardingInput = {
  companyName: string;
  country: string;
  timezone?: string;
  companyType: string;
  planCode: "business_starter" | "business_team" | "business_company" | "business_enterprise";
  billingPeriod: "monthly" | "yearly";
  teamSizeBand?: string;
  contactName?: string;
};

const DUPLICATE_STATUSES = ["pending", "pending_payment", "trialing", "active"];

function toTrimmedString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function parseWebOnboardingInput(data: unknown): WebOnboardingInput {
  const raw = (data ?? {}) as Record<string, unknown>;
  const companyName = toTrimmedString(raw.companyName);
  const country = toTrimmedString(raw.country || raw.countryCode);
  const companyType = toTrimmedString(raw.companyType);
  const planCode = toTrimmedString(raw.planCode).toLowerCase();
  const billingPeriod = toTrimmedString(raw.billingPeriod).toLowerCase();

  if (!companyName) throw new HttpsError("invalid-argument", "companyName is required.");
  if (!country) throw new HttpsError("invalid-argument", "country is required.");
  if (!companyType) throw new HttpsError("invalid-argument", "companyType is required.");
  if (
    planCode !== "business_starter" &&
    planCode !== "business_team" &&
    planCode !== "business_company" &&
    planCode !== "business_enterprise"
  ) {
    throw new HttpsError("invalid-argument", "planCode is invalid.");
  }
  if (billingPeriod !== "monthly" && billingPeriod !== "yearly") {
    throw new HttpsError("invalid-argument", "billingPeriod must be monthly or yearly.");
  }

  return {
    companyName,
    country,
    timezone: toTrimmedString(raw.timezone) || undefined,
    companyType,
    planCode,
    billingPeriod,
    teamSizeBand: toTrimmedString(raw.teamSizeBand) || undefined,
    contactName: toTrimmedString(raw.contactName) || undefined,
  };
}

type EnabledModulesDoc = Record<string, boolean>;

function buildEnabledModulesForCompanyType(companyType: string): EnabledModulesDoc {
  const modules: EnabledModulesDoc = {
    jobs: true,
    quotes: true,
    team: true,
    documents: true,
    billing: true,
    planning: false,
    vehicles: false,
    equipment: false,
    expenses: false,
    reports: false,
    issues: false,
  };

  const type = companyType.trim().toLowerCase();
  const enable = (...keys: string[]) => {
    for (const key of keys) modules[key] = true;
  };

  switch (type) {
    case "hvac":
      enable("equipment", "vehicles");
      break;
    case "construction":
      enable("planning", "vehicles");
      break;
    case "electrical":
    case "plumbing":
      enable("equipment");
      if (type === "plumbing") enable("vehicles");
      break;
    case "roofing":
      enable("equipment", "vehicles");
      break;
    default:
      break;
  }

  return modules;
}

async function assertNoDuplicateOwnerOrg(
  tx: FirebaseFirestore.Transaction,
  actorUid: string
): Promise<void> {
  const ownerOrgQuery = db
    .collection("organizations")
    .where("ownerUid", "==", actorUid)
    .limit(10);
  const ownedOrgSnap = await tx.get(ownerOrgQuery);
  const hasActiveOrg = ownedOrgSnap.docs.some((doc) => {
    const status = doc.data().status as string | undefined;
    return !status || DUPLICATE_STATUSES.includes(status);
  });
  if (hasActiveOrg) {
    throw new HttpsError(
      "failed-precondition",
      "You already have a business organization with active or pending status."
    );
  }
}

export type WebOnboardingOrgResult = {
  orgId: string;
  planCode: string;
  status: string;
  trialEndsAt: string;
};

export function isWebOnboardingPayload(raw: Record<string, unknown>): boolean {
  if (raw.source === "web_onboarding") return true;
  const hasCompanyType =
    typeof raw.companyType === "string" && raw.companyType.trim().length > 0;
  const hasCountry =
    (typeof raw.country === "string" && raw.country.trim().length > 0) ||
    (typeof raw.countryCode === "string" && raw.countryCode.trim().length > 0);
  const billingEmail =
    typeof raw.billingEmail === "string" ? raw.billingEmail.trim() : "";
  const billingLine1 =
    raw.billingAddress &&
    typeof raw.billingAddress === "object" &&
    typeof (raw.billingAddress as { line1?: unknown }).line1 === "string"
      ? String((raw.billingAddress as { line1: string }).line1).trim()
      : "";
  return hasCompanyType && hasCountry && !billingEmail && !billingLine1;
}

export async function handleWebOnboardingCreateOrg(
  uid: string,
  actorEmail: string | null | undefined,
  data: unknown
): Promise<WebOnboardingOrgResult> {
  const input = parseWebOnboardingInput(data);

  if (input.planCode === "business_enterprise") {
    throw new HttpsError(
      "failed-precondition",
      "Enterprise plans require contact with sales."
    );
  }

  const now = Timestamp.now();
  const trialEnds = Timestamp.fromMillis(now.toMillis() + 14 * 24 * 60 * 60 * 1000);
  const seatsLimit = seatsForPlan(input.planCode);
  const timezone = input.timezone?.trim() || "Europe/Bratislava";
  const countryCode = input.country.trim().toUpperCase();
  const companyName = input.companyName.trim();
  const billingEmail = (actorEmail ?? "").trim().toLowerCase() || null;
  const contactName = input.contactName?.trim() || null;

  const orgRef = db.collection("organizations").doc();
  const memberRef = orgRef.collection("members").doc(uid);
  const orgId = orgRef.id;

  await db.runTransaction(async (tx) => {
    await assertNoDuplicateOwnerOrg(tx, uid);

    tx.set(orgRef, {
      name: companyName,
      legalName: companyName,
      ownerUid: uid,
      billingOwnerUid: uid,
      createdByUid: uid,
      seatLimit: seatsLimit,
      seatsLimit,
      requestedSeats: seatsLimit,
      seatsUsed: 1,
      plan: LEGACY_PLAN[input.planCode] ?? "TEAM_5",
      planCode: input.planCode,
      billingPeriod: input.billingPeriod,
      selectedPlan: input.planCode,
      status: "trialing",
      billingStatus: "pending_payment",
      businessEnabled: true,
      companyType: input.companyType,
      enabledModules: buildEnabledModulesForCompanyType(input.companyType),
      countryCode,
      country: countryCode,
      timezone,
      teamSizeBand: input.teamSizeBand ?? null,
      trialStartedAt: now,
      trialEndsAt: trialEnds,
      billingEmail,
      billingAddress: {},
      companyIdentifiers: {},
      contactName,
      phone: null,
      source: "web_onboarding",
      onboardingSource: "web",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      profile: {
        legalName: companyName,
        country: countryCode,
        countryCode,
        email: billingEmail,
        contactEmail: billingEmail,
      },
    });

    tx.set(memberRef, {
      role: "owner",
      userId: uid,
      email: actorEmail ?? null,
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    orgId,
    planCode: input.planCode,
    status: "trialing",
    trialEndsAt: trialEnds.toDate().toISOString(),
  };
}
