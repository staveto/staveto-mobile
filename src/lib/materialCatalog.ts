import type {
  MaterialCategory,
  MaterialConfidence,
  MaterialSuggestionSource,
  MaterialUnit,
} from "./types";

/** Canonical units stored on material documents. */
export const MATERIAL_UNITS: MaterialUnit[] = [
  "pcs",
  "m",
  "m2",
  "m3",
  "kg",
  "g",
  "l",
  "pack",
  "box",
  "roll",
  "hour",
  "set",
  "pair",
  "other",
];

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
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
  "transport",
  "service_or_labor",
  "discount",
  "other_material",
  "unknown",
];

const CATEGORY_KEYWORDS: Array<{ category: MaterialCategory; patterns: RegExp[] }> = [
  { category: "cable", patterns: [/\b(kábl|kabl|cable|dr[oô]t|wire|leitung|vodič|vodic)\b/i] },
  {
    category: "electrical_component",
    patterns: [/\b(istič|istič|breaker|zásuvk|zásuvk|socket|switch|vypínač|vypinac|relay|contactor|led|lamp)\b/i],
  },
  { category: "installation_box", patterns: [/\b(inštalač|instalač|junction\s*box|rozboč|krabic|box)\b/i] },
  {
    category: "breaker_or_protection",
    patterns: [/\b(fi\s|rcd|rcbo|spd|surge|fuse|poistk|jistič|jistic|schutz)\b/i],
  },
  { category: "connector", patterns: [/\b(konektor|connector|wago|svork|terminal|zásuv|zásuv)\b/i] },
  { category: "fastener", patterns: [/\b(šroub|skrut|screw|bolt|nat|hmožd|hmožd|anchor|klip|clip)\b/i] },
  { category: "pipe_or_conduit", patterns: [/\b(rúr|trubk|pipe|conduit|potrub|kanálik|kanalik|pvc\s*trub)\b/i] },
  { category: "board_or_panel", patterns: [/\b(dosk|board|panel|dsp|osb|sadrokart|drywall|plywood)\b/i] },
  { category: "insulation", patterns: [/\b(izol|insul|mineral|wool|polystyr|eps|xps|pur)\b/i] },
  { category: "adhesive_or_sealant", patterns: [/\b(lepid|seal|silikon|silicone|tmel|adhesive|kit)\b/i] },
  { category: "paint_or_coating", patterns: [/\b(farba|paint|coat|lak|nátěr|nater|emulz)\b/i] },
  { category: "concrete_or_mortar", patterns: [/\b(betón|beton|concrete|mortar|malta|cement)\b/i] },
  { category: "wood", patterns: [/\b(drevo|dřevo|wood|timber|lat|hranol|prkno)\b/i] },
  { category: "metal", patterns: [/\b(oceľ|ocel|steel|hliník|hlinik|alumin|metal|plech|profil)\b/i] },
  { category: "plumbing", patterns: [/\b(vodovod|sanit|wc|umyv|sifon|kohútik|kohoutik|tap|fitting)\b/i] },
  { category: "hvac", patterns: [/\b(klim|hvac|ventil|kurenie|kúren|heating|radiátor|radiator|potrubie)\b/i] },
  { category: "tool_accessory", patterns: [/\b(vrták|vrtak|bit|disc|kotúč|kotuc|blade|tool)\b/i] },
  { category: "consumable", patterns: [/\b(sprej|tape|páska|paska|gloves|rukav|brus|abrasive)\b/i] },
  { category: "transport", patterns: [/\b(doprav|transport|delivery|poštov|postage|shipping)\b/i] },
  {
    category: "service_or_labor",
    patterns: [/\b(práca|praca|labor|montáž|montaz|inštalač|instalac|service|hodin|hourly|fee)\b/i],
  },
  { category: "discount", patterns: [/\b(zľav|zlev|discount|rabat|rebate|bonus)\b/i] },
];

const UNIT_ONLY_NAME =
  /^(ks|kus|kusy|pc|pcs|stk|st|m2|m²|m3|m³|m|kg|g|l|lt|bal|pack|box|hod|h|hour|set|pair|eur|€|usd|chf|czk|pln|gbp|mj)$/i;

