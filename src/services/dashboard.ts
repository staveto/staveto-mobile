import * as projectsService from "./projects";
import * as tasksService from "./tasks";
import * as expensesService from "./expenses";
import type { ProjectDoc } from "./projects";
import type { TaskDoc } from "./tasks";
import type { ExpenseDoc } from "./expenses";

export type DashboardData = {
  projects: ProjectDoc[];
  allTasks: TaskDoc[];
  allExpenses: ExpenseDoc[];
  todayTasks: TaskDoc[];
  kpis: {
    openCount: number;
    doneTodayCount: number;
    blockedCount: number;
    expensesMonthSum: number;
  };
  projectStats: Map<string, {
    openCount: number;
    totalCount: number;
    progress: number; // 0-100 percentage
  }>;
};

/**
 * Load dashboard data across all projects
 * Aggregates tasks and expenses from all user's projects
 */
export async function loadDashboardData(ownerId: string): Promise<DashboardData> {
  // 1. Load all projects
  const projects = await projectsService.listMyProjects(ownerId);
  
  if (projects.length === 0) {
    return {
      projects: [],
      allTasks: [],
      allExpenses: [],
      todayTasks: [],
      kpis: {
        openCount: 0,
        doneTodayCount: 0,
        blockedCount: 0,
        expensesMonthSum: 0,
      },
      projectStats: new Map(),
    };
  }

  // 2. Load tasks and expenses for each project in parallel
  const loadPromises = projects.map(async (project) => {
    try {
      const [tasks, expenses] = await Promise.all([
        tasksService.listTasksByProject(project.id).catch(() => []),
        expensesService.listExpensesByProject(project.id).catch(() => []),
      ]);
      return { projectId: project.id, tasks, expenses };
    } catch (error) {
      console.error(`[dashboard] Error loading data for project ${project.id}:`, error);
      return { projectId: project.id, tasks: [], expenses: [] };
    }
  });

  const projectData = await Promise.all(loadPromises);
  
  // 3. Aggregate all tasks and expenses
  const allTasks: TaskDoc[] = [];
  const allExpenses: ExpenseDoc[] = [];
  
  projectData.forEach(({ tasks, expenses }) => {
    allTasks.push(...tasks);
    allExpenses.push(...expenses);
  });

  // 4. Calculate today's date range
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  // 5. Calculate current month date range
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // 6. Filter today/next tasks
  const currentUserUid = (await import("../firebase")).auth.currentUser?.uid;
  const todayTasks = allTasks
    .filter(task => {
      // Exclude tasks from BUILD projects
      const project = projects.find(p => p.id === task.projectId);
      if (project?.projectType === 'BUILD') return false;
      
      // Only active tasks
      if (task.isActive === false) return false;
      // Only OPEN tasks
      if (task.status !== 'OPEN') return false;
      return true;
    })
    .sort((a, b) => {
      // Prioritize tasks assigned to current user
      const aAssigned = a.assigneeId === currentUserUid ? 1 : 0;
      const bAssigned = b.assigneeId === currentUserUid ? 1 : 0;
      if (aAssigned !== bAssigned) return bAssigned - aAssigned;
      
      // Sort by dueDate if exists
      if (a.dueDate && b.dueDate) {
        return a.dueDate.localeCompare(b.dueDate);
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      
      // Sort by priority if exists
      if (a.priority && b.priority) {
        const priorityOrder: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        if (aPriority !== bPriority) return bPriority - aPriority;
      }
      
      // Sort by createdAt
      const aCreated = a.createdAt || "";
      const bCreated = b.createdAt || "";
      return aCreated.localeCompare(bCreated);
    })
    .slice(0, 5); // Top 5

  // 7. Calculate KPIs (exclude BUILD projects)
  const openCount = allTasks.filter(t => {
    const project = projects.find(p => p.id === t.projectId);
    if (project?.projectType === 'BUILD') return false;
    return t.status === 'OPEN' && t.isActive !== false;
  }).length;
  
  const blockedCount = allTasks.filter(t => {
    const project = projects.find(p => p.id === t.projectId);
    if (project?.projectType === 'BUILD') return false;
    return t.status === 'BLOCKED' && t.isActive !== false;
  }).length;
  
  const doneTodayCount = allTasks.filter(task => {
    const project = projects.find(p => p.id === task.projectId);
    if (project?.projectType === 'BUILD') return false;
    if (task.status !== 'DONE') return false;
    if (!task.updatedAt) return false;
    const updatedDate = new Date(task.updatedAt);
    return updatedDate >= today && updatedDate <= todayEnd;
  }).length;

  const expensesMonthSum = allExpenses
    .filter(e => {
      const expenseDate = new Date(e.date);
      return expenseDate >= monthStart && expenseDate <= monthEnd;
    })
    .reduce((sum, e) => sum + e.amount, 0);

  // 8. Calculate project stats
  const projectStats = new Map<string, { openCount: number; totalCount: number; progress: number }>();
  
  projects.forEach(project => {
    const projectTasks = allTasks.filter(t => t.projectId === project.id && t.isActive !== false);
    const totalCount = projectTasks.length;
    const openCount = projectTasks.filter(t => t.status === 'OPEN').length;
    const doneCount = projectTasks.filter(t => t.status === 'DONE').length;
    const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    
    projectStats.set(project.id, {
      openCount,
      totalCount,
      progress,
    });
  });

  return {
    projects,
    allTasks,
    allExpenses,
    todayTasks,
    kpis: {
      openCount,
      doneTodayCount,
      blockedCount,
      expensesMonthSum,
    },
    projectStats,
  };
}
