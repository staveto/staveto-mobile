import type { LocaleDetectionResult, RegionCode } from "./types";

type Probe = { code: RegionCode; weight: number; hint: string; test: (t: string) => boolean };

const PROBES: readonly Probe[] = [
  { code: "SK", weight: 4, hint: "sk_tokens", test: (t) => /\b(ičo|ič\s*dph|dič|slovensko|slovenská\s*republika|sk\d{10})\b/i.test(t) },
  { code: "CZ", weight: 4, hint: "cz_tokens", test: (t) => /\b(ičo|dič|česká\s*republika|česká\s*rep\.|czech\s*republic|cz\d{8,10})\b/i.test(t) },
  { code: "DE", weight: 4, hint: "de_tokens", test: (t) => /\b(ust[\s-]?id[\s-]?nr|u\.?\s*st[\s-]?id|de\d{9}|bundesrepublik|deutschland)\b/i.test(t) },
  { code: "AT", weight: 3, hint: "at_tokens", test: (t) => /\b(at\s*u\s*\d{8}|uid\s*nummer|österreich|austria)\b/i.test(t) },
  { code: "PL", weight: 4, hint: "pl_tokens", test: (t) => /\b(nip|polska|poland|pl\d{10})\b/i.test(t) },
  { code: "US", weight: 4, hint: "us_tax", test: (t) => /\b(ein|irs|tin|ss-?4|form\s*1099|w-?9|sales\s*tax\s*id)\b/i.test(t) },
  { code: "US", weight: 2, hint: "us_money", test: (t) => /\bUSD\b|\$\s*\d/.test(t) },
  { code: "FR", weight: 3, hint: "fr_tokens", test: (t) => /\b(siret|siren|tva\s*fr|france|facture)\b/i.test(t) },
  { code: "IT", weight: 3, hint: "it_tokens", test: (t) => /\b(partita\s*iva|p\.?\s*iva|codice\s*fiscale|italia|italy)\b/i.test(t) },
  { code: "ES", weight: 3, hint: "es_tokens", test: (t) => /\b(nif|cif|iva|españa|spain)\b/i.test(t) },
  { code: "NL", weight: 3, hint: "nl_tokens", test: (t) => /\b(kvk|btw\s*-?id|nederland|netherlands)\b/i.test(t) },
  { code: "BE", weight: 3, hint: "be_tokens", test: (t) => /\b(ondernemingsnummer|tvac|belgium|belgië|belgique)\b/i.test(t) },
];

const TIER1: ReadonlySet<RegionCode> = new Set(["SK", "CZ", "DE", "AT", "PL", "US"]);

/**
 * Lightweight region hints from OCR text (no external geo-IP).
 * Used to pick extra label rules and synonym packs — never as sole proof of jurisdiction.
 */
export function detectLocaleContext(rawText: string): LocaleDetectionResult {
  if (!rawText || typeof rawText !== "string") {
    return { regions: [], hints: [] };
  }
  const t = rawText.slice(0, 24_000);
  const hits: Array<{ code: RegionCode; weight: number; hint: string }> = [];
  const hints: string[] = [];
  for (const p of PROBES) {
    if (p.test(t)) {
      hits.push({ code: p.code, weight: p.weight, hint: p.hint });
      if (!hints.includes(p.hint)) hints.push(p.hint);
    }
  }
  hits.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const a1 = TIER1.has(a.code) ? 0 : 1;
    const b1 = TIER1.has(b.code) ? 0 : 1;
    if (a1 !== b1) return a1 - b1;
    return a.code.localeCompare(b.code);
  });
  const seen = new Set<RegionCode>();
  const regions: RegionCode[] = [];
  for (const h of hits) {
    if (seen.has(h.code)) continue;
    seen.add(h.code);
    regions.push(h.code);
    if (regions.length >= 6) break;
  }
  return { regions, hints };
}
