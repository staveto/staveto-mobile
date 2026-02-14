import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";
import * as crypto from "crypto";
import vision from "@google-cloud/vision";

const STORAGE_BUCKET = "staveto-mvp-5f251.firebasestorage.app";
admin.initializeApp({ storageBucket: STORAGE_BUCKET });

type ParsedInvoice = {
  supplierName: string | null;
  supplierTaxId: string | null; // EU: IČO, USt-IdNr, NIP, P.IVA, CIF, etc.
  invoiceNumber: string | null;
  issueDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: "EUR";
};

const visionClient = new vision.ImageAnnotatorClient();
type OcrStep = "auth" | "exists_check" | "signed_url" | "download_bytes" | "vision_call";

function sanitizeError(error: unknown): { errorMessage: string; errorCode: string } {
  const e = error as { message?: string; code?: string | number; details?: string };
  return {
    errorMessage: String(e?.message || e?.details || "Unknown OCR error"),
    errorCode: String(e?.code || "UNKNOWN"),
  };
}

function logStepError(input: {
  step: OcrStep;
  filePath: string;
  bucketUsed: string;
  uid?: string;
  attachmentId?: string | null;
  error: unknown;
}) {
  const { errorMessage, errorCode } = sanitizeError(input.error);
  console.error("[extractInvoiceData] step_error", {
    step: input.step,
    filePath: input.filePath,
    bucketUsed: input.bucketUsed,
    uid: input.uid ?? null,
    attachmentId: input.attachmentId ?? null,
    errorMessage,
    errorCode,
  });
}

function throwStepError(step: OcrStep, reason: string): never {
  throw new HttpsError("internal", "OCR failed", { step, reason });
}

