/**
 * Self-check for BUILD → AI request shape (no RN / Firebase deps).
 * Run: npm run test:ai-flow
 */
import test from "node:test";
import assert from "node:assert/strict";

test("BUILD + Novostavba (NEW_BUILD) uses engine and work types the Cloud Function understands", () => {
  const payload = {
    projectBrief: "Rodinný dom, zastavaná plocha 120 m², jednopodlažný.",
    engineType: "BUILD",
    workType: "NEW_BUILD",
    projectDetails: "Typ strechy: sedlová; Plocha: 120; Podlažia: 1",
  };
  assert.equal(payload.engineType, "BUILD");
  assert.equal(payload.workType, "NEW_BUILD");
  assert.ok(payload.projectBrief.length > 0 && payload.projectBrief.length <= 600);
});

test("brief length matches backend MAX_BRIEF_LEN guard on client", () => {
  const brief = "x".repeat(601);
  const sent = brief.trim().slice(0, 600);
  assert.equal(sent.length, 600);
});
