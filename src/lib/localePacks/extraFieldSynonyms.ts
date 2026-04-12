import type { RegionCode } from "./types";

/** Extra FIELD_LABEL_SYNONYMS strings per region (lowercase matching in caller). */
export const EXTRA_FIELD_SYNONYMS: Partial<
  Record<
    RegionCode,
    Partial<{
      supplier: readonly string[];
      customer: readonly string[];
      invoiceNumber: readonly string[];
      issueDate: readonly string[];
      dueDate: readonly string[];
      total: readonly string[];
      subtotal: readonly string[];
      tax: readonly string[];
      receipt: readonly string[];
    }>
  >
> = {
  US: {
    supplier: ["vendor", "remit to", "sold by", "from:"],
    invoiceNumber: ["invoice #", "inv #", "bill no", "bill #"],
    issueDate: ["bill date", "service date"],
    dueDate: ["pay by", "payment terms"],
    total: ["order total", "payment due", "amount owed"],
    receipt: ["sales receipt", "cash receipt"],
  },
  DE: {
    supplier: ["lieferant", "verkäufer", "aussteller"],
    invoiceNumber: ["rechnungsnr", "rechnungs-nr"],
    issueDate: ["rechnungsdatum", "leistungsdatum"],
    dueDate: ["zahlbar bis", "fällig am"],
    total: ["endsumme", "gesamtbetrag", "summe brutto"],
  },
  PL: {
    supplier: ["sprzedawca", "dostawca"],
    invoiceNumber: ["numer faktury", "nr faktury"],
    dueDate: ["termin płatności"],
    total: ["wartość brutto", "razem do zapłaty"],
  },
  FR: {
    supplier: ["fournisseur", "émetteur", "vendeur"],
    invoiceNumber: ["n° de facture", "numéro de facture"],
    issueDate: ["date de facture", "émis le"],
    dueDate: ["date d'échéance", "échéance"],
    total: ["total ttc", "net à payer", "montant total"],
  },
  IT: {
    supplier: ["fornitore", "cedente", "venditore"],
    invoiceNumber: ["numero fattura", "n. fattura"],
    issueDate: ["data fattura", "data emissione"],
    dueDate: ["data scadenza", "scadenza"],
    total: ["totale documento", "importo totale"],
  },
  ES: {
    supplier: ["proveedor", "emisor", "vendedor"],
    invoiceNumber: ["número de factura", "nº factura"],
    issueDate: ["fecha de factura", "fecha emisión"],
    dueDate: ["fecha de vencimiento", "vencimiento"],
    total: ["importe total", "total a pagar"],
  },
  NL: {
    supplier: ["leverancier", "verkoper"],
    invoiceNumber: ["factuurnummer", "factuur nr"],
    dueDate: ["vervaldatum", "uiterste betaaldatum"],
    total: ["te betalen", "totaalbedrag"],
  },
  BE: {
    supplier: ["fournisseur", "leverancier"],
    total: ["total à payer", "te betalen"],
  },
  AT: {
    supplier: ["lieferant", "aussteller"],
    total: ["gesamtbetrag", "summe"],
  },
  SK: {},
  CZ: {},
};
