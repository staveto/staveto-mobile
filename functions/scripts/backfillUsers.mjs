#!/usr/bin/env node
/**
 * Backfill Firestore users/{uid} for Auth users that don't have a user document.
 *
 * Run from functions directory with service account credentials:
 *   cd functions
 *   set GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json   (Windows)
 *   export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json (Linux/Mac)
 *   node scripts/backfillUsers.mjs
 *
 * Or from repo root:
 *   cd functions && node scripts/backfillUsers.mjs
 *
 * Requires firebase-admin (already in functions/package.json).
 */

import admin from "firebase-admin";

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const auth = admin.auth();
const db = admin.firestore();

async function run() {
  let created = 0;
  let skipped = 0;
  let nextPageToken;

  console.log("[backfillUsers] Listing Auth users...");

  do {
    const res = await auth.listUsers(1000, nextPageToken);

    for (const u of res.users) {
      const ref = db.collection("users").doc(u.uid);
      const snap = await ref.get();

      if (snap.exists) {
        skipped++;
        continue;
      }

      const userDoc = {
        uid: u.uid,
        email: u.email || null,
        emailLower: u.email ? u.email.toLowerCase() : null,
        displayName: u.displayName || null,
        photoURL: u.photoURL || null,
        providers: (u.providerData || []).map((p) => p.providerId),
        countryCode: null,
        locale: null,
        timezone: null,
        openToWork: true,
        subscriptionStatus: "free",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await ref.set(userDoc, { merge: true });
      created++;
      console.log("[backfillUsers] Created:", u.uid, u.email || "(no email)");
    }

    nextPageToken = res.pageToken;
  } while (nextPageToken);

  console.log("[backfillUsers] Done. Created:", created, "Skipped (existing):", skipped);
}

run().catch((err) => {
  console.error("[backfillUsers] Error:", err);
  process.exit(1);
});
