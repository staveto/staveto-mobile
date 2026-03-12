/**
 * Clone project (structure only) - sync path with batch chunking.
 * Allowed types: BUILD, RESIDENTIAL, TRADE, MANAGEMENT. Owner only.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";
import { setMembersByUidMirror } from "./team";

const BATCH_SIZE = 450;
export const WRITE_THRESHOLD_ASYNC = 400;
export const ALLOWED_PROJECT_TYPES = ["BUILD", "RESIDENTIAL", "TRADE", "MANAGEMENT"] as const;

type CloneRequest = {
  sourceProjectId?: string;
  newName?: string;
  countryCode?: string;
  city?: string;
  addressText?: string;
  keepAssignees?: boolean;
  keepEstimates?: boolean;
  keepTags?: boolean;
};

function generateId(db: admin.firestore.Firestore): string {
  return db.collection("_").doc().id;
}

async function addProjectEvent(
  db: admin.firestore.Firestore,
  projectId: string,
  type: string,
  payload: Record<string, unknown>,
  actorId: string
): Promise<void> {
  await db.collection("projects").doc(projectId).collection("events").add({
    type,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    actorId,
    payload,
  });
}

export const cloneProjectStructure = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = (request.data ?? {}) as CloneRequest;
    const sourceProjectId = typeof data.sourceProjectId === "string" ? data.sourceProjectId.trim() : "";
    const newName = typeof data.newName === "string" ? data.newName.trim() : "";
    const countryCode = typeof data.countryCode === "string" ? data.countryCode.trim() || null : null;
    const city = typeof data.city === "string" ? data.city.trim() || null : null;
    const addressText = typeof data.addressText === "string" ? data.addressText.trim() || null : null;
    const keepAssignees = !!data.keepAssignees;
    const keepEstimates = !!data.keepEstimates;
    const keepTags = !!data.keepTags;

    if (!sourceProjectId) {
      throw new HttpsError("invalid-argument", "sourceProjectId is required.");
    }
    if (!newName) {
      throw new HttpsError("invalid-argument", "newName is required.");
    }

    const db = admin.firestore();
    log("[cloneProjectStructure] start", { sourceProjectId, newName, uid });

    // 1. Load source project
    const srcProjectRef = db.doc(`projects/${sourceProjectId}`);
    const srcSnap = await srcProjectRef.get();
    if (!srcSnap.exists) {
      log("[cloneProjectStructure] not-found", { sourceProjectId });
      throw new HttpsError("not-found", "Project not found.");
    }

    const srcData = srcSnap.data() as Record<string, unknown>;
    const ownerId = srcData?.ownerId as string | undefined;
    const projectType = srcData?.projectType as string | undefined;
    const sourceProjectName = (srcData?.name as string) ?? "";

    // 2. Owner check
    if (!ownerId || ownerId !== uid) {
      log("[cloneProjectStructure] permission-denied", { ownerId, uid });
      throw new HttpsError("permission-denied", "Only project owner can clone.");
    }

    // 3. Type check
    if (!projectType || !ALLOWED_PROJECT_TYPES.includes(projectType as (typeof ALLOWED_PROJECT_TYPES)[number])) {
      log("[cloneProjectStructure] failed-precondition", { projectType });
      throw new HttpsError("failed-precondition", "Clone not allowed for this project type.");
    }

    // TODO: enforce plan limits - if billing/subscription helper exists in functions, call it
    // const limitCheck = await checkLimit(uid, "projects", currentCount);
    // if (!limitCheck.allowed) throw new HttpsError("resource-exhausted", limitCheck.message);

    // 4. Load phases and tasks
    const [phasesSnap, tasksSnap] = await Promise.all([
      db.collection(`projects/${sourceProjectId}/phases`).orderBy("order", "asc").get(),
      db.collection(`projects/${sourceProjectId}/tasks`).get(),
    ]);

    const phases = phasesSnap.docs;
    const tasks = tasksSnap.docs;
    const estimatedWrites = 1 + 1 + phases.length + tasks.length + 1 + 1; // project, member, phases, tasks, event, overhead

    if (estimatedWrites > WRITE_THRESHOLD_ASYNC) {
      log("[cloneProjectStructure] jobQueued - too many writes", { estimatedWrites });
      const jobId = generateId(db);
      await db.doc(`cloneJobs/${jobId}`).set({
        status: "queued",
        sourceProjectId,
        uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { jobQueued: true, jobId };
    }

    // 5. Sync clone
    const newProjectId = db.collection("projects").doc().id;
    const phaseIdMap = new Map<string, string>();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 5a. Create project doc + owner member + membersByUid + projectRef
    const initBatch = db.batch();
    initBatch.set(db.doc(`projects/${newProjectId}`), {
      name: newName,
      projectType,
      ownerId: uid,
      templateId: srcData?.templateId ?? null,
      addressText: addressText ?? srcData?.addressText ?? null,
      countryCode: countryCode ?? srcData?.countryCode ?? null,
      city: city ?? srcData?.city ?? null,
      sharedWithCount: 0,
      progress: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    initBatch.set(db.doc(`projects/${newProjectId}/members/${uid}`), {
      userId: uid,
      role: "owner",
      addedAt: now,
    });
    setMembersByUidMirror(initBatch, newProjectId, uid, {
      permissionLevel: "editor",
      sharedItems: { tasks: true, phases: true, expenses: false, diary: false, documents: false },
      sharedPhaseIds: [],
      status: "active",
      joinedAt: now,
    });
    initBatch.set(db.doc(`users/${uid}/projectRefs/${newProjectId}`), {
      projectId: newProjectId,
      role: "owner",
      permissionLevel: "editor",
      sharedItems: { tasks: true, phases: true, expenses: false, diary: false, documents: false },
      sharedPhaseIds: [],
      joinedAt: now,
      source: "owner",
    }, { merge: true });
    await initBatch.commit();
    log("[cloneProjectStructure] project created", { newProjectId });

    // 5c. Create phases and tasks in batches
    let opCount = 0;
    let batch = db.batch();
    const maxRetries = 3;

    const commitBatch = async (): Promise<void> => {
      if (opCount === 0) return;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await batch.commit();
          log("[cloneProjectStructure] batch committed", { opCount });
          return;
        } catch (err) {
          log("[cloneProjectStructure] batch commit failed", { attempt, error: String(err) });
          if (attempt === maxRetries) throw err;
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    };

    // Phases
    for (const phaseDoc of phases) {
      if (opCount >= BATCH_SIZE) {
        await commitBatch();
        batch = db.batch();
        opCount = 0;
      }
      const oldId = phaseDoc.id;
      const newId = generateId(db);
      phaseIdMap.set(oldId, newId);
      const d = phaseDoc.data();
      batch.set(db.doc(`projects/${newProjectId}/phases/${newId}`), {
        name: d.name ?? "",
        order: d.order ?? 0,
        description: d.description ?? null,
        projectId: newProjectId,
        ownerId: uid,
        status: "ACTIVE",
      });
      opCount++;
    }

    // Tasks
    for (const taskDoc of tasks) {
      if (opCount >= BATCH_SIZE) {
        await commitBatch();
        batch = db.batch();
        opCount = 0;
      }
      const d = taskDoc.data() as Record<string, unknown>;
      const oldPhaseId = d.phaseId as string | null | undefined;
      const newPhaseId = oldPhaseId ? phaseIdMap.get(oldPhaseId) ?? null : null;
      const newTaskId = generateId(db);

      const checklist = d.checklist as Array<{ id: string; title: string; done: boolean }> | undefined;
      const subtasks = d.subtasks as Array<{ id: string; title: string; done: boolean; order: number }> | undefined;
      const checklistCopy = checklist?.length
        ? checklist.map((c) => ({ ...c, done: false }))
        : undefined;
      const subtasksCopy = subtasks?.length
        ? subtasks.map((s) => ({ ...s, done: false }))
        : undefined;

      const taskData: Record<string, unknown> = {
        projectId: newProjectId,
        ownerId: uid,
        phaseId: newPhaseId,
        order: d.order ?? 0,
        title: d.title ?? "",
        status: "OPEN",
        required: d.required ?? false,
        assigneeId: keepAssignees ? (d.assigneeId ?? null) : null,
        assigneeName: keepAssignees ? (d.assigneeName ?? null) : null,
        doneAt: null,
        dueDate: null,
        equipmentId: null,
        serviceRuleId: null,
        isActive: true,
        origin: "CUSTOM",
        templateTaskId: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (keepEstimates && typeof d.timeSpentMinutes === "number") {
        taskData.timeSpentMinutes = d.timeSpentMinutes;
      }
      if (checklistCopy) taskData.checklist = checklistCopy;
      if (subtasksCopy) taskData.subtasks = subtasksCopy;
      if (keepTags && d.trade) taskData.trade = d.trade;
      if (d.priority) taskData.priority = d.priority;

      batch.set(db.doc(`projects/${newProjectId}/tasks/${newTaskId}`), taskData);
      opCount++;
    }

    await commitBatch();

    // 5d. Audit event
    await addProjectEvent(db, newProjectId, "project_cloned", {
      sourceProjectId,
      sourceProjectName,
      actorId: uid,
    }, uid);

    log("[cloneProjectStructure] completed", { newProjectId, phasesCount: phases.length, tasksCount: tasks.length });
    return {
      status: "done",
      newProjectId,
      phasesCount: phases.length,
      tasksCount: tasks.length,
    };
  }
);
