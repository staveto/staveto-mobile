/**
 * Firebase Callable: Create project + phases + tasks from AI plan.
 * All Firestore writes happen in backend.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";
import {
  validateAiProjectPlan,
  mapAiCategoryToFirestore,
  type AiProjectPlan,
} from "./aiProjectSchema";
import { setMembersByUidMirror } from "./team";

const MAX_BRIEF_LEN = 600;

type CreateRequest = {
  plan: unknown;
  originalBrief?: string;
  addressText?: string;
  countryCode?: string;
  city?: string;
};

function generateId(): string {
  return admin.firestore().collection("_").doc().id;
}

export const createProjectFromAiPlan = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = (request.data ?? {}) as CreateRequest;
    const planInput = data.plan;
    const originalBrief =
      typeof data.originalBrief === "string"
        ? data.originalBrief.trim().slice(0, MAX_BRIEF_LEN)
        : null;
    const addressText =
      typeof data.addressText === "string" ? data.addressText.trim() || null : null;
    const countryCode =
      typeof data.countryCode === "string" ? data.countryCode.trim() || null : null;
    const city = typeof data.city === "string" ? data.city.trim() || null : null;

    const validationErrors = validateAiProjectPlan(planInput);
    if (validationErrors) {
      const msg = validationErrors.map((e) => `${e.path}: ${e.message}`).join("; ");
      log("[createProjectFromAiPlan] validation failed", { msg });
      throw new HttpsError("invalid-argument", `Invalid plan: ${msg}`);
    }

    const plan = planInput as AiProjectPlan;

    if (!plan.projectTitle?.trim()) {
      throw new HttpsError("invalid-argument", "projectTitle is required.");
    }

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const projectId = db.collection("projects").doc().id;
    const projectType = mapAiCategoryToFirestore(plan.category);

    const projectData: Record<string, unknown> = {
      ownerId: uid,
      projectType,
      templateId: "ai-generated",
      name: plan.projectTitle.trim(),
      source: "ai",
      originalBrief,
      category: plan.category,
      scope: plan.scope,
      summary: plan.summary?.trim() || null,
      sharedWithCount: 0,
      progress: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (addressText) projectData.addressText = addressText;
    if (countryCode) projectData.countryCode = countryCode;
    if (city) projectData.city = city;

    const batch = db.batch();

    batch.set(db.doc(`projects/${projectId}`), projectData);
    batch.set(db.doc(`projects/${projectId}/members/${uid}`), {
      userId: uid,
      role: "owner",
      addedAt: now,
    });
    setMembersByUidMirror(batch, projectId, uid, {
      permissionLevel: "editor",
      sharedItems: { tasks: true, phases: true, expenses: false, diary: false, documents: false },
      sharedPhaseIds: [],
      status: "active",
      joinedAt: now,
    });
    batch.set(db.doc(`users/${uid}/projectRefs/${projectId}`), {
      projectId,
      role: "owner",
      permissionLevel: "editor",
      sharedItems: { tasks: true, phases: true, expenses: false, diary: false, documents: false },
      sharedPhaseIds: [],
      joinedAt: now,
      source: "owner",
    }, { merge: true });

    const phaseIdByIndex = new Map<number, string>();

    plan.phases.forEach((phase, phaseIndex) => {
      const phaseId = generateId();
      phaseIdByIndex.set(phaseIndex, phaseId);
      batch.set(db.doc(`projects/${projectId}/phases/${phaseId}`), {
        projectId,
        ownerId: uid,
        name: phase.name?.trim() || "",
        description: phase.description?.trim() || null,
        order: phaseIndex,
        status: "ACTIVE",
      });
    });

    let taskOrder = 0;
    plan.phases.forEach((phase, phaseIndex) => {
      const phaseId = phaseIdByIndex.get(phaseIndex);
      if (!phaseId) return;

      phase.tasks.forEach((task) => {
        const taskId = generateId();
        batch.set(db.doc(`projects/${projectId}/tasks/${taskId}`), {
          projectId,
          ownerId: uid,
          phaseId,
          order: taskOrder++,
          title: task.title?.trim() || "",
          description: task.description?.trim() || null,
          status: "OPEN",
          required: false,
          assigneeId: null,
          assigneeName: null,
          assignedTrade: null,
          updatedAt: now,
          doneAt: null,
          createdAt: now,
          origin: "CUSTOM",
          isActive: true,
          source: "ai",
        });
      });
    });

    try {
      await batch.commit();
      log("[createProjectFromAiPlan] project created", { projectId, uid });
    } catch (e) {
      log("[createProjectFromAiPlan] batch commit failed", e);
      throw new HttpsError("internal", "Failed to create project. Try again.");
    }

    return { projectId };
  }
);
