/**
 * i18n Audit Script
 * - Loads EN as canonical source
 * - Diffs all languages vs EN: missing keys per language
 * - Exits with code 1 if any language has missing keys (CI-ready)
 */
const fs = require("fs");
const path = require("path");

const TRANSLATIONS_PATH = path.join(__dirname, "../src/i18n/translations.ts");
const LOCALES = ["en", "de", "sk", "cs", "es", "it", "pl"];

function extractKeysFromLocaleBlock(content, locale) {
  // Match locale block: "de: { ... }," - use non-greedy and stop at "  },\n  next:"
  const blockRe = new RegExp(
    `\\s${locale}:\\s*\\{([\\s\\S]*?)\\n\\s+\\}(?:,|\\})`,
    "m"
  );
  const match = content.match(blockRe);
  if (!match) return new Set();
  const block = match[1];
  // Match "key": (value can contain ", {{}}, etc - match key only)
  const keyRe = /"([a-zA-Z0-9_.]+)":\s*(?:"[^"]*"|\[)/g;
  const keys = new Set();
  let m;
  while ((m = keyRe.exec(block)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

function extractKeysFromFile() {
  const content = fs.readFileSync(TRANSLATIONS_PATH, "utf8");
  const result = {};
  for (const locale of LOCALES) {
    result[locale] = extractKeysFromLocaleBlock(content, locale);
  }
  return result;
}

function main() {
  console.log("i18n Audit - Translation Coverage Report\n");
  console.log("Source:", TRANSLATIONS_PATH);

  const keysByLocale = extractKeysFromFile();
  const enKeys = keysByLocale.en;
  const enSorted = [...enKeys].sort();

  console.log("\n--- Canonical EN keys:", enSorted.length);

  let hasMissing = false;
  const report = {};

  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const keys = keysByLocale[locale];
    const missing = enSorted.filter((k) => !keys.has(k));
    if (missing.length > 0) {
      hasMissing = true;
      report[locale] = missing;
      console.log(`\n--- ${locale.toUpperCase()}: ${missing.length} MISSING keys`);
      missing.forEach((k) => console.log(`  - ${k}`));
    } else {
      console.log(`\n--- ${locale.toUpperCase()}: OK (${keys.size} keys)`);
    }
  }

  // Extra: keys in other locales but not in EN (inconsistent)
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const keys = keysByLocale[locale];
    const extra = [...keys].filter((k) => !enKeys.has(k)).sort();
    if (extra.length > 0) {
      console.log(`\n--- ${locale.toUpperCase()}: ${extra.length} EXTRA keys (not in EN)`);
      extra.slice(0, 10).forEach((k) => console.log(`  - ${k}`));
      if (extra.length > 10) console.log(`  ... and ${extra.length - 10} more`);
    }
  }

  if (hasMissing) {
    console.log("\n❌ FAIL: Some languages have missing keys. Fix before merging.");
    process.exit(1);
  }
  console.log("\n✅ PASS: All languages have identical key coverage.");
  process.exit(0);
}

main();
