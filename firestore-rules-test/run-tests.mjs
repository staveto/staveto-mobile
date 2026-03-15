#!/usr/bin/env node
/**
 * Firestore Rules QA – standalone runner (no Jest)
 * Run: firebase emulators:exec --only firestore "node firestore-rules-test/run-tests.mjs"
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
} from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "demo-staveto";

const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, status: "ALLOW", error: null });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.push({ name, status: "DENY/FAIL", error: e?.message || String(e) });
    console.log(`  ❌ ${name}: ${e?.message || e}`);
  }
}

async function main() {
  console.log("\n=== Firestore Rules QA – Onboarding/Invite/Org/Projects ===\n");

  const rulesPath = join(__dirname, "..", "mobile", "firestore.rules");
  const rules = readFileSync(rulesPath, "utf8");

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

  const ADMIN_UID = "admin-uid-123";
  const INVITEE_UID = "invitee-uid-456";
  const INVITEE_EMAIL = "invitee@example.com";

  const db = (ctx) => ctx.firestore();

  try {
    // --- Admin actions ---
    console.log("Admin actions:");
    await testEnv.clearFirestore();

    await run("Admin creates organization (ownerUid=admin)", async () => {
      const admin = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(
        addDoc(collection(db(admin), "organizations"), {
          name: "Test Org",
          ownerUid: ADMIN_UID,
          seatLimit: 5,
          plan: "TEAM_5",
          createdAt: new Date(),
        })
      );
    });

    await run("Admin creates self as first org member", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(db(ctx), "organizations", "org1"), {
          name: "Org1",
          ownerUid: ADMIN_UID,
          seatLimit: 5,
          plan: "TEAM_5",
          createdAt: new Date(),
        });
      });
      const admin = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(
        setDoc(doc(db(admin), "organizations", "org1", "members", ADMIN_UID), {
          role: "admin",
          status: "active",
          createdAt: new Date(),
        })
      );
    });

    await run("Admin creates invite for invitee", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(db(ctx), "organizations", "org1"), {
          name: "Org1",
          ownerUid: ADMIN_UID,
          seatLimit: 5,
          plan: "TEAM_5",
          createdAt: new Date(),
        });
        await setDoc(
          doc(db(ctx), "organizations", "org1", "members", ADMIN_UID),
          { role: "admin", status: "active", createdAt: new Date() }
        );
      });
      const admin = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(
        addDoc(collection(db(admin), "invites"), {
          orgId: "org1",
          emailLower: INVITEE_EMAIL,
          role: "member",
          invitedByUid: ADMIN_UID,
          createdAt: new Date(),
          status: "pending",
          token: "random-token-xyz",
        })
      );
    });

    await run("Admin creates project in org workspace", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(db(ctx), "organizations", "org1"), {
          name: "Org1",
          ownerUid: ADMIN_UID,
          seatLimit: 5,
          plan: "TEAM_5",
          createdAt: new Date(),
        });
        await setDoc(
          doc(db(ctx), "organizations", "org1", "members", ADMIN_UID),
          { role: "admin", status: "active", createdAt: new Date() }
        );
      });
      const admin = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(
        addDoc(collection(db(admin), "projects"), {
          name: "Team Project",
          orgId: "org1",
          workspaceType: "team",
          workspaceId: "org1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });

    // --- Invitee actions ---
    console.log("\nInvitee actions:");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(db(ctx), "organizations", "org1"), {
        name: "Org1",
        ownerUid: ADMIN_UID,
        seatLimit: 5,
        plan: "TEAM_5",
        createdAt: new Date(),
      });
      await setDoc(
        doc(db(ctx), "organizations", "org1", "members", ADMIN_UID),
        { role: "admin", status: "active", createdAt: new Date() }
      );
      await setDoc(doc(db(ctx), "invites", "inv1"), {
        orgId: "org1",
        emailLower: INVITEE_EMAIL,
        role: "member",
        invitedByUid: ADMIN_UID,
        createdAt: new Date(),
        status: "pending",
        token: "token-abc",
      });
      await setDoc(doc(db(ctx), "projects", "proj1"), {
        name: "Team Project",
        orgId: "org1",
        workspaceType: "team",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    await run("Invitee reads invite (email matches) – ALLOW", async () => {
      const invitee = testEnv.authenticatedContext(INVITEE_UID, {
        email: INVITEE_EMAIL,
      });
      await assertSucceeds(getDoc(doc(db(invitee), "invites", "inv1")));
    });

    await run(
      "Invitee creates org member (accept) – DENIED (must use CF)",
      async () => {
        const invitee = testEnv.authenticatedContext(INVITEE_UID, {
          email: INVITEE_EMAIL,
        });
        await assertFails(
          setDoc(
            doc(db(invitee), "organizations", "org1", "members", INVITEE_UID),
            {
              role: "member",
              status: "active",
              email: INVITEE_EMAIL,
              createdAt: new Date(),
            }
          )
        );
      }
    );

    await run("Invitee reads project before membership – DENIED", async () => {
      const invitee = testEnv.authenticatedContext(INVITEE_UID, {
        email: INVITEE_EMAIL,
      });
      await assertFails(getDoc(doc(db(invitee), "projects", "proj1")));
    });

    await run("Invitee reads project after org membership – ALLOW", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(db(ctx), "organizations", "org1", "members", INVITEE_UID),
          { role: "member", status: "active", createdAt: new Date() }
        );
      });
      const invitee = testEnv.authenticatedContext(INVITEE_UID, {
        email: INVITEE_EMAIL,
      });
      await assertSucceeds(getDoc(doc(db(invitee), "projects", "proj1")));
    });

    // --- Users ---
    console.log("\nUsers:");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(db(ctx), "users", ADMIN_UID), {
        displayName: "Admin",
        email: "admin@example.com",
      });
      await setDoc(doc(db(ctx), "users", INVITEE_UID), {
        displayName: "Invitee",
        email: INVITEE_EMAIL,
      });
    });

    await run("User reads own user doc – ALLOW", async () => {
      const user = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(getDoc(doc(db(user), "users", ADMIN_UID)));
    });

    await run("User reads another user doc – DENIED", async () => {
      const user = testEnv.authenticatedContext(ADMIN_UID);
      await assertFails(getDoc(doc(db(user), "users", INVITEE_UID)));
    });

    // --- Personal projects ---
    console.log("\nPersonal projects:");
    await testEnv.clearFirestore();

    await run("Owner creates personal project – ALLOW", async () => {
      const user = testEnv.authenticatedContext(ADMIN_UID);
      await assertSucceeds(
        addDoc(collection(db(user), "projects"), {
          name: "My Project",
          ownerId: ADMIN_UID,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });

    await run("User creates project with wrong ownerId – DENIED", async () => {
      const user = testEnv.authenticatedContext(ADMIN_UID);
      await assertFails(
        addDoc(collection(db(user), "projects"), {
          name: "Fake",
          ownerId: INVITEE_UID,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });
  } finally {
    await testEnv.cleanup();
  }

  const passed = results.filter((r) => r.status === "ALLOW").length;
  const failed = results.filter((r) => r.status !== "ALLOW").length;
  console.log("\n=== QA Summary ===");
  console.log(`Passed: ${passed} | Failed: ${failed} | Total: ${results.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
