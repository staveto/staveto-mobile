import { translations } from "../src/i18n/translations.ts";

const locales = ["en", "de", "sk", "cs", "es", "it", "pl"];

const required = [
  "tabs.home",
  "tabs.projects",
  "tabs.equipment",
  "tabs.notifications",
  "tabs.account",
  "createProject.aiDraft.structureSummary",
  "createProject.aiDraft.phaseTaskCount",
  "createProject.aiDraft.unnamedPhase",
  "createProject.aiDraft.unnamedTask",
  "createProject.aiDraft.tapPhaseTaskHint",
  "createProject.aiDraft.backToPrompt",
  "createProject.aiDraft.regenerateWholeDraft",
  "createProject.newJob.contact.title",
  "createProject.newJob.contact.subtitle",
  "createProject.newJob.contact.selectContact",
  "createProject.newJob.contact.createContact",
  "createProject.newJob.contact.continueWithout",
  "business.dashboard.modules.contacts",
  "business.dashboard.modules.openContacts",
  "business.dashboard.actionContactsBody",
  "business.contacts.loadError",
  "business.contacts.empty",
  "business.contacts.createCta",
  "business.contacts.displayName",
  "business.contacts.accessDenied",
];

console.log("key\t" + locales.join("\t"));
const missingByLocale = Object.fromEntries(locales.map((l) => [l, []]));

for (const key of required) {
  const row = [key];
  for (const loc of locales) {
    const val = translations[loc]?.[key];
    if (val) row.push("ok");
    else {
      row.push("MISS");
      missingByLocale[loc].push(key);
    }
  }
  console.log(row.join("\t"));
}

console.log("\n--- summary ---");
for (const loc of locales) {
  console.log(`${loc}: ${missingByLocale[loc].length} missing`);
  if (missingByLocale[loc].length) console.log("  ", missingByLocale[loc].join(", "));
}
