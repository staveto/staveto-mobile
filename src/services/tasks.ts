import {
  collection,
  collectionGroup,
  addDoc,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";

export type TaskDoc = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  phaseId?: string | null; // Only BUILD projects have phaseId, TRADE/MAINTENANCE have null or undefined
  order?: number;
  trade?: string;
  priority?: string;
  required?: boolean;
  dueDate?: string;
  assigneeId?: string | null;
  assigneeName?: string | null; // Use assigneeName (consistent with types)
  createdAt?: string;
  updatedAt?: string;
  // MVP additions
  origin?: 'TEMPLATE' | 'CUSTOM';
  templateTaskId?: string | null;
  isActive?: boolean; // true = active, false = archived, undefined = legacy (treat as active)
};

function toDoc(
  docSnap: { id: string; data: () => Record<string, unknown> },
  projectId: string
): TaskDoc {
  const d = docSnap.data();
  
  // Convert Firestore Timestamp to ISO string
  const convertTimestamp = (ts: unknown): string | undefined => {
    if (!ts) return undefined;
    if (ts instanceof Timestamp) {
      return ts.toDate().toISOString();
    }
    if (typeof ts === 'string') {
      return ts;
    }
    // Try to convert if it has toDate method
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
      return (ts as { toDate: () => Date }).toDate().toISOString();
    }
    return undefined;
  };
  
  return {
    id: docSnap.id,
    projectId,
    title: (d.title as string) ?? "",
    status: (d.status as string) ?? "OPEN",
    phaseId: (d.phaseId as string | null | undefined) ?? undefined,
    order: d.order as number | undefined,
    trade: d.trade as string | undefined,
    priority: d.priority as string | undefined,
    required: d.required as boolean | undefined,
    dueDate: d.dueDate as string | undefined,
    assigneeId: (d.assigneeId as string | null) ?? undefined,
    assigneeName: (d.assigneeName as string | null) ?? undefined, // Use assigneeName (consistent with types)
    createdAt: convertTimestamp(d.createdAt),
    updatedAt: convertTimestamp(d.updatedAt),
    // MVP additions
    origin: (d.origin as 'TEMPLATE' | 'CUSTOM') ?? undefined,
    templateTaskId: (d.templateTaskId as string | null) ?? undefined,
    isActive: d.isActive !== undefined ? (d.isActive as boolean) : undefined, // undefined = legacy (treat as active)
  };
}

/**
 * Create a custom task in a project
 * Automatically sets order to max(order) + 1 in the phase if not provided
 * Sets origin="CUSTOM" and templateTaskId=null
 */
