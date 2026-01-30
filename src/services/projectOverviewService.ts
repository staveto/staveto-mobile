import { 
  collection, 
  getDocs, 
  query, 
  orderBy,
  where,
  collectionGroup 
} from 'firebase/firestore';
import { db } from '../firebase';
import { paths } from '../lib/firestorePaths';
import type { ProjectPhase, ProjectTask, PhaseStats, ProjectStats } from '../lib/types';

/**
 * Get project phases ordered by order field
 */
export async function getProjectPhases(projectId: string): Promise<ProjectPhase[]> {
  const phasesRef = collection(db, paths.projectPhases(projectId));
  const q = query(phasesRef, orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as ProjectPhase[];
}

/**
 * Get all tasks for a project
 */
export async function getProjectTasks(projectId: string): Promise<ProjectTask[]> {
  const tasksRef = collection(db, paths.projectTasks(projectId));
  const snapshot = await getDocs(tasksRef);
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as ProjectTask[];
}

/**
 * Get tasks for a specific phase
 */
export async function getPhaseTasks(
  projectId: string, 
  phaseId: string
): Promise<ProjectTask[]> {
  const tasksRef = collection(db, paths.projectTasks(projectId));
  const q = query(tasksRef, where('phaseId', '==', phaseId), orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as ProjectTask[];
}

/**
 * Calculate phase statistics
 */
export function calculatePhaseStats(
  phaseId: string,
  tasks: ProjectTask[]
): PhaseStats {
  const phaseTasks = tasks.filter(t => t.phaseId === phaseId);
  const total = phaseTasks.length;
  const open = phaseTasks.filter(t => t.status === 'OPEN').length;
  const done = phaseTasks.filter(t => t.status === 'DONE').length;
  const inProgress = phaseTasks.filter(t => t.status === 'IN_PROGRESS').length;
  const blocked = phaseTasks.filter(t => t.status === 'BLOCKED').length;
  
  const completionPercentage = total > 0 ? Math.round((done / total) * 100) : 0;
  
  return {
    phaseId,
    totalTasks: total,
    openTasks: open,
    doneTasks: done,
    inProgressTasks: inProgress,
    blockedTasks: blocked,
    completionPercentage,
  };
}

/**
 * Calculate project statistics
 */
export function calculateProjectStats(tasks: ProjectTask[]): ProjectStats {
  const total = tasks.length;
  const open = tasks.filter(t => t.status === 'OPEN').length;
  const done = tasks.filter(t => t.status === 'DONE').length;
  const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
  const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
  
  const completionPercentage = total > 0 ? Math.round((done / total) * 100) : 0;
  
  return {
    totalTasks: total,
    openTasks: open,
    doneTasks: done,
    inProgressTasks: inProgress,
    blockedTasks: blocked,
    completionPercentage,
  };
}

/**
 * Get project overview with phases, tasks, and statistics
 * This is the main query for ProjectOverview screen
 */
export async function getProjectOverview(projectId: string): Promise<{
  phases: ProjectPhase[];
  tasks: ProjectTask[];
  phaseStats: Record<string, PhaseStats>;
  projectStats: ProjectStats;
}> {
  // Load phases and tasks in parallel
  const [phases, tasks] = await Promise.all([
    getProjectPhases(projectId),
    getProjectTasks(projectId),
  ]);
  
  // Calculate statistics
  const phaseStats: Record<string, PhaseStats> = {};
  phases.forEach(phase => {
    phaseStats[phase.id] = calculatePhaseStats(phase.id, tasks);
  });
  
  const projectStats = calculateProjectStats(tasks);
  
  return {
    phases,
    tasks,
    phaseStats,
    projectStats,
  };
}

/**
 * Get "My Projects" - projects where user is owner or member
 * Option A: Two queries (owner + members)
 */
export async function getMyProjects(userId: string): Promise<string[]> {
  // Guard: userId must be defined
  if (!userId) {
    console.warn('getMyProjects called with undefined userId');
    return [];
  }
  
  // Query 1: Projects where user is owner
  const projectsRef = collection(db, 'projects');
  const ownerQuery = query(projectsRef, where('ownerId', '==', userId));
  const ownerSnapshot = await getDocs(ownerQuery);
  const ownerProjectIds = ownerSnapshot.docs.map(doc => doc.id);
  
  // Query 2: Projects where user is member (collection group query)
  // Note: This requires a collection group index on 'members'
  const membersGroup = collectionGroup(db, 'members');
  const memberQuery = query(membersGroup, where('userId', '==', userId));
  const memberSnapshot = await getDocs(memberQuery);
  const memberProjectIds = memberSnapshot.docs.map(doc => {
    // Extract projectId from path: projects/{projectId}/members/{userId}
    const pathParts = doc.ref.path.split('/');
    return pathParts[1]; // projects/{projectId}
  });
  
  // Combine and deduplicate
  const allProjectIds = [...new Set([...ownerProjectIds, ...memberProjectIds])];
  return allProjectIds;
}

/**
 * Alternative: Get "My Projects" using denormalized projectUsers array
 * This requires adding projectUsers: [uid...] field to project document
 */
export async function getMyProjectsDenormalized(userId: string): Promise<string[]> {
  const projectsRef = collection(db, 'projects');
  const q = query(projectsRef, where('projectUsers', 'array-contains', userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.id);
}
