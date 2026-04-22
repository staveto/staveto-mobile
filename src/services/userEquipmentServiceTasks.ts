/**
 * Service work items for user-owned equipment — Firestore:
 * users/{uid}/equipment/{equipmentId}/serviceTasks/{taskId}
 * Mirrors project task fields used by MAINTENANCE v2 (title, dueDate, serviceRuleId, subtasks, status).
 */

import { collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, serverTimestamp } from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { upsertTaskDueNotification, markTaskNotificationsRead } from "./notifications";
import { runUserEquipmentServiceAutoNextOnDone } from "./userEquipmentServiceAutoNext";
import type { ServiceRuleDoc } from "./serviceRules";
import { getUserEquipment } from "./userEquipment";
import { getProject } from "./projects";

export type UserEquipmentServiceTaskDoc = {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  serviceRuleId?: string | null;
  subtasks?: Array<{ id: string; title: string; done: boolean; order: number }>;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function toTaskDoc(snap: { id: string; data: () => Record<string, unknown> }): UserEquipmentServiceTaskDoc {
  const d = snap.data();
  const toIso = (v: unknown) => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "toDate" in v) return (v as { toDate: () => Date }).toDate().toISOString();
    return String(v);
  };
  return {
    id: snap.id,
    title: (d.title as string) ?? "",
    status: String(d.status ?? "OPEN").toUpperCase(),
    dueDate: (d.dueDate as string) ?? null,
    serviceRuleId: (d.serviceRuleId as string) ?? null,
    subtasks: (d.subtasks as UserEquipmentServiceTaskDoc["subtasks"]) ?? [],
    isActive: d.isActive !== false,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

export async function listUserEquipmentServiceTasks(
  ownerUid: string,
  equipmentId: string,
  opts?: { status?: "OPEN" | "DONE" | "all" }
): Promise<UserEquipmentServiceTaskDoc[]> {
  const col = collection(db, paths.userEquipmentServiceTasks(ownerUid, equipmentId));
  const q =
    opts?.status && opts.status !== "all"
      ? query(col, where("status", "==", opts.status))
      : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => toTaskDoc({ id: d.id, data: () => d.data() }));
}

