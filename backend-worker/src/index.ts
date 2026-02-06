import { Hono } from "hono";
import { z } from "zod";
import { startOfDay, parseISO, isBefore, isAfter, addDays, isWithinInterval } from "date-fns";
import { AirtableClient } from "./lib/airtable";
import { AuthService } from "./lib/auth";
import {
  TABLE_ORGS,
  TABLE_USERS,
  TABLE_PROJECTS,
  TABLE_TASKS,
  USERS as UF,
  PROJECTS as PF,
  TASKS as TF,
  normalizeTaskStatus,
} from "./lib/airtable-tables";

export type Env = {
  AIRTABLE_API_KEY?: string;
  AIRTABLE_API_KEY_PART1?: string;
  AIRTABLE_API_KEY_PART2?: string;
  AIRTABLE_BASE_ID: string;
  JWT_SECRET: string;
};

function getAirtableKey(env: Env): string {
  const p1 = env.AIRTABLE_API_KEY_PART1 ?? "";
  const p2 = env.AIRTABLE_API_KEY_PART2 ?? "";
  if (p1 && p2) return `${p1}.${p2}`;
  return env.AIRTABLE_API_KEY ?? "";
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  await next();
});

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  Object.entries(CORS).forEach(([k, v]) => h.set(k, v));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

app.get("/", (c) =>
  c.json({
    service: "Staveto API",
    docs: {
      health: "GET /health",
      login: "POST /auth/login",
      debugEnv: "GET /debug/env-check (confirm AIRTABLE_API_KEY is loaded)",
      debugUsers: "GET /debug/airtable-users (field names from Airtable Users table)",
    },
  })
);
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// Debug: confirm AIRTABLE_API_KEY is loaded (non-sensitive)
app.get("/debug/env-check", (c) => {
  const k = getAirtableKey(c.env);
  const part1Len = (c.env.AIRTABLE_API_KEY_PART1 ?? "").length;
  const part2Len = (c.env.AIRTABLE_API_KEY_PART2 ?? "").length;
  const source = part1Len && part2Len ? "PART1+PART2" : "AIRTABLE_API_KEY";
  const ok = k.length >= 80 && k.includes(".");
  const fixHint =
    !ok && source === "AIRTABLE_API_KEY"
      ? "Run 'npx wrangler dev' from the folder that contains wrangler.toml and a .dev.vars with AIRTABLE_API_KEY_PART1 and AIRTABLE_API_KEY_PART2 (see .dev.vars.example). Path: .../staveto-app_v2/backend-worker"
      : !ok && source === "PART1+PART2"
        ? "PART1 and PART2 are set but token may be wrong. Full PAT must be part1.part2 from airtable.com/create/tokens"
        : undefined;
  return c.json({
    AIRTABLE_API_KEY: {
      set: k.length > 0,
      length: k.length,
      startsWithPat: k.startsWith("pat"),
      hasDot: k.includes("."),
      source,
      ok,
    },
    AIRTABLE_BASE_ID: (c.env.AIRTABLE_BASE_ID ?? "").slice(0, 8) + "...",
    ...(fixHint && { fix: fixHint }),
  });
});

// Debug: see what field names Airtable returns for Users (remove or protect in production)
app.get("/debug/airtable-users", async (c) => {
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const result = await airtable.list("Users", {});
    const records = result.records ?? [];
    const first = records[0];
    const fieldNames = first ? Object.keys(first.fields as object) : [];
    return c.json({
      recordCount: records.length,
      fieldNames,
      expectedForLogin: ["Email", "Status", "Org", "FullName", "Role"],
    });
  } catch (err) {
    const msg = (err as Error).message;
    const hint =
      msg.includes("401") || msg.toLowerCase().includes("authentication")
        ? "Use a Personal Access Token (pat...) in .dev.vars as AIRTABLE_API_KEY. Create at airtable.com/create/tokens with read access to this base."
        : undefined;
    return c.json({ error: msg, ...(hint && { hint }) }, 500);
  }
});

app.post("/auth/login", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z.object({ email: z.string().email() }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
  const auth = new AuthService(c.env.JWT_SECRET, airtable);
  const result = await auth.login(email);
  if ("ok" in result && result.ok === false) {
    const messages: Record<string, string> = {
      not_found: "No user with this email in the Users table.",
      no_org: "User has no linked organization. Link an Org in Airtable.",
      not_active: "User exists but Status is not ACTIVE. Set Status to ACTIVE.",
      error: result.reason === "error" && result.message ? result.message : "Airtable or server error.",
    };
    return c.json({ error: messages[result.reason] ?? "Invalid email or user not active" }, 401);
  }
  return c.json(result);
});

