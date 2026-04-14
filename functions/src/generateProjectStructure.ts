/**
 * Firebase Callable: Generate project structure from brief using AI.
 * Requires GOOGLE_GENERATIVE_AI_API_KEY in Firebase config (or env).
 * Optionally accepts technical documents (PDF, images) for better planning.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { log } from "firebase-functions/logger";
import { sanitizeAiProjectPlanFromModel, validateAiProjectPlan } from "./aiProjectSchema";

/**
 * Gemini 1.5 Flash family has been removed from the public API (see Gemini API changelog).
 * Default to a current stable flash model; override via GEMINI_MODEL for staged upgrades.
 */
const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim();
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_BRIEF_LEN = 600;
const MAX_DOCUMENTS = 5;
const STORAGE_BUCKET = "staveto-mvp-5f251.firebasestorage.app";

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/pdf";
}

const SYSTEM_PROMPT = `You are a construction project planning assistant. Generate a structured project plan from the user's brief for REVIEW. The user will approve it before the project is created.

GOAL: Create practical, actionable phases and tasks that the user can immediately use. Each task should be clear and executable.

RULES:
- Return ONLY valid JSON, no markdown, no explanation.
- Generate ONLY the scope the user needs. If the brief describes ONE trade/part (e.g. "Montage Solaranlage", "Garage mauern", "Kanalisation"), create ONLY relevant phases. Do NOT generate a full house template.
- Small jobs: max 3-5 phases, each max 5-10 tasks.
- Larger projects: max 6-8 phases, each max 5-10 tasks.
- Prefer execution tasks (real work) over coordination. Use coordination only when needed (e.g. "Bagger bestellen", "Material bestellen"). Use inspection for quality checks.
- Task titles: short, actionable (e.g. "Fundament gießen", "Elektroverteiler montieren").
- Prefer smaller practical plans over large generic structures.
- category: "construction" | "renovation" | "trade_installation" | "service" | "maintenance"
- scope: "full_build" | "partial_build" | "single_trade" | "small_job"
- taskType: "execution" | "coordination" | "inspection"
- priority: "low" | "medium" | "high"
- uiMode: "phases" for construction, "work_packages" for trade installations

JSON schema:
{
  "projectTitle": "string",
  "category": "construction|renovation|trade_installation|service|maintenance",
  "scope": "full_build|partial_build|single_trade|small_job",
  "summary": "string",
  "uiMode": "phases|work_packages",
  "phases": [
    {
      "name": "string",
      "description": "string",
      "tasks": [
        {
          "title": "string",
          "description": "string",
          "taskType": "execution|coordination|inspection",
          "priority": "low|medium|high"
        }
      ]
    }
  ]
}`;

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

function extractJsonFromResponse(text: string): object {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
  }

  const parseObject = (raw: string): object => {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as object;
    }
    if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object") {
      return parsed[0] as object;
    }
    throw new Error("Expected JSON object (or single-element object array)");
  };

  try {
    return parseObject(s);
  } catch {
    // fall through: model may wrap JSON in prose
  }

  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in AI response");
  }
  return parseObject(jsonMatch[0]);
}