export async function createTask(
  ownerId: string,
  projectId: string,
  title: string,
  opts?: { phaseId?: string | null; order?: number; trade?: string; dueDate?: string }
): Promise<TaskDoc> {
  // If order is not provided, calculate it automatically
  let order = opts?.order;
  
  // For tasks with phaseId (BUILD projects): calculate order within phase
  // For tasks without phaseId (TRADE/MAINTENANCE): calculate order globally
  if (order === undefined && opts?.phaseId) {
    // Get all active tasks for the phase to calculate max order
    // Note: Query without isActive filter (Firestore doesn't support != false in composite queries)
    // We'll filter in code after fetching
    const tasksRef = collection(db, paths.projectTasks(projectId));
    const phaseQuery = query(
      tasksRef, 
      where("phaseId", "==", opts.phaseId),
      orderBy("order", "desc"),
      limit(10) // Get top 10 to find max order (filter archived in code)
    );
    
    try {
      const phaseSnapshot = await getDocs(phaseQuery);
      const activeTasks = phaseSnapshot.docs
        .map(d => d.data())
        .filter(t => t.isActive !== false); // Filter archived tasks
      
      if (activeTasks.length > 0) {
        const maxOrder = Math.max(...activeTasks.map(t => (t.order as number ?? 0)));
        order = maxOrder + 1;
      } else {
        order = 0; // First task in phase
      }
      console.log(`[tasks] Auto-calculated order for phase ${opts.phaseId}: ${order}`);
    } catch (error: any) {
      // If index error, fallback to simple calculation
      console.warn(`[tasks] Index error, using fallback order calculation:`, error);
      // Fallback: just use 0 or a simple increment
      // Load all tasks and calculate in memory
      const allTasks = await listTasksByProject(projectId);
      const phaseTasks = allTasks.filter(t => t.phaseId === opts.phaseId);
      const maxOrder = phaseTasks.length > 0 
        ? Math.max(...phaseTasks.map(t => t.order ?? 0))
        : -1;
      order = maxOrder + 1;
      console.log(`[tasks] Fallback calculated order: ${order}`);
    }
  } else if (order === undefined) {
    // For TRADE/MAINTENANCE (no phaseId): calculate order globally
    try {
      const tasksRef = collection(db, paths.projectTasks(projectId));
      const globalQuery = query(
        tasksRef,
        where("phaseId", "==", null),
        orderBy("order", "desc"),
        limit(10)
      );
      const globalSnapshot = await getDocs(globalQuery);
      const activeTasks = globalSnapshot.docs
        .map(d => d.data())
        .filter(t => t.isActive !== false);
      
      if (activeTasks.length > 0) {
        const maxOrder = Math.max(...activeTasks.map(t => (t.order as number ?? 0)));
        order = maxOrder + 1;
      } else {
        order = 0;
      }
      console.log(`[tasks] Auto-calculated global order: ${order}`);
    } catch (error: any) {
      // Fallback: load all tasks and calculate in memory
      console.warn(`[tasks] Index error for global order, using fallback:`, error);
      const allTasks = await listTasksByProject(projectId);
      const globalTasks = allTasks.filter(t => !t.phaseId);
      const maxOrder = globalTasks.length > 0 
        ? Math.max(...globalTasks.map(t => t.order ?? 0))
        : -1;
      order = maxOrder + 1;
      console.log(`[tasks] Fallback calculated global order: ${order}`);
    }
  }
  
  const c = collection(db, paths.projectTasks(projectId));
  const ref = await addDoc(c, {
    ownerId,
    projectId, // Required: reference to parent project
    phaseId: opts?.phaseId ?? null, // null for TRADE/MAINTENANCE, string for BUILD
    order: order,
    title: title.trim(),
    trade: opts?.trade ?? null,
    dueDate: opts?.dueDate || null,
    status: "OPEN",
    origin: "CUSTOM", // Mark as custom task
    templateTaskId: null, // Custom tasks don't have template reference
    isActive: true, // Active by default (MVP: soft delete flag)
    assigneeId: null,
    assigneeName: null,
    doneAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  console.log(`[tasks] Created custom task: ${ref.id} in project ${projectId}, phase ${opts?.phaseId || 'none'}, order ${order}`);
  
  return {
    id: ref.id,
    projectId,
    title: title.trim(),
    status: "OPEN",
    phaseId: opts?.phaseId,
    order: order,
    trade: opts?.trade,
    dueDate: opts?.dueDate,
    createdAt: new Date().toISOString(), // Return current time for immediate display
    updatedAt: new Date().toISOString(),
  };
}

/**
 * List all active tasks for a project
 * Filters out archived tasks (isActive === false)
 * Legacy tasks (isActive === undefined) are treated as active
 */
export async function listTasksByProject(projectId: string): Promise<TaskDoc[]> {
  console.log(`[tasks] listTasksByProject called for projectId: ${projectId}`);
  
  // DEBUG: Check auth state
  const currentUser = auth.currentUser;
  const currentUserUid = currentUser?.uid;
  console.log(`[tasks] listTasksByProject: auth.currentUser?.uid = "${currentUserUid}"`);
  
  if (!currentUserUid) {
    console.error(`[tasks] listTasksByProject: auth.currentUser is null`);
    throw new Error('Musíte byť prihlásený na načítanie úloh.');
  }
  
  try {
    const c = collection(db, paths.projectTasks(projectId));
    // Query with filter for active tasks (isActive !== false)
    // Note: Firestore doesn't support != null, so we query all and filter in code
    const q = query(c, orderBy("order", "asc"));
    console.log(`[tasks] listTasksByProject: querying tasks collection...`);
    const snap = await getDocs(q);
    console.log(`[tasks] Found ${snap.docs.length} tasks in Firestore (before filtering)`);
    
    const list = snap.docs
      .map((d) => toDoc({ id: d.id, data: d.data.bind(d) }, projectId))
      .filter((task) => {
        // Filter: isActive !== false (include true and undefined/legacy)
        return task.isActive !== false;
      });
    
    console.log(`[tasks] After filtering archived tasks: ${list.length} active tasks`);
    
    list.sort((a, b) => {
      const oA = a.order ?? 0;
      const oB = b.order ?? 0;
      if (oA !== oB) return oA - oB;
      // Compare createdAt as strings (ISO format)
      const createdAtA = a.createdAt ?? "";
      const createdAtB = b.createdAt ?? "";
      return createdAtA.localeCompare(createdAtB);
    });
    return list;
  } catch (error: any) {
    console.error(`[tasks] listTasksByProject error:`, error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Unknown error';
    
    if (errorCode === 'permission-denied') {
      console.error(`[tasks] listTasksByProject: PERMISSION DENIED for project ${projectId}`);
      console.error(`[tasks] listTasksByProject: auth.currentUser.uid = "${currentUserUid}"`);
      console.error(`[tasks] listTasksByProject: Firestore rule: projectOwner(${projectId})`);
      console.error(`[tasks] listTasksByProject: Rule check: get(projects/${projectId}).data.ownerId == ${currentUserUid}`);
      console.error(`[tasks] listTasksByProject: Returning empty array instead of throwing error`);
      // Return empty array instead of throwing - allows app to continue
      return [];
    }
    
    throw error;
  }
}

/** List all tasks for the owner across projects (uses collection group). */
export async function listMyTasks(ownerId: string): Promise<TaskDoc[]> {
  const cg = collectionGroup(db, "tasks");
  const q = query(cg, where("ownerId", "==", ownerId));
  const snap = await getDocs(q);
  const list: TaskDoc[] = [];
  snap.docs.forEach((d) => {
    const path = d.ref.path;
    const match = /^projects\/([^/]+)\/tasks\//.exec(path);
    const projectId = match ? match[1] : "";
    list.push(toDoc({ id: d.id, data: d.data.bind(d) }, projectId));
  });
  list.sort((a, b) => {
    // Compare createdAt as strings (ISO format)
    const createdAtA = a.createdAt ?? "";
    const createdAtB = b.createdAt ?? "";
    return createdAtB.localeCompare(createdAtA);
  });
  return list;
}

export async function updateTaskStatus(
  _ownerId: string,
  projectId: string,
  taskId: string,
  status: string
): Promise<void> {
  const ref = doc(db, paths.projectTask(projectId, taskId));
  await updateDoc(ref, {
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateTaskAssignee(
  _ownerId: string,
  projectId: string,
  taskId: string,
  assigneeId: string | null,
  assigneeName?: string | null
): Promise<void> {
  const ref = doc(db, paths.projectTask(projectId, taskId));
  await updateDoc(ref, {
    assigneeId: assigneeId ?? null,
    assigneeName: assigneeName ?? null, // Use assigneeName (consistent with types)
    updatedAt: serverTimestamp(), // Use serverTimestamp()
  });
}

/**
 * Archive a task (soft delete)
 * Sets isActive=false
 */
export async function archiveTask(
  projectId: string,
  taskId: string
): Promise<void> {
  const ref = doc(db, paths.projectTask(projectId, taskId));
  await updateDoc(ref, {
    isActive: false,
    updatedAt: serverTimestamp(),
  });
  console.log(`[tasks] Archived task ${taskId} in project ${projectId}`);
}

/**
 * Reorder a task within its phase (move up or down)
 * Swaps order with the nearest neighbor task in the same phase
 */
export async function reorderTask(
  projectId: string,
  taskId: string,
  direction: 'up' | 'down'
): Promise<void> {
  // Get current task
  const taskRef = doc(db, paths.projectTask(projectId, taskId));
  const taskSnap = await getDoc(taskRef);
  
  if (!taskSnap.exists()) {
    throw new Error(`Task ${taskId} not found`);
  }
  
  const currentTaskData = taskSnap.data();
  const currentPhaseId = currentTaskData.phaseId;
  const currentOrder = currentTaskData.order ?? 0;
  
  // Get all active tasks in the same phase, ordered by order
  // Note: Firestore doesn't support != false directly, so we query all and filter
  const allTasksQuery = query(
    collection(db, paths.projectTasks(projectId)),
    where('phaseId', '==', currentPhaseId),
    orderBy('order', 'asc')
  );
  
  const allTasksSnap = await getDocs(allTasksQuery);
  const phaseTasks = allTasksSnap.docs
    .map(d => ({
      id: d.id,
      order: d.data().order ?? 0,
      isActive: d.data().isActive,
    }))
    .filter(t => t.isActive !== false) // Filter archived tasks
    .sort((a, b) => a.order - b.order);
  
  // Find current task index
  const currentIndex = phaseTasks.findIndex(t => t.id === taskId);
  if (currentIndex === -1) {
    throw new Error(`Task ${taskId} not found in phase ${currentPhaseId}`);
  }
  
  // Find neighbor index
  let neighborIndex: number;
  if (direction === 'up') {
    neighborIndex = currentIndex - 1;
  } else {
    neighborIndex = currentIndex + 1;
  }
  
  // Check bounds
  if (neighborIndex < 0 || neighborIndex >= phaseTasks.length) {
    console.log(`[tasks] Cannot move task ${direction}: already at ${direction === 'up' ? 'top' : 'bottom'}`);
    return; // Already at boundary, do nothing
  }
  
  // Swap orders
  const neighborTaskId = phaseTasks[neighborIndex].id;
  const neighborOrder = phaseTasks[neighborIndex].order;
  
  const batch = writeBatch(db);
  batch.update(taskRef, {
    order: neighborOrder,
    updatedAt: serverTimestamp(),
  });
  
  const neighborRef = doc(db, paths.projectTask(projectId, neighborTaskId));
  batch.update(neighborRef, {
    order: currentOrder,
    updatedAt: serverTimestamp(),
  });
  
  await batch.commit();
  console.log(`[tasks] Reordered task ${taskId} ${direction} in phase ${currentPhaseId} (order ${currentOrder} ↔ ${neighborOrder})`);
}

/**
 * Update task title and due date
 */
export async function updateTaskTitle(
  _ownerId: string,
  projectId: string,
  taskId: string,
  title: string,
  dueDate?: string | null
): Promise<void> {
  const ref = doc(db, paths.projectTask(projectId, taskId));
  const updateData: any = {
    title,
    updatedAt: serverTimestamp(),
  };
  if (dueDate !== undefined) {
    updateData.dueDate = dueDate || null;
  }
  await updateDoc(ref, updateData);
  console.log(`[tasks] Updated task ${taskId} title to "${title}"${dueDate !== undefined ? `, dueDate to "${dueDate || 'null'}"` : ''}`);
}

/**
 * Delete a task permanently
 */
export async function deleteTask(
  _ownerId: string,
  projectId: string,
  taskId: string
): Promise<void> {
  const ref = doc(db, paths.projectTask(projectId, taskId));
  await deleteDoc(ref);
  console.log(`[tasks] Deleted task ${taskId} from project ${projectId}`);
}
