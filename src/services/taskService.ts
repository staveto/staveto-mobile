import {
  doc,
  updateDoc,
  serverTimestamp,
} from '../lib/rnFirestore';
import { db } from '../firebase';
import { paths } from '../lib/firestorePaths';
import type { TaskStatus } from '../lib/types';
import { updateTaskStatus as updateTaskStatusCore } from './tasks';
import { auth } from '../firebase';

/**
 * Update task status with proper doneAt handling (delegates to services/tasks).
 */
export async function updateTaskStatus(
  projectId: string,
  taskId: string,
  newStatus: TaskStatus,
  ownerId?: string
): Promise<void> {
  const uid = ownerId ?? auth.currentUser?.uid ?? "";
  await updateTaskStatusCore(uid, projectId, taskId, newStatus);
}

/**
 * Assign task to a user
 */
export async function assignTask(
  projectId: string,
  taskId: string,
  userId: string | null,
  assigneeName?: string | null
): Promise<void> {
  const taskRef = doc(db, paths.projectTask(projectId, taskId));

  await updateDoc(taskRef, {
    assigneeId: userId,
    assigneeName: assigneeName || null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Assign task to a trade (optional field)
 */
export async function assignTaskToTrade(
  projectId: string,
  taskId: string,
  trade: string | null
): Promise<void> {
  const taskRef = doc(db, paths.projectTask(projectId, taskId));

  await updateDoc(taskRef, {
    assignedTrade: trade,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Assign task to both user and trade
 */
export async function assignTaskToUserAndTrade(
  projectId: string,
  taskId: string,
  userId: string | null,
  trade: string | null,
  assigneeName?: string | null
): Promise<void> {
  const taskRef = doc(db, paths.projectTask(projectId, taskId));

  await updateDoc(taskRef, {
    assigneeId: userId,
    assigneeName: assigneeName || null,
    assignedTrade: trade,
    updatedAt: serverTimestamp(),
  });
}
