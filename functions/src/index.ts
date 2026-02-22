import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { log } from "firebase-functions/logger";
import { getUserTokens, findUidByEmailLower, sendPushToUser } from "./push";
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

/** Max reasonable invoice total (EUR) – filters out IDs, barcodes, etc. */
const MAX_REASONABLE_AMOUNT = 999_999.99;

function isReasonableAmount(n: number): boolean {
  return n > 0 && n <= MAX_REASONABLE_AMOUNT;
}

function pickLargestAmount(text: string): number | null {
  const matches = text.match(/[\d][\d\s.,]{1,}/g);
  if (!matches) return null;
  const amounts = matches
    .map((m) => parseAmount(m))
    .filter((n): n is number => typeof n === "number" && isReasonableAmount(n));
  if (!amounts.length) return null;
  const max = Math.max(...amounts);
  // Prefer amounts with 2 decimals (EUR totals) over round numbers (45 from "45%", 46 from barcode)
  const withDecimals = amounts.filter((n) => n % 1 !== 0 && n > 1 && n < 1000);
  if (withDecimals.length > 0 && max >= 40 && max <= 60 && Number.isInteger(max)) {
    const bestDecimal = Math.max(...withDecimals);
    return bestDecimal;
  }
  return max;
}

function extractLineAmount(lines: string[], keywordRegex: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!keywordRegex.test(line)) continue;
    let amount = pickLargestAmount(line);
    if (amount !== null) return amount;
    if (i + 1 < lines.length) {
      amount = pickLargestAmount(lines[i + 1]);
      if (amount !== null) return amount;
    }
  }
  return null;
}

/** Lines that mean BASE (without VAT) – never use as total. */
const BASE_ONLY_REGEX = /^(?:základ|base|netto|net|báze)\s*[:]?\s*/i;

/** Lines about discount – amounts like 45 from "45% zľava" must not be used as total (multi-language) */
const DISCOUNT_LINE_REGEX = /(?:z[lľ]ava|discount|rabatt|sconto|r[ée]duction|korting|zni[żz]ka)\s*[:\s]*\d*\s*%/i;

/** Extract amount in XX,XX EUR or XX.XX EUR format – avoids picking 45 from "45%" or 46 from barcodes */
function extractEurAmountFromLine(line: string): number | null {
  const m = line.match(/(\d{1,6}[.,]\d{2})\s*(?:eur|€|euro)/i);
  if (!m?.[1]) return null;
  const n = parseAmount(m[1]);
  return n != null && isReasonableAmount(n) ? n : null;
}

/** Extract total WITH VAT. Prioritize XX,XX EUR format, then unambiguous "total" phrases. */
function extractTotalWithVat(lines: string[]): number | null {
  const totalWithVatRegex =
    /(?:spolu(?:\s+v\s+eur)?|uhraden[ée]|platen[ée]\s+v\s+hotovosti|na\s*[úu]hradu\s*(?:eur)?|celkom|total|summe|gesamt|totale|importe|razem|k\s*[úu]hrade|hotovosť|karta|platba|zaplatiť|betrag|úhradu\s*eur|paid|bezahlt|pagato|amount|montant|importo)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BASE_ONLY_REGEX.test(line)) continue;
    if (DISCOUNT_LINE_REGEX.test(line)) continue;
    if (!totalWithVatRegex.test(line)) continue;
    // Prefer amount in "40,20 EUR" format – avoids 45 from "45%" or 46 from barcodes
    let amount = extractEurAmountFromLine(line);
    if (amount !== null) return amount;
    if (i + 1 < lines.length) {
      amount = extractEurAmountFromLine(lines[i + 1]);
      if (amount !== null) return amount;
    }
    // Fallback: line may have "40,20" without EUR – prefer amounts with 2 decimals (totals)
    const decimalAmounts = (line + (i + 1 < lines.length ? " " + lines[i + 1] : ""))
      .match(/\d{1,6}[.,]\d{2}/g) || [];
    const parsed = decimalAmounts.map((s) => parseAmount(s)).filter((n): n is number => n != null && isReasonableAmount(n));
    if (parsed.length > 0) return Math.max(...parsed);
    amount = pickLargestAmount(line);
    if (amount !== null) return amount;
    if (i + 1 < lines.length) {
      amount = pickLargestAmount(lines[i + 1]);
      if (amount !== null) return amount;
    }
  }
  return null;
}