function parseAmount(value: string): number | null {
  const raw = value.replace(/[^\d,.\s]/g, "").replace(/\s/g, "");
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = /,\d{2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (hasDot) {
    normalized = /\.\d{2}$/.test(raw) ? raw : raw.replace(/\./g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function pickLargestAmount(text: string): number | null {
  const matches = text.match(/[\d][\d\s.,]{1,}/g);
  if (!matches) return null;
  const amounts = matches
    .map((m) => parseAmount(m))
    .filter((n): n is number => typeof n === "number" && n > 0);
  if (!amounts.length) return null;
  return Math.max(...amounts);
}

function extractLineAmount(lines: string[], keywordRegex: RegExp): number | null {
  for (const line of lines) {
    if (!keywordRegex.test(line)) continue;
    const amount = pickLargestAmount(line);
    if (amount !== null) return amount;
  }
  return null;
}

function parseInvoiceNumber(text: string): string | null {
  const patterns = [
    /(?:fakt[úu]ra|invoice|rechnung|fattura|factura|rachunek|factuur)\s*(?:no\.?|nr\.?|number|nummer|numero)?\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
    /(?:č[íi]slo\s*fakt[úu]ry|invoice\s*no\.?|numero\s*fattura)\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function parseDate(text: string): string | null {
  const datePatterns = [
    /\b(\d{2})[./](\d{2})[./](\d{4})\b/,
    /\b(\d{4})-(\d{2})-(\d{2})\b/,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (!m) continue;
    if (m[0].includes("-")) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

function parseSupplierName(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/fakt[úu]ra|invoice|rechnung|fattura|factura|rachunek/i.test(trimmed)) continue;
    if (/\d{6,}/.test(trimmed)) continue;
    if (trimmed.length < 3) continue;
    return trimmed.slice(0, 80);
  }
  return null;
}

/** Extracts EU VAT/Tax ID from invoice text (IČO, USt-IdNr, NIP, P.IVA, CIF, etc.) */
function parseSupplierTaxId(text: string): string | null {
  // EU VAT format: 2-letter country + 8–12 digits (DE123456789, SK2020317089, CZ12345678, ATU12345678, PL1234567890, IT12345678901, ES12345678A)
  const euVat = text.match(/\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s\-]?([A-Z0-9]{8,12})\b/i);
  if (euVat?.[2]) return `${euVat[1].toUpperCase()}${euVat[2]}`;
  // IČO (SK/CZ): 8 digits
  const ico = text.match(/\b(?:IČO|IČ|IC|DIČ|DS)[\s:]*(\d{8})\b/i);
  if (ico?.[1]) return ico[1];
  // USt-IdNr / VAT ID (DE and others)
  const ust = text.match(/\b(?:USt[- ]?IdNr?\.?|VAT|MwSt[- ]?Nr)[\s:]*([A-Z]{2}\s?[\dA-Z]{8,12})\b/i);
  if (ust?.[1]) return ust[1].replace(/\s/g, "");
  // NIP (PL)
  const nip = text.match(/\b(?:NIP)[\s:]*(\d{3}[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}|\d{10})\b/);
  if (nip?.[1]) return nip[1].replace(/[\s\-]/g, "");
  // P.IVA / CIF (IT, ES)
  const piva = text.match(/\b(?:P\.?IVA|Partita IVA|CIF|NIF)[\s:]*([A-Z0-9]{9,12})\b/i);
  if (piva?.[1]) return piva[1];
  return null;
}

function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const invoiceNumber = parseInvoiceNumber(rawText);
  const issueDate = parseDate(rawText);
  const totalRegex = /(celkom|spolu|total|summe|gesamt|totale|importe|razem|pagos|betrag)/i;
  const totalAmount =
    extractLineAmount(lines, totalRegex) ?? pickLargestAmount(rawText);
  const vatRegex = /(dph|vat|mwst|iva|tva|podatek)/i;
  const vatAmount = extractLineAmount(lines, vatRegex);
  const supplierName = parseSupplierName(lines);
  const supplierTaxId = parseSupplierTaxId(rawText);
  return {
    supplierName,
    supplierTaxId,
    invoiceNumber,
    issueDate,
    totalAmount,
    vatAmount,
    currency: "EUR",
  };
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export const claimProjectInvites = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const uid = request.auth.uid;
    const emailLower = normalizeEmail(request.auth.token.email);
    if (!emailLower) {
      return { claimedCount: 0, projectIds: [] as string[] };
    }

    const db = admin.firestore();
    const [emailLowerSnap, emailSnap] = await Promise.all([
      db.collectionGroup("members").where("emailLower", "==", emailLower).get(),
      db.collectionGroup("members").where("email", "==", emailLower).get(),
    ]);

    const memberDocs = [...emailLowerSnap.docs, ...emailSnap.docs].filter(
      (doc, index, arr) => arr.findIndex((x) => x.ref.path === doc.ref.path) === index
    );

    if (!memberDocs.length) {
      return { claimedCount: 0, projectIds: [] as string[] };
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let claimedCount = 0;
    const projectIds: string[] = [];
    const projectOwnerCache = new Map<string, string | undefined>();
    const projectSharedCountCache = new Map<string, number>();
    const displayName = (request.auth.token.name as string) ?? request.auth.token.email ?? emailLower;
    const { setMembersByUidMirror } = await import("./team");

    for (const memberDoc of memberDocs) {
      const data = memberDoc.data() as {
        email?: string;
        emailLower?: string;
        userId?: string | null;
        status?: string;
        role?: string;
        name?: string;
        invitedBy?: string;
        permissionLevel?: "viewer" | "editor";
        sharedItems?: { tasks?: boolean; phases?: boolean; expenses?: boolean; diary?: boolean; documents?: boolean };
        sharedPhaseIds?: string[];
      };

      const normalizedStoredEmail = normalizeEmail(data.emailLower || data.email);
      if (!normalizedStoredEmail || normalizedStoredEmail !== emailLower) continue;

      const currentUserId = typeof data.userId === "string" ? data.userId.trim() : "";
      const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
      const isInvitedOrUnclaimed = status === "invited" || !currentUserId;
      const isAlreadyActiveForUser = currentUserId === uid && status === "active";
      if (!isInvitedOrUnclaimed && !isAlreadyActiveForUser) continue;

      const projectId = memberDoc.ref.parent?.parent?.id;
      if (!projectId) continue;

      if (isInvitedOrUnclaimed) {
        batch.update(memberDoc.ref, {
          userId: uid,
          status: "active",
          emailLower,
          name: displayName || data.name || emailLower,
          joinedAt: now,
        });

        const eventsRef = db.collection("projects").doc(projectId).collection("events");
        const eventRef = eventsRef.doc();
        batch.set(eventRef, {
          type: "member_joined",
          actorId: uid,
          actorName: displayName || emailLower,
          createdAt: now,
          payload: {
            targetUserId: uid,
            targetEmail: emailLower,
            targetName: displayName || emailLower,
            text: `${displayName || emailLower} vstúpil do projektu.`,
          },
        });

        let recipientUid = data.invitedBy ?? null;
        if (!recipientUid) {
          if (!projectOwnerCache.has(projectId)) {
            const projectSnap = await db.doc(`projects/${projectId}`).get();
            projectOwnerCache.set(projectId, projectSnap.data()?.ownerId as string | undefined);
          }
          recipientUid = projectOwnerCache.get(projectId) ?? null;
        }
        if (recipientUid && recipientUid !== uid) {
          const notifRef = db.collection("notifications").doc();
          batch.set(notifRef, {
            userId: recipientUid,
            type: "MEMBER_JOINED",
            projectId,
            createdAt: now,
            readAt: null,
            message: `Používateľ ${displayName || emailLower} prijal pozvánku do projektu.`,
            fromUserId: uid,
            fromUserName: displayName || emailLower,
            severity: "info",
          });
        }

        claimedCount += 1;

        const permissionLevel = (data.permissionLevel === "viewer" || data.permissionLevel === "editor" ? data.permissionLevel : "editor") as "viewer" | "editor";
        const sharedItems = data.sharedItems && typeof data.sharedItems === "object"
          ? data.sharedItems
          : { tasks: true, phases: true, expenses: false, diary: false, documents: false };
        const sharedPhaseIds = Array.isArray(data.sharedPhaseIds)
          ? data.sharedPhaseIds.filter((id): id is string => typeof id === "string")
          : [];

        batch.set(
          db.doc(`users/${uid}/projectRefs/${projectId}`),
          {
            projectId,
            role: typeof data.role === "string" ? data.role : "member",
            permissionLevel,
            sharedItems,
            sharedPhaseIds,
            joinedAt: now,
            source: "invite",
          },
          { merge: true }
        );

        setMembersByUidMirror(batch, projectId, uid, {
          permissionLevel,
          sharedItems,
          sharedPhaseIds,
          status: "active",
          joinedAt: now,
        });

        const projectRef = db.doc(`projects/${projectId}`);
        if (!projectOwnerCache.has(projectId)) {
          const projectSnap = await db.doc(`projects/${projectId}`).get();
          projectOwnerCache.set(projectId, projectSnap.data()?.ownerId as string | undefined);
        }
        const currentSharedWithCount = projectSharedCountCache.get(projectId)
          ?? (await projectRef.get()).data()?.sharedWithCount ?? 0;
        const nextCount = currentSharedWithCount + 1;
        projectSharedCountCache.set(projectId, nextCount);
        batch.update(projectRef, { sharedWithCount: nextCount });
      }

      if (!projectIds.includes(projectId)) {
        projectIds.push(projectId);
      }
    }

    if (claimedCount > 0) {
      await batch.commit();
    }

    return { claimedCount, projectIds };
  }
);

// --- Project Invites Inbox (explicit accept/decline) ---

export const listPendingInvites = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }

      const data = (request.data ?? {}) as { email?: string };
      const emailLower =
        normalizeEmail(request.auth?.token?.email) || normalizeEmail(data?.email);
      if (!emailLower) {
        return { invites: [] };
      }

      const db = admin.firestore();
      let membersSnap;
      try {
        membersSnap = await db
          .collectionGroup("members")
          .where("emailLower", "==", emailLower)
          .where("status", "==", "invited")
          .where("userId", "==", null)
          .get();
      } catch (queryErr) {
        const msg = queryErr instanceof Error ? queryErr.message : String(queryErr);
        const code = (queryErr as { code?: number | string })?.code;
        const isIndexError =
          msg.includes("index") ||
          msg.includes("FAILED_PRECONDITION") ||
          msg.includes("requires an index") ||
          code === "FAILED_PRECONDITION" ||
          code === 9;
        if (isIndexError) {
          console.error("[listPendingInvites] index required", msg);
          throw new HttpsError("failed-precondition", "index_required");
        }
        throw queryErr;
      }

      const invites: Array<{
        projectId: string;
        projectName: string;
        memberId: string;
        invitedBy: string | null;
        invitedAt: unknown;
        permissionLevel: string;
        role: string;
        sharedItems: Record<string, boolean>;
        sharedPhaseIds: string[];
        email: string;
        name: string;
      }> = [];
      const projectIds = new Set<string>();

      for (const doc of membersSnap.docs) {
        const projectId = doc.ref.parent?.parent?.id;
        if (!projectId) continue;
        projectIds.add(projectId);
      }

      const projectCache = new Map<string, string>();
      await Promise.all(
        Array.from(projectIds).map(async (projectId) => {
          const projectSnap = await db.doc(`projects/${projectId}`).get();
          const name = projectSnap.exists
            ? (String((projectSnap.data() as { name?: string })?.name ?? "").trim() || projectId)
            : "";
          projectCache.set(projectId, name || projectId);
        })
      );

      for (const doc of membersSnap.docs) {
        const projectId = doc.ref.parent?.parent?.id;
        if (!projectId) continue;
        const d = doc.data() as {
          invitedBy?: string;
          invitedAt?: unknown;
          permissionLevel?: string;
          role?: string;
          sharedItems?: Record<string, boolean>;
          sharedPhaseIds?: string[];
          email?: string;
          name?: string;
        };
        const projectName = projectCache.get(projectId) ?? projectId;
        invites.push({
          projectId,
          projectName: projectName || "",
          memberId: doc.id,
          invitedBy: d.invitedBy ?? null,
          invitedAt: d.invitedAt ?? null,
          permissionLevel: d.permissionLevel ?? "",
          role: d.role ?? "",
          sharedItems: d.sharedItems ?? {},
          sharedPhaseIds: Array.isArray(d.sharedPhaseIds) ? d.sharedPhaseIds : [],
          email: d.email ?? "",
          name: d.name ?? "",
        });
      }

      return { invites };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[listPendingInvites] error", err);
      throw new HttpsError("internal", `listPendingInvites_failed: ${errMsg}`);
    }
  }
);

