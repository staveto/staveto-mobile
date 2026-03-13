/**
 * Copy catalog template from source to target.
 * Preserves all document IDs exactly. Uses chunked Firestore batch writes.
 *
 * Prereqs: npm install firebase-admin, GOOGLE_APPLICATION_CREDENTIALS set
 *
 * Usage: node scripts/copy-catalog.js <sourceTemplateId> <targetTemplateId>
 * Example: node scripts/copy-catalog.js eu-construction-v1 de-construction-v1
 */

const admin = require("firebase-admin");
const BATCH_LIMIT = 450; // Firestore limit is 500

const SOURCE = process.argv[2];
const TARGET = process.argv[3];

if (!SOURCE || !TARGET) {
  console.error("Usage: node scripts/copy-catalog.js <sourceTemplateId> <targetTemplateId>");
  process.exit(1);
}

if (SOURCE === TARGET) {
  console.error("Source and target must differ.");
  process.exit(1);
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "staveto-mvp-5f251" });
  }
  const db = admin.firestore();

  const srcRef = db.collection("catalogTemplates").doc(SOURCE);
  const tgtRef = db.collection("catalogTemplates").doc(TARGET);

  // Validate source exists
  const srcDoc = await srcRef.get();
  if (!srcDoc.exists) {
    console.error(`Source template "${SOURCE}" not found.`);
    process.exit(1);
  }

  const [phasesSnap, tasksSnap] = await Promise.all([
    srcRef.collection("phases").get(),
    srcRef.collection("tasks").get(),
  ]);

  const phases = phasesSnap.docs;
  const tasks = tasksSnap.docs;

  console.log(`[copy-catalog] Source: ${SOURCE}, Target: ${TARGET}`);
  console.log(`[copy-catalog] Phases: ${phases.length}, Tasks: ${tasks.length}`);

  // Prepare target template doc (preserve structure, add metadata)
  const srcData = srcDoc.data();
  const tgtData = {
    ...srcData,
    sourceTemplateId: SOURCE,
    isActive: false,
    updatedAt: new Date().toISOString(),
  };

  // Chunked batch writes
  const allOps = [
    { type: "set", ref: tgtRef, data: tgtData },
    ...phases.map((d) => ({ type: "set", ref: tgtRef.collection("phases").doc(d.id), data: d.data() })),
    ...tasks.map((d) => ({ type: "set", ref: tgtRef.collection("tasks").doc(d.id), data: d.data() })),
  ];

  let committed = 0;
  for (let i = 0; i < allOps.length; i += BATCH_LIMIT) {
    const chunk = allOps.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(op.ref, op.data);
    }
    await batch.commit();
    committed += chunk.length;
    console.log(`[copy-catalog] Committed batch: ${chunk.length} ops (total: ${committed})`);
  }

  console.log(`[copy-catalog] Done. Copied: 1 template, ${phases.length} phases, ${tasks.length} tasks`);
  console.log(`[copy-catalog] Target: catalogTemplates/${TARGET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