/** Fallback: Základ + DPH = Spolu (SK receipts) – always WITH VAT */
function extractTotalFromBaseAndVat(lines: string[]): number | null {
  let base: number | null = null;
  let vat: number | null = null;
  const baseRegex = /(základ|base|netto|net)\s*[:]?\s*/i;
  const vatRegex = /(dph|vat|mwst|iva)\s*[:]?\s*/i;
  for (const line of lines) {
    if (baseRegex.test(line) && base === null) base = pickLargestAmount(line);
    if (vatRegex.test(line) && vat === null) vat = pickLargestAmount(line);
  }
  if (base != null && vat != null && isReasonableAmount(base + vat)) {
    return Math.round((base + vat) * 100) / 100;
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

/** Section headers (supplier/customer) in multiple languages – strip from supplier name */
const SUPPLIER_PREFIX_REGEX =
  /^(?:dod[áa]vate[lľ]|odberate[lľ]|dodávatel|odberatel|lieferant|kunde|supplier|customer|fornitore|cliente|fournisseur|client|dostawca|odbiorca|leverancier|klant)\s*[:]?\s*/i;
/** Single stray char from OCR (e.g. "ľ" misread as "y" from "Dodávateľ") – only strip if followed by space + company-like text */
const SUPPLIER_LEADING_JUNK = /^[yíýľ]\s+(?=[A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŔŠŤÚÝŽ])/i;

function cleanSupplierName(raw: string): string {
  let s = raw.trim();
  s = s.replace(SUPPLIER_PREFIX_REGEX, "");
  s = s.replace(SUPPLIER_LEADING_JUNK, ""); // "y DEK s.r.o." -> "DEK s.r.o."
  return s.trim().slice(0, 80) || raw.trim().slice(0, 80);
}

function parseSupplierName(lines: string[]): string | null {
  let candidate: string | null = null;
  let inSupplierSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/\b(?:odberate[lľ]|kunde|customer|cliente|client|odbiorca|klant)\b/i.test(trimmed)) inSupplierSection = false;
    if (/\b(?:dod[áa]vate[lľ]|lieferant|supplier|fornitore|fournisseur|dostawca|leverancier)\b/i.test(trimmed)) {
      inSupplierSection = true;
      continue; // Section header – take next line
    }
    if (/fakt[úu]ra|invoice|rechnung|fattura|factura|rachunek/i.test(trimmed)) continue;
    if (/\d{6,}/.test(trimmed)) continue;
    if (trimmed.length < 3) continue;
    // Prefer lines that look like company names (multi-language legal forms, incl. "s. r. o." with spaces)
    if (/\b(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl|s\.a\.|s\.l\.|nv|bv|s\.a\.r\.l\.|eurl)\b/i.test(trimmed)) {
      return cleanSupplierName(trimmed);
    }
    if (inSupplierSection && !candidate) candidate = trimmed;
    if (!candidate) candidate = trimmed;
  }
  const result = candidate ? cleanSupplierName(candidate) : null;
  // Reject OCR noise: short Arabic-only strings (e.g. "کلام") from misread Latin on non-Arabic invoices
  if (result && /^[\u0600-\u06FF\s]+$/.test(result) && result.length < 10) return null;
  return result;
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

/** Highest priority: "uhradené" / "platené v hotovosti" = final paid amount (SK invoices) */
function extractPaidAmount(rawText: string): number | null {
  const block = rawText.replace(/\s+/g, " ");
  const paidRegex =
    /(?:uhraden[ée]|platen[ée](?:\s+v\s+hotovosti)?)\s*(\d{1,6}[.,]\d{2})\s*(?:eur|€|euro)?/gi;
  const all = [...block.matchAll(paidRegex)];
  if (all.length > 0) {
    const last = all[all.length - 1];
    const n = parseAmount(last[1]);
    return n != null && isReasonableAmount(n) ? n : null;
  }
  return null;
}

/** Fallback: find "XX,XX EUR" or "XX.XX EUR" after total keywords (multi-language) */
function extractTotalFromEurInText(rawText: string): number | null {
  const block = rawText.replace(/\s+/g, " ");
  const m = block.match(
    /(?:spolu|uhraden[ée]|platen[ée](?:\s+v\s+hotovosti)?|total|summe|gesamt|totale|importe|razem|paid|bezahlt|pagato|pay[ée]|betrag|amount|montant|importo)[\s\S]{0,80}?(\d{1,6}[.,]\d{2})\s*(?:eur|€|euro)/i
  );
  if (m?.[1]) {
    const n = parseAmount(m[1]);
    return n != null && isReasonableAmount(n) ? n : null;
  }
  return null;
}

function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const invoiceNumber = parseInvoiceNumber(rawText);
  const issueDate = parseDate(rawText);
  // Always use total WITH VAT: prioritize XX,XX EUR format near "Spolu"/"Uhradené"
  const totalRegex =
    /(?:spolu(?:\s+v\s+eur)?|uhraden[ée]|na\s*[úu]hradu|celkom|total|summe|gesamt|totale|importe|razem|k\s*[úu]hrade|hotovosť|karta|platba|zaplatiť|betrag|úhradu\s*eur|eur\s*\d|paid|bezahlt|pagato|amount|montant|importo)/i;
  let totalAmount =
    extractPaidAmount(rawText) ??
    extractTotalWithVat(lines) ??
    extractTotalFromEurInText(rawText) ??
    extractLineAmount(lines, totalRegex) ??
    extractTotalFromBaseAndVat(lines) ??
    pickLargestAmount(rawText);
  if (totalAmount != null && !isReasonableAmount(totalAmount)) {
    totalAmount = extractTotalFromBaseAndVat(lines) ?? pickLargestAmount(rawText);
  }
  const vatRegex = /(dph|vat|mwst|iva|tva|podatek)/i;
  const vatAmount = extractLineAmount(lines, vatRegex);
  const supplierTaxId = parseSupplierTaxId(rawText);
  let supplierName = parseSupplierName(lines);
  // Fallback 1: find company name (with legal form) before the tax ID in text
  if (!supplierName && supplierTaxId) {
    const taxIdx = rawText.indexOf(supplierTaxId);
    if (taxIdx > 0) {
      const beforeTax = rawText.slice(0, taxIdx);
      const m = beforeTax.match(
        /([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž0-9\u0600-\u06FF][^\n]{2,50}\s+(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl|s\.a\.|s\.l\.|nv|bv)\b)/i
      );
      if (m?.[1]) {
        const extracted = m[1].replace(/\s+/g, " ").trim();
        const isNoise = /^[\u0600-\u06FF\s]+$/.test(extracted) && extracted.length < 10;
        if (!/\d{6,}/.test(extracted) && !isNoise) supplierName = cleanSupplierName(extracted);
      }
    }
    // Fallback 2: tax ID might appear before company name in OCR – search after tax ID too
    if (!supplierName && taxIdx >= 0 && taxIdx < rawText.length) {
      const afterTax = rawText.slice(taxIdx + supplierTaxId.length, taxIdx + 200);
      const m2 = afterTax.match(
        /([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž][^\n]{1,40}\s+(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b)/i
      );
      if (m2?.[1]) {
        const extracted = m2[1].replace(/\s+/g, " ").trim();
        const isNoise = /^[\u0600-\u06FF\s]+$/.test(extracted) && extracted.length < 10;
        if (!/\d{6,}/.test(extracted) && !isNoise) supplierName = cleanSupplierName(extracted);
      }
    }
  }
  // Fallback 3: line containing tax ID – company name is often 1–2 lines before
  if (!supplierName && supplierTaxId) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(supplierTaxId)) continue;
      const legalForm = /\b(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b/i;
      for (const offset of [2, 1]) {
        if (i - offset < 0) continue;
        const line = lines[i - offset].trim();
        if (line.length < 4 || line.length > 80 || /\d{6,}/.test(line)) continue;
        const isNoise = /^[\u0600-\u06FF\s]+$/.test(line) && line.length < 10;
        if (isNoise) continue;
        supplierName = cleanSupplierName(line);
        if (legalForm.test(line)) break; // Prefer line with legal form
      }
      break;
    }
  }
  // Fallback 4: search first 800 chars for any "CompanyName s.r.o."
  if (!supplierName) {
    const top = rawText.slice(0, 800);
    const m3 = top.match(
      /\b([A-ZÁÄČĎÉÍĹĽŇÓÔŔŘŠŤÚÝŽa-záäčďéíĺľňóôřšťúýž][A-Za-záäčďéíĺľňóôřšťúýž0-9\s\-\.]{1,45}(?:s\.?\s*r\.?\s*o\.?|a\.s\.|sro|as|gmbh|ag|ltd|limited|inc|llc|spa|srl)\b)/i
    );
    if (m3?.[1]) {
      const extracted = m3[1].replace(/\s+/g, " ").trim();
      const isNoise = /^[\u0600-\u06FF\s]+$/.test(extracted) && extracted.length < 10;
      if (!/\d{6,}/.test(extracted) && !isNoise && extracted.length >= 4) supplierName = cleanSupplierName(extracted);
    }
  }
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
    const projectNameCache = new Map<string, string>();
    const displayName = (request.auth.token.name as string) ?? request.auth.token.email ?? emailLower;
    const ownerPushTargets: Array<{ ownerUid: string; projectId: string; projectName: string; joinerName: string }> = [];
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
          let pName = projectNameCache.get(projectId);
          if (!pName) {
            const ps = await db.doc(`projects/${projectId}`).get();
            pName = (ps.data()?.name as string) ?? "Projekt";
            projectNameCache.set(projectId, pName);
          }
          ownerPushTargets.push({
            ownerUid: recipientUid,
            projectId,
            projectName: pName,
            joinerName: displayName || emailLower,
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
      for (const t of ownerPushTargets) {
        sendPushToUser(
          t.ownerUid,
          "Pozvánka prijatá",
          `${t.joinerName} prijal pozvánku do projektu ${t.projectName}.`,
          { type: "MEMBER_JOINED", projectId: t.projectId }
        ).catch((err) => log("[claimProjectInvites] push error", t.ownerUid, err));
      }
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

      if (recipientUid && recipientUid !== uid) {
        const projectName = (projectSnapForCount.data()?.name as string) ?? "Projekt";
        sendPushToUser(
          recipientUid,
          "Pozvánka prijatá",
          `${name} prijal pozvánku do projektu ${projectName}.`,
          { type: "MEMBER_JOINED", projectId }
        ).catch((err) => log("[acceptProjectInvite] push error", recipientUid, err));
      }
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
        const rawText = cached.rawText ?? cached.extractedText ?? "";
        // Re-parse cached rawText so improved parsing logic applies (fixes stale cache after deploy)
        const reparsed = rawText ? parseInvoiceText(rawText) : (cached.parsed ?? cached.fields);
        return {
          ok: true,
          extractedText: rawText,
          fields: reparsed,
          status: "success" as const,
          parsed: reparsed,
          rawText,
        };
      }
      return cached;
    }

    const requestId = attachmentId || hash;
    const { checkAndConsumeOcrCreditSync, getPeriodKey, getLimitsConfig } = await import("./billing");
    const limits = await getLimitsConfig(db);
    const userRef = db.collection("users").doc(uid);

    const gateError = await db.runTransaction<
      { errorCode: string; cooldownSeconds?: number } | null
    >(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { errorCode: "ENTITLEMENT_REQUIRED" };
      }
      const userData = userSnap.data() as Record<string, unknown>;
      let effectiveUserData = userData;
      let periodKey: string;
      const needsTrialInit = !userData?.subscriptionStatus && !userData?.subscription;
      if (needsTrialInit) {
        const now = new Date();
        const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const trialFields = {
          subscriptionStatus: "trial",
          trialStartAt: admin.firestore.Timestamp.fromDate(now),
          trialEndAt: admin.firestore.Timestamp.fromDate(trialEnd),
          planId: "staveto_monthly_1499",
          entitlement: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        tx.set(userRef, trialFields, { merge: true });
        effectiveUserData = { ...userData, ...trialFields };
        periodKey = "trial";
      } else {
        periodKey = getPeriodKey(userData);
      }

      const usageRef = db.collection("users").doc(uid).collection("usage").doc(periodKey);
      const usageSnap = await tx.get(usageRef);
      const usageData = usageSnap.exists ? (usageSnap.data() as { ocrUsed?: number; lastOcrAt?: unknown; requestIds?: string[] }) : undefined;

      const gateResult = checkAndConsumeOcrCreditSync(effectiveUserData, usageData, limits, requestId);
      if (!gateResult.allowed) {
        return { errorCode: gateResult.errorCode!, cooldownSeconds: gateResult.cooldownSeconds };
      }

      const ocrUsed = typeof usageData?.ocrUsed === "number" ? usageData.ocrUsed : 0;
      const requestIds: string[] = Array.isArray(usageData?.requestIds) ? usageData.requestIds : [];
      const now = admin.firestore.FieldValue.serverTimestamp();
      const nowTs = admin.firestore.Timestamp.now();
      tx.set(usageRef, {
        periodKey,
        ocrUsed: ocrUsed + 1,
        lastOcrAt: nowTs,
        requestIds: [...requestIds, requestId],
        updatedAt: now,
      }, { merge: true });
      return null;
    });

    if (gateError) {
      const upgradeRequired =
        gateError.errorCode === "ENTITLEMENT_REQUIRED" || gateError.errorCode === "LIMIT_REACHED";
      return {
        status: "limit",
        parsed: null,
        errorCode: gateError.errorCode,
        cooldownSeconds: gateError.cooldownSeconds,
        code: "LIMIT_EXCEEDED",
        upgradeRequired,
        remaining: 0,
        limit: upgradeRequired ? 0 : undefined,
      };
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

    const parsed = parseInvoiceText(rawText) as ParseInvoiceResult;
    const response = {
      ok: true,
      extractedText: rawText,
      fields: parsed,
      // Backward compatibility for existing mobile app response mapping.
      status: "success" as const,
      parsed,
      rawText,
      _debug: { fromCache: false, rawTextLength: rawText.length, rawTextPreview: rawText.slice(0, 600), parsedAmount: parsed.totalAmount, parsedSupplier: parsed.supplierName, totalAmountSource: parsed._debugSource?.totalAmountSource, linesCount: parsed._debugSource?.linesCount },
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
export { addProjectMemberByEmail, removeProjectMember, updateMemberPermissions, syncMembersByUidForProject, backfillProjectSharedCounts, syncMyProjectsSharedCount } from "./team";
export { calculateDistanceKm } from "./distance";
export { redeemPromoCode } from "./promo";
export { checkEntitlement, getBillingStatus } from "./billing";
export { revenuecatWebhook } from "./revenuecatWebhook";

/** Send in-app notification when a project member invite is created. Push is sent by onNotificationCreated. */
export const onMemberInviteCreated = onDocumentCreated(
  {
    document: "projects/{projectId}/members/{memberId}",
    region: "europe-west1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;
    const data = snap.data();
    const status = data?.status;
    const emailLower = (data?.emailLower ?? data?.email ?? "").trim().toLowerCase();
    if (status !== "invited" || !emailLower) return;

    const projectId = event.params?.projectId;
    if (!projectId) return;

    const invitedByUid = (data?.invitedBy as string) ?? null;
    const uid = (data?.userId as string) ?? (await findUidByEmailLower(emailLower));
    if (!uid) {
      log("[onMemberInviteCreated] No user found for email, skipping notification", emailLower);
      return;
    }

    const db = admin.firestore();
    const projectSnap = await db.doc(`projects/${projectId}`).get();
    const projectName = (projectSnap.data()?.name as string) ?? "Projekt";

    await db.collection("notifications").add({
      userId: uid,
      type: "PROJECT_INVITED",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readAt: null,
      projectId,
      projectName,
      fromUserId: invitedByUid,
      severity: "info",
      message: `${projectName} – čaká na prijatie`,
    });
    log("[onMemberInviteCreated] In-app notification created for", uid, "project", projectId);
  }
);

/** Send in-app notification when a problem is created or assignee changes. */
export const onProblemCreated = onDocumentCreated(
  {
    document: "projects/{projectId}/problems/{problemId}",
    region: "europe-west1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;
    const data = snap.data();
    const assigneeUid = (data?.assigneeUid as string) ?? "";
    const createdByUid = (data?.createdByUid as string) ?? "";
    if (!assigneeUid) return;

    const projectId = event.params?.projectId;
    const problemId = event.params?.problemId;
    if (!projectId || !problemId) return;

    const db = admin.firestore();
    const projectSnap = await db.doc(`projects/${projectId}`).get();
    const projectName = (projectSnap.data()?.name as string) ?? "Projekt";
    const shortDescription = (data?.shortDescription as string) ?? "";
    const createdByName = (data?.createdByName as string) ?? "";
    const isSelfAssign = assigneeUid === createdByUid;

    const message = isSelfAssign
      ? `Nahlásil si nový problém: ${shortDescription || "Bez popisu"}`
      : createdByName
        ? `${createdByName} ti priradil problém: ${shortDescription || "Bez popisu"}`
        : `Bola ti priradená nová úloha v projekte ${projectName}`;

    await db.collection("notifications").add({
      userId: assigneeUid,
      type: "PROBLEM_ASSIGNED",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readAt: null,
      projectId,
      projectName,
      message,
      fromUserId: createdByUid,
      fromUserName: createdByName || null,
      severity: "info",
      meta: { problemId, projectId },
      deepLink: { screen: "ProblemDetail", params: { projectId, problemId } },
    });
    log("[onProblemCreated] Notification created for assignee", assigneeUid, "problem", problemId);
  }
);

/** Send in-app notification when problem assignee changes. */
export const onProblemUpdated = onDocumentUpdated(
  {
    document: "projects/{projectId}/problems/{problemId}",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const oldAssignee = (before.assigneeUid as string) ?? "";
    const newAssignee = (after.assigneeUid as string) ?? "";
    if (!newAssignee || oldAssignee === newAssignee) return;

    const projectId = event.params?.projectId;
    const problemId = event.params?.problemId;
    if (!projectId || !problemId) return;

    const audit = after.audit as { lastStatusByUid?: string } | undefined;
    const updatedByUid = (audit?.lastStatusByUid ?? after.createdByUid ?? "") as string;
    if (updatedByUid === newAssignee) return; // Don't notify self

    const db = admin.firestore();
    const projectSnap = await db.doc(`projects/${projectId}`).get();
    const projectName = (projectSnap.data()?.name as string) ?? "Projekt";
    const shortDescription = (after.shortDescription as string) ?? "";
    const createdByName = (after.createdByName as string) ?? "";

    const message = createdByName
      ? `${createdByName} ti priradil problém: ${shortDescription || "Bez popisu"}`
      : `Bola ti priradená úloha v projekte ${projectName}`;

    await db.collection("notifications").add({
      userId: newAssignee,
      type: "PROBLEM_ASSIGNED",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readAt: null,
      projectId,
      projectName,
      message,
      fromUserId: updatedByUid,
      fromUserName: createdByName || null,
      severity: "info",
      meta: { problemId, projectId },
      deepLink: { screen: "ProblemDetail", params: { projectId, problemId } },
    });
    log("[onProblemUpdated] Notification created for new assignee", newAssignee, "problem", problemId);
  }
);

/** Send FCM push to user's phone whenever any notification is created in Firestore. */
export const onNotificationCreated = onDocumentCreated(
  {
    document: "notifications/{notificationId}",
    region: "europe-west1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;
    const data = snap.data();
    const userId = data?.userId as string | undefined;
    const type = (data?.type as string) ?? "PROJECT_ACTIVITY";
    const message = (data?.message as string) ?? "";
    const projectId = (data?.projectId as string) ?? "";
    const projectName = (data?.projectName as string) ?? "";

    if (!userId) {
      log("[onNotificationCreated] No userId, skipping push");
      return;
    }

    const titleMap: Record<string, string> = {
      TASK_ASSIGNED: "Priradená úloha",
      TASK_DUE_TODAY: "Úloha dnes",
      TASK_OVERDUE: "Úloha po termíne",
      PROJECT_INVITED: "Pozvánka do projektu",
      PROBLEM_ASSIGNED: "Priradený problém",
      EXPENSE_ADDED: "Nový výdavok",
      PROJECT_CREATED: "Nový projekt",
      MEMBER_JOINED: "Člen vstúpil",
      MEMBER_LEFT: "Člen opustil projekt",
      MEMBER_REMOVED: "Člen bol odstránený",
      SYNC_ISSUE: "Problém so synchronizáciou",
    };
    const title = titleMap[type] ?? "Upozornenie";
    const body = message || (projectName ? `Projekt: ${projectName}` : "Máte nové upozornenie.");

    await sendPushToUser(userId, title, body, {
      type: type === "PROJECT_INVITED" ? "PROJECT_INVITE" : type,
      projectId,
    });
    log("[onNotificationCreated] Push sent to", userId, "type", type);
  }
);
