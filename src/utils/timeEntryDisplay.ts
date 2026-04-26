import { entryCalendarDayYmd, type TimeEntryDoc } from "../services/timeTracking";
import type { GpsPoint } from "../lib/location";

export function localDayKeyForEntry(e: TimeEntryDoc, toLocalYmd: (d: Date) => string): string {
  const ymd = entryCalendarDayYmd(e);
  if (ymd) return ymd;
  return toLocalYmd(new Date(e.startedAt));
}

/** Newest day first; within a day, newest entry first. */
export function groupTimeEntriesByDay(
  entries: TimeEntryDoc[],
  toLocalYmd: (d: Date) => string
): { dayKey: string; entries: TimeEntryDoc[] }[] {
  const map = new Map<string, TimeEntryDoc[]>();
  for (const e of entries) {
    const k = localDayKeyForEntry(e, toLocalYmd);
    const arr = map.get(k) ?? [];
    arr.push(e);
    map.set(k, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return keys.map((dayKey) => ({ dayKey, entries: map.get(dayKey)! }));
}

export function sumMinutes(entries: TimeEntryDoc[]): number {
  return entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);
}

export function formatGpsShort(p: GpsPoint | null | undefined): string | null {
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return null;
  const acc = typeof p.accuracyM === "number" && p.accuracyM > 0 ? ` ±${Math.round(p.accuracyM)}m` : "";
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${acc}`;
}

export function mapsUrlForPoint(p: GpsPoint | null | undefined): string | null {
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return null;
  return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}
