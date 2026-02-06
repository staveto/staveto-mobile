import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import vision from "@google-cloud/vision";

admin.initializeApp();

type ParsedInvoice = {
  supplierName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  totalAmount: number | null;
  vatAmount: number | null;
  currency: "EUR";
};

const visionClient = new vision.ImageAnnotatorClient();

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
    /(?:fakt[úu]ra|invoice|rechnung)\s*(?:no\.?|nr\.?|number|nummer)?\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
    /(?:č[íi]slo\s*fakt[úu]ry|invoice\s*no\.?)\s*[:#]?\s*([A-Z0-9\-\/]+)/i,
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
    if (/fakt[úu]ra|invoice|rechnung/i.test(trimmed)) continue;
    if (/\d{6,}/.test(trimmed)) continue;
    if (trimmed.length < 3) continue;
    return trimmed.slice(0, 80);
  }
  return null;
}

function parseInvoiceText(rawText: string): ParsedInvoice {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const invoiceNumber = parseInvoiceNumber(rawText);
  const issueDate = parseDate(rawText);
  const totalAmount =
    extractLineAmount(lines, /(celkom|spolu|total|summe|gesamt)/i) ?? pickLargestAmount(rawText);
  const vatAmount = extractLineAmount(lines, /(dph|vat|mwst)/i);
  const supplierName = parseSupplierName(lines);
  return {
    supplierName,
    invoiceNumber,
    issueDate,
    totalAmount,
    vatAmount,
    currency: "EUR",
  };
}

export const extractInvoiceData = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { storagePath, attachmentId } = request.data as {
      storagePath?: string;
      attachmentId?: string;
    };
    if (!storagePath || typeof storagePath !== "string") {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }

    const uid = request.auth.uid;
    const db = admin.firestore();
    const cacheCollection = db.collection("users").doc(uid).collection("ocrCache");
    const limitsRef = db.collection("users").doc(uid).collection("limits").doc("ocr");

    const [bytes] = await admin.storage().bucket().file(storagePath).download();
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");

    const cacheDoc = await cacheCollection.doc(hash).get();
    if (cacheDoc.exists) {
      const cached = cacheDoc.data() as {
        status: "success" | "failed" | "limit";
        parsed: ParsedInvoice | null;
        rawText?: string;
      };
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
      const [result] = await visionClient.documentTextDetection({
        image: { content: bytes.toString("base64") },
      });
      rawText =
        result.fullTextAnnotation?.text ??
        result.textAnnotations?.[0]?.description ??
        "";
    } catch (error) {
      const failed = { status: "failed", parsed: null as ParsedInvoice | null };
      await cacheCollection.doc(hash).set({
        ...failed,
        storagePath,
        attachmentId: attachmentId ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return failed;
    }

    if (!rawText.trim()) {
      const failed = { status: "failed", parsed: null as ParsedInvoice | null };
      await cacheCollection.doc(hash).set({
        ...failed,
        storagePath,
        attachmentId: attachmentId ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return failed;
    }

    const parsed = parseInvoiceText(rawText);
    const response = { status: "success", parsed, rawText };
    await cacheCollection.doc(hash).set({
      ...response,
      storagePath,
      attachmentId: attachmentId ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return response;
  }
);
