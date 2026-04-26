/**
 * When a user-equipment service task is marked DONE, advance the rule and create the next task.
 * Same idempotency pattern as serviceAutoNext.ts (project tasks).
 */

import { doc, getDoc, updateDoc, serverTimestamp, Timestamp } from "../lib/rnFirestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { computeNextDueAt } from "../helpers/computeNextDueAt";
import { createUserEquipmentServiceTaskFromRule } from "./userEquipmentServiceTasks";
import type { ServiceRuleDoc } from "./serviceRules";
import { listUserEquipmentServiceTasks } from "./userEquipmentServiceTasks";

function toServiceRuleFromSnap(
  equipmentId: string,
  snap: { id: string; data: () => Record<string, unknown> }
): ServiceRuleDoc {
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
    projectId: (d.projectId as string) || "",
    equipmentId: (d.equipmentId as string) || equipmentId,
    title: (d.title as string) ?? "",
    intervalUnit: (d.intervalUnit as "weeks" | "months") ?? "weeks",
    intervalValue: (d.intervalValue as number) ?? 1,
    startFrom: d.startFrom ? toDate(d.startFrom) : null,
    nextDueAt: toDate(d.nextDueAt),
    lastServiceAt: d.lastServiceAt ? toDate(d.lastServiceAt) : null,
    lastGeneratedDueAt: d.lastGeneratedDueAt ? toDate(d.lastGeneratedDueAt) : null,
    checklistTemplate: (d.checklistTemplate as Array<{ id: string; title: string }>) ?? [],
    status: (d.status as "active" | "paused" | "archived") ?? "active",
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export async function runUserEquipmentServiceAutoNextOnDone(params: {
  ownerUid: string;
  equipmentId: string;
  serviceRuleId: string;
}): Promise<void> {
  const { ownerUid, equipmentId, serviceRuleId } = params;

  const ruleRef = doc(db, paths.userEquipmentServiceRule(ownerUid, equipmentId, serviceRuleId));
  const ruleSnap = await getDoc(ruleRef);
  if (!ruleSnap.exists()) return;

  const rule = toServiceRuleFromSnap(equipmentId, { id: ruleSnap.id, data: ruleSnap.data() });
  if (rule.status !== "active") return;

  const baseDate = new Date();
  const computedNext = computeNextDueAt(baseDate, rule.intervalUnit, rule.intervalValue);
  const computedNextStr = computedNext.toISOString().split("T")[0];

  if (rule.lastGeneratedDueAt) {
    const lastGenStr = rule.lastGeneratedDueAt.split("T")[0];
    if (lastGenStr === computedNextStr) return;
  }

  const openTasks = await listUserEquipmentServiceTasks(ownerUid, equipmentId, { status: "OPEN" });
  const duplicate = openTasks.some(
    (t) => t.serviceRuleId === serviceRuleId && (t.dueDate ?? "").trim() === computedNextStr
  );
  if (duplicate) return;

  await updateDoc(ruleRef, {
    lastServiceAt: Timestamp.fromDate(baseDate),
    nextDueAt: Timestamp.fromDate(computedNext),
    lastGeneratedDueAt: Timestamp.fromDate(computedNext),
    updatedAt: serverTimestamp(),
  });

  await createUserEquipmentServiceTaskFromRule(ownerUid, equipmentId, rule, computedNext);
}