export const acceptProjectInvite = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    try {
      console.log("[acceptProjectInvite] auth?", !!request.auth, "uid?", request.auth?.uid ?? "null");
      if (!request.auth?.uid) {
        console.warn("[acceptProjectInvite] UNAUTHENTICATED: request.auth missing or uid empty");
        throw new HttpsError("unauthenticated", "Authentication required.");
      }

      const uid = request.auth.uid;
      const data = (request.data ?? {}) as { projectId?: string };
      const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
      if (!projectId) {
        throw new HttpsError("invalid-argument", "projectId is required.");
      }

      const emailLower =
        normalizeEmail(request.auth?.token?.email) ||
        normalizeEmail((request.data as { email?: string })?.email);
      if (!emailLower) {
        throw new HttpsError(
          "failed-precondition",
          "User must have an email to accept invites."
        );
      }

      const db = admin.firestore();
      const membersRef = db.collection("projects").doc(projectId).collection("members");
      const inviteSnap = await membersRef
        .where("emailLower", "==", emailLower)
        .where("status", "==", "invited")
        .where("userId", "==", null)
        .limit(1)
        .get();

      if (inviteSnap.empty) {
        const alreadySnap = await membersRef
          .where("userId", "==", uid)
          .limit(1)
          .get();
        if (!alreadySnap.empty) {
          return { ok: true, projectId, already: true };
        }
        return { ok: false, reason: "NOT_FOUND" };
      }

      const inviteDoc = inviteSnap.docs[0];
      const inviteData = inviteDoc.data() as {
        role?: string;
        permissionLevel?: string;
        name?: string;
        invitedBy?: string;
        sharedItems?: Record<string, boolean>;
      };

      const displayName =
        (request.auth?.token?.name as string) ??
        request.auth?.token?.email ??
        emailLower;
      const name = displayName || inviteData.name || emailLower;

      const mappedRole =
        inviteData.role ||
        (inviteData.permissionLevel === "editor" ? "editor" : "viewer") ||
        "member";

      const now = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();

      const permissionLevel = (inviteData.permissionLevel === "viewer" || inviteData.permissionLevel === "editor" ? inviteData.permissionLevel : "editor") as "viewer" | "editor";
      const sharedItems = inviteData.sharedItems && typeof inviteData.sharedItems === "object"
        ? inviteData.sharedItems
        : { tasks: true, phases: true, expenses: false, diary: false, documents: false };
      const sharedPhaseIds = Array.isArray((inviteDoc.data() as { sharedPhaseIds?: unknown }).sharedPhaseIds)
        ? (inviteDoc.data() as { sharedPhaseIds: string[] }).sharedPhaseIds.filter((id): id is string => typeof id === "string")
        : [];

      batch.update(inviteDoc.ref, {
        userId: uid,
        status: "active",
        name,
        joinedAt: now,
      });

      batch.set(
        db.doc(`users/${uid}/projectRefs/${projectId}`),
        {
          projectId,
          role: mappedRole,
          permissionLevel,
          sharedItems,
          sharedPhaseIds,
          joinedAt: now,
          source: "invite",
        },
        { merge: true }
      );

      const { setMembersByUidMirror } = await import("./team");
      const projectRef = db.doc(`projects/${projectId}`);
      setMembersByUidMirror(batch, projectId, uid, {
        permissionLevel,
        sharedItems,
        sharedPhaseIds,
        status: "active",
        joinedAt: now,
      });
      const projectSnapForCount = await projectRef.get();
      const currentSharedWithCount = (projectSnapForCount.data()?.sharedWithCount as number | undefined) ?? 0;
      batch.update(projectRef, { sharedWithCount: currentSharedWithCount + 1 });

      const eventsRef = db.collection("projects").doc(projectId).collection("events");
      batch.set(eventsRef.doc(), {
        type: "member_joined",
        actorId: uid,
        actorName: name,
        createdAt: now,
        payload: {
          targetUserId: uid,
          targetEmail: emailLower,
          targetName: name,
          text: `${name} vstúpil do projektu.`,
        },
      });

      let recipientUid = inviteData.invitedBy ?? null;
      if (!recipientUid) {
        const projectSnap = await db.doc(`projects/${projectId}`).get();
        recipientUid = projectSnap.exists
          ? ((projectSnap.data() as { ownerId?: string })?.ownerId ?? null)
          : null;
      }
      if (recipientUid && recipientUid !== uid) {
        batch.set(db.collection("notifications").doc(), {
          userId: recipientUid,
          type: "MEMBER_JOINED",
          projectId,
          createdAt: now,
          readAt: null,
          message: `Používateľ ${name} prijal pozvánku do projektu.`,
          fromUserId: uid,
          fromUserName: name,
          severity: "info",
        });
      }

      await batch.commit();
      return { ok: true, projectId };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[acceptProjectInvite] error", err);
      throw new HttpsError("internal", "acceptProjectInvite_failed");
    }
  }
);

