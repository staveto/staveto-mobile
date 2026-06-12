/** Stable synthetic id for tasks that only have a legacy string `phase` field (matches web). */
export function legacyPhaseIdFromName(name: string): string {
  return `legacy:${encodeURIComponent(name.trim().toLowerCase())}`;
}

/** Decode display label from {@link legacyPhaseIdFromName} id. */
export function parseLegacyPhaseId(id: string): string | null {
  if (!id.startsWith("legacy:")) return null;
  try {
    return decodeURIComponent(id.slice("legacy:".length));
  } catch {
    return null;
  }
}

export type ProjectPhaseRow = {
  id: string;
  name: string;
  description?: string;
  order: number;
};

/** Resolve human-readable phase name from task-carried ids (legacy + phase_title). */
export function resolvePhaseDisplayName(
  phaseId: string,
  tasks: Array<{ phaseId?: string | null; phaseTitle?: string | null }>
): string | null {
  const linked = tasks.find((tk) => tk.phaseId?.trim() === phaseId);
  const fromTitle = linked?.phaseTitle?.trim();
  if (fromTitle) return fromTitle;
  const fromLegacy = parseLegacyPhaseId(phaseId);
  if (fromLegacy) return fromLegacy;
  return null;
}

/** Build phase list from parsed task rows (fallback when phases subcollection is empty). */
export function derivePhasesFromTaskRows(
  tasks: Array<{ phaseId?: string | null; phaseTitle?: string | null; isActive?: boolean }>
): ProjectPhaseRow[] {
  const byKey = new Map<string, ProjectPhaseRow>();
  let order = 0;

  for (const tk of tasks) {
    if (tk.isActive === false) continue;
    const key = tk.phaseId?.trim();
    if (!key) continue;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: key,
      name: tk.phaseTitle?.trim() || parseLegacyPhaseId(key) || key,
      order: order++,
    });
  }

  return [...byKey.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
