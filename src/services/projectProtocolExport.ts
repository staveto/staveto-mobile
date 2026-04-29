/**
 * Export project as PDF protocol (handover report).
 * Uses expo-print to generate PDF from HTML template.
 */
import { Share } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { doc, getDoc } from "../lib/rnFirestore";
import { db } from "../firebase";
import * as projectsService from "./projects";
import * as tasksService from "./tasks";
import * as expensesService from "./expenses";
import * as constructionDiaryService from "./constructionDiary";
import * as problemsService from "./problems";
import * as attachmentsService from "./attachments";
import type { ProjectPhaseDoc } from "./projects";
import type { TaskDoc } from "./tasks";
import type { ExpenseDoc } from "./expenses";
import type { DiaryEntryDoc } from "./constructionDiary";
import type { ProblemDoc } from "./problems";

export type ExportResult = { ok: true; shared: boolean } | { ok: false; error: string };

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso ?? "";
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ProtocolLabels = {
  title?: string;
  exportDate?: string;
  status?: string;
  tasks?: string;
  expenses?: string;
  diary?: string;
  problems?: string;
  phase?: string;
  task?: string;
  statusLabel?: string;
  responsible?: string;
  date?: string;
  amount?: string;
  description?: string;
  total?: string;
  footer?: string;
  photos?: string;
  signature?: string;
};

const DEFAULT_LABELS: ProtocolLabels = {
  title: "Protokol projektu",
  exportDate: "Exportované",
  status: "Stav",
  tasks: "Úlohy",
  expenses: "Výdavky",
  diary: "Denník",
  problems: "Reklamácie / Problémy",
  phase: "Fáza",
  task: "Úloha",
  statusLabel: "Stav",
  responsible: "Zodpovedný",
  date: "Dátum",
  amount: "Suma",
  description: "Popis",
  total: "Spolu",
  footer: "Vygenerované v Staveto",
  photos: "Fotky",
  signature: "Podpis",
};

