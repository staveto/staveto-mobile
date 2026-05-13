#!/usr/bin/env node
/**
 * One-off script: set Firebase Auth custom claim `admin: true`.
 *
 * Usage (run from `mobile/functions/`):
 *   node scripts/setAdminClaim.js --uid=<firebase_uid>
 *   node scripts/setAdminClaim.js --email=<user@example.com>
 *
 * Notes:
 * - Requires Admin SDK credentials (GOOGLE_APPLICATION_CREDENTIALS or equivalent).
 * - This script is never called from the mobile app.
 * - Existing custom claims are preserved; only `admin: true` is added.
 */

const admin = require("firebase-admin");

function readArg(name) {
  const withEquals = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3).trim();
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) {
    const next = process.argv[index + 1];
    return typeof next === "string" ? next.trim() : "";
  }
  return "";
}

function printUsageAndExit() {
  console.log("Usage:");
  console.log("  node scripts/setAdminClaim.js --uid=<firebase_uid>");
  console.log("  node scripts/setAdminClaim.js --email=<user@example.com>");
  process.exit(1);
}

async function resolveUid(auth, uidArg, emailArg) {
  if (uidArg) return uidArg;
  if (!emailArg) return "";
  const user = await auth.getUserByEmail(emailArg);
  return user.uid;
}

async function main() {
  const uidArg = readArg("uid");
  const emailArg = readArg("email").toLowerCase();

  if (!uidArg && !emailArg) {
    printUsageAndExit();
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const auth = admin.auth();
  const uid = await resolveUid(auth, uidArg, emailArg);
  if (!uid) {
    throw new Error("Could not resolve uid. Provide --uid or valid --email.");
  }

  const user = await auth.getUser(uid);
  const existingClaims = user.customClaims || {};
  const nextClaims = { ...existingClaims, admin: true };

  await auth.setCustomUserClaims(uid, nextClaims);

  console.log("[setAdminClaim] Success");
  console.log("  uid:", uid);
  console.log("  email:", user.email || "(none)");
  console.log("  claims:", JSON.stringify(nextClaims));
  console.log("User should refresh ID token (or re-login) to receive updated claim.");
}

main().catch((err) => {
  console.error("[setAdminClaim] Error:", err?.message || err);
  process.exit(1);
});