// Registrácia: vytvorí skutočný záznam v Airtable Users a prepojí na prvú organizáciu. Žiadne stub tokeny.
app.post("/auth/register", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Neplatná požiadavka", details: parsed.error.flatten() }, 400);
  }
  const email = parsed.data.email.trim().toLowerCase();
  const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
  const auth = new AuthService(c.env.JWT_SECRET, airtable);

  const existing = await auth.login(email);
  if ("token" in existing) {
    return c.json({ error: "Používateľ s týmto emailom už existuje. Prihláste sa." }, 409);
  }
  if ("ok" in existing && existing.reason !== "not_found") {
    const msg =
      existing.reason === "no_org"
        ? "Používateľ existuje, ale nemá priradenú organizáciu."
        : existing.reason === "not_active"
          ? "Používateľ existuje, ale nie je ACTIVE."
          : "Prihlásenie zlyhalo.";
    return c.json({ error: msg }, 400);
  }

  let firstOrgId: string;
  try {
    const orgsRes = await airtable.list(TABLE_ORGS, { maxRecords: 1 });
    const first = orgsRes.records?.[0];
    if (!first?.id) {
      return c.json(
        {
          error:
            "V Airtable nie je žiadna organizácia. Vytvorte v tabuľke „Orgs“ aspoň jeden záznam a skúste znova.",
        },
        400
      );
    }
    firstOrgId = first.id;
  } catch (err) {
    const msg = (err as Error).message;
    return c.json(
      {
        error: "Nepodarilo sa načítať organizácie z Airtable.",
        hint: msg.includes("404") ? "Skontrolujte názov tabuľky „Orgs“ a BASE_ID." : undefined,
      },
      502
    );
  }

  try {
    await airtable.create(TABLE_USERS, {
      [UF.Email]: email,
      [UF.FullName]: email.split("@")[0] || "User",
      [UF.Status]: "ACTIVE",
      [UF.Role]: "ADMIN",
      [UF.Org]: [firstOrgId],
    });
  } catch (err) {
    const msg = (err as Error).message;
    return c.json(
      {
        error: "Registrácia zlyhala: nepodarilo sa vytvoriť používateľa v Airtable.",
        hint: msg.includes("INVALID_VALUE_FOR_COLUMN") ? "Skontrolujte názvy stĺpcov (Email, FullName, Status, Role, Org)." : undefined,
      },
      502
    );
  }

  const loginResult = await auth.login(email);
  if ("ok" in loginResult && loginResult.ok === false) {
    return c.json(
      { error: "Používateľ bol vytvorený, ale prihlásenie zlyhalo. Skúste sa prihlásiť ručne." },
      502
    );
  }
  return c.json(loginResult);
});

// Projekty: Airtable Projects table, Org ako linked record (pole record ID)
function orgMatch(record: { fields: Record<string, unknown> }, orgId: string): boolean {
  const o = record.fields[PF.Org];
  const arr = Array.isArray(o) ? o : o != null ? [o] : [];
  return arr.some((x) => String(x) === orgId);
}

app.get("/projects", async (c) => {
  const orgId = c.req.query("orgId") ?? "";
  if (!orgId) return c.json({ projects: [] });
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const res = await airtable.list(TABLE_PROJECTS, { maxRecords: 100 });
    const projects = (res.records ?? []).filter((r) => orgMatch(r, orgId)).map((r) => ({ id: r.id, name: (r.fields[PF.Name] as string) ?? "" }));
    return c.json({ projects });
  } catch {
    return c.json({ projects: [] });
  }
});

app.post("/projects", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ orgId: z.string(), name: z.string().min(1), shareWithinOrg: z.boolean().optional() })
    .safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  const { orgId, name } = parsed.data;
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const created = await airtable.create(TABLE_PROJECTS, {
      [PF.Name]: name.trim(),
      [PF.Org]: [orgId],
    });
    return c.json({
      project: {
        id: created.id,
        name: (created.fields[PF.Name] as string) ?? name.trim(),
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (isSchemaError(msg)) {
      return c.json({ error: "Airtable schema mismatch – Projects: Name, Org (linked)." }, 502);
    }
    return c.json({ error: "Vytvorenie projektu zlyhalo: " + msg }, 502);
  }
});

app.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z.object({ orgId: z.string(), name: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  const { orgId, name } = parsed.data;
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const existing = await airtable.find(TABLE_PROJECTS, id);
    const o = existing.fields[PF.Org];
    const arr = Array.isArray(o) ? o : o != null ? [o] : [];
    if (!arr.some((x) => String(x) === orgId)) {
      return c.json({ error: "Project not in this organisation" }, 403);
    }
    const updated = await airtable.update(TABLE_PROJECTS, id, { [PF.Name]: name.trim() });
    return c.json({
      project: { id: updated.id, name: (updated.fields[PF.Name] as string) ?? name.trim() },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (isSchemaError(msg)) return c.json({ error: "Airtable schema mismatch" }, 502);
    return c.json({ error: "Update failed: " + msg }, 502);
  }
});

app.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const orgId = c.req.query("orgId") ?? "";
  if (!orgId) return c.json({ error: "orgId required" }, 400);
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const existing = await airtable.find(TABLE_PROJECTS, id);
    const o = existing.fields[PF.Org];
    const arr = Array.isArray(o) ? o : o != null ? [o] : [];
    if (!arr.some((x) => String(x) === orgId)) {
      return c.json({ error: "Project not in this organisation" }, 403);
    }
    await airtable.delete(TABLE_PROJECTS, id);
    return c.json({ deleted: true, id });
  } catch (err) {
    const msg = (err as Error).message;
    return c.json({ error: "Delete failed: " + msg }, 502);
  }
});

