/**
 * Service Tasks helper - MAINTENANCE v2
 * Creates service tasks from rules (work orders with checklist).
 */

import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
} from '../lib/rnFirestore';
import { db, auth } from '../firebase';
import { paths } from '../lib/firestorePaths';
import { upsertTaskDueNotification } from './notifications';
import { addProjectEvent } from './projectEvents';
import type { ServiceRuleDoc } from './serviceRules';

/**
 * Create a service task from a rule.
 * Used when creating a new rule (first task) or when auto-next triggers.
 */
export async function createServiceTaskFromRule(
  projectId: string,
  rule: ServiceRuleDoc,
  dueAt: Date
): Promise<string> {
  const ownerId = auth.currentUser?.uid;
  if (!ownerId) {
    throw new Error('Musíte byť prihlásený na vytvorenie servisnej úlohy.');
  }

  // Calculate order for tasks without phaseId (same as tasks.ts)
  const tasksRef = collection(db, paths.projectTasks(projectId));
  let order = 0;
  try {
    const globalQuery = query(
      tasksRef,
      where('phaseId', '==', null),
      orderBy('order', 'desc'),
      limit(10)
    );
    const globalSnapshot = await getDocs(globalQuery);
    const activeTasks = globalSnapshot.docs
      .map((d) => d.data())
      .filter((t) => t.isActive !== false);
    if (activeTasks.length > 0) {
      const maxOrder = Math.max(...activeTasks.map((t) => (t.order as number) ?? 0));
      order = maxOrder + 1;
    }
  } catch {
    order = 0;
  }

  const dueDateStr = dueAt.toISOString().split('T')[0]; // YYYY-MM-DD for consistency with tasks
  const subtasks = (rule.checklistTemplate ?? []).map((item, index) => ({
    id: item.id,
    title: item.title,
    done: false,
    order: index,
  }));

  const ref = await addDoc(tasksRef, {
    ownerId,
    projectId,
    phaseId: null,
    order,
    title: rule.title,
    status: 'OPEN',
    required: false,
    origin: 'CUSTOM',
    templateTaskId: null,
    isActive: true,
    assigneeId: null,
    assigneeName: null,
    doneAt: null,
    equipmentId: rule.equipmentId,
    serviceRuleId: rule.id,
    subtasks,
    dueDate: dueDateStr,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (ownerId) {
    try {
      const { getProject } = await import('./projects');
      const project = await getProject(projectId);
      await upsertTaskDueNotification({
        userId: ownerId,
        taskId: ref.id,
        taskTitle: rule.title,
        dueDate: dueDateStr,
        projectId,
        projectName: project?.name ?? null,
      });
    } catch (error) {
      console.warn('[serviceTasks] Failed to create due notification:', error);
    }
  }

  try {
    await addProjectEvent(projectId, 'task_created', { taskTitle: rule.title }, { kind: 'task', id: ref.id });
  } catch (error) {
    console.warn('[serviceTasks] Failed to create task_created event:', error);
  }

  return ref.id;
}