const HEADER_OR_META_NAME =
  /^(popis|description|názov|nazov|name|množstvo|mnozstvo|qty|quantity|j\.?c\.?|unit\s*price|cena|amount|suma|total|spolu|celkom|celkem|dph|vat|tax|ean|barcode|kód|kod|poznámka|poznamka|note|mj)$/i;

/** Normalize OCR line text before unit/header rejection checks. */
export function normalizeMaterialLineNameForValidation(name: string): string {
  let t = name.normalize("NFKC").trim().toLowerCase();
  t = t.replace(/^[\[(【「『]+|[\])】」』]+$/g, "").trim();
  t = t.replace(/[.,:;]+$/g, "").trim();
  t = t.replace(/\s+/g, " ");
  t = t.replace("m²", "m2").replace("m³", "m3");
  return t;
}

export function normalizeMaterialUnit(raw?: string): { unit: MaterialUnit; originalUnit?: string } {
  if (!raw?.trim()) return { unit: "pcs" };
  const original = raw.trim();
  const u = original.toLowerCase().replace(/\./g, "").replace("m²", "m2").replace("m³", "m3");
  if (["ks", "kus", "kusy", "pc", "pcs", "st", "stk", "stück", "stuck", "piece", "pieces"].includes(u)) {
    return { unit: "pcs", originalUnit: original };
  }
  if (u === "m2") return { unit: "m2", originalUnit: original };
  if (u === "m3") return { unit: "m3", originalUnit: original };
  if (u === "m" || u === "bm") return { unit: "m", originalUnit: original };
  if (u === "kg") return { unit: "kg", originalUnit: original };
  if (u === "g") return { unit: "g", originalUnit: original };
  if (u === "l" || u === "lt") return { unit: "l", originalUnit: original };
  if (["pack", "bal", "balenie", "pkg", "box"].includes(u)) return { unit: u === "box" ? "box" : "pack", originalUnit: original };
  if (["roll", "rol", "rola"].includes(u)) return { unit: "roll", originalUnit: original };
  if (["hod", "h", "hour", "hr", "std"].includes(u)) return { unit: "hour", originalUnit: original };
  if (["set", "sada", "kit"].includes(u)) return { unit: "set", originalUnit: original };
  if (["pair", "par"].includes(u)) return { unit: "pair", originalUnit: original };
  return { unit: "other", originalUnit: original };
}

export function parseMaterialUnit(value: unknown): MaterialUnit | undefined {
  if (typeof value !== "string") return undefined;
  return (MATERIAL_UNITS as readonly string[]).includes(value)
    ? (value as MaterialUnit)
    : normalizeMaterialUnit(value).unit;
}

export function parseMaterialCategory(value: unknown): MaterialCategory | undefined {
  if (typeof value !== "string") return undefined;
  return (MATERIAL_CATEGORIES as readonly string[]).includes(value)
    ? (value as MaterialCategory)
    : undefined;
}

export function parseMaterialSource(value: unknown): MaterialSuggestionSource {
  if (value === "ai" || value === "ocr" || value === "document" || value === "manual") return value;
  return "manual";
}

export function inferMaterialCategoryFromName(name: string): MaterialCategory {
  const text = name.trim();
  if (!text) return "unknown";
  for (const row of CATEGORY_KEYWORDS) {
    if (row.patterns.some((re) => re.test(text))) return row.category;
  }
  return "other_material";
}

export function isInvalidMaterialLineName(name: string): boolean {
  const t = normalizeMaterialLineNameForValidation(name);
  if (!t) return true;
  if (t.length < 3) return true;
  if (UNIT_ONLY_NAME.test(t)) return true;
  if (HEADER_OR_META_NAME.test(t)) return true;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/^(eur|usd|chf|czk|pln|gbp|€|\$)\s*\d/i.test(t)) return true;
  return false;
}

