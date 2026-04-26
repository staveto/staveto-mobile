/**
 * One-way idempotent migration: project-scoped MAINTENANCE equipment → users/{uid}/equipment.
 * - Safe to call repeatedly (stable doc IDs + sourceLegacy* markers).
 * - Only migrates projects owned by ownerUid (avoids copying shared org equipment into every member’s tab).
 * - Does not delete or rewrite legacy project data; optional pointer field on legacy doc is best-effort.
 */

import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, serverTimestamp, Timestamp } from "../lib/rnFirestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import * as projectsService from "./projects";
import * as equipmentService from "./equipment";
import * as serviceRulesService from "./serviceRules";
import * as tasksService from "./tasks";

export const LEGACY_USER_EQUIPMENT_MIGRATION_VERSION = 1;
/** Background tab opens: avoid full project scan more often than this. Pull-to-refresh always re-runs migration. */
export const LEGACY_USER_EQUIPMENT_MIGRATION_THROTTLE_MS = 6 * 60 * 60 * 1000;

export type LegacyUserEquipmentMigrationResult = {
  ran: boolean;
  projectsScanned: number;
  legacyEquipmentSeen: number;
  userEquipmentCreated: number;
  userEquipmentSkipped: number;
  serviceRulesCreated: number;
  serviceTasksCreated: number;
  legacyMarkersWritten: number;
  errors: string[];
};

const THROTTLE_KEY = "@staveto:legacyUserEquipmentMigrationV1LastMs";

export async function shouldThrottleLegacyUserEquipmentMigration(throttleMs: number): Promise<boolean> {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const raw = await AsyncStorage.getItem(THROTTLE_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < throttleMs;
  } catch {
    return false;
  }
}

