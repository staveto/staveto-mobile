/**
 * Dump template structure from Firestore to generate translation keys.
 * Outputs phase IDs, task IDs, and current text for translations.json.
 *
 * Prereqs: npm install firebase-admin, GOOGLE_APPLICATION_CREDENTIALS set
 *
 * Usage: node scripts/dump-template-structure.js [templateId]
 * Example: node scripts/dump-template-structure.js eu-construction-v1
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const TEMPLATE_ID = process.argv[2] || "eu-construction-v1";

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "staveto-mvp-5f251" });
  }
  const db = admin.firestore();

  const templateRef = db.collection("catalogTemplates").doc(TEMPLATE_ID);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) {
    console.error(`Template "${TEMPLATE_ID}" not found.`);
    process.exit(1);
  }

  const [phasesSnap, tasksSnap] = await Promise.all([
    templateRef.collection("phases").get(),
    templateRef.collection("tasks").get(),
  ]);

  const phases = phasesSnap.docs.map((d) => ({
    id: d.id,
    name: d.data().name || d.data().phaseName || "",
    description: d.data().description || d.data().phaseDescription || "",
    order: d.data().order ?? 0,
  }));

  const tasks = tasksSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      phaseId: data.phaseId || "",
      title: data.title || data.taskTitle || "",
      description: data.description || data.taskDescription || "",
      order: data.order ?? 0,
    };
  });

  const output = {
    templateId: TEMPLATE_ID,
    dumpedAt: new Date().toISOString(),
    phases,
    tasks,
    translationKeys: {
      phases: phases.map((p) => ({
        id: p.id,
        nameKey: `phase.${p.id}.name`,
        descriptionKey: `phase.${p.id}.description`,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        titleKey: `task.${t.id}.title`,
        descriptionKey: `task.${t.id}.description`,
      })),
    },
  };

  const outPath = path.join(process.cwd(), "scripts", "template-structure.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`[dump-template-structure] Dumped to ${outPath}`);
  console.log(`[dump-template-structure] Phases: ${phases.length}, Tasks: ${tasks.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
