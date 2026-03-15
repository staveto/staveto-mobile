/**
 * AI project structure schema – strict JSON format for AI response.
 * Shared between mobile, web, and Firebase Functions.
 * Used by generateProjectStructure and createProjectFromAiPlan.
 */

export type AiCategory =
  | "construction"
  | "renovation"
  | "trade_installation"
  | "service"
  | "maintenance";

export type AiScope =
  | "full_build"
  | "partial_build"
  | "single_trade"
  | "small_job";

export type AiUiMode = "phases" | "work_packages";

export type AiTaskType = "execution" | "coordination" | "inspection";

export type AiPriority = "low" | "medium" | "high";

export interface AiTask {
  title: string;
  description?: string;
  taskType: AiTaskType;
  priority: AiPriority;
}

export interface AiPhase {
  name: string;
  description?: string;
  tasks: AiTask[];
}

export interface AiProjectPlan {
  projectTitle: string;
  category: AiCategory;
  scope: AiScope;
  summary?: string;
  uiMode?: AiUiMode;
  phases: AiPhase[];
}

const AI_CATEGORIES: AiCategory[] = [
  "construction",
  "renovation",
  "trade_installation",
  "service",
  "maintenance",
];

const AI_SCOPES: AiScope[] = [
  "full_build",
  "partial_build",
  "single_trade",
  "small_job",
];

const AI_TASK_TYPES: AiTaskType[] = ["execution", "coordination", "inspection"];

const AI_PRIORITIES: AiPriority[] = ["low", "medium", "high"];

function isString(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function isValidEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validates AI response against schema. Returns errors or null if valid.
 */
export function validateAiProjectPlan(data: unknown): ValidationError[] | null {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== "object") {
    return [{ path: "root", message: "Expected object" }];
  }

  const obj = data as Record<string, unknown>;

  if (!isString(obj.projectTitle)) {
    errors.push({
      path: "projectTitle",
      message: "projectTitle is required and must be non-empty string",
    });
  }

  if (!isValidEnum(obj.category, AI_CATEGORIES)) {
    errors.push({
      path: "category",
      message: `category must be one of: ${AI_CATEGORIES.join(", ")}`,
    });
  }

  if (!isValidEnum(obj.scope, AI_SCOPES)) {
    errors.push({
      path: "scope",
      message: `scope must be one of: ${AI_SCOPES.join(", ")}`,
    });
  }

  if (obj.uiMode !== undefined && obj.uiMode !== null) {
    const validUiModes = ["phases", "work_packages"];
    if (
      typeof obj.uiMode !== "string" ||
      !validUiModes.includes(obj.uiMode)
    ) {
      errors.push({
        path: "uiMode",
        message: `uiMode must be one of: ${validUiModes.join(", ")}`,
      });
    }
  }

  if (!Array.isArray(obj.phases)) {
    errors.push({ path: "phases", message: "phases is required and must be array" });
  } else {
    if (obj.phases.length < 1) {
      errors.push({ path: "phases", message: "At least 1 phase required" });
    }
    if (obj.phases.length > 8) {
      errors.push({ path: "phases", message: "Maximum 8 phases allowed" });
    }

    obj.phases.forEach((phase, pi) => {
      const prefix = `phases[${pi}]`;
      if (!phase || typeof phase !== "object") {
        errors.push({ path: prefix, message: "Phase must be object" });
        return;
      }
      const p = phase as Record<string, unknown>;
      if (!isString(p.name)) {
        errors.push({ path: `${prefix}.name`, message: "Phase name is required" });
      }
      if (!Array.isArray(p.tasks)) {
        errors.push({ path: `${prefix}.tasks`, message: "Phase tasks must be array" });
      } else {
        if (p.tasks.length < 1) {
          errors.push({
            path: `${prefix}.tasks`,
            message: "Each phase must have at least 1 task",
          });
        }
        if (p.tasks.length > 10) {
          errors.push({
            path: `${prefix}.tasks`,
            message: "Maximum 10 tasks per phase",
          });
        }
        (p.tasks as unknown[]).forEach((task, ti) => {
          const tPrefix = `${prefix}.tasks[${ti}]`;
          if (!task || typeof task !== "object") {
            errors.push({ path: tPrefix, message: "Task must be object" });
            return;
          }
          const t = task as Record<string, unknown>;
          if (!isString(t.title)) {
            errors.push({
              path: `${tPrefix}.title`,
              message: "Task title is required",
            });
          }
          if (
            t.taskType !== undefined &&
            !isValidEnum(t.taskType, AI_TASK_TYPES)
          ) {
            errors.push({
              path: `${tPrefix}.taskType`,
              message: `taskType must be one of: ${AI_TASK_TYPES.join(", ")}`,
            });
          }
          if (
            t.priority !== undefined &&
            !isValidEnum(t.priority, AI_PRIORITIES)
          ) {
            errors.push({
              path: `${tPrefix}.priority`,
              message: `priority must be one of: ${AI_PRIORITIES.join(", ")}`,
            });
          }
        });
      }
    });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Maps AI category to Firestore ProjectType.
 */
export function mapAiCategoryToFirestore(
  category: AiCategory
): "BUILD" | "TRADE" | "MAINTENANCE" {
  switch (category) {
    case "construction":
    case "renovation":
      return "BUILD";
    case "trade_installation":
      return "TRADE";
    case "service":
    case "maintenance":
      return "MAINTENANCE";
    default:
      return "BUILD";
  }
}
