/**
 * Service rules on user-scoped equipment — Firestore:
 * users/{uid}/equipment/{equipmentId}/serviceRules/{ruleId}
 * Same fields as projects/{pid}/serviceRules (MAINTENANCE v2) except projectId is omitted / null.
 */

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "../lib/rnFirestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { computeNextDueAt } from "../helpers/computeNextDueAt";
import type { CreateServiceRuleInput, ServiceRuleDoc, ServiceRuleStatus } from "./serviceRules";

function toServiceRuleDoc(
  _ownerUid: string,
  equipmentId: string,
  snap: { id: string; data: () => Record<string, unknown> }
): ServiceRuleDoc {
  const d = snap.data();
  const toDate = (v: unknown) => {
    if (!v) return "";
    if (v && typeof v === "object" && "toDate" in v) return (v as { toDate: () => Date }).toDate().toISOString();
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
    status: (d.status as ServiceRuleStatus) ?? "active",
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export async function createUserEquipmentServiceRule(
  ownerUid: string,
  equipmentId: string,
  data: CreateServiceRuleInput
): Promise<ServiceRuleDoc> {
  const baseDate = data.startFrom ?? new Date();
  const nextDueAt = computeNextDueAt(baseDate, data.intervalUnit, data.intervalValue);

  const col = collection(db, paths.userEquipmentServiceRules(ownerUid, equipmentId));
  const ref = await addDoc(col, {
    ownerUid,
    equipmentId,
    projectId: null,
    title: data.title.trim(),
    intervalUnit: data.intervalUnit,
    intervalValue: data.intervalValue,
    startFrom: Timestamp.fromDate(baseDate),
    nextDueAt: Timestamp.fromDate(nextDueAt),
    lastServiceAt: null,
    lastGeneratedDueAt: null,
    checklistTemplate: data.checklistTemplate ?? [],
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Failed to create service rule");
  return toServiceRuleDoc(ownerUid, equipmentId, { id: snap.id, data: snap.data.bind(snap) });
}

export async function listUserEquipmentServiceRules(
  ownerUid: string,
  equipmentId: string,
  opts?: { status?: ServiceRuleStatus }
): Promise<ServiceRuleDoc[]> {
  const col = collection(db, paths.userEquipmentServiceRules(ownerUid, equipmentId));
  const q = opts?.status ? query(col, where("status", "==", opts.status)) : col;
  const snap = await getDocs(q);
  return snap.docs.map((d) => toServiceRuleDoc(ownerUid, equipmentId, { id: d.id, data: () => d.data() }));
}

export async function getUserEquipmentServiceRule(
  ownerUid: string,
  equipmentId: string,
  ruleId: string
): Promise<ServiceRuleDoc | null> {
  const ref = doc(db, paths.userEquipmentServiceRule(ownerUid, equipmentId, ruleId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toServiceRuleDoc(ownerUid, equipmentId, { id: snap.id, data: () => snap.data() });
}

export async function updateUserEquipmentServiceRule(
  ownerUid: string,
  equipmentId: string,
  ruleId: string,
  patch: Partial<
    Pick<ServiceRuleDoc, "title" | "intervalUnit" | "intervalValue" | "checklistTemplate" | "status">
  > & { startFrom?: Date | string | null }
): Promise<void> {
  const ref = doc(db, paths.userEquipmentServiceRule(ownerUid, equipmentId, ruleId));
  const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) updateData.title = patch.title.trim();
  if (patch.intervalUnit !== undefined) updateData.intervalUnit = patch.intervalUnit;
  if (patch.intervalValue !== undefined) updateData.intervalValue = patch.intervalValue;
  if (patch.checklistTemplate !== undefined) updateData.checklistTemplate = patch.checklistTemplate;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.startFrom !== undefined) {
    const d = patch.startFrom instanceof Date ? patch.startFrom : new Date(patch.startFrom);
    updateData.startFrom = Timestamp.fromDate(d);
  }

  const needsRecompute =
    patch.intervalUnit !== undefined || patch.intervalValue !== undefined || patch.startFrom !== undefined;
  if (needsRecompute) {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      const intervalUnit = (patch.intervalUnit ?? d.intervalUnit) as "weeks" | "months";
      const intervalValue = (patch.intervalValue ?? d.intervalValue) as number;
      let baseDate: Date;
      if (patch.startFrom !== undefined) {
        baseDate = patch.startFrom instanceof Date ? patch.startFrom : new Date(patch.startFrom);
      } else if (d.startFrom && typeof d.startFrom === "object" && "toDate" in d.startFrom) {
        baseDate = (d.startFrom as { toDate: () => Date }).toDate();
      } else {
        baseDate = new Date();
      }
      const nextDueAt = computeNextDueAt(baseDate, intervalUnit, intervalValue);
      updateData.nextDueAt = Timestamp.fromDate(nextDueAt);
    }
  }

  await updateDoc(ref, updateData);
}
