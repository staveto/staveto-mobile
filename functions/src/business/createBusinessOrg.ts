import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  handleWebOnboardingCreateOrg,
  isWebOnboardingPayload,
} from "./webOnboardingOrg";

type CreateBusinessOrgInput = {
  companyName?: unknown;
  legalName?: unknown;
  countryCode?: unknown;
  billingEmail?: unknown;
  requestedSeats?: unknown;
  billingAddress?: {
    line1?: unknown;
    line2?: unknown;
    city?: unknown;
    zip?: unknown;
  } | null;
  companyIdentifiers?: {
    registrationNumber?: unknown;
    taxId?: unknown;
    vatId?: unknown;
  } | null;
  contactName?: unknown;
  phone?: unknown;
};

type CreateBusinessOrgResult = {
  ok: true;
  orgId: string;
  orderId: string;
  orderNumber: string;
  variableSymbol: string;
  paymentReference: string;
  status: "pending_payment";
};

type NormalizedCreateInput = {
  companyName: string;
  legalName: string;
  countryCode: string;
  billingEmail: string;
  requestedSeats: number;
  billingAddress: {
    line1: string;
    line2: string | null;
    city: string;
    zip: string;
  };
  companyIdentifiers: {
    registrationNumber: string | null;
    taxId: string | null;
    vatId: string | null;
  };
  contactName: string | null;
  phone: string | null;
};

function toTrimmedString(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeCountryCode(raw: unknown): string {
  return toTrimmedString(raw).toUpperCase();
}

function normalizeEmail(raw: unknown): string {
  return toTrimmedString(raw).toLowerCase();
}

function normalizeRegistrationNumber(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  if (!value) return null;
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return normalized || null;
}

function normalizeOptionalId(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  return value || null;
}

function normalizeOptionalText(raw: unknown): string | null {
  const value = toTrimmedString(raw);
  return value || null;
}

function normalizeRequestedSeats(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
    throw new HttpsError("invalid-argument", "requestedSeats must be an integer >= 1.");
  }
  return raw;
}

function requireAuth(
  request: { auth?: { uid?: string; token?: Record<string, unknown> } | null }
): { uid: string; email: string | null } {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return {
    uid: request.auth.uid,
    email: typeof request.auth.token?.email === "string" ? request.auth.token.email : null,
  };
}

function normalizeInput(raw: CreateBusinessOrgInput): NormalizedCreateInput {
  const companyName = toTrimmedString(raw.companyName);
  const legalName = toTrimmedString(raw.legalName);
  const countryCode = normalizeCountryCode(raw.countryCode);
  const billingEmail = normalizeEmail(raw.billingEmail);
  const requestedSeats = normalizeRequestedSeats(raw.requestedSeats);

  const billingAddressRaw = raw.billingAddress ?? {};
  const line1 = toTrimmedString(billingAddressRaw.line1);
  const city = toTrimmedString(billingAddressRaw.city);
  const zip = toTrimmedString(billingAddressRaw.zip);
  const line2 = normalizeOptionalText(billingAddressRaw.line2);

  const idsRaw = raw.companyIdentifiers ?? {};
  const registrationNumber = normalizeRegistrationNumber(idsRaw.registrationNumber);
  const taxId = normalizeOptionalId(idsRaw.taxId);
  const vatId = normalizeOptionalId(idsRaw.vatId);
  const contactName = normalizeOptionalText(raw.contactName);
  const phone = normalizeOptionalText(raw.phone);

  if (!companyName) throw new HttpsError("invalid-argument", "companyName is required.");
  if (!legalName) throw new HttpsError("invalid-argument", "legalName is required.");
  if (!countryCode) throw new HttpsError("invalid-argument", "countryCode is required.");
  if (!billingEmail) throw new HttpsError("invalid-argument", "billingEmail is required.");
  if (!line1 || !city || !zip) {
    throw new HttpsError("invalid-argument", "billingAddress.line1, city and zip are required.");
  }

  if ((countryCode === "SK" || countryCode === "CZ") && !registrationNumber) {
    throw new HttpsError("invalid-argument", "registrationNumber is required for SK/CZ.");
  }

  return {
    companyName,
    legalName,
    countryCode,
    billingEmail,
    requestedSeats,
    billingAddress: {
      line1,
      line2,
      city,
      zip,
    },
    companyIdentifiers: {
      registrationNumber,
      taxId,
      vatId,
    },
    contactName,
    phone,
  };
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(6, "0");
}

function getYearString(): string {
  return String(new Date().getUTCFullYear());
}