/** Strip a leading unit token (e.g. bal.) when OCR leaves it in the description column. */
export function stripUnitTokenFromDescription(description: string, rawUnit?: string): string {
  if (!rawUnit?.trim()) return description.trim();
  let desc = description.trim();
  const escaped = rawUnit.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("m²", "m2").replace("m³", "m3");
  desc = desc.replace(new RegExp(`^${escaped}\\.?\\s*`, "i"), "").trim();
  if (new RegExp(`^${escaped}\\.?$`, "i").test(desc)) return "";
  return desc;
}

export function shouldRejectOcrMaterialImportItem(item: {
  description?: string;
  unit?: string;
  originalUnit?: string;
}): boolean {
  const description = item.description?.trim() ?? "";
  if (!description) return true;
  if (isInvalidMaterialLineName(description)) return true;

  const descNorm = normalizeMaterialLineNameForValidation(description);
  const unitTokens = new Set<string>();
  for (const token of [item.originalUnit, item.unit]) {
    if (!token?.trim()) continue;
    unitTokens.add(normalizeMaterialLineNameForValidation(token));
    unitTokens.add(normalizeMaterialUnit(token).unit);
  }
  if (unitTokens.has(descNorm)) return true;

  if (/\d[.,]\d*\s*,\s*,/.test(description)) return true;
  if (/\s\d[.,]\s*,?\s*$/.test(description) && description.length < 24) return true;

  return false;
}

export function isMaterialCategoryExcludedFromAutoSelect(
  category: MaterialCategory,
  confidence?: MaterialConfidence
): boolean {
  if (category === "service_or_labor" || category === "transport" || category === "discount") return true;
  if (category === "unknown" && confidence === "low") return true;
  return false;
}

export function resolveMaterialCurrency(opts: {
  expenseCurrency?: string | null;
  projectCurrency?: string | null;
  userCurrency?: string | null;
  fallback?: string;
}): string {
  for (const c of [opts.expenseCurrency, opts.projectCurrency, opts.userCurrency, opts.fallback, "EUR"]) {
    const code = typeof c === "string" ? c.trim().toUpperCase() : "";
    if (/^[A-Z]{3}$/.test(code)) return code;
  }
  return "EUR";
}

export type MaterialTotalsGroup = {
  currency: string;
  totalPrice: number;
  count: number;
};

export type MaterialTotals = {
  count: number;
  groups: MaterialTotalsGroup[];
  /** Primary group for legacy single-line displays. */
  totalPrice: number;
  currency: string;
};

export function calculateMaterialTotals(
  materials: Array<{ totalPrice?: number; currency?: string }>
): MaterialTotals {
  const byCurrency = new Map<string, { totalPrice: number; count: number }>();
  for (const m of materials) {
    const currency = resolveMaterialCurrency({ expenseCurrency: m.currency });
    const add = m.totalPrice ?? 0;
    const prev = byCurrency.get(currency) ?? { totalPrice: 0, count: 0 };
    byCurrency.set(currency, { totalPrice: prev.totalPrice + add, count: prev.count + 1 });
  }
  const groups = [...byCurrency.entries()]
    .map(([currency, g]) => ({ currency, totalPrice: g.totalPrice, count: g.count }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const primary = groups[0] ?? { currency: "EUR", totalPrice: 0, count: 0 };
  return {
    count: materials.length,
    groups,
    totalPrice: primary.totalPrice,
    currency: primary.currency,
  };
}

export function formatMaterialTotalsDisplay(totals: MaterialTotals): string {
  if (totals.groups.length === 0) return `0.00 ${totals.currency}`;
  return totals.groups.map((g) => `${g.totalPrice.toFixed(2)} ${g.currency}`).join(" · ");
}

export function numericConfidenceToMaterialConfidence(score?: number): MaterialConfidence | undefined {
  if (score == null || !Number.isFinite(score)) return undefined;
  if (score >= 0.75) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

export function shouldPreselectImportedMaterialRow(
  item: { confidence?: number; category?: MaterialCategory },
  mappedConfidence?: MaterialConfidence
): boolean {
  const confidence = mappedConfidence ?? numericConfidenceToMaterialConfidence(item.confidence);
  if (confidence === "low") return false;
  const category = item.category ?? "other_material";
  return !isMaterialCategoryExcludedFromAutoSelect(category, confidence);
}
