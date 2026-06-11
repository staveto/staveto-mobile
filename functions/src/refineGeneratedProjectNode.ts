/**
 * Firebase Callable: refine a single phase or task in an AI-generated draft (no full regeneration).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";
import type { AiPhase, AiTask } from "./aiProjectSchema";
import { sanitizeAiProjectPlanFromModel } from "./aiProjectSchema";

const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_BRIEF = 600;
const MAX_FEEDBACK = 800;
const MAX_EXTRA = 600;

function getApiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
  if (!key.trim()) {
    throw new HttpsError(
      "failed-precondition",
      "AI service not configured. Set GOOGLE_GENERATIVE_AI_API_KEY in Firebase config."
    );
  }
  return key;
}

function extractJsonFromResponse(text: string): Record<string, unknown> {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const parsed = JSON.parse(s) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error("Expected JSON object");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateTask(t: unknown, prefix: string): string[] {
  const errs: string[] = [];
  if (!t || typeof t !== "object" || Array.isArray(t)) {
    return [`${prefix}: task must be object`];
  }
  const o = t as Record<string, unknown>;
  if (!isNonEmptyString(o.title)) errs.push(`${prefix}.title`);
  const ttRaw = typeof o.taskType === "string" ? o.taskType.trim().toLowerCase().replace(/[\s-]+/g, "_") : "execution";
  if (!["execution", "coordination", "inspection"].includes(ttRaw)) errs.push(`${prefix}.taskType`);
  const prRaw = typeof o.priority === "string" ? o.priority.trim().toLowerCase() : "medium";
  if (!["low", "medium", "high"].includes(prRaw)) errs.push(`${prefix}.priority`);
  return errs;
}

function validatePhaseShape(p: unknown): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== "object" || Array.isArray(p)) return ["phase must be object"];
  const ph = p as Record<string, unknown>;
  if (!isNonEmptyString(ph.name)) errs.push("phase.name");
  if (!Array.isArray(ph.tasks)) errs.push("phase.tasks");
  else {
    if (ph.tasks.length < 1) errs.push("phase.tasks min 1");
    if (ph.tasks.length > 10) errs.push("phase.tasks max 10");
    ph.tasks.forEach((task, ti) => {
      errs.push(...validateTask(task, `tasks[${ti}]`));
    });
  }
  return errs.filter(Boolean);
}

function normalizePhase(raw: unknown): AiPhase {
  const sanitized = sanitizeAiProjectPlanFromModel({
    phases: [raw],
    projectTitle: "x",
    category: "construction",
    scope: "small_job",
  }) as Record<string, unknown>;
  const phases = sanitized.phases as unknown[];
  const phase = phases?.[0];
  if (!phase || typeof phase !== "object") {
    throw new Error("normalizePhase failed");
  }
  return phase as AiPhase;
}

function normalizeTask(raw: unknown): AiTask {
  const sanitized = sanitizeAiProjectPlanFromModel({
    phases: [
      {
        name: "Temp",
        tasks: [raw],
      },
    ],
    projectTitle: "x",
    category: "construction",
    scope: "small_job",
  }) as Record<string, unknown>;
  const phases = sanitized.phases as { tasks: unknown[] }[];
  const t = phases?.[0]?.tasks?.[0];
  if (!t || typeof t !== "object") throw new Error("normalizeTask failed");
  return t as AiTask;
}

/**
 * Single-node refinement: returns only `{ phase }` or `{ task }` JSON from Gemini.
 */
