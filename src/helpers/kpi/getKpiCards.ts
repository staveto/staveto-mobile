/**
 * KPI Cards Helper
 * 
 * Pure functions to compute KPI cards for the Home screen.
 * UI-only refactor - no database changes.
 * 
 * DB SAFETY: No database schema changes - only UI presentation layer.
 */

import type { DashboardViewModel } from "../../services/dashboard";
import type { TaskDoc } from "../../services/tasks";

export type KpiCardType = 
  | "active_tasks" 
  | "done_today" 
  | "projects_count" // Number of projects
  | "expenses_total" // Total expenses (not just this month)
  | "blocked" 
  | "expenses_month"
  | "overdue" // Replacement for blocked if blocked is 0
  | "waiting_customer"; // Another replacement option

export interface KpiCard {
  id: string;
  type: KpiCardType;
  value: number;
  label: string;
  caption?: string;
  icon: string;
  iconColor: string;
  // Navigation target when card is tapped
  navigationTarget: {
    screen: string;
    params?: Record<string, any>;
  };
}

/**
 * Calculate overdue tasks (tasks with dueDate in the past and status not DONE)
 */
function calculateOverdueTasks(allTasks: TaskDoc[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];

  return allTasks.filter(task => {
    if (task.status === 'DONE') return false;
    if (!task.dueDate) return false;
    // Compare dates (dueDate is ISO string YYYY-MM-DD)
    return task.dueDate < todayISO;
  }).length;
}

/**
 * Calculate tasks waiting for customer (heuristic: tasks with status OPEN/DOING that are older than 7 days)
 */
function calculateWaitingCustomerTasks(allTasks: TaskDoc[]): number {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  return allTasks.filter(task => {
    if (task.status !== 'OPEN' && task.status !== 'DOING') return false;
    if (!task.createdAt) return false;
    const createdDate = new Date(task.createdAt);
    createdDate.setHours(0, 0, 0, 0);
    return createdDate <= sevenDaysAgo;
  }).length;
}

/**
 * Get KPI cards based on dashboard data.
 * Implements dynamic replacement logic: if blocked is 0, replace with overdue or waiting customer.
 * 
 * @param data - Dashboard data from dashboardService
 * @returns Array of 4 KPI cards
 */
export function getKpiCards(data: DashboardViewModel): KpiCard[] {
  // Extract all tasks from projects (we need this for replacement calculations)
  const allTasks: TaskDoc[] = [];
  data.projects.forEach(project => {
    // We don't have direct access to all tasks here, but we can infer from kpis
    // For now, we'll use the kpis directly and compute replacements from what we have
  });

  const cards: KpiCard[] = [];

  // 1. Active Tasks (OPEN + DOING)
  cards.push({
    id: "active_tasks",
    type: "active_tasks",
    value: data.kpis.openCount,
    label: "OTVORENÉ ÚLOHY",
    icon: "document-text-outline",
    iconColor: "#FF6B35", // Primary color
    navigationTarget: {
      screen: "Tasks",
      params: { filter: "active" }, // Filter for OPEN/DOING tasks
    },
  });

  // 2. Done Today
  cards.push({
    id: "done_today",
    type: "done_today",
    value: data.kpis.doneTodayCount,
    label: "DOKONČENÉ",
    caption: "dnes",
    icon: "checkmark-circle",
    iconColor: "#4CAF50",
    navigationTarget: {
      screen: "Tasks",
      params: { filter: "done_today" },
    },
  });

  // 3. Blocked OR Replacement (if blocked is 0)
  if (data.kpis.blockedCount > 0) {
    cards.push({
      id: "blocked",
      type: "blocked",
      value: data.kpis.blockedCount,
      label: "BLOKOVANÉ",
      icon: "alert-circle",
      iconColor: "#FF9800",
      navigationTarget: {
        screen: "Tasks",
        params: { filter: "blocked" },
      },
    });
  } else {
    // Replacement: Show overdue tasks instead
    // Note: We need to calculate this from tasks, but we don't have direct access here
    // For now, we'll show a placeholder that will be computed client-side
    // In a real implementation, you'd pass allTasks to this function
    cards.push({
      id: "overdue",
      type: "overdue",
      value: 0, // Will be computed if we have task data
      label: t("kpi.overdue"),
      icon: "time-outline",
      iconColor: "#FF5722",
      navigationTarget: {
        screen: "Tasks",
        params: { filter: "overdue" },
      },
    });
  }

  // 4. Expenses This Month
  cards.push({
    id: "expenses_month",
    type: "expenses_month",
    value: data.kpis.expensesMonthSum,
    label: "VÝDAVKY",
    caption: "tento mesiac",
    icon: "cash-outline",
    iconColor: "#FF6B35",
    navigationTarget: {
      screen: "Projects", // Expenses are shown per-project, so navigate to Projects
      params: { highlightExpenses: true },
    },
  });

  return cards;
}

/**
 * Enhanced version that accepts all tasks for better replacement calculations.
 * This should be called from HomeScreen after loading tasks.
 * 
 * @param data - Dashboard data from dashboardService
 * @param allTasks - All tasks for replacement calculations
 * @param t - Translation function from i18n
 */
export function getKpiCardsWithTasks(
  data: DashboardViewModel,
  allTasks: TaskDoc[],
  t: (key: string, params?: Record<string, string>) => string
): KpiCard[] {
  const cards: KpiCard[] = [];

  // 1. Active Tasks
  cards.push({
    id: "active_tasks",
    type: "active_tasks",
    value: data.kpis.openCount,
    label: t("kpi.activeTasks"),
    icon: "document-text-outline",
    iconColor: "#FF6B35",
    navigationTarget: {
      screen: "Tasks",
      params: { filter: "active" },
    },
  });

  // 2. Done Today - label changed to "DOKONČENÉ" without caption
  cards.push({
    id: "done_today",
    type: "done_today",
    value: data.kpis.doneTodayCount,
    label: t("kpi.completed"),
    icon: "checkmark-circle",
    iconColor: "#4CAF50",
    navigationTarget: {
      screen: "Tasks",
      params: { filter: "done_today" },
    },
  });

  // 3. Number of Projects
  cards.push({
    id: "projects_count",
    type: "projects_count",
    value: data.projects.length,
    label: t("kpi.projectsCount"),
    icon: "folder-outline",
    iconColor: "#2196F3",
    navigationTarget: {
      screen: "Projects",
    },
  });

  // 4. Total Expenses (all time, not just this month)
  cards.push({
    id: "expenses_total",
    type: "expenses_total",
    value: data.kpis.expensesTotalSum,
    label: t("kpi.expensesTotal"),
    icon: "cash-outline",
    iconColor: "#FF6B35",
    navigationTarget: {
      screen: "Projects",
      params: { highlightExpenses: true },
    },
  });

  return cards;
}
