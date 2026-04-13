import * as projectsService from "./projects";
import * as tasksService from "./tasks";
import * as expensesService from "./expenses";
import { fetchProjectAccess } from "../hooks/useProjectAccess";
import type { ProjectDoc } from "./projects";
import type { TaskDoc } from "./tasks";

export type DashboardViewModel = {
  projects: ProjectDoc[];
  todayTasks: Array<TaskDoc & { projectName: string; phaseName?: string }>;
  kpis: {
    openCount: number;
    doneTodayCount: number;
    blockedCount: number;
    /** Open / doing / blocked tasks with due date strictly before today */
    overdueCount: number;
    expensesMonthSum: number;
    expensesTotalSum: number; // Total expenses across all projects
    hasExpensesAccess: boolean; // True if user can see expenses in at least one project
  };
  projectStats: Map<string, { openCount: number; totalCount: number; progress: number }>;
  timeTrackingProjectIds: string[]; // Project IDs where user can log time (owner or editor with sharedItems.timeTracking)
}

/**
 * Load dashboard data for a user
 * @param forceServerRead - When true, bypasses Firestore cache (use after sync to get fresh sharedWithCount)
 */
const EMPTY_DASHBOARD: DashboardViewModel = {
  projects: [],
  todayTasks: [],
  kpis: {
    openCount: 0,
    doneTodayCount: 0,
    blockedCount: 0,
    overdueCount: 0,
    expensesMonthSum: 0,
    expensesTotalSum: 0,
    hasExpensesAccess: false,
  },
  projectStats: new Map(),
  timeTrackingProjectIds: [],
};

export async function loadDashboardData(ownerId: string, options?: { forceServerRead?: boolean }): Promise<DashboardViewModel> {
  if (!ownerId) {
    throw new Error('Musíte byť prihlásený na načítanie dashboard dát.');
  }

  try {
    return await loadDashboardDataInternal(ownerId, options);
  } catch (error: unknown) {
    console.error("[dashboard] loadDashboardData failed:", error);
    return EMPTY_DASHBOARD;
  }
}

