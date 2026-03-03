/**
 * Unit tests for isDiagnosticOnValue (diagnostic env parsing).
 * Run: node scripts/test-ios-diagnostic.js
 *
 * Uses the same logic as src/lib/iosDiagnosticHelpers.ts - tests the spec.
 */
function isDiagnosticOnValue(raw) {
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const cases = [
  ["", false],
  [" ", false],
  ["0", false],
  ["false", false],
  ["FALSE", false],
  ["1", true],
  ["true", true],
  ["TRUE", true],
  ["yes", true],
  ["on", true],
  [" 1 ", true],
  [" true ", true],
  ["random", false],
];

let passed = 0;
let failed = 0;

for (const [input, expected] of cases) {
  const result = isDiagnosticOnValue(input);
  if (result === expected) {
    passed++;
    console.log(`✓ "${input}" -> ${result}`);
  } else {
    failed++;
    console.error(`✗ "${input}" -> ${result} (expected ${expected})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