export const refineGeneratedProjectNode = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "512MiB",
    invoker: "public",
    secrets: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = (request.data ?? {}) as {
      projectBrief?: string;
      draftSummary?: string;
      nodeKind?: string;
      phaseIndex?: number;
      taskIndex?: number;
      currentPhaseJson?: unknown;
      currentTaskJson?: unknown;
      userChangeRequest?: string;
      extraContext?: string;
    };

    const kind = typeof data.nodeKind === "string" ? data.nodeKind.trim().toLowerCase() : "";
    if (kind !== "phase" && kind !== "task") {
      log("[refineGeneratedProjectNode] invalid_argument", { reason: "invalid_node_kind", kind });
      throw new HttpsError("invalid-argument", "nodeKind must be phase or task.");
    }

    const brief =
      typeof data.projectBrief === "string" ? data.projectBrief.trim().slice(0, MAX_BRIEF) : "";
    if (!brief) {
      log("[refineGeneratedProjectNode] invalid_argument", { reason: "missing_required_ai_input" });
      throw new HttpsError("invalid-argument", "projectBrief is required.");
    }

    const feedback =
      typeof data.userChangeRequest === "string"
        ? data.userChangeRequest.trim().slice(0, MAX_FEEDBACK)
        : "";
    if (!feedback) {
      log("[refineGeneratedProjectNode] invalid_argument", { reason: "missing_feedback" });
      throw new HttpsError("invalid-argument", "Describe what should change.");
    }

    const extra =
      typeof data.extraContext === "string"
        ? data.extraContext.trim().slice(0, MAX_EXTRA)
        : "";
    const draftSummary =
      typeof data.draftSummary === "string" ? data.draftSummary.trim().slice(0, 400) : "";

    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch (e) {
      log("[refineGeneratedProjectNode] missing_api_key");
      throw e;
    }

    const phaseIdx =
      typeof data.phaseIndex === "number" && Number.isFinite(data.phaseIndex)
        ? Math.floor(data.phaseIndex)
        : -1;
    if (phaseIdx < 0) {
      throw new HttpsError("invalid-argument", "phaseIndex is required.");
    }

    const systemPhase = `You refine ONE phase of a construction/trade project plan.
Return ONLY valid JSON (no markdown): {"phase":{"name":"string","description":"string","tasks":[{"title":"string","description":"string","taskType":"execution|coordination|inspection","priority":"low|medium|high"}, ...]}}
Rules:
- Keep the same number of tasks unless the user asks to add/remove steps.
- taskType priority must use allowed enums only.
- Practical, short titles for builders.`;

    const systemTask = `You refine ONE task in a construction/trade project plan.
Return ONLY valid JSON (no markdown): {"task":{"title":"string","description":"string","taskType":"execution|coordination|inspection","priority":"low|medium|high"}}
Rules:
- Practical wording for installers/tradespeople.`;

    let userPrompt: string;
    if (kind === "phase") {
      userPrompt = [
        `Original job brief: ${brief}`,
        draftSummary ? `Draft summary: ${draftSummary}` : "",
        `Phase index (0-based): ${phaseIdx}`,
        `Current phase JSON: ${JSON.stringify(data.currentPhaseJson ?? {})}`,
        `User wants this change: ${feedback}`,
        extra ? `Extra context: ${extra}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      const taskIdx =
        typeof data.taskIndex === "number" && Number.isFinite(data.taskIndex)
          ? Math.floor(data.taskIndex)
          : -1;
      if (taskIdx < 0) {
        throw new HttpsError("invalid-argument", "taskIndex is required for task refinement.");
      }
      userPrompt = [
        `Original job brief: ${brief}`,
        draftSummary ? `Draft summary: ${draftSummary}` : "",
        `Phase index: ${phaseIdx}, task index: ${taskIdx}`,
        `Current task JSON: ${JSON.stringify(data.currentTaskJson ?? {})}`,
        `User wants this change: ${feedback}`,
        extra ? `Extra context: ${extra}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${kind === "phase" ? systemPhase : systemTask}\n\n${userPrompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    };

    const url = `${GEMINI_URL}?key=${apiKey}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      log("[refineGeneratedProjectNode] fetch_error", { reasonCode: "provider_unreachable", error: String(e) });
      throw new HttpsError("unavailable", "AI service unavailable. Try again.");
    }

    const rawJson = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      log("[refineGeneratedProjectNode] gemini_http_error", {
        reasonCode: "provider_http_error",
        status: response.status,
        preview: JSON.stringify(rawJson).slice(0, 400),
      });
      if (response.status === 429) {
        throw new HttpsError(
          "resource-exhausted",
          "AI is temporarily overloaded. Try again shortly."
        );
      }
      throw new HttpsError("failed-precondition", "AI request failed. Try again.");
    }

    if (rawJson.error && typeof rawJson.error === "object") {
      log("[refineGeneratedProjectNode] gemini_error_field", {
        reasonCode: "provider_response_invalid",
        error: rawJson.error,
      });
      throw new HttpsError("failed-precondition", "AI configuration error.");
    }

    const promptFeedback = rawJson.promptFeedback as { blockReason?: string } | undefined;
    if (promptFeedback?.blockReason) {
      log("[refineGeneratedProjectNode] blocked", {
        reasonCode: "prompt_blocked",
        blockReason: promptFeedback.blockReason,
      });
      throw new HttpsError(
        "failed-precondition",
        "AI could not process this request. Try simpler wording."
      );
    }

    const candidates = rawJson.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    const text = candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text.trim()) {
      log("[refineGeneratedProjectNode] empty_output", { reasonCode: "provider_empty_output" });
      throw new HttpsError("failed-precondition", "AI returned nothing. Try again.");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonFromResponse(text);
    } catch (e) {
      log("[refineGeneratedProjectNode] parsing_failed", {
        reasonCode: "parsing_failed",
        preview: text.slice(0, 200),
        error: String(e),
      });
      throw new HttpsError("failed-precondition", "Could not read AI response. Try again.");
    }

    try {
      if (kind === "phase") {
        const phaseRaw = parsed.phase;
        const errs = validatePhaseShape(phaseRaw);
        if (errs.length) {
          log("[refineGeneratedProjectNode] validation_failed", {
            reasonCode: "invalid_ai_payload",
            errs,
          });
          throw new HttpsError(
            "failed-precondition",
            "AI proposed an invalid phase. Try different wording."
          );
        }
        const phase = normalizePhase(phaseRaw);
        return { kind: "phase" as const, phase };
      }
      const taskRaw = parsed.task;
      const te = validateTask(taskRaw, "task");
      if (te.length) {
        log("[refineGeneratedProjectNode] validation_failed", {
          reasonCode: "invalid_ai_payload",
          errs: te,
        });
        throw new HttpsError(
          "failed-precondition",
          "AI proposed an invalid task. Try different wording."
        );
      }
      const task = normalizeTask(taskRaw);
      return { kind: "task" as const, task };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      log("[refineGeneratedProjectNode] normalization_failed", {
        reasonCode: "template_mapping_failed",
        error: String(e),
      });
      throw new HttpsError("failed-precondition", "Could not apply AI suggestion. Try again.");
    }
  }
);
