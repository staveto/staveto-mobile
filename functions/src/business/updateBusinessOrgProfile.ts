import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

type ProfileInput = {
  orgId?: unknown;
  legalName?: unknown;
  billingEmail?: unknown;
  contactName?: unknown;
  phone?: unknown;
  countryCode?: unknown;
  billingAddress?: {
    line1?: unknown;
    street?: unknown;
    line2?: unknown;
    city?: unknown;
    zip?: unknown;
    postalCode?: unknown;
    country?: unknown;
  } | null;
  companyIdentifiers?: {
    registrationNumber?: unknown;
    taxId?: unknown;
    vatId?: unknown;
    vatNumber?: unknown;
  } | null;
  profile?: Record<string, unknown> | null;
};

function readString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function nullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = readString(raw);
  return value || null;
}

async function assertOrgOwnerOrAdmin(orgId: string, uid: string): Promise<void> {
  const snap = await admin.firestore().collection("organizations").doc(orgId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Organization not found.");
  }
  const ownerUid = snap.data()?.ownerUid;
  if (ownerUid === uid) return;

  const memberSnap = await admin
    .firestore()
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid)
    .get();
  const role = memberSnap.data()?.role;
  const status = memberSnap.data()?.status;
  const isAdmin =
    memberSnap.exists && status === "active" && (role === "owner" || role === "admin");
  if (!isAdmin) {
    throw new HttpsError(
      "permission-denied",
      "Only organization owner or admin can update company profile."
    );
  }
}

export const updateBusinessOrgProfile = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<{ ok: true }> => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const uid = request.auth.uid;
    const raw = (request.data ?? {}) as ProfileInput;
    const orgId = readString(raw.orgId);
    if (!orgId) {
      throw new HttpsError("invalid-argument", "orgId is required.");
    }

    await assertOrgOwnerOrAdmin(orgId, uid);

    const nested = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
    const legalNameInput = raw.legalName ?? nested.legalName;
    if (legalNameInput !== undefined && !readString(legalNameInput)) {
      throw new HttpsError("invalid-argument", "legalName cannot be empty.");
    }

    const legalName = nullableString(legalNameInput ?? nested.legalName);
    const billingEmailRaw = raw.billingEmail ?? nested.email;
    const billingEmail =
      billingEmailRaw === undefined
        ? undefined
        : nullableString(billingEmailRaw)?.toLowerCase() ?? null;
    const contactName =
      raw.contactName === undefined ? undefined : nullableString(raw.contactName);
    const phone = raw.phone === undefined ? undefined : nullableString(raw.phone ?? nested.phone);
    const countryCodeRaw = raw.countryCode ?? nested.country ?? nested.countryCode;
    const countryCode =
      countryCodeRaw === undefined ? undefined : nullableString(countryCodeRaw)?.toUpperCase() ?? null;

    const billingRaw = raw.billingAddress ?? {};
    const line1Raw = billingRaw.line1 ?? billingRaw.street ?? nested.addressText;
    const zipRaw = billingRaw.zip ?? billingRaw.postalCode ?? nested.zip;
    const cityRaw = billingRaw.city ?? nested.city;
    const line1 = line1Raw === undefined ? undefined : nullableString(line1Raw);
    const line2 =
      billingRaw.line2 === undefined ? undefined : nullableString(billingRaw.line2);
    const city = cityRaw === undefined ? undefined : nullableString(cityRaw);
    const zip = zipRaw === undefined ? undefined : nullableString(zipRaw);

    const idsRaw = raw.companyIdentifiers ?? {};
    const registrationNumber =
      idsRaw.registrationNumber === undefined && nested.registrationNumber === undefined
        ? undefined
        : nullableString(idsRaw.registrationNumber ?? nested.registrationNumber);
    const taxId =
      idsRaw.taxId === undefined && nested.taxId === undefined
        ? undefined
        : nullableString(idsRaw.taxId ?? nested.taxId);
    const vatRaw = idsRaw.vatId ?? idsRaw.vatNumber ?? nested.vatId ?? nested.vatNumber;
    const vatId = vatRaw === undefined ? undefined : nullableString(vatRaw);

    const orgPatch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (legalName !== undefined) {
      orgPatch.legalName = legalName;
      orgPatch.name = legalName;
    }
    if (billingEmail !== undefined) orgPatch.billingEmail = billingEmail;
    if (contactName !== undefined) orgPatch.contactName = contactName;
    if (phone !== undefined) orgPatch.phone = phone;
    if (countryCode !== undefined) {
      orgPatch.countryCode = countryCode;
      orgPatch.country = countryCode;
    }

    if (
      line1 !== undefined ||
      line2 !== undefined ||
      city !== undefined ||
      zip !== undefined
    ) {
      orgPatch.billingAddress = {
        ...(line1 !== undefined ? { line1: line1 ?? "" } : {}),
        ...(line2 !== undefined ? { line2: line2 ?? "" } : {}),
        ...(city !== undefined ? { city: city ?? "" } : {}),
        ...(zip !== undefined ? { zip: zip ?? "" } : {}),
      };
    }

    if (registrationNumber !== undefined || taxId !== undefined || vatId !== undefined) {
      orgPatch.companyIdentifiers = {
        ...(registrationNumber !== undefined
          ? { registrationNumber: registrationNumber ?? "" }
          : {}),
        ...(taxId !== undefined ? { taxId: taxId ?? "" } : {}),
        ...(vatId !== undefined ? { vatId: vatId ?? "" } : {}),
      };
    }

    const profilePatch: Record<string, string | null> = {};
    if (legalName !== undefined) profilePatch.legalName = legalName;
    if (billingEmail !== undefined) {
      profilePatch.email = billingEmail;
      profilePatch.contactEmail = billingEmail;
    }
    if (line1 !== undefined) profilePatch.addressText = line1;
    if (city !== undefined) profilePatch.city = city;
    if (zip !== undefined) profilePatch.zip = zip;
    if (countryCode !== undefined) {
      profilePatch.country = countryCode;
      profilePatch.countryCode = countryCode;
    }
    if (registrationNumber !== undefined) profilePatch.registrationNumber = registrationNumber;
    if (taxId !== undefined) profilePatch.taxId = taxId;
    if (vatId !== undefined) profilePatch.vatId = vatId;
    if (phone !== undefined) profilePatch.phone = phone;
    if (contactName !== undefined) profilePatch.contactName = contactName;
    if (nested.websiteUrl !== undefined) profilePatch.websiteUrl = nullableString(nested.websiteUrl);
    if (nested.bankAccount !== undefined) profilePatch.bankAccount = nullableString(nested.bankAccount);
    if (nested.logoUrl !== undefined) profilePatch.logoUrl = nullableString(nested.logoUrl);
    if (nested.logoStoragePath !== undefined) {
      profilePatch.logoStoragePath = nullableString(nested.logoStoragePath);
    }

    if (Object.keys(profilePatch).length > 0) {
      orgPatch.profile = profilePatch;
    }

    await admin.firestore().collection("organizations").doc(orgId).set(orgPatch, { merge: true });
    return { ok: true };
  }
);
