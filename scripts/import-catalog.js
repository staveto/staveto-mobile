/**
 * Import PhaseCatalog-SHORT.csv + TasksCatalog-SHORT.csv into Firestore
 * as catalogTemplates/eu-construction-v1 and subcollections phases, tasks.
 *
 * Prereqs:
 *   npm install firebase-admin
 *   Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path.
 *
 * Run (from mobile/ or project root):
 *   node scripts/import-catalog.js [path-to-phase-csv] [path-to-tasks-csv]
 *
 * Example:
 *   node scripts/import-catalog.js "C:\\Users\\Marek\\Downloads\\PhaseCatalog-SHORT.csv" "C:\\Users\\Marek\\Downloads\\TasksCatalog-SHORT.csv"
 */

const { readFileSync } = require("fs");
const path = require("path");

const PHASE_CSV = process.argv[2] || path.join(process.cwd(), "PhaseCatalog-SHORT.csv");
const TASKS_CSV = process.argv[3] || path.join(process.cwd(), "TasksCatalog-SHORT.csv");
const TEMPLATE_ID = "eu-construction-v1";

function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      i++;
      let s = "";
      while (i < line.length && line[i] !== '"') {
        s += line[i];
        i++;
      }
      if (line[i] === '"') i++;
      out.push(s);
      if (line[i] === ",") i++;
    } else {
      let s = "";
      while (i < line.length && line[i] !== ",") {
        s += line[i];
        i++;
      }
      if (line[i] === ",") i++;
      out.push(s.trim());
    }
  }
  return out;
}

function readCsv(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((l) => parseCsvLine(l));
}

async function main() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "staveto-mvp-5f251" });
  }
  const db = admin.firestore();

  const phaseRows = readCsv(PHASE_CSV);
  const taskRows = readCsv(TASKS_CSV);
  const phaseHeaders = phaseRows[0] || [];
  const taskHeaders = taskRows[0] || [];
  const phaseData = phaseRows.slice(1);
  const taskData = taskRows.slice(1);

  const batch = db.batch();
  const templateRef = db.collection("catalogTemplates").doc(TEMPLATE_ID);
  batch.set(templateRef, {
    name: "Stavba rodinného domu (EU)",
    projectType: "BUILD",
    updatedAt: new Date().toISOString(),
  });

  const idx = (arr, name) => arr.indexOf(name);
  const pi = (name) => idx(phaseHeaders, name);
  for (const row of phaseData) {
    const phaseId = row[pi("phaseId")] ?? row[1];
    if (!phaseId) continue;
    const ref = templateRef.collection("phases").doc(phaseId);
    batch.set(ref, {
      name: row[pi("phaseName")] ?? row[2] ?? "",
      description: row[pi("phaseDescription")] ?? row[3] ?? "",
      order: parseInt(row[pi("order")] ?? row[4], 10) || 0,
    });
  }

  const ti = (name) => idx(taskHeaders, name);
  for (const row of taskData) {
    const phaseId = row[ti("phaseId")] ?? row[1];
    const order = parseInt(row[ti("order")] ?? row[2], 10) || 0;
    if (!phaseId) continue;
    const taskId = `${phaseId}-${order}`;
    const ref = templateRef.collection("tasks").doc(taskId);
    const req = row[ti("required")] ?? row[6];
    batch.set(ref, {
      phaseId,
      order,
      title: row[ti("taskTitle")] ?? row[3] ?? "",
      trade: row[ti("trade")] ?? row[4] ?? "",
      priority: row[ti("priority")] ?? row[5] ?? "",
      required: String(req).toUpperCase() === "TRUE",
      defaultStatus: (row[ti("defaultStatus")] ?? row[7]) || "OPEN",
    });
  }

  await batch.commit();
  console.log("Import done: catalogTemplates/%s (+ phases + tasks)", TEMPLATE_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
