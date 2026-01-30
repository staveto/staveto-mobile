import { 
  doc, 
  updateDoc, 
  serverTimestamp,
  getDoc 
} from 'firebase/firestore';
import { db } from '../firebase';
import { paths } from '../lib/firestorePaths';
import type { TaskStatus, ProjectTask } from '../lib/types';

/**
 * Update task status with proper doneAt handling
 * Rules:
 * - DONE sets doneAt
 * - If status changes from DONE to OPEN, doneAt = null
 */
export async function updateTaskStatus(
  projectId: string,
  taskId: string,
  newStatus: TaskStatus
): Promise<void> {
  const taskRef = doc(db, paths.projectTask(projectId, taskId));
  
  // Get current task to check previous status
  const taskSnap = await getDoc(taskRef);
  if (!taskSnap.exists()) {
    throw new Error(`Task ${taskId} not found`);
  }
  
  const currentTask = taskSnap.data() as ProjectTask;
  const currentStatus = currentTask.status;
  
  const updateData: any = {
    status: newStatus,
    updatedAt: serverTimestamp(), // Use serverTimestamp()
  };
  
  // Handle doneAt based on status transition
  if (newStatus === 'DONE') {
    updateData.doneAt = serverTimestamp();
  } else if (currentStatus === 'DONE' && newStatus !== 'DONE') {
    // Reverting from DONE to another status
    updateData.doneAt = null;
  }
  
  await updateDoc(taskRef, updateData);
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
    assigneeId: userId, // Use assigneeId (consistent with types)
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
    assigneeId: userId, // Use assigneeId (consistent with types)
    assigneeName: assigneeName || null,
    assignedTrade: trade,
    updatedAt: serverTimestamp(),
  });
}
