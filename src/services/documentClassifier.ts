import type { ParsedDocumentType } from "../lib/parsedDocumentTypes";
import { getEffectiveFieldSynonyms } from "./documentFieldDictionary";

function countInsensitive(haystack: string, needles: readonly string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const needle of needles) {
    if (needle.length < 2) continue;
    const q = needle.toLowerCase();
    let pos = 0;
    while (pos < h.length) {
      const i = h.indexOf(q, pos);
      if (i < 0) break;
      n += 1;
      pos = i + q.length;
    }
  }
  return n;
}

/**
 * Lightweight multilingual document classification from plain text (no layout).
 */
export function classifyDocumentFromText(rawText: string | null | undefined): ParsedDocumentType {
  if (!rawText || typeof rawText !== "string" || rawText.length < 12) {
    return "unknown";
  }
  const t = rawText.slice(0, 12000);
  const syn = getEffectiveFieldSynonyms(t);

  const creditNoteHints =
    /\b(dobropis|dobropisu|credit\s*note|creditnota|gutschrift|storno\s*faktur|storno\s*faktúr|opravný\s*doklad|credit\s*memo)\b/i.test(
      t
    );
  if (creditNoteHints) return "credit_note";

  const receiptScore = countInsensitive(t, syn.receipt);
  const invScore =
    countInsensitive(t, syn.invoiceNumber) +
    countInsensitive(t, syn.supplier) +
    countInsensitive(t, syn.customer) +
    countInsensitive(t, syn.dueDate);

  const quoteHints = /\b(quote|angebot|offerte|cenová\s*nabídka|cenová\s*ponuka|kostenvoranschlag)\b/i.test(
    t
  );
  const deliveryHints = /\b(delivery\s*note|dodací\s*list|dodací\s*list|dodací|packing\s*slip|liefer|lieferschein)\b/i.test(
    t
  );

  if (deliveryHints && !quoteHints) return "delivery_note";
  if (quoteHints) return "quote";

  if (receiptScore >= 2 && invScore < 2) return "receipt";
  if (invScore >= 2 || /\b(invoice|rechnung|faktúra|faktura|factuur)\b/i.test(t)) {
    return receiptScore >= 3 && invScore < 2 ? "receipt" : "invoice";
  }
  if (receiptScore >= 1) return "receipt";

  return "unknown";
}
