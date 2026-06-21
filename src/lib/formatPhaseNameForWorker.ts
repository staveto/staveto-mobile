/** Known phase slugs → i18n keys under workPhoto.phase.* */
const PHASE_I18N_BY_SLUG: Record<string, string> = {
  planning: "workPhoto.phase.planning",
  planung: "workPhoto.phase.planning",
  vorberitung: "workPhoto.phase.planning",
  installation: "workPhoto.phase.installation",
  install: "workPhoto.phase.installation",
  completion: "workPhoto.phase.completion",
  abschluss: "workPhoto.phase.completion",
  commissioning: "workPhoto.phase.commissioning",
  inbetriebnahme: "workPhoto.phase.commissioning",
};

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^legacy:/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function looksLikeTechnicalId(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^legacy:/i.test(v)) return true;
  if (/^[A-Z0-9_:-]+$/.test(v) && !v.includes(" ")) return true;
  if (/^phase[_-]/i.test(v)) return true;
  return false;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Human-readable phase label for field workers (no LEGACY:/ids in UI).
 */
export function formatPhaseNameForWorker(
  phaseNameOrId: string | null | undefined,
  t: (key: string) => string
): string {
  const raw = (phaseNameOrId ?? "").trim();
  if (!raw) return t("workPhoto.phaseOther");

  const withoutLegacy = raw.replace(/^LEGACY:/i, "").trim();
  const slug = toSlug(withoutLegacy);

  for (const [key, i18nKey] of Object.entries(PHASE_I18N_BY_SLUG)) {
    if (slug === key || slug.includes(key)) {
      return t(i18nKey);
    }
  }

  if (!looksLikeTechnicalId(withoutLegacy)) {
    return withoutLegacy;
  }

  if (/^[a-z]+$/i.test(withoutLegacy)) {
    return titleCaseWords(withoutLegacy);
  }

  return t("workPhoto.phaseOther");
}