// Úlohy: Status = OPEN | DOING | DONE | BLOCKED | SKIPPED; Org, Project, Assignee ako linked record polia
function taskToDto(r: { id: string; fields: Record<string, unknown> }): { id: string; title: string; status: string; dueDate?: string; projectId?: string } {
  const f = r.fields;
  const status = normalizeTaskStatus((f[TF.Status] as string) ?? "OPEN");
  const projectArr = (f[TF.Project] as string[] | undefined) ?? [];
  return {
    id: r.id,
    title: (f[TF.Title] as string) ?? "",
    status,
    dueDate: f["DueDate"] as string | undefined,
    projectId: projectArr[0],
  };
}

function isSchemaError(msg: string): boolean {
  const u = msg.toLowerCase();
  return u.includes("unknown field") || u.includes("invalid field") || u.includes("invalid_value_for_column") || u.includes("schema");
}

function bucketFilter(tasks: { dueDate?: string }[], bucket: string): { dueDate?: string }[] {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const parse = (d?: string) => (d ? parseISO(d.slice(0, 10)) : null);

  if (bucket === "overdue") {
    return tasks.filter((t) => {
      const d = parse(t.dueDate);
      return d != null && isBefore(d, today);
    });
  }
  if (bucket === "today") {
    return tasks.filter((t) => {
      const d = parse(t.dueDate);
      return d != null && isWithinInterval(d, { start: today, end: addDays(today, 1) });
    });
  }
  if (bucket === "nextWeek") {
    return tasks.filter((t) => {
      const d = parse(t.dueDate);
      return d != null && isWithinInterval(d, { start: tomorrow, end: weekEnd });
    });
  }
  if (bucket === "later") {
    return tasks.filter((t) => {
      const d = parse(t.dueDate);
      return d == null || isAfter(d, weekEnd);
    });
  }
  return tasks;
}

app.get("/tasks", async (c) => {
  const orgId = c.req.query("orgId") ?? "";
  const bucket = (c.req.query("bucket") ?? "today") as string;
  const includeDone = c.req.query("includeDone") ?? "0";
  if (!orgId) return c.json({ tasks: [] });
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const res = await airtable.list(TABLE_TASKS, { maxRecords: 200 });
    let list = (res.records ?? [])
      .filter((r) => orgMatch(r as { fields: Record<string, unknown> }, orgId))
      .map((r) => taskToDto(r as { id: string; fields: Record<string, unknown> }));
    if (includeDone === "0") list = list.filter((t) => t.status !== "DONE");
    list = bucketFilter(list, bucket) as typeof list;
    return c.json({ tasks: list });
  } catch (err) {
    const msg = (err as Error).message;
    if (isSchemaError(msg)) {
      return c.json({ error: "Airtable schema mismatch – skontrolujte názvy tabuliek a polí (Tasks: Title, Status, Org, Project, Assignee, DueDate)." }, 502);
    }
    return c.json({ tasks: [] });
  }
});

app.post("/tasks", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ orgId: z.string(), title: z.string().min(1), projectId: z.string().optional(), assigneeId: z.string().optional() })
    .safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  const { orgId, title, projectId, assigneeId } = parsed.data;
  const fields: Record<string, unknown> = {
    [TF.Title]: title.trim(),
    [TF.Status]: "OPEN",
    [TF.Org]: [orgId],
  };
  if (projectId) fields[TF.Project] = [projectId];
  if (assigneeId) fields[TF.Assignee] = [assigneeId];
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    const created = await airtable.create(TABLE_TASKS, fields);
    return c.json({
      task: taskToDto(created as { id: string; fields: Record<string, unknown> }),
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (isSchemaError(msg)) {
      return c.json({ error: "Airtable schema mismatch – Tasks: Title, Status, Org, Project, Assignee, DueDate." }, 502);
    }
    return c.json({ error: "Vytvorenie úlohy zlyhalo: " + msg }, 502);
  }
});

app.patch("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z.object({ orgId: z.string().optional(), status: z.string() }).safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  const status = normalizeTaskStatus(parsed.data.status);
  try {
    const airtable = new AirtableClient(getAirtableKey(c.env), c.env.AIRTABLE_BASE_ID);
    await airtable.update(TABLE_TASKS, id, { [TF.Status]: status });
    return c.json({ task: { id, status } });
  } catch (err) {
    const msg = (err as Error).message;
    if (isSchemaError(msg)) {
      return c.json({ error: "Airtable schema mismatch – Tasks: Status." }, 502);
    }
    return c.json({ error: "Zmena statusu zlyhala: " + msg }, 502);
  }
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await app.fetch(request, env, ctx);
    return withCors(res);
  },
};