function buildProtocolHtml(params: {
  projectName: string;
  address: string;
  exportDate: string;
  statusLabel: string;
  progressPct: number;
  tasksDone: number;
  tasksTotal: number;
  phases: ProjectPhaseDoc[];
  tasks: TaskDoc[];
  expenses: ExpenseDoc[];
  diaryEntries: DiaryEntryDoc[];
  problems: ProblemDoc[];
  photoUrls: string[];
  ownerName: string;
  signedDate: string;
  forCustomer?: boolean;
  labels?: ProtocolLabels;
}): string {
  const L = { ...DEFAULT_LABELS, ...params.labels };
  const phaseNames: Record<string, string> = {};
  params.phases.forEach((p) => {
    phaseNames[p.id] = p.name || "";
  });

  const tasksRows = params.phases.length > 0
    ? params.phases.flatMap((p) => {
        const phaseTasks = params.tasks.filter((t) => t.phaseId === p.id);
        return phaseTasks.map((t) =>
          `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(t.title ?? "")}</td><td>${escapeHtml(t.status ?? "")}</td><td>${escapeHtml(t.assigneeName ?? t.assignedToEmail ?? "")}</td></tr>`
        );
      })
    : params.tasks.map((t) =>
        `<tr><td>—</td><td>${escapeHtml(t.title ?? "")}</td><td>${escapeHtml(t.status ?? "")}</td><td>${escapeHtml(t.assigneeName ?? t.assignedToEmail ?? "")}</td></tr>`
      );

  const expensesTotal = params.expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const expensesRows = params.expenses.map(
    (e) =>
      `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.title ?? "")}</td><td>${e.amount ?? 0} ${e.currency ?? "€"}</td></tr>`
  );

  const diaryRows = params.diaryEntries.map((d) => {
    const phaseName = d.phaseId ? phaseNames[d.phaseId] ?? "" : "";
    return `
    <div class="diary-entry">
      <strong>${formatDate(d.date)}</strong>${phaseName ? ` – ${escapeHtml(phaseName)}` : ""}<br>
      <span class="diary-desc">${escapeHtml(d.workDescription ?? "")}</span>
      ${d.weather ? `<br><small>Počasie: ${escapeHtml(d.weather)}</small>` : ""}
      ${d.workers ? `<br><small>Pracovníci: ${escapeHtml(d.workers)}</small>` : ""}
    </div>`;
  });

  const problemsRows = params.problems.map(
    (p) => `<tr><td>${escapeHtml(p.shortDescription ?? "")}</td><td>${escapeHtml(p.status ?? "")}</td></tr>`
  );

  const photosHtml =
    params.photoUrls.length > 0
      ? params.photoUrls
          .map(
            (url) =>
              `<img src="${url.replace(/"/g, "&quot;")}" alt="Photo" style="max-width: 200px; max-height: 150px; object-fit: cover; margin: 4px; border-radius: 4px;" />`
          )
          .join("")
      : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #333; font-size: 14px; }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .logo-text { font-size: 24px; font-weight: 800; color: #1D376A; letter-spacing: 0.05em; }
    .logo-url { font-size: 12px; color: #666; margin-top: 2px; }
    h1 { font-size: 22px; margin-bottom: 4px; color: #1D376A; }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
    h2 { font-size: 16px; margin-top: 28px; margin-bottom: 8px; border-bottom: 2px solid #1D376A; padding-bottom: 6px; color: #1D376A; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    .diary-entry { margin-bottom: 16px; padding: 12px; background: #fafafa; border-radius: 6px; }
    .diary-desc { white-space: pre-wrap; }
    .photos-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .footer { margin-top: 40px; font-size: 11px; color: #999; }
    .signed-row { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 13px; color: #333; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
    .signed-left { flex-shrink: 0; }
    .signed-line { width: 180px; border-bottom: 1px solid #333; margin-bottom: 2px; }
    .progress { font-weight: 600; color: #2e7d32; }
  </style>
</head>
<body>
  <div class="header-row">
    <div>
      <div class="logo-text">STAVETO</div>
      <div class="logo-url">www.staveto.com</div>
    </div>
  </div>

  <h1>${escapeHtml(params.projectName)}</h1>
  <div class="meta">
    ${params.address ? `<div>${escapeHtml(params.address)}</div>` : ""}
    <div>${L.exportDate}: ${params.exportDate} | ${L.status}: ${escapeHtml(params.statusLabel)} (${params.progressPct}%)</div>
  </div>

  <h2>${L.tasks} (${params.tasksDone}/${params.tasksTotal})</h2>
  <table>
    <tr><th>${L.phase}</th><th>${L.task}</th><th>${L.statusLabel}</th><th>${L.responsible}</th></tr>
    ${tasksRows.join("")}
  </table>

  ${!params.forCustomer ? `
  <h2>${L.expenses}</h2>
  <table>
    <tr><th>${L.date}</th><th>${L.task}</th><th>${L.amount}</th></tr>
    ${expensesRows.join("")}
    ${expensesRows.length > 0 ? `<tr style="font-weight:600"><td colspan="2">${L.total}</td><td>${expensesTotal.toFixed(2)} €</td></tr>` : ""}
  </table>
` : ""}

  <h2>${L.diary}</h2>
  ${diaryRows.length > 0 ? diaryRows.join("") : `<p class="meta">Žiadne zápisy</p>`}

  <h2>${L.problems}</h2>
  <table>
    <tr><th>${L.task}</th><th>${L.statusLabel}</th></tr>
    ${problemsRows.length > 0 ? problemsRows.join("") : `<tr><td colspan="2">Žiadne</td></tr>`}
  </table>

  ${params.photoUrls.length > 0 ? `<h2>${L.photos}</h2><div class="photos-grid">${photosHtml}</div>` : ""}

  <div class="signed-row">
    <div class="signed-left">${escapeHtml(params.ownerName)} | ${params.signedDate}</div>
    <div style="flex: 1; display: flex; flex-direction: column; align-items: flex-end;">
      <div class="signed-line"></div>
      <small style="font-size: 10px; color: #666;">${L.signature}</small>
    </div>
  </div>
  <div class="footer">${L.footer} | ${params.exportDate}</div>
</body>
</html>`;
}

export async function exportProjectAsProtocol(
  projectId: string,
  labels?: ProtocolLabels
): Promise<ExportResult> {
  try {
    const [project, phases, tasks, expenses, diaryEntries, problems, attachments] = await Promise.all([
      projectsService.getProject(projectId),
      projectsService.listProjectPhases(projectId).catch(() => [] as ProjectPhaseDoc[]),
      tasksService.listTasksByProject(projectId),
      expensesService.listExpensesByProject(projectId),
      constructionDiaryService.listDiaryEntries(projectId),
      problemsService.listProblems(projectId).catch(() => [] as ProblemDoc[]),
      attachmentsService.listAttachments(projectId).catch(() => []),
    ]);

    const imageAttachments = attachmentsService.attachmentsForProjectPhotoGallery(attachments);
    const photoUrls: string[] = [];
    for (const att of imageAttachments) {
      try {
        const url = await attachmentsService.getAttachmentURL(att);
        if (url) photoUrls.push(url);
      } catch {
        // ignore failed URLs
      }
    }

    let ownerName = "";
    const ownerId = project?.ownerId;
    if (ownerId) {
      try {
        const userSnap = await getDoc(doc(db, "users", ownerId));
        const userData = userSnap.data();
        ownerName =
          (userData?.displayName as string) ??
          (userData?.name as string) ??
          (userData?.email as string) ??
          "";
      } catch {
        // ignore
      }
    }

    const projectName = project?.name ?? "Projekt";
    const tasksDone = tasks.filter((t) => t.status === "DONE").length;
    const tasksTotal = tasks.length;
    const progressPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 100;
    const exportDate = formatDate(new Date().toISOString());
    const signedDate = formatDate(new Date().toISOString());

    let statusLabel = "Dokončené";
    if (progressPct < 100) statusLabel = "Prebieha";
    if (tasksTotal === 0) statusLabel = "Prázdny";

    const html = buildProtocolHtml({
      projectName,
      address: project?.addressText ?? "",
      exportDate,
      statusLabel,
      progressPct,
      tasksDone,
      tasksTotal,
      phases,
      tasks,
      expenses,
      diaryEntries,
      problems,
      photoUrls,
      ownerName,
      signedDate,
      forCustomer: true,
      labels,
    });

    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: `Protokol: ${projectName}`,
        });
        return { ok: true, shared: true };
      }
    } catch (_sharingErr) {
      // Fallback to Share API
    }

    await Share.share({
      url: uri,
      title: `Protokol: ${projectName}`,
      message: `${projectName} – ${exportDate}`,
    });
    return { ok: true, shared: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[projectProtocolExport] Export failed:", err);
    return { ok: false, error: msg };
  }
}
