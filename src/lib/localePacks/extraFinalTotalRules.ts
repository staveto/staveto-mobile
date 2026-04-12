import type { FinalTotalLineRule, RegionCode } from "./types";

/** Tier-1 regional additions (prepend before BASE; ids must stay unique). */
export const EXTRA_FINAL_TOTAL_RULES_TIER1: Partial<Record<RegionCode, readonly FinalTotalLineRule[]>> = {
  PL: [
    { tier: 3, id: "pl_do_zaplaty", match: (l) => /\bdo\s*zapłaty\b/i.test(l) },
    { tier: 5, id: "pl_razem_brutto", match: (l) => /\bRazem\b/i.test(l) && /\bbrutto\b/i.test(l) },
  ],
  DE: [
    { tier: 5, id: "de_rechnungsbetrag", match: (l) => /\brechnungsbetrag\b/i.test(l) },
    { tier: 6, id: "de_zahlbetrag", match: (l) => /\bzahlbetrag\b/i.test(l) },
    { tier: 7, id: "de_gesamtbetrag", match: (l) => /\bgesamtbetrag\b/i.test(l) },
  ],
  AT: [
    { tier: 5, id: "at_gesamtbetrag", match: (l) => /\bgesamtbetrag\b/i.test(l) },
    { tier: 8, id: "at_zu_zahlen", match: (l) => /\bzu\s+zahlen\b/i.test(l) },
  ],
  US: [
    { tier: 6, id: "us_order_total", match: (l) => /\border\s*total\b/i.test(l) },
    { tier: 6, id: "us_payment_due", match: (l) => /\bpayment\s*due\b/i.test(l) },
    { tier: 7, id: "us_amount_owed", match: (l) => /\bamount\s*owed\b/i.test(l) },
  ],
  SK: [],
  CZ: [],
};

/** Tier-2 starter rules — expand over time without touching core engine. */
export const EXTRA_FINAL_TOTAL_RULES_TIER2: Partial<Record<RegionCode, readonly FinalTotalLineRule[]>> = {
  FR: [
    { tier: 3, id: "fr_net_a_payer", match: (l) => /\bnet\s*à\s*payer\b/i.test(l) },
    { tier: 5, id: "fr_montant_total", match: (l) => /\bmontant\s*total\b/i.test(l) },
    { tier: 6, id: "fr_total_ttc", match: (l) => /\btotal\s*ttc\b/i.test(l) },
  ],
  IT: [
    { tier: 4, id: "it_totale_fattura", match: (l) => /\btotale\s*(documento|fattura)\b/i.test(l) },
    { tier: 5, id: "it_importo_totale", match: (l) => /\bimporto\s*totale\b/i.test(l) },
    { tier: 6, id: "it_saldo", match: (l) => /\bsaldo\s*da\s*pagare\b/i.test(l) },
  ],
  ES: [
    { tier: 5, id: "es_importe_total", match: (l) => /\bimporte\s*total\b/i.test(l) },
    { tier: 6, id: "es_total_a_pagar", match: (l) => /\btotal\s*a\s*pagar\b/i.test(l) },
  ],
  NL: [
    { tier: 4, id: "nl_te_betalen", match: (l) => /\bte\s*betalen\b/i.test(l) },
    { tier: 5, id: "nl_totaal", match: (l) => /\btotaal\b/i.test(l) && !/\btw\b/i.test(l) },
  ],
  BE: [
    { tier: 4, id: "be_a_payer", match: (l) => /\bà\s*payer\b/i.test(l) },
    { tier: 5, id: "be_te_betalen", match: (l) => /\bte\s*betalen\b/i.test(l) },
  ],
};
