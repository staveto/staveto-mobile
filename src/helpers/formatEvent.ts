import type { ProjectEvent } from "../lib/types";

type TranslateFn = (key: string, params?: Record<string, string>) => string;

function normalizeTemplate(input: string): string {
  // Support both {{key}} and {key} placeholders.
  return input.replace(/\{\{(\w+)\}\}/g, "{$1}");
}

function formatAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed.toFixed(2);
    return value;
  }
  return "";
}

export function formatEventSummary(t: TranslateFn, event: ProjectEvent): string {
  const payload = event.payload ?? {};
  const actor = event.actorName ?? payload.actorName ?? t("events.systemActor");
  const task = payload.taskTitle ?? "";
  const amount = formatAmount(payload.amount);
  const currency = payload.currency ?? "EUR";
  const supplier = payload.supplier ?? "";

  // Dedicated fallback for OCR without supplier.
  if (event.type === "ocr_completed" && !supplier) {
    return t("events.ocr_completed_no_supplier");
  }

  const template = normalizeTemplate(t(`events.${event.type}`));
  const replacements: Record<string, string> = {
    actor,
    task,
    amount,
    currency,
    supplier,
  };

  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? "");
  return text.replace(/\s{2,}/g, " ").trim();
}
