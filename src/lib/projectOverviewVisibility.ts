import type { ProjectAccess } from "../hooks/useProjectAccess";

export type ProjectOverviewCardVisibility = {
  photos: boolean;
  problems: boolean;
  diary: boolean;
  expenses: boolean;
  tasks: boolean;
  phases: boolean;
  hours: boolean;
  milestones: boolean;
};

/**
 * Which project-overview / dashboard cards a user may see.
 * Driven by project membership `sharedItems` + write flags from useProjectAccess
 * (business org roles are already applied inside that hook).
 */
export function getProjectOverviewCardVisibility(
  access: Pick<
    ProjectAccess,
    | "loading"
    | "isOwner"
    | "isMember"
    | "canReadTasks"
    | "canReadPhases"
    | "canReadExpenses"
    | "canReadDiary"
    | "canReadDocuments"
    | "canWritePhotos"
    | "canWriteTime"
    | "canReportProblem"
  >
): ProjectOverviewCardVisibility {
  if (access.loading) {
    return {
      photos: false,
      problems: false,
      diary: false,
      expenses: false,
      tasks: false,
      phases: false,
      hours: false,
      milestones: false,
    };
  }

  if (access.isOwner) {
    return {
      photos: true,
      problems: true,
      diary: true,
      expenses: true,
      tasks: true,
      phases: true,
      hours: true,
      milestones: true,
    };
  }

  const photos =
    access.canWritePhotos ||
    access.canReadDocuments ||
    access.canReadDiary ||
    access.canReadTasks;
  const problems = access.isMember || access.canReportProblem;
  const diary = access.canReadDiary;
  const expenses = access.canReadExpenses;
  const tasks = access.canReadTasks;
  const phases = access.canReadPhases;
  const hours = access.canWriteTime;
  const milestones = phases;

  return { photos, problems, diary, expenses, tasks, phases, hours, milestones };
}