async function assertNoDuplicateBusinessIdentity(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: NormalizedCreateInput
): Promise<void> {
  const duplicateStatuses = ["pending", "pending_payment", "active"];

  if (input.companyIdentifiers.registrationNumber) {
    const orgQuery = db
      .collection("organizations")
      .where("countryCode", "==", input.countryCode)
      .where("companyIdentifiers.registrationNumber", "==", input.companyIdentifiers.registrationNumber)
      .where("status", "in", duplicateStatuses)
      .limit(1);
    const orderQuery = db
      .collection("businessOrders")
      .where("countryCode", "==", input.countryCode)
      .where("companyIdentifiers.registrationNumber", "==", input.companyIdentifiers.registrationNumber)
      .where("status", "in", duplicateStatuses)
      .limit(1);

    const [orgSnap, orderSnap] = await Promise.all([tx.get(orgQuery), tx.get(orderQuery)]);
    if (!orgSnap.empty || !orderSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "A business organization or order with the same registration number already exists."
      );
    }
    return;
  }

  const orgFallbackQuery = db
    .collection("organizations")
    .where("billingEmail", "==", input.billingEmail)
    .where("name", "==", input.companyName)
    .where("status", "in", duplicateStatuses)
    .limit(1);
  const orderFallbackQuery = db
    .collection("businessOrders")
    .where("billingEmail", "==", input.billingEmail)
    .where("companyName", "==", input.companyName)
    .where("status", "in", duplicateStatuses)
    .limit(1);
  const [fallbackOrgSnap, fallbackOrderSnap] = await Promise.all([
    tx.get(orgFallbackQuery),
    tx.get(orderFallbackQuery),
  ]);
  if (!fallbackOrgSnap.empty || !fallbackOrderSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "A pending or active business registration with the same billingEmail + companyName already exists."
    );
  }
}

export const createBusinessOrg = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request): Promise<CreateBusinessOrgResult | Record<string, unknown>> => {
    const actor = requireAuth(request);
    const raw = (request.data ?? {}) as Record<string, unknown>;

    if (isWebOnboardingPayload(raw)) {
      return handleWebOnboardingCreateOrg(actor.uid, actor.email, raw);
    }

    const input = normalizeInput(raw as CreateBusinessOrgInput);
    const db = admin.firestore();

    const now = admin.firestore.FieldValue.serverTimestamp();
    const year = getYearString();
    const countersRef = db.collection("counters").doc(`businessOrders_${year}`);
    const orgRef = db.collection("organizations").doc();
    const orderRef = db.collection("businessOrders").doc();
    const memberRef = orgRef.collection("members").doc(actor.uid);
    const auditRef = db.collection("adminActivityLogs").doc();

    let orderNumber = "";
    let variableSymbol = "";
    let paymentReference = "";

    await db.runTransaction(async (tx) => {
      await assertNoDuplicateBusinessIdentity(tx, db, input);

      const counterSnap = await tx.get(countersRef);
      const currentSequence =
        counterSnap.exists && typeof counterSnap.data()?.sequence === "number"
          ? (counterSnap.data()?.sequence as number)
          : 0;
      const nextSequence = currentSequence + 1;
      const seq = padSequence(nextSequence);

      orderNumber = `STV-${year}-${seq}`;
      variableSymbol = `${year}${seq}`;
      paymentReference = orderNumber;

      if (!/^\d{10}$/.test(variableSymbol)) {
        throw new HttpsError("internal", "Generated variableSymbol is invalid.");
      }

      tx.set(
        countersRef,
        {
          sequence: nextSequence,
          year,
          updatedAt: now,
        },
        { merge: true }
      );

      tx.set(orgRef, {
        name: input.companyName,
        legalName: input.legalName,
        ownerUid: actor.uid,
        billingOwnerUid: actor.uid,
        createdByUid: actor.uid,
        status: "pending_payment",
        businessEnabled: false,
        requestedSeats: input.requestedSeats,
        seatsLimit: 0,
        seatsUsed: 1,
        countryCode: input.countryCode,
        billingEmail: input.billingEmail,
        billingAddress: input.billingAddress,
        companyIdentifiers: input.companyIdentifiers,
        contactName: input.contactName,
        phone: input.phone,
        activeBusinessOrderId: orderRef.id,
        createdAt: now,
        updatedAt: now,
      });

      tx.set(memberRef, {
        userId: actor.uid,
        email: actor.email,
        role: "owner",
        status: "active",
        joinedAt: now,
        createdAt: now,
      });

      tx.set(orderRef, {
        orgId: orgRef.id,
        orderNumber,
        variableSymbol,
        paymentReference,
        countryCode: input.countryCode,
        currency: "EUR",
        requestedSeats: input.requestedSeats,
        status: "pending_payment",
        billingOwnerUid: actor.uid,
        createdByUid: actor.uid,
        companyName: input.companyName,
        billingEmail: input.billingEmail,
        billingAddress: input.billingAddress,
        companyIdentifiers: input.companyIdentifiers,
        priceSnapshot: {
          planCode: "business",
          billingPeriod: "manual",
          requestedSeats: input.requestedSeats,
          currency: "EUR",
          pricingMode: "manual_invoice",
        },
        createdAt: now,
        updatedAt: now,
        paidAt: null,
        activatedAt: null,
      });

      tx.set(auditRef, {
        action: "create_business_org",
        orgId: orgRef.id,
        orderId: orderRef.id,
        actorUid: actor.uid,
        actorEmail: actor.email,
        createdAt: now,
        source: "create_business_org_callable",
      });
    });

    return {
      ok: true,
      orgId: orgRef.id,
      orderId: orderRef.id,
      orderNumber,
      variableSymbol,
      paymentReference,
      status: "pending_payment",
    };
  }
);

