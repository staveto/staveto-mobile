/**
 * Multilingual field-label synonyms per *concept* (not locale-specific parsers).
 * Used for soft matching and scoring — never as a single brittle regex per country.
 */

import { mergeFieldSynonymsForDocument } from "../lib/localePacks";

export type FieldConcept =
  | "supplier"
  | "customer"
  | "invoiceNumber"
  | "issueDate"
  | "dueDate"
  | "total"
  | "subtotal"
  | "tax"
  | "paymentMethod"
  | "variableSymbol"
  | "receipt";

/** Labels grouped by concept; any match boosts candidate scoring for that field. */
export const FIELD_LABEL_SYNONYMS: Record<FieldConcept, readonly string[]> = {
  supplier: [
    "supplier",
    "vendor",
    "seller",
    "from",
    "dodávateľ",
    "dodavatel",
    "dodavateľ",
    "predávajúci",
    "predajca",
    "vyhotoviteľ",
    "vyhotoviteľka",
    "vyhotovil",
    "daňový doklad",
    "danovy doklad",
    "lieferant",
    "verkäufer",
    "sprzedawca",
    "dostawca",
    "eladó",
    "szállító",
  ],
  customer: [
    "customer",
    "buyer",
    "bill to",
    "ship to",
    "odberateľ",
    "odberatel",
    "odběratel",
    "kunde",
    "käufer",
    "nabywca",
    "vevő",
    "megrendelő",
  ],
  invoiceNumber: [
    "invoice no",
    "invoice #",
    "invoice number",
    "inv no",
    "rechnungsnr",
    "rechnungs-nr",
    "rechnung nr",
    "faktúra č",
    "faktura č",
    "číslo faktúry",
    "číslo faktury",
    "č. faktury",
    "fa č",
    "fv č",
    "factuur",
    "factuurnummer",
    "numer faktury",
    "számla szám",
    "számlaszám",
  ],
  issueDate: [
    "issue date",
    "date of issue",
    "invoice date",
    "dated",
    "datum vystavenia",
    "datum vystavení",
    "dátum vystavenia",
    "ausstellungsdatum",
    "rechnungsdatum",
    "data wystawienia",
    "kiállítás dátuma",
    "kelt",
  ],
  dueDate: [
    "due date",
    "pay by",
    "payment due",
    "splatnosť",
    "splatnost",
    "datum splatnosti",
    "dátum splatnosti",
    "fällig",
    "fällig am",
    "zahlbar bis",
    "termin płatności",
    "esedékesség",
    "fizetési határidő",
  ],
  total: [
    "total due",
    "amount due",
    "balance due",
    "grand total",
    "total",
    "to pay",
    "k úhrade",
    "k úhradě",
    "k uhradě",
    "celkom",
    "celkem",
    "spolu",
    "razem",
    "suma",
    "összesen",
    "fizetendő",
    "brutto",
    "gesamt",
    "endsumme",
    "rechnungsbetrag",
    "zu zahlen",
    "montant",
    "total ttc",
    "importe total",
  ],
  subtotal: [
    "subtotal",
    "net",
    "základ",
    "základ dph",
    "bez dph",
    "netto",
    "zwischensumme",
    "podsuma",
    "részösszeg",
  ],
  tax: [
    "tax",
    "vat",
    "dph",
    "mwst",
    "ust",
    "btw",
    "áfa",
    "podatek",
  ],
  paymentMethod: [
    "payment",
    "payment method",
    "paid by",
    "spôsob úhrady",
    "způsob úhrady",
    "zahlungsart",
    "forma płatności",
    "fizetés módja",
  ],
  variableSymbol: [
    "variable symbol",
    "variabilný symbol",
    "variabilní symbol",
    "vs",
    "symb. var",
  ],
  receipt: [
    "receipt",
    "quittung",
    "paragon",
    "účtenka",
    "blokk",
    "potvrdenka",
    "cash register",
    "bon",
    "beleg",
  ],
};

/**
 * Base synonyms + `localePacks` extras for detected regions (EU/US Tier 1–2).
 * Pass normalized OCR text; omit to use base dictionary only.
 */
export function getEffectiveFieldSynonyms(
  rawText?: string | null
): Record<FieldConcept, readonly string[]> {
  if (!rawText || typeof rawText !== "string") {
    return FIELD_LABEL_SYNONYMS;
  }
  return mergeFieldSynonymsForDocument(rawText, FIELD_LABEL_SYNONYMS);
}
