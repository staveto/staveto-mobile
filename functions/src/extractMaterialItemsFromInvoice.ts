/**
 * Callable — extract structured material line items from invoice OCR text via Gemini.
 * Region: europe-west1. Secret: GOOGLE_GENERATIVE_AI_API_KEY
 */
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

const geminiApiKey = defineSecret("GOOGLE_GENERATIVE_AI_API_KEY");

const FN_VERSION = "extractMaterialItemsFromInvoice-v1";
const MAX_RAW_TEXT_CHARS = 12_000;
const MAX_ITEMS = 40;

const MATERIAL_CATEGORIES = new Set([
  "cable",
  "electrical_component",
  "installation_box",
  "breaker_or_protection",
  "connector",
  "fastener",
  "pipe_or_conduit",
  "board_or_panel",
  "insulation",
  "adhesive_or_sealant",
  "paint_or_coating",
  "concrete_or_mortar",
  "wood",
  "metal",
  "plumbing",
  "hvac",
  "tool_accessory",
  "consumable",
  "other_material",
  "service_or_labor",
  "transport",
  "discount",
  "unknown",
]);

const UNIT_ONLY =
  /^(ks|kus|pc|pcs|stk|st|m2|m3|m|kg|g|l|lt|bal|pack|box|hod|h|hour|set|pair|eur|€|usd|chf|czk|pln|gbp|mj)$/i;

const HEADER_ONLY =
  /^(popis|description|názov|nazov|name|množstvo|mnozstvo|qty|quantity|cena|amount|suma|total|spolu|dph|vat|tax|mj|popis)$/i;

type ExtractInput = {
  projectId?: string;
  expenseId?: string;
  attachmentId?: string;
  storagePath?: string;
  rawText?: string;
  fileName?: string;
  mimeType?: string;
  currencyHint?: string;
  localeHint?: string;
  supplierName?: string;
};

type MaterialItemOut = {
  name: string;
  category: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  confidence: "low" | "medium" | "high";
  sourceNote?: string;
  originalText?: string;
};

function normalizeNameForReject(name: string): string {
  let t = name.normalize("NFKC").trim().toLowerCase();
  t = t.replace(/[.,:;]+$/g, "").trim();
  t = t.replace("m²", "m2").replace("m³", "m3");
  return t;
}

function isInvalidMaterialName(name: string): boolean {
  const t = normalizeNameForReject(name);
  if (!t || t.length < 3) return true;
  if (UNIT_ONLY.test(t)) return true;
  if (HEADER_ONLY.test(t)) return true;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  return false;
}

function parseNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return undefined;
}

function normalizeConfidence(v: unknown): "low" | "medium" | "high" {
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function normalizeCategory(v: unknown): string {
  if (typeof v === "string" && MATERIAL_CATEGORIES.has(v)) return v;
  return "other_material";
}

function sanitizeItem(raw: Record<string, unknown>, currencyHint?: string): MaterialItemOut | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || isInvalidMaterialName(name)) return null;

  const category = normalizeCategory(raw.category);
  if (["service_or_labor", "transport", "discount"].includes(category)) return null;

  let quantity = parseNum(raw.quantity);
  const unitPrice = parseNum(raw.unitPrice);
  let totalPrice = parseNum(raw.totalPrice);
  if (totalPrice == null && quantity != null && unitPrice != null) {
    totalPrice = Math.round(quantity * unitPrice * 100) / 100;
  }

  const unit = typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim().slice(0, 24) : undefined;
  let currency =
    typeof raw.currency === "string" && /^[A-Z]{3}$/i.test(raw.currency.trim())
      ? raw.currency.trim().toUpperCase()
      : undefined;
  if (!currency && currencyHint && /^[A-Z]{3}$/i.test(currencyHint.trim())) {
    currency = currencyHint.trim().toUpperCase();
  }

  const confidence = normalizeConfidence(raw.confidence);
  if (category === "unknown" && confidence === "low") return null;

  return {
    name: name.slice(0, 200),
    category,
    quantity,
    unit,
    unitPrice,
    totalPrice,
    currency,
    confidence,
    sourceNote: typeof raw.sourceNote === "string" ? raw.sourceNote.slice(0, 300) : undefined,
    originalText: typeof raw.originalText === "string" ? raw.originalText.slice(0, 300) : undefined,
  };
}

