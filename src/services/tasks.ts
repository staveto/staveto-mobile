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
} from "../lib/rnFirestore";
import { db, auth } from "../firebase";
import { paths } from "../lib/firestorePaths";
import { upsertTaskDueNotification, markTaskNotificationsRead, recordSyncIssue } from "./notifications";
import { getUserTier, checkLimit, getSubscriptionLimits } from "./subscription";
import { addProjectEvent } from "./projectEvents";

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
  assignedTo?: string | null;
  assignedToEmail?: string | null;
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
    assignedTo: (d.assignedTo as string | null) ?? undefined,
    assignedToEmail: (d.assignedToEmail as string | null) ?? undefined,
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
  // Check subscription limit before creating task
  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    try {
      const existingTasks = await listTasksByProject(projectId);
      const activeTasksCount = existingTasks.filter(t => t.isActive !== false).length;
      const limitCheck = await checkLimit(currentUser.uid, "tasks", activeTasksCount);
      
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.message || `Dosiahli ste limit úloh pre váš plán (${limitCheck.limit}). Zvážte upgrade na vyšší tier.`);
      }
    } catch (error: any) {
      // If limit check fails, throw error (don't create task)
      if (error.message && error.message.includes("limit")) {
        throw error;
      }
      // If it's a different error, log but allow creation (server will enforce)
      console.warn("[tasks] Subscription limit check failed, allowing creation (server will enforce):", error);
    }
  }
  
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
  let ref;
  try {
    ref = await addDoc(c, {
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
  } catch (error: any) {
    if (error?.code === "unavailable" || error?.code === "network-request-failed") {
      await recordSyncIssue("Nepodarilo sa uložiť úlohu. Skontrolujte pripojenie a skúste znova.");
    }
    throw error;
  }
  
  console.log(`[tasks] Created custom task: ${ref.id} in project ${projectId}, phase ${opts?.phaseId || 'none'}, order ${order}`);
  
  if (currentUser?.uid) {
    try {
      const { getProject } = await import("./projects");
      const project = await getProject(projectId);
      await upsertTaskDueNotification({
        userId: currentUser.uid,
        taskId: ref.id,
        taskTitle: title.trim(),
        dueDate: opts?.dueDate ?? null,
        projectId,
        projectName: project?.name ?? null,
      });
    } catch (error) {
      console.warn("[tasks] Failed to create due notification:", error);
    }
  }

  try {
    await addProjectEvent(
      projectId,
      "task_created",
      { taskTitle: title.trim() },
      { kind: "task", id: ref.id }
    );
  } catch (error) {
    console.warn("[tasks] Failed to create task_created event:", error);
  }

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

/** List all tasks for the owner across projects (loads via projects to avoid collectionGroup permission issues). */
export async function listMyTasks(ownerId: string): Promise<TaskDoc[]> {
  // Import projectsService here to avoid circular dependency
  const { listMyProjects } = await import("./projects");
  
  // Load all projects first
  const projects = await listMyProjects(ownerId);
  
  // Load all tasks from all projects in parallel
  const allTasksPromises = projects.map(async (project) => {
    try {
      const tasks = await listTasksByProject(project.id);
      return tasks.map(task => ({ ...task, projectId: project.id }));
    } catch (error: any) {
      console.warn(`[tasks] Error loading tasks for project ${project.id}:`, error);
      return [];
    }
  });
  
  const allTasksArrays = await Promise.all(allTasksPromises);
  const allTasks = allTasksArrays.flat();
  
  // Filter out archived tasks (isActive === false)
  const activeTasks = allTasks.filter(task => task.isActive !== false);
  
  // Sort by createdAt descending (most recent first)
  activeTasks.sort((a, b) => {
    const createdAtA = a.createdAt ?? "";
    const createdAtB = b.createdAt ?? "";
    return createdAtB.localeCompare(createdAtA);
  });
  
  return activeTasks;
}

export async function updateTaskStatus(
  _ownerId: string,
  projectId: string,
  taskId: string,
  status: string
): Promise<void> {
  const currentUser = auth.currentUser;
  let taskTitle = "";
  try {
    const beforeSnap = await getDoc(doc(db, paths.projectTask(projectId, taskId)));
    if (beforeSnap.exists()) {
      const beforeData = beforeSnap.data() as { title?: string };
      taskTitle = beforeData.title ?? "";
    }
  } catch (error) {
    console.warn("[tasks] Failed to read task before status update:", error);
  }
  const ref = doc(db, paths.projectTask(projectId, taskId));
  await updateDoc(ref, {
    status,
    updatedAt: new Date().toISOString(),
  });

  if (currentUser?.uid && status === "DONE") {
    try {
      await markTaskNotificationsRead(currentUser.uid, taskId);
    } catch (error) {
      console.warn("[tasks] Failed to mark task notifications as read:", error);
    }
    try {
      await addProjectEvent(
        projectId,
        "task_done",
        { taskTitle: taskTitle || undefined },
        { kind: "task", id: taskId }
      );
    } catch (error) {
      console.warn("[tasks] Failed to create task_done event:", error);
    }
  }
}

/**
 * Get a single task by projectId + taskId
 */
export async function getTaskById(projectId: string, taskId: string): Promise<TaskDoc | null> {
  try {
    const ref = doc(db, paths.projectTask(projectId, taskId));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return toDoc({ id: snap.id, data: snap.data.bind(snap) }, projectId);
  } catch (error) {
    console.error(`[tasks] Error loading task ${taskId} from project ${projectId}:`, error);
    return null;
  }
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
 * Move a task to a different phase
 */
export async function moveTaskToPhase(
  projectId: string,
  taskId: string,
  newPhaseId: string | null
): Promise<void> {
  const taskRef = doc(db, paths.projectTask(projectId, taskId));
  const taskSnap = await getDoc(taskRef);
  
  if (!taskSnap.exists()) {
    throw new Error(`Task ${taskId} not found`);
  }
  
  // Calculate new order in the target phase
  let newOrder = 0;
  try {
    const targetPhaseQuery = query(
      collection(db, paths.projectTasks(projectId)),
      where('phaseId', '==', newPhaseId),
      orderBy('order', 'desc'),
      limit(1)
    );
    const targetPhaseSnap = await getDocs(targetPhaseQuery);
    const activeTasks = targetPhaseSnap.docs
      .map(d => d.data())
      .filter(t => t.isActive !== false);
    
    if (activeTasks.length > 0) {
      newOrder = (activeTasks[0].order as number ?? 0) + 1;
    } else {
      newOrder = 0;
    }
  } catch (error: any) {
    // Fallback: load all tasks and calculate in memory
    console.warn(`[tasks] Index error for phase order, using fallback:`, error);
    const allTasks = await listTasksByProject(projectId);
    const phaseTasks = allTasks.filter(t => t.phaseId === newPhaseId);
    const maxOrder = phaseTasks.length > 0 
      ? Math.max(...phaseTasks.map(t => t.order ?? 0))
      : -1;
    newOrder = maxOrder + 1;
  }
  
  // Update task with new phaseId and order
  await updateDoc(taskRef, {
    phaseId: newPhaseId,
    order: newOrder,
    updatedAt: serverTimestamp(),
  });
  
  console.log(`[tasks] Moved task ${taskId} to phase ${newPhaseId || 'null'} with order ${newOrder}`);
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
  try {
    await updateDoc(ref, updateData);
  } catch (error: any) {
    if (error?.code === "unavailable" || error?.code === "network-request-failed") {
      await recordSyncIssue("Nepodarilo sa uložiť zmenu úlohy. Skontrolujte pripojenie a skúste znova.");
    }
    throw error;
  }

  const currentUser = auth.currentUser;
  if (currentUser?.uid) {
    try {
      if (dueDate) {
        const { getProject } = await import("./projects");
        const project = await getProject(projectId);
        await upsertTaskDueNotification({
          userId: currentUser.uid,
          taskId,
          taskTitle: title.trim(),
          dueDate,
          projectId,
          projectName: project?.name ?? null,
        });
      } else {
        await markTaskNotificationsRead(currentUser.uid, taskId);
      }
    } catch (error) {
      console.warn("[tasks] Failed to update due notification:", error);
    }
  }
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