export async function createUserEquipmentServiceTaskFromRule(
  ownerUid: string,
  equipmentId: string,
  rule: ServiceRuleDoc,
  dueAt: Date
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("Musíte byť prihlásený na vytvorenie servisnej úlohy.");
  }
  if (uid !== ownerUid) {
    throw new Error("Nemáte oprávnenie na vytvorenie servisnej úlohy.");
  }

  const dueDateStr = dueAt.toISOString().split("T")[0];
  const subtasks = (rule.checklistTemplate ?? []).map((item, index) => ({
    id: item.id,
    title: item.title,
    done: false,
    order: index,
  }));

  const tasksRef = collection(db, paths.userEquipmentServiceTasks(ownerUid, equipmentId));
  const ref = await addDoc(tasksRef, {
    ownerId: ownerUid,
    equipmentId,
    title: rule.title,
    status: "OPEN",
    serviceRuleId: rule.id,
    subtasks,
    dueDate: dueDateStr,
    isActive: true,
    doneAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const equipment = await getUserEquipment(ownerUid, equipmentId);
  const projectId = equipment?.assignedProjectId ?? null;
  let projectName: string | null = null;
  if (projectId) {
    try {
      const p = await getProject(projectId);
      projectName = p?.name ?? null;
    } catch {
      projectName = null;
    }
  }

  try {
    await upsertTaskDueNotification({
      userId: ownerUid,
      taskId: ref.id,
      taskTitle: rule.title,
      dueDate: dueDateStr,
      projectId,
      projectName,
      meta: {
        userEquipmentServiceTask: true,
        equipmentId,
        ownerUid,
      },
    });
  } catch (error) {
    console.warn("[userEquipmentServiceTasks] Failed to create due notification:", error);
  }

  return ref.id;
}

export async function updateUserEquipmentServiceTaskStatus(
  ownerUid: string,
  equipmentId: string,
  taskId: string,
  status: string
): Promise<void> {
  const ref = doc(db, paths.userEquipmentServiceTask(ownerUid, equipmentId, taskId));
  const upper = status.toUpperCase();
  await updateDoc(ref, {
    status: upper,
    updatedAt: serverTimestamp(),
    doneAt: upper === "DONE" ? serverTimestamp() : null,
  });
}

/** Mark task DONE, roll rule forward + next task, clear task-due notifications. */
export async function completeUserEquipmentServiceTask(
  ownerUid: string,
  equipmentId: string,
  taskId: string
): Promise<void> {
  const ref = doc(db, paths.userEquipmentServiceTask(ownerUid, equipmentId, taskId));
  const snap = await getDoc(ref);
  let serviceRuleId: string | undefined;
  if (snap.exists()) {
    const d = snap.data() as { serviceRuleId?: string };
    serviceRuleId = d.serviceRuleId;
  }
  await updateUserEquipmentServiceTaskStatus(ownerUid, equipmentId, taskId, "DONE");

  if (serviceRuleId) {
    try {
      await runUserEquipmentServiceAutoNextOnDone({ ownerUid, equipmentId, serviceRuleId });
    } catch (e) {
      console.warn("[userEquipmentServiceTasks] runUserEquipmentServiceAutoNextOnDone failed:", e);
    }
  }

  try {
    await markTaskNotificationsRead(ownerUid, taskId);
  } catch (e) {
    console.warn("[userEquipmentServiceTasks] markTaskNotificationsRead failed:", e);
  }
}

/**
 * When user equipment service tasks are past due, upsert TASK_OVERDUE / TASK_DUE_TODAY notifications (client-side).
 */
/** Counts user-owned equipment service tasks for a compact Home summary (no project cards). */
export async function getUserEquipmentHomeSummary(ownerId: string): Promise<{
  openServiceTasks: number;
  dueTodayOrOverdue: number;
}> {
  const { listUserEquipment } = await import("./userEquipment");
  const equipment = await listUserEquipment(ownerId, { status: "all" });
  const todayYmd = new Date().toISOString().split("T")[0];
  let openServiceTasks = 0;
  let dueTodayOrOverdue = 0;
  for (const e of equipment) {
    const tasks = await listUserEquipmentServiceTasks(ownerId, e.id, { status: "OPEN" });
    for (const t of tasks) {
      if (t.isActive === false) continue;
      openServiceTasks++;
      const ymd = (t.dueDate ?? "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd <= todayYmd) dueTodayOrOverdue += 1;
    }
  }
  return { openServiceTasks, dueTodayOrOverdue };
}

export async function ensureUserEquipmentServiceOverdueNotificationsIfNeeded(userId: string): Promise<void> {
  const todayYmd = new Date().toISOString().split("T")[0];
  const { listUserEquipment } = await import("./userEquipment");
  const equipmentList = await listUserEquipment(userId, { status: "all" });
  for (const e of equipmentList) {
    try {
      const tasks = await listUserEquipmentServiceTasks(userId, e.id, { status: "OPEN" });
      for (const task of tasks) {
        if (task.isActive === false) continue;
        if (!task.dueDate || typeof task.dueDate !== "string") continue;
        const ymd = task.dueDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        if (ymd >= todayYmd) continue;
        const projectId = e.assignedProjectId ?? null;
        let projectName: string | null = null;
        if (projectId) {
          try {
            const p = await getProject(projectId);
            projectName = p?.name ?? null;
          } catch {
            projectName = null;
          }
        }
        await upsertTaskDueNotification({
          userId,
          taskId: task.id,
          taskTitle: task.title ?? "",
          dueDate: ymd,
          projectId,
          projectName,
          meta: {
            userEquipmentServiceTask: true,
            equipmentId: e.id,
            ownerUid: userId,
          },
        });
      }
    } catch (err) {
      console.warn(`[userEquipmentServiceTasks] ensure overdue failed for equipment ${e.id}:`, err);
    }
  }
}
