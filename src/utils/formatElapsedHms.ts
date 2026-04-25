/** HH:MM:SS since ISO start time (for live timer UIs). */
export function formatElapsedHms(startedAtIso: string, nowMs: number = Date.now()): string {
  let ms = nowMs - new Date(startedAtIso).getTime();
  if (Number.isNaN(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
