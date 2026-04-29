/**
 * Lexicographic semver-like comparison (numeric segments only).
 * No prerelease support. Examples: 1.10.0 > 1.9.99; 1.2.0 == 1.2; 2.0.0 > 1.999.999
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
function versionParts(v: string): number[] {
  const t = v.trim().replace(/^v/i, "");
  if (!t) return [0];
  const segs = t.split(".").map((s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return segs.length ? segs : [0];
}

export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}
