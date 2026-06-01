/**
 * Merge regex OCR line items + AI extraction, persist as materialSuggestions, open review sheet.
 */
import type { ParsedDocumentLineItem } from "../lib/parsedDocumentTypes";
import type { MaterialConfidence, MaterialSuggestionSource } from "../lib/types";
import {
  inferMaterialCategoryFromName,
  normalizeMaterialUnit,
  parseMaterialCategory,
  resolveMaterialCurrency,
} from "../lib/materialCatalog";
import {
  extractMaterialItemsFromInvoice,
  parsedLineItemToCandidate,
  type AiExtractedMaterialItem,
} from "./aiMaterialExtractionService";
import {
  createMaterialSuggestion,
  findExistingMaterialNamesForAttachment,
  type CreateMaterialSuggestionInput,
  type MaterialSuggestionDoc,
} from "./projectMaterials";
import type { ExpenseMaterialImportContext } from "../components/ExpenseLineItemsMaterialImportSheet";

export type InvoiceMaterialImportParams = {
  projectId: string;
  expenseId: string;
  attachmentId: string;
  storagePath?: string;
  rawText?: string;
  fileName?: string;
  mimeType?: string;
  currency: string;
  supplierName?: string;
  expenseTitle?: string;
  expenseDate?: string;
  localeHint?: string;
  regexLineItems?: ParsedDocumentLineItem[];
  aiSourceNote?: string;
};

function candidateKey(name: string, totalPrice?: number, currency?: string): string {
  return `${name.trim().toLowerCase()}|${totalPrice ?? ""}|${(currency ?? "").toUpperCase()}`;
}

function mergeCandidates(
  regexItems: ParsedDocumentLineItem[],
  aiItems: AiExtractedMaterialItem[]
): Array<AiExtractedMaterialItem & { source: MaterialSuggestionSource }> {
  const merged = new Map<string, AiExtractedMaterialItem & { source: MaterialSuggestionSource }>();

  for (const item of regexItems) {
    const c = parsedLineItemToCandidate(item);
    if (!c) continue;
    const key = candidateKey(c.name, c.totalPrice, c.currency);
    if (!merged.has(key)) merged.set(key, { ...c, source: "ocr" });
  }

  for (const item of aiItems) {
    const key = candidateKey(item.name, item.totalPrice, item.currency);
    const prev = merged.get(key);
    if (!prev || prev.source === "ocr") {
      merged.set(key, { ...item, source: "ai" });
    }
  }

  return [...merged.values()];
}

function toCreateInput(
  c: AiExtractedMaterialItem & { source: MaterialSuggestionSource },
  ctx: InvoiceMaterialImportParams,
  sourceNote: string
): CreateMaterialSuggestionInput {
  const unit = c.unit ? normalizeMaterialUnit(c.unit).unit : undefined;
  return {
    name: c.name,
    category: c.category ?? parseMaterialCategory(c.category) ?? inferMaterialCategoryFromName(c.name),
    suggestedQuantity: c.quantity,
    unit,
    estimatedUnitPrice: c.unitPrice,
    estimatedTotalPrice: c.totalPrice,
    currency: resolveMaterialCurrency({ expenseCurrency: c.currency ?? ctx.currency }),
    source: c.source,
    confidence: c.confidence as MaterialConfidence | undefined,
    sourceDocumentId: ctx.attachmentId,
    sourceExpenseId: ctx.expenseId,
    sourceNote,
  };
}

/**
 * Runs regex + AI extraction, saves new suggestions, returns sheet context (or null if nothing to show).
 */
export async function runInvoiceMaterialImportAfterExpense(
  params: InvoiceMaterialImportParams
): Promise<ExpenseMaterialImportContext | null> {
  const { projectId, expenseId, attachmentId } = params;
  if (!projectId || !expenseId || !attachmentId) return null;

  const regexItems = params.regexLineItems ?? [];
  let aiItems: AiExtractedMaterialItem[] = [];

  if (params.rawText && params.rawText.trim().length >= 40) {
    aiItems = await extractMaterialItemsFromInvoice({
      projectId,
      expenseId,
      attachmentId,
      storagePath: params.storagePath,
      rawText: params.rawText,
      fileName: params.fileName,
      mimeType: params.mimeType,
      currencyHint: params.currency,
      localeHint: params.localeHint,
      supplierName: params.supplierName,
    });
  }

  const candidates = mergeCandidates(regexItems, aiItems);
  if (candidates.length === 0) return null;

  const existing = await findExistingMaterialNamesForAttachment(projectId, attachmentId);
  const sourceNoteAi = params.aiSourceNote ?? "Imported from invoice AI";
  const saved: MaterialSuggestionDoc[] = [];

  for (const c of candidates) {
    const nameKey = c.name.trim().toLowerCase();
    if (existing.suggestionNames.has(nameKey) || existing.materialNames.has(nameKey)) continue;

    const note =
      c.source === "ai"
        ? sourceNoteAi
        : c.sourceNote ?? "Imported from expense OCR";
    const doc = await createMaterialSuggestion(projectId, toCreateInput(c, params, note));
    saved.push(doc);
    existing.suggestionNames.add(nameKey);
  }

  if (saved.length === 0) return null;

  return {
    projectId,
    expenseId,
    attachmentId,
    currency: params.currency || "EUR",
    supplierName: params.supplierName,
    expenseTitle: params.expenseTitle,
    expenseDate: params.expenseDate,
    variant: "savedReview",
    savedSuggestions: saved,
    aiExtractionAttempted: aiItems.length > 0 || !!(params.rawText && params.rawText.length >= 40),
  };
}
