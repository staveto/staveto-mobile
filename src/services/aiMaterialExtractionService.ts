/**
 * AI material extraction from invoice OCR text via Cloud Function.
 */
import { getCallable } from "../firebase";
import type { MaterialCategory, MaterialConfidence } from "../lib/types";
import {
  inferMaterialCategoryFromName,
  normalizeMaterialUnit,
  parseMaterialCategory,
  resolveMaterialCurrency,
  shouldRejectOcrMaterialImportItem,
} from "../lib/materialCatalog";
import type { ParsedDocumentLineItem } from "../lib/parsedDocumentTypes";

export type AiExtractedMaterialItem = {
  name: string;
  category?: MaterialCategory;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  confidence?: MaterialConfidence;
  sourceNote?: string;
  originalText?: string;
};

export type ExtractMaterialItemsFromInvoiceInput = {
  projectId: string;
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

type CloudMaterialItem = {
  name?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  confidence?: "low" | "medium" | "high";
  sourceNote?: string;
  originalText?: string;
};

type CloudResponse = {
  materialItems?: CloudMaterialItem[];
  warnings?: string[];
};

function mapCloudItem(row: CloudMaterialItem, currencyHint?: string): AiExtractedMaterialItem | null {
  const name = row.name?.trim() ?? "";
  if (!name) return null;
  const category =
    parseMaterialCategory(row.category) ?? inferMaterialCategoryFromName(name);
  const unit = row.unit ? normalizeMaterialUnit(row.unit).unit : undefined;
  const candidate = {
    description: name,
    category,
    unit,
    originalUnit: row.unit,
  };
  if (shouldRejectOcrMaterialImportItem(candidate)) return null;

  return {
    name,
    category,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
    currency: resolveMaterialCurrency({
      expenseCurrency: row.currency ?? currencyHint,
    }),
    confidence: row.confidence,
    sourceNote: row.sourceNote,
    originalText: row.originalText,
  };
}

/** Calls `extractMaterialItemsFromInvoice` callable. Returns [] on failure — never throws. */
export async function extractMaterialItemsFromInvoice(
  input: ExtractMaterialItemsFromInvoiceInput
): Promise<AiExtractedMaterialItem[]> {
  const rawText = input.rawText?.trim() ?? "";
  if (!input.projectId?.trim() || rawText.length < 40) return [];

  try {
    const fn = getCallable<ExtractMaterialItemsFromInvoiceInput, CloudResponse>(
      "extractMaterialItemsFromInvoice",
      { timeoutMs: 65_000 }
    );
    const result = await fn({
      ...input,
      rawText: rawText.slice(0, 12_000),
    });
    const data = (result as { data?: CloudResponse })?.data ?? (result as CloudResponse);
    const rows = Array.isArray(data?.materialItems) ? data.materialItems : [];
    const out: AiExtractedMaterialItem[] = [];
    for (const row of rows) {
      const mapped = mapCloudItem(row, input.currencyHint);
      if (mapped) out.push(mapped);
    }
    if (__DEV__) {
      console.log("[aiMaterialExtraction] items", out.length, data?.warnings ?? []);
    }
    return out;
  } catch (err) {
    if (__DEV__) {
      console.warn("[aiMaterialExtraction] extractMaterialItemsFromInvoice failed", err);
    }
    return [];
  }
}

export function parsedLineItemToCandidate(item: ParsedDocumentLineItem): AiExtractedMaterialItem | null {
  const name = item.description?.trim() ?? "";
  if (!name) return null;
  if (shouldRejectOcrMaterialImportItem(item)) return null;
  return {
    name,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit ?? item.originalUnit,
    unitPrice: item.unitPrice,
    totalPrice: item.total,
    currency: item.currency,
    confidence:
      item.confidence != null && item.confidence >= 0.75
        ? "high"
        : item.confidence != null && item.confidence >= 0.6
          ? "medium"
          : "low",
  };
}
