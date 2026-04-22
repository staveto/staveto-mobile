/**
 * Idempotent migration: normalize legacy `projects.projectType` to **BUILD** | **TRADE** for owned projects.
 *
 * Rules (Firestore fields written):
 * - `MANAGEMENT` → `BUILD`, set `projectTypeBeforeProductV2` if absent
 * - `RESIDENTIAL` → `TRADE`, set `projectTypeBeforeProductV2` if absent
 * - `MAINTENANCE` with `jobsTabVisible === true` → `TRADE`, set trace field if absent
 * - `MAINTENANCE` equipment hubs (`jobsTabVisible !== true`) → **unchanged** (project-scoped equipment)
 *
 * Runs at most once per app session after Projects list load to avoid repeated writes.
 */

import { auth } from "../firebase";
import type { ProjectDoc } from "./projects";
import { patchProjectDocument } from "./projects";

let ranThisSession = false;

export function resetProjectTypeBackfillSessionFlagForTests(): void {
  ranThisSession = false;
}

export async function runLegacyProjectTypeBackfillOncePerSession(projects: ProjectDoc[]): Promise<void> {
  if (ranThisSession) return;
  ranThisSession = true;

  const uid = auth.currentUser?.uid;
  if (!uid || !projects.length) return;

  for (const p of projects) {
    if (p.ownerId !== uid) continue;
    const raw = p.projectType;
    if (!raw) continue;

    let next: "BUILD" | "TRADE" | null = null;
    if (raw === "MANAGEMENT") next = "BUILD";
    else if (raw === "RESIDENTIAL") next = "TRADE";
    else if (raw === "MAINTENANCE" && p.jobsTabVisible === true) next = "TRADE";

    if (!next) continue;

    try {
      await patchProjectDocument(p.id, {
        projectType: next,
        ...(p.projectTypeBeforeProductV2 ? {} : { projectTypeBeforeProductV2: raw }),
      });
    } catch (e) {
      console.warn("[projectTypeBackfill] failed for project", p.id, e);
    }
  }
}