export const generateProjectStructure = onCall(
  {
    region: "europe-west1",
    timeoutSeconds: 90,
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
      engineType?: string;
      workType?: string;
      documentStoragePaths?: string[];
      projectDetails?: string;
    };
    const raw = typeof data.projectBrief === "string" ? data.projectBrief.trim() : "";
    if (!raw) {
      throw new HttpsError("invalid-argument", "projectBrief is required.");
    }
    const projectBrief = raw.slice(0, MAX_BRIEF_LEN);
    const engineType = typeof data.engineType === "string" ? data.engineType.trim() : "";
    const workType = typeof data.workType === "string" ? data.workType.trim() : "";
    const projectDetails = typeof data.projectDetails === "string" ? data.projectDetails.trim().slice(0, 400) : "";
    const docPaths = Array.isArray(data.documentStoragePaths)
      ? data.documentStoragePaths
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .slice(0, MAX_DOCUMENTS)
      : [];

    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch (e) {
      log("[generateProjectStructure] Missing API key");
      throw e;
    }

    const contextParts: string[] = [];
    if (engineType === "BUILD") {
      contextParts.push("Project type: Construction (Bau)");
      if (workType) {
        const wtMap: Record<string, string> = {
          NEW_BUILD: "New construction (Neubau)",
          RENOVATION: "Renovation",
          INSTALLATION: "Installation/Mounting",
          SERVICE: "Service/Repair",
        };
        contextParts.push(`Work type: ${wtMap[workType] ?? workType}`);
      }
    } else if (engineType === "TRADE") {
      contextParts.push("Project type: Trade/Aufträge (Handwerker)");
      if (workType) {
        const wtMap: Record<string, string> = {
          INSTALLATION: "Installation/Mounting",
          REPAIR: "Repair",
          RENOVATION: "Renovation",
          DELIVERY: "Delivery",
        };
        contextParts.push(`Work type: ${wtMap[workType] ?? workType}`);
      }
    }

    const contextStr = contextParts.length > 0
      ? `\nContext: ${contextParts.join(". ")}\n`
      : "";
    const docHint =
      docPaths.length > 0
        ? "\nThe user has attached technical documents (PDF/images). Use them to refine the plan: extract specs, dimensions, or requirements mentioned in the documents."
        : "";
    const detailsStr = projectDetails
      ? `\nUser-provided project details: ${projectDetails}\n`
      : "";
    const userPrompt = `Create a project plan for review. User will approve before creation.${contextStr}${detailsStr}${docHint}\nUser brief: ${projectBrief}`;

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: `${SYSTEM_PROMPT}\n\n${userPrompt}` },
    ];

    if (docPaths.length > 0 && request.auth?.uid) {
      const bucket = admin.storage().bucket(STORAGE_BUCKET);
      for (const storagePath of docPaths) {
        if (!storagePath.startsWith(`users/${request.auth.uid}/aiProjectDrafts/`)) {
          log("[generateProjectStructure] Rejecting path outside user draft", { storagePath });
          continue;
        }
        try {
          const [buffer] = await bucket.file(storagePath).download();
          const mimeType = mimeFromPath(storagePath);
          const base64 = buffer.toString("base64");
          parts.push({ inlineData: { mimeType, data: base64 } });
        } catch (e) {
          log("[generateProjectStructure] Failed to download document", { storagePath, error: e });
        }
      }
    }

    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
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
      log("[generateProjectStructure] Fetch error", e);
      throw new HttpsError("internal", "AI service unavailable.");
    }

    if (!response.ok) {
      const errText = await response.text();
      log("[generateProjectStructure] Gemini API error", {
        status: response.status,
        model: GEMINI_MODEL,
        bodyPreview: errText.slice(0, 800),
      });
      if (response.status === 429) {
        throw new HttpsError(
          "resource-exhausted",
          "AI is temporarily overloaded. Try again in a moment or create manually."
        );
      }
      if (response.status === 404 || response.status === 400) {
        throw new HttpsError(
          "failed-precondition",
          "AI model or API configuration is outdated. Contact support."
        );
      }
      throw new HttpsError("internal", "AI generation failed. Try again or create manually.");
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text =
      result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      throw new HttpsError("internal", "AI returned empty response.");
    }

    let plan: object;
    try {
      plan = extractJsonFromResponse(text) as object;
    } catch (e) {
      log("[generateProjectStructure] JSON parse error", text.slice(0, 200), e);
      throw new HttpsError("internal", "Invalid AI response. Try again or create manually.");
    }

    const validationErrors = validateAiProjectPlan(plan);
    if (validationErrors) {
      const msg = validationErrors.map((e) => `${e.path}: ${e.message}`).join("; ");
      log("[generateProjectStructure] validation failed", { msg });
      throw new HttpsError("internal", "AI returned invalid structure. Try again or create manually.");
    }

    const planForClient = sanitizeAiProjectPlanFromModel(plan) as object;

    return { plan: planForClient, raw: text };
  }
);