async function loadDashboardDataInternal(ownerId: string, options?: { forceServerRead?: boolean }): Promise<DashboardViewModel> {
  // Load projects
  const projects = await projectsService.listMyProjects(ownerId, { forceServerRead: options?.forceServerRead });

  // Load all tasks from all projects in parallel (skip projects without valid id)
  const allTasksPromises = projects
    .filter((p) => p?.id)
    .map(async (project) => {
    try {
      const tasks = await tasksService.listTasksByProject(project.id);
      return tasks.map(task => ({ ...task, projectId: project.id }));
    } catch (error: any) {
      console.warn(`[dashboard] Error loading tasks for project ${project.id}:`, error);
      return [];
    }
  });

  const allTasksArrays = await Promise.all(allTasksPromises);
  const allTasks = allTasksArrays.flat();

  // Calculate KPIs
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];

  const openTasks = allTasks.filter(t => t.status === 'OPEN' || t.status === 'DOING');
  const blockedTasks = allTasks.filter(t => t.status === 'BLOCKED');
  
  // Tasks done today (check doneAt or updatedAt if status is DONE)
  const doneTodayTasks = allTasks.filter(t => {
    if (t.status !== 'DONE') return false;
    // Check if task was completed today
    const doneAt = (t as any).doneAt;
    if (doneAt) {
      const doneDate = new Date(doneAt);
      doneDate.setHours(0, 0, 0, 0);
      return doneDate.toISOString().split('T')[0] === todayISO;
    }
    // Fallback: check updatedAt if doneAt is not available
    if (t.updatedAt) {
      const updatedDate = new Date(t.updatedAt);
      updatedDate.setHours(0, 0, 0, 0);
      return updatedDate.toISOString().split('T')[0] === todayISO;
    }
    return false;
  });

  // Load expenses for current month and total (only from projects where user has expenses access)
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  let expensesMonthSum = 0;
  let expensesTotalSum = 0;
  let projectIdsWithExpensesAccess = new Set<string>();
  let timeTrackingProjectIds: string[] = [];
  try {
    // Determine which projects the user can see expenses for and which can log time
    const accessPromises = projects.map(async (project) => {
      const isOwner = project.ownerId === ownerId;
      if (isOwner) {
        return { projectId: project.id, canReadExpenses: true, canWriteTime: true };
      }
      const access = await fetchProjectAccess(project.id, ownerId, project.ownerId);
      return {
        projectId: project.id,
        canReadExpenses: access.canReadExpenses,
        canWriteTime: access.canWriteTime,
      };
    });
    const accessList = await Promise.all(accessPromises);
    projectIdsWithExpensesAccess = new Set(
      accessList.filter((a) => a.canReadExpenses).map((a) => a.projectId)
    );
    timeTrackingProjectIds = accessList.filter((a) => a.canWriteTime).map((a) => a.projectId);

    // Load expenses only from projects where user has expenses permission
    const expensesPromises = projects
      .filter((p) => projectIdsWithExpensesAccess.has(p.id))
      .map(async (project) => {
        try {
          const expenses = await expensesService.listExpensesByProject(project.id);
          const readyExpenses = expenses.filter(exp => {
            if (!exp.date || exp.status !== 'READY' || !exp.amount) return false;
            return true;
          });
          return readyExpenses;
        } catch (error: any) {
          console.warn(`[dashboard] Error loading expenses for project ${project.id}:`, error);
          return [];
        }
      });

    const allExpensesArrays = await Promise.all(expensesPromises);
    const allExpenses = allExpensesArrays.flat();

    // Calculate total expenses (all READY expenses)
    expensesTotalSum = allExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

    // Calculate monthly expenses (filter by date)
    const monthlyExpenses = allExpenses.filter(exp => {
      if (!exp.date) return false;
      const expenseDate = new Date(exp.date);
      return expenseDate >= firstDayOfMonth && expenseDate <= lastDayOfMonth;
    });
    expensesMonthSum = monthlyExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  } catch (error: any) {
    console.warn(`[dashboard] Error loading expenses:`, error);
  }

  // Calculate project stats
  const projectStats = new Map<string, { openCount: number; totalCount: number; progress: number }>();
  
  projects.forEach(project => {
    const projectTasks = allTasks.filter(t => t.projectId === project.id);
    const totalCount = projectTasks.length;
    const openCount = projectTasks.filter(t => t.status === 'OPEN' || t.status === 'DOING').length;
    const doneCount = projectTasks.filter(t => t.status === 'DONE').length;
    const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    
    projectStats.set(project.id, {
      openCount,
      totalCount,
      progress,
    });
  });

  const parseDateOnly = (dateStr?: string) => {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const overdueTasks = allTasks.filter((task) => {
    if (task.status === "DONE") return false;
    if (!task.dueDate) return false;
    const dueDate = parseDateOnly(task.dueDate);
    if (!dueDate) return false;
    dueDate.setHours(0, 0, 0, 0);
    return dueDate.getTime() < today.getTime();
  });

  // Upcoming tasks (with dueDate today or later), sorted by date
  const upcomingTasks = allTasks
    .filter((task) => {
      if (task.isActive === false) return false;
      if (task.status === "DONE") return false;
      if (!task.dueDate) return false;
      const dueDate = parseDateOnly(task.dueDate);
      if (!dueDate) return false;
      dueDate.setHours(0, 0, 0, 0);
      return dueDate.getTime() >= today.getTime();
    })
    .sort((a, b) => {
      const aDate = parseDateOnly(a.dueDate)?.getTime() ?? 0;
      const bDate = parseDateOnly(b.dueDate)?.getTime() ?? 0;
      return aDate - bDate;
    })
    .map(task => ({
      ...task,
      projectName: projects.find(p => p.id === task.projectId)?.name || 'Unknown',
    }));

  return {
    projects,
    todayTasks: upcomingTasks,
    kpis: {
      openCount: openTasks.length,
      doneTodayCount: doneTodayTasks.length,
      blockedCount: blockedTasks.length,
      overdueCount: overdueTasks.length,
      expensesMonthSum,
      expensesTotalSum,
      hasExpensesAccess: projectIdsWithExpensesAccess.size > 0,
    },
    projectStats,
    timeTrackingProjectIds,
  };
}