function buildPrompt(input: ExtractInput, rawText: string): string {
  const hints: string[] = [];
  if (input.currencyHint) hints.push(`Currency hint: ${input.currencyHint}`);
  if (input.localeHint) hints.push(`Locale hint: ${input.localeHint}`);
  if (input.supplierName) hints.push(`Supplier: ${input.supplierName}`);
  if (input.fileName) hints.push(`File: ${input.fileName}`);

  return `You extract REAL MATERIAL / PRODUCT line items from invoice or receipt OCR text.
Return ONLY valid JSON (no markdown):
{"materialItems":[{"name":"...","category":"...","quantity":1,"unit":"pcs","unitPrice":1.2,"totalPrice":1.2,"currency":"EUR","confidence":"medium","sourceNote":"...","originalText":"..."}],"warnings":[]}

Rules:
- Extract only purchasable materials/products (cables, pipes, boxes, fasteners, paint, wood, etc.).
- Do NOT return VAT, tax, subtotals, totals, discounts, deposits, labor, transport, payment info, invoice numbers, addresses, or column headers.
- Do NOT return unit-only names: bal, bal., ks, pcs, m, kg, l, hod, pack, etc.
- Use categories from: ${[...MATERIAL_CATEGORIES].join(", ")}.
- Prefer material-like categories; use service_or_labor/transport/discount only if clearly not a product (then omit instead).
- Keep detected invoice currency; do not invent prices.
- If quantity unclear, omit quantity.
- If unitPrice unclear but totalPrice exists, return totalPrice only.
- If uncertain, omit item or set confidence "low".
- Maximum ${MAX_ITEMS} items.

${hints.length ? hints.join("\n") + "\n\n" : ""}OCR TEXT:
${rawText}`;
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) throw new Error("Gemini empty response");
  return text.trim();
}

export const extractMaterialItemsFromInvoice = onCall(
  {
    region: "europe-west1",
    secrets: [geminiApiKey],
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const input = (request.data ?? {}) as ExtractInput;
    const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
    if (!projectId) {
      throw new HttpsError("invalid-argument", "projectId is required.");
    }

    const rawText = typeof input.rawText === "string" ? input.rawText.trim().slice(0, MAX_RAW_TEXT_CHARS) : "";
    if (rawText.length < 40) {
      return { materialItems: [] as MaterialItemOut[], warnings: ["RAW_TEXT_TOO_SHORT"], fnVersion: FN_VERSION };
    }

    const apiKey = geminiApiKey.value();
    if (!apiKey?.trim()) {
      logger.warn("extractMaterialItemsFromInvoice: GEMINI key missing");
      return { materialItems: [], warnings: ["GEMINI_NOT_CONFIGURED"], fnVersion: FN_VERSION };
    }

    try {
      const prompt = buildPrompt(input, rawText);
      const jsonText = await callGemini(apiKey, prompt);
      let parsed: { materialItems?: unknown[]; warnings?: unknown[] } = {};
      try {
        parsed = JSON.parse(jsonText) as typeof parsed;
      } catch {
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]) as typeof parsed;
        else throw new Error("Invalid JSON from model");
      }

      const warnings: string[] = Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((w): w is string => typeof w === "string")
        : [];

      const items: MaterialItemOut[] = [];
      const seen = new Set<string>();
      if (Array.isArray(parsed.materialItems)) {
        for (const row of parsed.materialItems) {
          if (!row || typeof row !== "object") continue;
          const item = sanitizeItem(row as Record<string, unknown>, input.currencyHint);
          if (!item) continue;
          const key = `${item.name.toLowerCase()}|${item.totalPrice ?? ""}|${item.currency ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(item);
          if (items.length >= MAX_ITEMS) break;
        }
      }

      logger.info("extractMaterialItemsFromInvoice done", {
        fnVersion: FN_VERSION,
        uid: request.auth.uid,
        projectId,
        rawLen: rawText.length,
        itemCount: items.length,
      });

      return { materialItems: items, warnings, fnVersion: FN_VERSION };
    } catch (err) {
      logger.warn("extractMaterialItemsFromInvoice failed", { err: String(err), fnVersion: FN_VERSION });
      return {
        materialItems: [] as MaterialItemOut[],
        warnings: ["AI_EXTRACTION_FAILED"],
        fnVersion: FN_VERSION,
      };
    }
  }
);
