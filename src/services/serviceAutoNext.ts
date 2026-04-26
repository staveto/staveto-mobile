/**
 * Service Auto-Next - MAINTENANCE v2
 * When a service task is marked DONE, update the rule and create the next task.
 * MUST be idempotent: no duplicate tasks on double-tap / offline retry.
 */

import { collection, doc, getDoc, getDocs, query, where, updateDoc, serverTimestamp, Timestamp } from '../lib/rnFirestore';
import { db } from '../firebase';
import { paths } from '../lib/firestorePaths';
import { computeNextDueAt } from '../helpers/computeNextDueAt';
import { createServiceTaskFromRule } from './serviceTasks';
import type { ServiceRuleDoc } from './serviceRules';
import type { TaskDoc } from './tasks';

function toServiceRuleFromSnap(snap: { id: string; data: () => Record<string, unknown> }): ServiceRuleDoc {
  const d = snap.data();
  const toDate = (v: unknown) => {
    if (!v) return "";
    if (typeof v === "object" && v !== null && typeof (v as { toDate?: unknown }).toDate === "function") {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    return String(v);
  };
  return {
    id: snap.id,
    projectId: (d.projectId as string) ?? '',
    equipmentId: (d.equipmentId as string) ?? '',
    title: (d.title as string) ?? '',
    intervalUnit: (d.intervalUnit as 'weeks' | 'months') ?? 'weeks',
    intervalValue: (d.intervalValue as number) ?? 1,
    nextDueAt: toDate(d.nextDueAt),
    lastServiceAt: d.lastServiceAt ? toDate(d.lastServiceAt) : null,
    lastGeneratedDueAt: d.lastGeneratedDueAt ? toDate(d.lastGeneratedDueAt) : null,
    checklistTemplate: (d.checklistTemplate as Array<{ id: string; title: string }>) ?? [],
    status: (d.status as 'active' | 'paused' | 'archived') ?? 'active',
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/**
 * Run auto-next when a service task is marked DONE.
 * Call from both taskService.updateTaskStatus and tasks.updateTaskStatus
 * ONLY when newStatus === 'DONE' (not when reverting DONE->OPEN).
 */
export async function runServiceAutoNextOnDone(params: {
  projectId: string;
  task: TaskDoc;
}): Promise<void> {
  const { projectId, task } = params;

  if (!task.serviceRuleId) return;

  const ruleRef = doc(db, paths.projectServiceRule(projectId, task.serviceRuleId));
  const ruleSnap = await getDoc(ruleRef);
  if (!ruleSnap.exists) return;

  const rule = toServiceRuleFromSnap({ id: ruleSnap.id, data: ruleSnap.data() });
  if (rule.status !== 'active') return;

  const baseDate = new Date();
  const computedNext = computeNextDueAt(baseDate, rule.intervalUnit, rule.intervalValue);
  const computedNextStr = computedNext.toISOString().split('T')[0];

  // Primary guard: lastGeneratedDueAt already equals computedNext
  if (rule.lastGeneratedDueAt) {
    const lastGenStr = rule.lastGeneratedDueAt.split('T')[0];
    if (lastGenStr === computedNextStr) return;
  }

  // Secondary guard: exists OPEN task with same serviceRuleId and dueDate
  const tasksRef = collection(db, paths.projectTasks(projectId));
  const existsQuery = query(
    tasksRef,
    where('serviceRuleId', '==', task.serviceRuleId),
    where('status', '==', 'OPEN'),
    where('dueDate', '==', computedNextStr)
  );
  const existsSnap = await getDocs(existsQuery);
  if (!existsSnap.empty) return;

  // Update rule
  await updateDoc(ruleRef, {
    lastServiceAt: Timestamp.fromDate(baseDate),
    nextDueAt: Timestamp.fromDate(computedNext),
    lastGeneratedDueAt: Timestamp.fromDate(computedNext),
    updatedAt: serverTimestamp(),
  });

  // Create next task (outside transaction for simplicity; guards prevent duplicates)
  await createServiceTaskFromRule(projectId, rule, computedNext);
}