export const declineProjectInvite = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
      }

      const uid = request.auth.uid;
      const data = (request.data ?? {}) as { projectId?: string };
      const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
      if (!projectId) {
        throw new HttpsError("invalid-argument", "projectId is required.");
      }

      const emailLower =
        normalizeEmail(request.auth?.token?.email) ||
        normalizeEmail((request.data as { email?: string })?.email);
      if (!emailLower) {
        return { ok: true };
      }

      const db = admin.firestore();
      const inviteSnap = await db
        .collection("projects")
        .doc(projectId)
        .collection("members")
        .where("emailLower", "==", emailLower)
        .where("status", "==", "invited")
        .where("userId", "==", null)
        .limit(1)
        .get();

      if (!inviteSnap.empty) {
        await inviteSnap.docs[0].ref.update({
          status: "declined",
          declinedAt: admin.firestore.FieldValue.serverTimestamp(),
          declinedByUid: uid,
        });
      }

      return { ok: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("[declineProjectInvite] error", err);
      throw new HttpsError("internal", "declineProjectInvite_failed");
    }
  }
);

export const extractInvoiceData = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const data = (request.data ?? {}) as {
      storagePath?: string;
      filePath?: string;
      mimeType?: string;
      attachmentId?: string;
      projectId?: string;
    };
    const storagePathValue = typeof data.storagePath === "string" ? data.storagePath.trim() : "";
    const filePathValue = typeof data.filePath === "string" ? data.filePath.trim() : "";
    const storagePath = storagePathValue || filePathValue || "";
    const attachmentId = typeof data.attachmentId === "string" ? data.attachmentId : undefined;
    const projectId = typeof data.projectId === "string" ? data.projectId : undefined;
    const mimeType = typeof data.mimeType === "string" ? data.mimeType : undefined;
    const uid = request.auth?.uid;

    log("[extractInvoiceData] request", { projectId, attachmentId, filePath: data.filePath, storagePath, mimeType, uid });

    if (!request.auth || !uid) {
      logStepError({
        step: "auth",
        filePath: storagePath || "<empty>",
        bucketUsed: STORAGE_BUCKET,
        uid: uid ?? undefined,
        attachmentId: attachmentId ?? null,
        error: new Error("Missing auth context"),
      });
      throw new HttpsError("unauthenticated", "Authentication required.", {
        step: "auth",
        reason: "missing_auth",
      });
    }

    if (!storagePath || typeof storagePath !== "string") {
      logStepError({
        step: "exists_check",
        filePath: "<empty>",
        bucketUsed: STORAGE_BUCKET,
        uid,
        attachmentId: attachmentId ?? null,
        error: new Error("storagePath/filePath is required"),
      });
      throw new HttpsError("invalid-argument", "storagePath is required.", {
        step: "exists_check",
        reason: "missing_file_path",
      });
    }

    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    const fileRef = bucket.file(storagePath);
    const [exists] = await fileRef.exists();
    log("[extractInvoiceData] OCR file exists?", { bucket: bucket.name, storagePath, exists });
    if (!exists) {
      log("[extractInvoiceData] FILE_NOT_FOUND", { bucket: bucket.name, storagePath });
      throw new HttpsError("not-found", "FILE_NOT_FOUND", { bucket: bucket.name, storagePath });
    }

    const db = admin.firestore();
    const cacheCollection = db.collection("users").doc(uid).collection("ocrCache");
    const limitsRef = db.collection("users").doc(uid).collection("limits").doc("ocr");

    let bytes: Buffer;
    try {
      [bytes] = await fileRef.download();
    } catch (error) {
      logStepError({
        step: "download_bytes",
        filePath: storagePath,
        bucketUsed: STORAGE_BUCKET,
        uid,
        attachmentId: attachmentId ?? null,
        error,
      });
      throwStepError("download_bytes", "storage_download_failed");
    }
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");

    const cacheDoc = await cacheCollection.doc(hash).get();
    if (cacheDoc.exists) {
      const cached = cacheDoc.data() as {
        ok?: boolean;
        extractedText?: string;
        fields?: ParsedInvoice | null;
        status: "success" | "failed" | "limit";
        parsed: ParsedInvoice | null;
        rawText?: string;
      };
      if (cached.status === "success") {
        return {
          ok: true,
          extractedText: cached.extractedText ?? cached.rawText ?? "",
          fields: cached.fields ?? cached.parsed ?? {},
          status: "success" as const,
          parsed: cached.parsed,
          rawText: cached.rawText ?? cached.extractedText ?? "",
        };
      }
      return cached;
    }

    const today = new Date().toISOString().slice(0, 10);
    let limitReached = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(limitsRef);
      const data = snap.data() as { date?: string; count?: number } | undefined;
      const count = data?.date === today ? data?.count ?? 0 : 0;
      if (count >= 30) {
        limitReached = true;
        return;
      }
      tx.set(limitsRef, { date: today, count: count + 1 }, { merge: true });
    });

    if (limitReached) {
      return { status: "limit", parsed: null };
    }

    let rawText = "";
    try {
      const [result] = await visionClient.textDetection({
        image: { content: bytes },
      });
      rawText = result.fullTextAnnotation?.text ?? result.textAnnotations?.[0]?.description ?? "";
    } catch (error) {
      logStepError({
        step: "vision_call",
        filePath: storagePath,
        bucketUsed: STORAGE_BUCKET,
        uid,
        attachmentId: attachmentId ?? null,
        error,
      });
      let signedUrl = "";
      try {
        const [generatedUrl] = await fileRef.getSignedUrl({
          action: "read",
          expires: Date.now() + 5 * 60 * 1000,
        });
        signedUrl = generatedUrl;
      } catch (signedUrlError) {
        logStepError({
          step: "signed_url",
          filePath: storagePath,
          bucketUsed: STORAGE_BUCKET,
          uid,
          attachmentId: attachmentId ?? null,
          error: signedUrlError,
        });
        throwStepError("signed_url", "failed_to_create_signed_url");
      }
      try {
        const [fallbackResult] = await visionClient.textDetection(signedUrl);
        rawText =
          fallbackResult.fullTextAnnotation?.text ??
          fallbackResult.textAnnotations?.[0]?.description ??
          "";
      } catch (fallbackError) {
        logStepError({
          step: "vision_call",
          filePath: storagePath,
          bucketUsed: STORAGE_BUCKET,
          uid,
          attachmentId: attachmentId ?? null,
          error: fallbackError,
        });
        throwStepError("vision_call", "vision_api_failed");
      }
    }

    if (!rawText.trim()) {
      logStepError({
        step: "vision_call",
        filePath: storagePath,
        bucketUsed: STORAGE_BUCKET,
        uid,
        attachmentId: attachmentId ?? null,
        error: new Error("Vision returned empty text"),
      });
      throwStepError("vision_call", "empty_ocr_text");
    }

    const parsed = parseInvoiceText(rawText);
    const response = {
      ok: true,
      extractedText: rawText,
      fields: parsed,
      // Backward compatibility for existing mobile app response mapping.
      status: "success" as const,
      parsed,
      rawText,
    };
    await cacheCollection.doc(hash).set({
      ...response,
      storagePath,
      attachmentId: attachmentId ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return response;
  }
);

export { inboundWebhook } from "./whatsapp";
export { addProjectMemberByEmail, removeProjectMember, updateMemberPermissions, backfillProjectSharedCounts } from "./team";