export async function markLegacyUserEquipmentMigrationRan(): Promise<void> {
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem(THROTTLE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Stable Firestore doc id for migrated user equipment (deterministic, idempotent). */
export function stableMigratedUserEquipmentDocId(projectId: string, legacyEquipmentId: string): string {
  const safe = (s: string) =>
    s
      .replace(/\//g, "_")
      .replace(/[\[\]#?]/g, "_")
      .slice(0, 200);
  const a = safe(projectId);
  const b = safe(legacyEquipmentId);
  const base = `migleg__${a}__${b}`;
  if (base.length <= 750) return base;
  return `migleg__${a.slice(0, 120)}__${b.slice(0, 120)}__${String(projectId.length)}_${String(legacyEquipmentId.length)}`;
}

function stableMigratedServiceTaskDocId(projectId: string, legacyTaskId: string): string {
  const safe = (s: string) => s.replace(/\//g, "_").replace(/[\[\]#?]/g, "_").slice(0, 200);
  const base = `migtask__${safe(projectId)}__${safe(legacyTaskId)}`;
  return base.length <= 750 ? base : `migtask__${safe(projectId).slice(0, 200)}__${safe(legacyTaskId).slice(0, 200)}`;
}

function buildNotesFromLegacy(eq: equipmentService.EquipmentDoc): string | null {
  return eq.subcategory?.trim() || null;
}

function copyTimelikeField(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && typeof (v as { toDate?: unknown }).toDate === "function") {
    return v;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return v;
}

function toTimestampNextDue(raw: Record<string, unknown>, fallbackIso: string): Timestamp {
  const v = raw.nextDueAt ?? fallbackIso;
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  ) {
    return Timestamp.fromDate((v as { toDate: () => Date }).toDate());
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  const d = new Date(fallbackIso);
  if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  return Timestamp.fromDate(new Date());
}

/**
 * Scan all owned projects (including legacy MAINTENANCE hubs), migrate active project equipment to user scope.
 * Throttle at call site if desired (see shouldThrottleLegacyUserEquipmentMigration).
 */
export async function runLegacyUserEquipmentMigration(ownerUid: string): Promise<LegacyUserEquipmentMigrationResult> {
  const result: LegacyUserEquipmentMigrationResult = {
    ran: true,
    projectsScanned: 0,
    legacyEquipmentSeen: 0,
    userEquipmentCreated: 0,
    userEquipmentSkipped: 0,
    serviceRulesCreated: 0,
    serviceTasksCreated: 0,
    legacyMarkersWritten: 0,
    errors: [],
  };

  try {
    const projects = await projectsService.listMyProjects(ownerUid, { forceServerRead: true });
    for (const project of projects) {
      if (!project?.id) continue;
      if ((project.ownerId || "") !== ownerUid) continue;
      if (project.archivedAt) continue;
      result.projectsScanned += 1;

      let equipmentList: equipmentService.EquipmentDoc[] = [];
      try {
        equipmentList = await equipmentService.listEquipment(project.id, { status: "active" });
      } catch (e) {
        result.errors.push(`listEquipment ${project.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      for (const eq of equipmentList) {
        result.legacyEquipmentSeen += 1;
        const userEquipId = stableMigratedUserEquipmentDocId(project.id, eq.id);
        const userEquipRef = doc(db, paths.userEquipmentItem(ownerUid, userEquipId));
        const existingSnap = await getDoc(userEquipRef);
        const existingData = existingSnap.exists() ? existingSnap.data() : null;
        const already =
          existingData &&
          existingData.sourceLegacyProjectId === project.id &&
          existingData.sourceLegacyEquipmentId === eq.id &&
          Number(existingData.migrationVersion) >= LEGACY_USER_EQUIPMENT_MIGRATION_VERSION;

        if (!existingSnap.exists()) {
          const notes = buildNotesFromLegacy(eq);
          await setDoc(userEquipRef, {
            ownerId: ownerUid,
            name: eq.name?.trim() || "Equipment",
            category: eq.category ?? "other",
            kind: eq.subcategory?.trim() || eq.type || null,
            serialNumber: eq.serialNumber?.trim() || null,
            internalCode: eq.labelCode?.trim() || null,
            locationText: eq.location?.trim() || null,
            notes: notes || null,
            model: eq.model?.trim() || null,
            status: "assigned",
            assignedProjectId: project.id,
            assignedToUserId: null,
            photoUrl: eq.photoUrl ?? null,
            photoPath: eq.photoPath ?? null,
            sourceLegacyProjectId: project.id,
            sourceLegacyEquipmentId: eq.id,
            legacySourceType: "project_equipment",
            migratedAt: serverTimestamp(),
            migrationVersion: LEGACY_USER_EQUIPMENT_MIGRATION_VERSION,
            migratedBy: ownerUid,
            createdAt: copyTimelikeField(eq.createdAt) ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          result.userEquipmentCreated += 1;
        } else if (already) {
          result.userEquipmentSkipped += 1;
        } else {
          await setDoc(
            userEquipRef,
            {
              ownerId: ownerUid,
              name: eq.name?.trim() || "Equipment",
              category: eq.category ?? "other",
              kind: eq.subcategory?.trim() || eq.type || null,
              serialNumber: eq.serialNumber?.trim() || null,
              internalCode: eq.labelCode?.trim() || null,
              locationText: eq.location?.trim() || null,
              notes: buildNotesFromLegacy(eq) || null,
              model: eq.model?.trim() || null,
              status: "assigned",
              assignedProjectId: project.id,
              photoUrl: eq.photoUrl ?? null,
              photoPath: eq.photoPath ?? null,
              sourceLegacyProjectId: project.id,
              sourceLegacyEquipmentId: eq.id,
              legacySourceType: "project_equipment",
              migratedAt: serverTimestamp(),
              migrationVersion: LEGACY_USER_EQUIPMENT_MIGRATION_VERSION,
              migratedBy: ownerUid,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        let legacyRules: serviceRulesService.ServiceRuleDoc[] = [];
        try {
          legacyRules = await serviceRulesService.listServiceRulesByEquipment(project.id, eq.id);
        } catch (e) {
          result.errors.push(`listServiceRules ${project.id}/${eq.id}: ${e instanceof Error ? e.message : String(e)}`);
          legacyRules = [];
        }

        const userRulesCol = collection(db, paths.userEquipmentServiceRules(ownerUid, userEquipId));
        const userRulesSnap = await getDocs(userRulesCol);
        const existingRuleByLegacy = new Map<string, string>();
        userRulesSnap.docs.forEach((d) => {
          const sid = d.data().sourceLegacyServiceRuleId as string | undefined;
          if (sid) existingRuleByLegacy.set(sid, d.id);
        });

        const ruleIdMap = new Map<string, string>();
        for (const lr of legacyRules) {
          const existingId = existingRuleByLegacy.get(lr.id);
          if (existingId) {
            ruleIdMap.set(lr.id, existingId);
            continue;
          }
          try {
            const legacyRuleRef = doc(db, paths.projectServiceRule(project.id, lr.id));
            const lrSnap = await getDoc(legacyRuleRef);
            if (!lrSnap.exists()) continue;
            const raw = lrSnap.data() as Record<string, unknown>;
            const newRef = await addDoc(userRulesCol, {
              ownerUid,
              equipmentId: userEquipId,
              projectId: null,
              title: (raw.title as string) ?? lr.title,
              intervalUnit: (raw.intervalUnit as "weeks" | "months") ?? lr.intervalUnit,
              intervalValue: (raw.intervalValue as number) ?? lr.intervalValue,
              startFrom: copyTimelikeField(raw.startFrom),
              nextDueAt: toTimestampNextDue(raw, lr.nextDueAt || new Date().toISOString()),
              lastServiceAt: copyTimelikeField(raw.lastServiceAt),
              lastGeneratedDueAt: copyTimelikeField(raw.lastGeneratedDueAt),
              checklistTemplate: (raw.checklistTemplate as Array<{ id: string; title: string }>) ?? lr.checklistTemplate ?? [],
              status: (raw.status as string) ?? lr.status ?? "active",
              sourceLegacyProjectId: project.id,
              sourceLegacyServiceRuleId: lr.id,
              migrationVersion: LEGACY_USER_EQUIPMENT_MIGRATION_VERSION,
              migratedAt: serverTimestamp(),
              createdAt: copyTimelikeField(raw.createdAt) ?? serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            ruleIdMap.set(lr.id, newRef.id);
            existingRuleByLegacy.set(lr.id, newRef.id);
            result.serviceRulesCreated += 1;
          } catch (e) {
            result.errors.push(`rule ${lr.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        let projectTasks: tasksService.TaskDoc[] = [];
        try {
          projectTasks = await tasksService.listTasksByProject(project.id);
        } catch (e) {
          result.errors.push(`listTasks ${project.id}: ${e instanceof Error ? e.message : String(e)}`);
          projectTasks = [];
        }

        const serviceTasksCol = collection(db, paths.userEquipmentServiceTasks(ownerUid, userEquipId));
        const existingTaskSnap = await getDocs(serviceTasksCol);
        const existingTaskSources = new Set<string>();
        existingTaskSnap.docs.forEach((d) => {
          const sid = d.data().sourceLegacyProjectTaskId as string | undefined;
          if (sid) existingTaskSources.add(sid);
        });

        for (const task of projectTasks) {
          if (task.equipmentId !== eq.id || !task.serviceRuleId) continue;
          const st = (task.status ?? "OPEN").toUpperCase();
          if (st === "DONE") continue;

          if (existingTaskSources.has(task.id)) continue;

          const newRuleId = ruleIdMap.get(task.serviceRuleId);
          if (!newRuleId) {
            result.errors.push(`skip task ${task.id}: no mapped rule for ${task.serviceRuleId}`);
            continue;
          }

          const taskDocId = stableMigratedServiceTaskDocId(project.id, task.id);
          const subtasks =
            task.subtasks && task.subtasks.length > 0
              ? task.subtasks
              : (task.checklist ?? []).map((c, index) => ({
                  id: c.id ?? `c_${index}`,
                  title: c.title ?? "",
                  done: !!c.done,
                  order: index,
                }));

          try {
            await setDoc(doc(db, paths.userEquipmentServiceTask(ownerUid, userEquipId, taskDocId)), {
              ownerId: ownerUid,
              equipmentId: userEquipId,
              title: task.title ?? "Service",
              status: task.status ?? "OPEN",
              serviceRuleId: newRuleId,
              subtasks,
              dueDate: task.dueDate ?? null,
              isActive: task.isActive !== false,
              doneAt: null,
              sourceLegacyProjectId: project.id,
              sourceLegacyProjectTaskId: task.id,
              migrationVersion: LEGACY_USER_EQUIPMENT_MIGRATION_VERSION,
              migratedAt: serverTimestamp(),
              createdAt: task.createdAt ? copyTimelikeField(task.createdAt) : serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            existingTaskSources.add(task.id);
            result.serviceTasksCreated += 1;
          } catch (e) {
            result.errors.push(`task ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        try {
          await updateDoc(doc(db, paths.projectEquipmentItem(project.id, eq.id)), {
            migratedToUserEquipmentId: userEquipId,
            migratedAt: serverTimestamp(),
            migrationVersion: LEGACY_USER_EQUIPMENT_MIGRATION_VERSION,
          });
          result.legacyMarkersWritten += 1;
        } catch {
          // Permission or unsupported fields: ignore — legacy remains source for project UI
        }
      }
    }
  } catch (e) {
    result.errors.push(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
