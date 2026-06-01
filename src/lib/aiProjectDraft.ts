/**
 * Client-side AI draft with stable ids for review/refine without persisting to Firestore until confirm.
 */

import type { AiPhase, AiProjectPlan, AiTask, AiMaterialSuggestion } from "./aiProjectSchema";

function newDraftNodeId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export type DraftTask = AiTask & { id: string };

export type DraftPhase = Omit<AiPhase, "tasks"> & {
  id: string;
  tasks: DraftTask[];
};

export type DraftMaterialSuggestion = AiMaterialSuggestion & {
  id: string;
  selected: boolean;
};

export type AiProjectDraft = Omit<AiProjectPlan, "phases" | "materialSuggestions"> & {
  draftId: string;
  phases: DraftPhase[];
  materialSuggestions?: DraftMaterialSuggestion[];
  /** Optional friendly reference entered by user (not Firestore id). */
  projectNumber?: string;
};

export function aiPlanToDraft(plan: AiProjectPlan, opts?: { projectNumber?: string }): AiProjectDraft {
  const pn = opts?.projectNumber?.trim();
  return {
    draftId: newDraftNodeId(),
    projectTitle: plan.projectTitle,
    category: plan.category,
    scope: plan.scope,
    summary: plan.summary,
    uiMode: plan.uiMode,
    projectNumber: pn || undefined,
    phases: plan.phases.map((p) => ({
      id: newDraftNodeId(),
      name: p.name,
      description: p.description,
      tasks: p.tasks.map((t) => ({
        id: newDraftNodeId(),
        title: t.title,
        description: t.description,
        taskType: t.taskType,
        priority: t.priority,
      })),
    })),
    materialSuggestions: (plan.materialSuggestions ?? []).map((m) => ({
      ...m,
      id: newDraftNodeId(),
      selected:
        m.confidence !== "low" &&
        m.category !== "service_or_labor" &&
        m.category !== "transport" &&
        m.category !== "discount",
    })),
  };
}

/** Strip ids for backend payloads that mirror AiPhase / AiTask (no id fields). */
export function draftPhaseToAiPhase(p: DraftPhase): AiPhase {
  return {
    name: p.name,
    description: p.description,
    tasks: p.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
    })),
  };
}

export function draftTaskToAiTask(t: DraftTask): AiTask {
  return {
    title: t.title,
    description: t.description,
    taskType: t.taskType,
    priority: t.priority,
  };
}

export function draftToAiProjectPlan(draft: AiProjectDraft): AiProjectPlan {
  return {
    projectTitle: draft.projectTitle.trim(),
    category: draft.category,
    scope: draft.scope,
    summary: draft.summary,
    uiMode: draft.uiMode,
    phases: draft.phases.map((p) => draftPhaseToAiPhase(p)),
    materialSuggestions: draft.materialSuggestions
      ?.filter((m) => m.selected && m.name?.trim())
      .map(({ id: _id, selected: _selected, ...m }) => m),
  };
}

export function replaceDraftPhase(draft: AiProjectDraft, phaseId: string, next: AiPhase): AiProjectDraft {
  const phases = draft.phases.map((p) => {
    if (p.id !== phaseId) return p;
    const newTasks: DraftTask[] = next.tasks.map((t) => ({
      id: newDraftNodeId(),
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
    }));
    return {
      ...p,
      name: next.name,
      description: next.description,
      tasks: newTasks,
    };
  });
  return { ...draft, phases };
}

export function replaceDraftTask(
  draft: AiProjectDraft,
  phaseId: string,
  taskId: string,
  next: AiTask
): AiProjectDraft {
  const phases = draft.phases.map((p) => {
    if (p.id !== phaseId) return p;
    const tasks = p.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            title: next.title,
            description: next.description,
            taskType: next.taskType,
            priority: next.priority,
          }
        : t
    );
    return { ...p, tasks };
  });
  return { ...draft, phases };
}

export function deleteDraftPhase(draft: AiProjectDraft, phaseId: string): AiProjectDraft {
  const phases = draft.phases.filter((p) => p.id !== phaseId);
  return { ...draft, phases };
}

export function deleteDraftTask(draft: AiProjectDraft, phaseId: string, taskId: string): AiProjectDraft {
  const phases = draft.phases.map((p) => {
    if (p.id !== phaseId) return p;
    const tasks = p.tasks.filter((t) => t.id !== taskId);
    return { ...p, tasks };
  });
  return { ...draft, phases };
}

export function updateDraftPhaseField(
  draft: AiProjectDraft,
  phaseId: string,
  patch: Partial<Pick<DraftPhase, "name" | "description">>
): AiProjectDraft {
  const phases = draft.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p));
  return { ...draft, phases };
}

export function updateDraftTaskField(
  draft: AiProjectDraft,
  phaseId: string,
  taskId: string,
  patch: Partial<Pick<DraftTask, "title" | "description">>
): AiProjectDraft {
  const phases = draft.phases.map((p) => {
    if (p.id !== phaseId) return p;
    const tasks = p.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
    return { ...p, tasks };
  });
  return { ...draft, phases };
}

/** Append a manually added task at end of phase (new stable id). */
export function appendDraftTask(draft: AiProjectDraft, phaseId: string, task: AiTask): AiProjectDraft {
  const phases = draft.phases.map((p) => {
    if (p.id !== phaseId) return p;
    const nt: DraftTask = {
      id: newDraftNodeId(),
      ...task,
    };
    return { ...p, tasks: [...p.tasks, nt] };
  });
  return { ...draft, phases };
}
