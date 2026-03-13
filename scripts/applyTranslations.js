/**
 * Apply translations to a catalog template. Updates only text fields and safe metadata.
 * Uses chunked Firestore batch writes. Fails safely if target does not exist.
 *
 * Prereqs: npm install firebase-admin, GOOGLE_APPLICATION_CREDENTIALS set
 *
 * Usage: node scripts/applyTranslations.js <targetTemplateId> <lang>
 * Example: node scripts/applyTranslations.js de-construction-v1 de
 *
 * Lang keys: cz, de, es, pl, it
 * Run scripts/dump-template-structure.js first to get real phase/task IDs for translations.json
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const BATCH_LIMIT = 450;

const TARGET_TEMPLATE_ID = process.argv[2];
const LANG = process.argv[3];

if (!TARGET_TEMPLATE_ID || !LANG) {
  console.error("Usage: node scripts/applyTranslations.js <targetTemplateId> <lang>");
  process.exit(1);
}

function loadTranslations() {
  const p = path.join(process.cwd(), "scripts", "translations.json");
  if (!fs.existsSync(p)) {
    console.error("translations.json not found at scripts/translations.json");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const dict = data[LANG];
  if (!dict) {
    console.error(`Unknown lang: ${LANG}. Available: ${Object.keys(data).filter((k) => !k.startsWith("_")).join(", ")}`);
    process.exit(1);
  }
  return dict;
}

async function main() {
  const dict = loadTranslations();

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "staveto-mvp-5f251" });
  }
  const db = admin.firestore();

  const templateRef = db.collection("catalogTemplates").doc(TARGET_TEMPLATE_ID);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) {
    console.error(`Target template "${TARGET_TEMPLATE_ID}" not found.`);
    process.exit(1);
  }

  const [phasesSnap, tasksSnap] = await Promise.all([
    templateRef.collection("phases").get(),
    templateRef.collection("tasks").get(),
  ]);

  const ops = [];
  const now = new Date().toISOString();

  // 1. Phases
  for (const doc of phasesSnap.docs) {
    const data = doc.data();
    const phaseId = doc.id;
    const updates = {};

    const nameVal = dict[`phase.${phaseId}.name`];
    if (nameVal != null && nameVal !== "") {
      updates.name = nameVal;
      updates.phaseName = nameVal;
    }
    const descVal = dict[`phase.${phaseId}.description`];
    if (descVal != null && (data.description || data.phaseDescription || descVal !== "")) {
      updates.description = descVal;
      updates.phaseDescription = descVal;
    }
    if (Object.keys(updates).length > 0) {
      ops.push({ ref: doc.ref, data: { ...updates, updatedAt: now } });
    }
  }

  // 2. Tasks
  for (const doc of tasksSnap.docs) {
    const data = doc.data();
    const taskId = doc.id;
    const updates = {};

    const titleVal = dict[`task.${taskId}.title`];
    if (titleVal != null && titleVal !== "") {
      updates.title = titleVal;
      updates.taskTitle = titleVal;
    }
    const descVal = dict[`task.${taskId}.description`];
    if (descVal != null && (data.description || data.taskDescription || descVal !== "")) {
      updates.description = descVal;
      updates.taskDescription = descVal;
    }
    if (Object.keys(updates).length > 0) {
      ops.push({ ref: doc.ref, data: { ...updates, updatedAt: now } });
    }
  }

  // 3. Template metadata
  const meta = dict._meta;
  if (meta) {
    const metaUpdates = { updatedAt: now };
    if (meta.name != null) metaUpdates.name = meta.name;
    if (meta.country != null) metaUpdates.country = meta.country;
    if (meta.language != null) metaUpdates.language = meta.language;
    if (meta.locale != null) metaUpdates.locale = meta.locale;
    if (meta.currency != null) metaUpdates.currency = meta.currency;
    if (Object.keys(metaUpdates).length > 1) {
      ops.push({ ref: templateRef, data: metaUpdates });
    }
  }

  if (ops.length === 0) {
    console.log(`[applyTranslations] No updates for ${TARGET_TEMPLATE_ID} (lang: ${LANG}). Run dump-template-structure.js and ensure translations.json keys match.`);
    return;
  }

  // Chunked batch writes
  let committed = 0;
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const op of chunk) {
      batch.update(op.ref, op.data);
    }
    await batch.commit();
    committed += chunk.length;
  }
  console.log(`[applyTranslations] Applied ${LANG} to ${TARGET_TEMPLATE_ID}: ${committed} updates`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
