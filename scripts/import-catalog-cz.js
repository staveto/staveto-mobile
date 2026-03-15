/**
 * Import CZ template: PhaseCatalog-SHORT_CZ.xlsx + TaskCatalog-SHORT_CZ.csv
 * into Firestore catalogTemplates/cz-construction-v1
 *
 * Prereqs:
 *   npm install firebase-admin xlsx
 *   Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path
 *
 * Usage: node scripts/import-catalog-cz.js [phase-xlsx] [task-csv]
 * Example: node scripts/import-catalog-cz.js "C:\Users\Marek\Downloads\PhaseCatalog-SHORT_CZ.xlsx" "C:\Users\Marek\Downloads\TaskCatalog-SHORT_CZ.csv"
 */

const { readFileSync, existsSync } = require("fs");
const path = require("path");

const PHASE_XLSX = process.argv[2] || path.join(process.cwd(), "PhaseCatalog-SHORT_CZ.xlsx");
const TASK_CSV = process.argv[3] || path.join(process.cwd(), "TaskCatalog-SHORT_CZ.csv");

function resolveCredentials() {
  const env = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (env && existsSync(env)) return env;
  const candidates = [
    path.join(process.cwd(), "credentials", "firebase-service-account.json"),
    path.join(process.cwd(), "credentials", "service-account.json"),
    path.join(process.cwd(), "..", "credentials", "firebase-service-account.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
      return p;
    }
  }
  return null;
}

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

function readPhaseXlsx(filePath) {
  const XLSX = require("xlsx");
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

async function main() {
  const credPath = resolveCredentials();
  if (!credPath) {
    console.error("");
    console.error("Chyba: Firebase credentials nenájdené.");
    console.error("");
    console.error("Možnosti:");
    console.error("  1. Stiahni service account: Firebase Console → Project Settings → Service accounts → Generate new private key");
    console.error("  2. Ulož JSON do: mobile/credentials/firebase-service-account.json");
    console.error("  3. Alebo nastav: $env:GOOGLE_APPLICATION_CREDENTIALS = \"C:\\cesta\\k\\tvojmu.json\"");
    console.error("");
    process.exit(1);
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "staveto-mvp-5f251" });
  }
  const db = admin.firestore();

  const phaseRows = readPhaseXlsx(PHASE_XLSX);
  const taskRows = readCsv(TASK_CSV);

  const phaseHeaders = phaseRows[0] || [];
  const taskHeaders = taskRows[0] || [];
  const phaseData = phaseRows.slice(1);
  const taskData = taskRows.slice(1);

  const templateId = phaseData[0]?.[phaseHeaders.indexOf("templateId")] || taskData[0]?.[taskHeaders.indexOf("templateId")] || "cz-construction-v1";

  const idx = (arr, name) => arr.indexOf(name);
  const pi = (name) => idx(phaseHeaders, name);
  const ti = (name) => idx(taskHeaders, name);

  const BATCH_LIMIT = 450;
  const templateRef = db.collection("catalogTemplates").doc(templateId);

  const ops = [];

  ops.push({
    ref: templateRef,
    data: {
      name: "Stavba rodinného domu (CZ)",
      projectType: "BUILD",
      country: "CZ",
      language: "cs",
      locale: "cs-CZ",
      currency: "CZK",
      sourceTemplateId: "eu-construction-v1",
      isActive: true,
      updatedAt: new Date().toISOString(),
    },
  });

  phaseData.forEach((row) => {
    const phaseId = row[pi("phaseId")];
    if (!phaseId) return;
    ops.push({
      ref: templateRef.collection("phases").doc(phaseId),
      data: {
        name: row[pi("phaseName")] || phaseId,
        description: row[pi("phaseDescription")] || "",
        order: parseInt(row[pi("order")], 10) || 0,
        updatedAt: new Date().toISOString(),
      },
    });
  });

  taskData.forEach((row) => {
    const phaseId = row[ti("phaseId")];
    const order = parseInt(row[ti("order")], 10) || 0;
    if (!phaseId) return;
    const taskId = `${phaseId}-${order}`;
    const req = row[ti("required")];
    ops.push({
      ref: templateRef.collection("tasks").doc(taskId),
      data: {
        phaseId,
        order,
        title: row[ti("taskTitle")] || "",
        trade: row[ti("trade")] || "",
        priority: row[ti("priority")] || "MEDIUM",
        required: String(req).toUpperCase() === "TRUE",
        defaultStatus: row[ti("defaultStatus")] || "OPEN",
        updatedAt: new Date().toISOString(),
      },
    });
  });

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((op) => batch.set(op.ref, op.data));
    await batch.commit();
    console.log(`[import-catalog-cz] Committed ${chunk.length} ops`);
  }

  console.log(`[import-catalog-cz] Done: catalogTemplates/${templateId}`);
  console.log(`[import-catalog-cz] Phases: ${phaseData.length}, Tasks: ${taskData.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
