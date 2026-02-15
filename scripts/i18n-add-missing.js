/**
 * Add missing translation keys to all locales.
 * Uses EN value as fallback for missing keys.
 * Run: node scripts/i18n-add-missing.js
 */
const fs = require("fs");
const path = require("path");

const TRANSLATIONS_PATH = path.join(__dirname, "../src/i18n/translations.ts");
const LOCALES = ["en", "de", "sk", "cs", "es", "it", "pl"];

function extractKeysAndValues(content, locale) {
  const blockRe = new RegExp(
    `\\s${locale}:\\s*\\{([\\s\\S]*?)\\n\\s+\\}(?:,|\\})`,
    "m"
  );
  const match = content.match(blockRe);
  if (!match) return {};
  const block = match[1];
  const re = /"([a-zA-Z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  const result = {};
  let m;
  while ((m = re.exec(block)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

function escapeForTs(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function main() {
  const content = fs.readFileSync(TRANSLATIONS_PATH, "utf8");
  const enData = extractKeysAndValues(content, "en");
  const enKeys = new Set(Object.keys(enData));

  let modified = false;
  let newContent = content;

  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const data = extractKeysAndValues(content, locale);
    const missing = [...enKeys].filter((k) => !(k in data));
    if (missing.length === 0) continue;

    modified = true;
    console.log(`${locale}: adding ${missing.length} missing keys`);

    // Find the position to insert: before "  },\n  next:" or "  }\n};"
    const blockEndRe = new RegExp(
      `(\\s${locale}:\\s*\\{[\\s\\S]*?)(\\n\\s+\\})(,|\\})`,
      "m"
    );
    const blockMatch = newContent.match(blockEndRe);
    if (!blockMatch) {
      console.error(`Could not find ${locale} block`);
      continue;
    }

    const insertPoint = blockMatch[1];
    const linesToAdd = missing
      .map((k) => {
        const val = enData[k] || k;
        const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        return `    "${k}": "${escaped}",`;
      })
      .join("\n");

    // Insert before the closing }; of this block
    const before = blockMatch[1];
    const after = blockMatch[2] + blockMatch[3];
    const replacement = before + "\n" + linesToAdd + "\n  " + after.replace(/^\s+/, "");
    newContent = newContent.replace(blockMatch[0], replacement);
  }

  if (modified) {
    fs.writeFileSync(TRANSLATIONS_PATH, newContent, "utf8");
    console.log("Done. Run node scripts/i18n-audit.js to verify.");
  } else {
    console.log("No missing keys to add.");
  }
}

main();
