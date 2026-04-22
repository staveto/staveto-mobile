/**
 * User-scoped equipment (assets) — Firestore: users/{uid}/equipment/{id}.
 * Separate from project subcollection equipment (services/equipment.ts).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "../lib/rnFirestore";
import { db, getStorage } from "../firebase";
import { paths } from "../lib/firestorePaths";
import type { EquipmentCategory } from "./equipment";

export type UserEquipmentStatus = "available" | "assigned" | "in_service" | "inactive";

export interface UserEquipmentDoc {
  id: string;
  ownerId: string;
  name: string;
  category: EquipmentCategory | string;
  kind?: string;
  /** Migrated from legacy project equipment `model` when present. */
  model?: string;
  status: UserEquipmentStatus;
  serialNumber?: string;
  internalCode?: string;
  locationText?: string;
  notes?: string;
  photoUrl?: string;
  photoPath?: string;
  assignedProjectId?: string | null;
  assignedToUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Traceability: migrated from `projects/{sourceLegacyProjectId}/equipment/{sourceLegacyEquipmentId}`. */
  sourceLegacyProjectId?: string | null;
  sourceLegacyEquipmentId?: string | null;
  legacySourceType?: string | null;
  migratedAt?: string;
  migrationVersion?: number;
  migratedBy?: string | null;
}

function toIso(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "toDate" in v) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return String(v);
}

function toDoc(uid: string, snap: { id: string; data: () => Record<string, unknown> }): UserEquipmentDoc {
  const d = snap.data();
  const statusRaw = d.status as string | undefined;
  const status: UserEquipmentStatus =
    statusRaw === "assigned" || statusRaw === "in_service" || statusRaw === "inactive"
      ? statusRaw
      : "available";
  return {
    id: snap.id,
    ownerId: (d.ownerId as string) ?? uid,
    name: (d.name as string) ?? "",
    category: (d.category as EquipmentCategory | string) ?? "other",
    kind: (d.kind as string) || undefined,
    status,
    serialNumber: (d.serialNumber as string) || undefined,
    internalCode: (d.internalCode as string) || undefined,
    locationText: (d.locationText as string) || undefined,
    notes: (d.notes as string) || undefined,
    photoUrl: (d.photoUrl as string) || undefined,
    photoPath: (d.photoPath as string) || undefined,
    assignedProjectId: (d.assignedProjectId as string) || null,
    assignedToUserId: (d.assignedToUserId as string) || null,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
    model: (d.model as string) || undefined,
    sourceLegacyProjectId: (d.sourceLegacyProjectId as string) || undefined,
    sourceLegacyEquipmentId: (d.sourceLegacyEquipmentId as string) || undefined,
    legacySourceType: (d.legacySourceType as string) || undefined,
    migratedAt: d.migratedAt ? toIso(d.migratedAt) : undefined,
    migrationVersion: typeof d.migrationVersion === "number" ? d.migrationVersion : undefined,
    migratedBy: (d.migratedBy as string) || undefined,
  };
}

export type CreateUserEquipmentInput = {
  name: string;
  category: EquipmentCategory | string;
  kind?: string;
  model?: string;
  serialNumber?: string;
  internalCode?: string;
  locationText?: string;
  notes?: string;
  status?: UserEquipmentStatus;
};

export async function listUserEquipment(
  uid: string,
  opts?: { status?: UserEquipmentStatus | "all" }
): Promise<UserEquipmentDoc[]> {
  const col = collection(db, paths.userEquipment(uid));
  const q = query(col, orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => toDoc(uid, { id: d.id, data: () => d.data() }));
  if (opts?.status && opts.status !== "all") {
    rows = rows.filter((r) => r.status === opts.status);
  }
  return rows;
}

export async function getUserEquipment(uid: string, equipmentId: string): Promise<UserEquipmentDoc | null> {
  const ref = doc(db, paths.userEquipmentItem(uid, equipmentId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toDoc(uid, { id: snap.id, data: () => snap.data() });
}

export async function createUserEquipment(uid: string, data: CreateUserEquipmentInput): Promise<string> {
  const col = collection(db, paths.userEquipment(uid));
  const ref = await addDoc(col, {
    ownerId: uid,
    name: data.name.trim(),
    category: data.category,
    kind: data.kind?.trim() || null,
    model: data.model?.trim() || null,
    serialNumber: data.serialNumber?.trim() || null,
    internalCode: data.internalCode?.trim() || null,
    locationText: data.locationText?.trim() || null,
    notes: data.notes?.trim() || null,
    status: data.status ?? "available",
    assignedProjectId: null,
    assignedToUserId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export type UpdateUserEquipmentInput = Partial<
  CreateUserEquipmentInput & {
    status: UserEquipmentStatus;
    photoUrl: string | null;
    photoPath: string | null;
    assignedProjectId: string | null;
    assignedToUserId: string | null;
  }
>;

export async function updateUserEquipment(
  uid: string,
  equipmentId: string,
  patch: UpdateUserEquipmentInput
): Promise<void> {
  const ref = doc(db, paths.userEquipmentItem(uid, equipmentId));
  const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.category !== undefined) updateData.category = patch.category;
  if (patch.kind !== undefined) updateData.kind = patch.kind?.trim() || null;
  if (patch.model !== undefined) updateData.model = patch.model?.trim() || null;
  if (patch.serialNumber !== undefined) updateData.serialNumber = patch.serialNumber?.trim() || null;
  if (patch.internalCode !== undefined) updateData.internalCode = patch.internalCode?.trim() || null;
  if (patch.locationText !== undefined) updateData.locationText = patch.locationText?.trim() || null;
  if (patch.notes !== undefined) updateData.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.photoUrl !== undefined) updateData.photoUrl = patch.photoUrl;
  if (patch.photoPath !== undefined) updateData.photoPath = patch.photoPath;
  if (patch.assignedProjectId !== undefined) updateData.assignedProjectId = patch.assignedProjectId || null;
  if (patch.assignedToUserId !== undefined) updateData.assignedToUserId = patch.assignedToUserId || null;
  await updateDoc(ref, updateData);
}

export async function deleteUserEquipment(uid: string, equipmentId: string): Promise<void> {
  await deleteDoc(doc(db, paths.userEquipmentItem(uid, equipmentId)));
}

export async function uploadUserEquipmentPhoto(
  uid: string,
  equipmentId: string,
  localUri: string,
  mimeType = "image/jpeg"
): Promise<{ photoUrl: string; photoPath: string }> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const storagePath = `users/${uid}/equipment/${equipmentId}/photo_${Date.now()}.${ext}`;
  const storageInstance = getStorage();
  if (!storageInstance) throw new Error("Storage unavailable");
  const storageRef = storageInstance.ref(storagePath);
  await storageRef.putFile(localUri, { contentType: mimeType });
  const photoUrl = await storageRef.getDownloadURL();
  return { photoUrl, photoPath: storagePath };
}

export async function removeUserEquipmentPhoto(photoPath: string): Promise<void> {
  const storageInstance = getStorage();
  if (!storageInstance) return;
  await storageInstance.ref(photoPath).delete();
}

/** Set project assignment and align status to assigned / available when unassigned. */
export async function setUserEquipmentProjectAssignment(
  uid: string,
  equipmentId: string,
  projectId: string | null
): Promise<void> {
  if (projectId) {
    await updateUserEquipment(uid, equipmentId, {
      assignedProjectId: projectId,
      status: "assigned",
    });
  } else {
    await updateUserEquipment(uid, equipmentId, {
      assignedProjectId: null,
      status: "available",
    });
  }
}
