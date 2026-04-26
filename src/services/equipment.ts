/**
 * Equipment service - MAINTENANCE v2
 * CRUD for equipment (assets) under projects.
 */

import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from '../lib/rnFirestore';
import { db, getStorage } from '../firebase';
import { paths } from '../lib/firestorePaths';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars

function mapLegacyTypeToCategory(type?: string): EquipmentCategory {
  if (type === 'vehicle') return 'vehicle';
  if (type === 'mixer' || type === 'excavator') return 'machine';
  return 'other';
}

function generateQrToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += ALPHABET[bytes[i % 16] % ALPHABET.length];
  }
  return result;
}

/** @deprecated Use category instead */
export type EquipmentType = 'mixer' | 'excavator' | 'vehicle' | 'other';

export type EquipmentCategory = 'machine' | 'tool' | 'vehicle' | 'building' | 'other';

export interface EquipmentDoc {
  id: string;
  projectId: string;
  name: string;
  type?: EquipmentType; // legacy
  category: EquipmentCategory;
  subcategory?: string;
  labelCode?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
  status: 'active' | 'archived';
  qrToken: string;
  photoUrl?: string;
  photoPath?: string;
  /** Optional migration pointer (written by legacy → user equipment migration). */
  migratedToUserEquipmentId?: string;
  createdAt: string;
  updatedAt: string;
}

function toEquipmentDoc(snap: { id: string; data: () => Record<string, unknown> }): EquipmentDoc {
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
    name: (d.name as string) ?? '',
    type: d.type as EquipmentType | undefined,
    category: (d.category as EquipmentCategory) ?? mapLegacyTypeToCategory(d.type as string | undefined),
    subcategory: d.subcategory as string | undefined,
    labelCode: d.labelCode as string | undefined,
    model: d.model as string | undefined,
    serialNumber: d.serialNumber as string | undefined,
    location: d.location as string | undefined,
    status: (d.status as 'active' | 'archived') ?? 'active',
    qrToken: (d.qrToken as string) ?? '',
    photoUrl: d.photoUrl as string | undefined,
    photoPath: d.photoPath as string | undefined,
    migratedToUserEquipmentId: d.migratedToUserEquipmentId as string | undefined,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export interface CreateEquipmentInput {
  name: string;
  category: EquipmentCategory;
  subcategory?: string;
  labelCode?: string;
  model?: string;
  serialNumber?: string;
  location?: string;
}

export async function createEquipment(
  projectId: string,
  data: CreateEquipmentInput
): Promise<string> {
  const qrToken = generateQrToken();
  const col = collection(db, paths.projectEquipment(projectId));
  const ref = await addDoc(col, {
    projectId,
    name: data.name.trim(),
    category: data.category,
    subcategory: data.subcategory?.trim() || null,
    labelCode: data.labelCode?.trim() || null,
    model: data.model?.trim() || null,
    serialNumber: data.serialNumber?.trim() || null,
    location: data.location?.trim() || null,
    status: 'active',
    qrToken,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function uploadEquipmentPhoto(
  projectId: string,
  equipmentId: string,
  localUri: string,
  mimeType = 'image/jpeg'
): Promise<{ photoUrl: string; photoPath: string }> {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const storagePath = `projects/${projectId}/equipment/${equipmentId}/photo_${Date.now()}.${ext}`;
  const storageInstance = getStorage();
  if (!storageInstance) throw new Error('Firebase Storage nie je dostupný.');
  const storageRef = storageInstance.ref(storagePath);
  await storageRef.putFile(localUri, { contentType: mimeType });
  const photoUrl = await storageRef.getDownloadURL();
  return { photoUrl, photoPath: storagePath };
}

export async function removeEquipmentPhoto(
  projectId: string,
  _equipmentId: string,
  photoPath: string
): Promise<void> {
  const storageInstance = getStorage();
  if (!storageInstance) return;
  const storageRef = storageInstance.ref(photoPath);
  await storageRef.delete();
}

export async function listEquipment(
  projectId: string,
  opts?: { status?: 'active' | 'archived' }
): Promise<EquipmentDoc[]> {
  const col = collection(db, paths.projectEquipment(projectId));
  let q = query(col);
  if (opts?.status) {
    q = query(col, where('status', '==', opts.status));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => toEquipmentDoc({ id: d.id, data: () => d.data() }));
}

export async function getEquipment(
  projectId: string,
  equipmentId: string
): Promise<EquipmentDoc | null> {
  const ref = doc(db, paths.projectEquipmentItem(projectId, equipmentId));
  const snap = await getDoc(ref);
  if (!snap.exists) return null;
  return toEquipmentDoc({ id: snap.id, data: () => snap.data() });
}

export async function updateEquipment(
  projectId: string,
  equipmentId: string,
  patch: Partial<CreateEquipmentInput | { status: 'active' | 'archived'; photoUrl?: string | null; photoPath?: string | null }>
): Promise<void> {
  const ref = doc(db, paths.projectEquipmentItem(projectId, equipmentId));
  const updateData: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.name !== undefined) updateData.name = patch.name.trim();
  if (patch.category !== undefined) updateData.category = patch.category;
  if (patch.subcategory !== undefined) updateData.subcategory = patch.subcategory?.trim() || null;
  if (patch.labelCode !== undefined) updateData.labelCode = patch.labelCode?.trim() || null;
  if (patch.model !== undefined) updateData.model = patch.model?.trim() || null;
  if (patch.serialNumber !== undefined) updateData.serialNumber = patch.serialNumber?.trim() || null;
  if (patch.location !== undefined) updateData.location = patch.location?.trim() || null;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.photoUrl !== undefined) updateData.photoUrl = patch.photoUrl ?? null;
  if (patch.photoPath !== undefined) updateData.photoPath = patch.photoPath ?? null;
  await updateDoc(ref, updateData);
}

export async function archiveEquipment(projectId: string, equipmentId: string): Promise<void> {
  await updateEquipment(projectId, equipmentId, { status: 'archived' });
}

export async function findEquipmentByQrToken(qrToken: string): Promise<{
  projectId: string;
  equipmentId: string;
} | null> {
  const group = collectionGroup(db, 'equipment');
  const q = query(group, where('qrToken', '==', qrToken), where('status', '==', 'active'));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  const projectId = data.projectId as string;
  if (!projectId) return null;
  return { projectId, equipmentId: doc.id };
}
