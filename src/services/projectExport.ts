/**
 * Export project data to CSV file.
 * Uses expo-file-system + expo-sharing when available, else Share with CSV text.
 */
import { Share } from "react-native";
import * as tasksService from "./tasks";
import * as expensesService from "./expenses";
import * as constructionDiaryService from "./constructionDiary";
import * as projectsService from "./projects";
import type { TaskDoc } from "./tasks";
import type { ExpenseDoc } from "./expenses";
import type { DiaryEntryDoc } from "./constructionDiary";
import type { ProjectPhaseDoc } from "./projects";

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function buildProjectCsv(
  projectName: string,
  phases: ProjectPhaseDoc[],
  tasks: TaskDoc[],
  expenses: ExpenseDoc[],
  diaryEntries: DiaryEntryDoc[]
): string {
  const phaseNames: Record<string, string> = {};
  phases.forEach((p) => {
    phaseNames[p.id] = p.name || "";
  });

  const lines: string[] = [];
  lines.push(`Project: ${escapeCsv(projectName)}`);
  lines.push(`Exported: ${formatDate(new Date().toISOString())}`);
  lines.push("");

  // Tasks section
  lines.push("=== TASKS ===");
  lines.push("Phase,Task,Status,Assignee,Due date");
  tasks.forEach((t) => {
    const phaseName = t.phaseId ? phaseNames[t.phaseId] ?? "" : "";
    lines.push(
      [
        escapeCsv(phaseName),
        escapeCsv(t.title),
        escapeCsv(t.status),
        escapeCsv(t.assigneeName ?? t.assignedToEmail ?? ""),
        escapeCsv(t.dueDate ?? ""),
      ].join(",")
    );
  });
  lines.push("");

  // Expenses section
  lines.push("=== EXPENSES ===");
  lines.push("Date,Title,Amount,Currency,Supplier,Tax ID,Category,Note");
  expenses.forEach((e) => {
    lines.push(
      [
        escapeCsv(formatDate(e.date)),
        escapeCsv(e.title),
        escapeCsv(e.amount ?? ""),
        escapeCsv(e.currency ?? "EUR"),
        escapeCsv(e.supplierName ?? ""),
        escapeCsv(e.supplierIco ?? ""),
        escapeCsv(e.category ?? ""),
        escapeCsv(e.note ?? ""),
      ].join(",")
    );
  });
  lines.push("");

  // Diary section
  lines.push("=== CONSTRUCTION DIARY ===");
  lines.push("Date,Phase,Description,Weather,Workers,Materials");
  diaryEntries.forEach((d) => {
    const phaseName = d.phaseId ? phaseNames[d.phaseId] ?? "" : "";
    lines.push(
      [
        escapeCsv(formatDate(d.date)),
        escapeCsv(phaseName),
        escapeCsv(d.workDescription ?? ""),
        escapeCsv(d.weather ?? ""),
        escapeCsv(d.workers ?? ""),
        escapeCsv(d.materials ?? ""),
      ].join(",")
    );
  });

  return lines.join("\n");
}

export type ExportResult = { ok: true; shared: boolean } | { ok: false; error: string };

export async function exportProjectToCsv(projectId: string): Promise<ExportResult> {
  try {
    const [project, phases, tasks, expenses, diaryEntries] = await Promise.all([
      projectsService.getProject(projectId),
      projectsService.listProjectPhases(projectId),
      tasksService.listTasksByProject(projectId),
      expensesService.listExpensesByProject(projectId),
      constructionDiaryService.listDiaryEntries(projectId),
    ]);

    const projectName = project?.name ?? "Project";
    const csv = buildProjectCsv(projectName, phases, tasks, expenses, diaryEntries);

    try {
      const FileSystem = await import("expo-file-system");
      const Sharing = await import("expo-sharing");
      const fileName = `staveto_${projectName.replace(/[^a-zA-Z0-9]/g, "_")}_${formatDate(new Date().toISOString())}.csv`;
      const fileUri = `${FileSystem.default.cacheDirectory}${fileName}`;

      await FileSystem.default.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.default.EncodingType.UTF8,
      });

      const canShare = await Sharing.default.isAvailableAsync();
      if (canShare) {
        await Sharing.default.shareAsync(fileUri, {
          mimeType: "text/csv",
          dialogTitle: `Export: ${projectName}`,
        });
        return { ok: true, shared: true };
      }
    } catch (_fsErr) {
      // Fallback: share CSV as text
    }

    await Share.share({
      message: csv,
      title: `Export: ${projectName}`,
    });
    return { ok: true, shared: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[projectExport] Export failed:", err);
    return { ok: false, error: msg };
  }
}
