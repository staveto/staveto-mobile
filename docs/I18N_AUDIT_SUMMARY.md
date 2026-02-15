# i18n Audit Summary

## 1. Translation Coverage Report

| Language | Missing keys BEFORE | Missing keys AFTER | Files touched |
|----------|---------------------|--------------------|---------------|
| en      | 0 (canonical)       | 0                  | -             |
| de      | 151                 | 0                  | translations.ts |
| sk      | 29                  | 0                  | translations.ts |
| cs      | 142                 | 0                  | translations.ts |
| es      | 418                 | 0                  | translations.ts |
| it      | 441                 | 0                  | translations.ts |
| pl      | 418                 | 0                  | translations.ts |

**Total EN keys:** 665 (after adding new keys for ocr, equipment, notifications, account, maps, tasks, errors)

## 2. Hardcoded String Removal (Mobile)

| Path | What it became |
|------|----------------|
| ProjectOverviewScreen.tsx | OCR_MANUAL_FALLBACK_MESSAGE → t("ocr.manualFallback") |
| ProjectOverviewScreen.tsx | getOcrFallbackMessage → t("ocr.backendNotDeployed"), t("ocr.noPermission"), t("ocr.manualFallback") |
| ProjectOverviewScreen.tsx | "just now" → t("events.justNow") |
| ProjectOverviewScreen.tsx | "Počasie sa nepodarilo načítať" → t("projectOverview.weatherLoadFailed") |
| ProjectOverviewScreen.tsx | "Nepodarilo sa vypočítať km" → t("projectOverview.distanceCalcFailed") |
| ProjectOverviewScreen.tsx | "Hlasová nahrávka" → t("projectOverview.voiceRecording") |
| ProjectOverviewScreen.tsx | "Chyba" → t("common.error") |
| ProjectOverviewScreen.tsx | "Zrušiť", "Pridať úlohu", etc. → t("common.cancel"), t("projectOverview.addTask"), etc. |
| ProjectOverviewScreen.tsx | "[Hlasová správa]" → t("projectOverview.voiceMessage") |
| ProjectOverviewScreen.tsx | placeholder="Počasie" → t("projectOverview.weather") |
| ExpenseReviewScreen.tsx | OCR status messages → t("expense.ocrLimit"), t("expense.ocrFailed"), t("expense.ocrCancelled") |
| HomeScreen.tsx | "just now", "No activity" → t("events.justNow"), t("home.noRecentActivity") |
| AccountScreen.tsx | "Chyba", "Nepodarilo sa..." → t("common.error"), t("account.uploadPhotoFailed"), etc. |
| NotificationsScreen.tsx | "Označiť všetko ako prečítané", "Zrušiť" → t("notifications.markAllRead"), t("common.cancel") |
| ProjectMembersScreen.tsx | "Chyba", "Nepodarilo sa..." → t("common.error"), t("projectMembers.loadFailed"), etc. |
| EquipmentDetailScreen.tsx | "Chyba", "Nepodarilo sa načítať..." → t("common.error"), t("equipment.loadFailed") |
| EquipmentFormScreen.tsx | "Chyba", "Nepodarilo sa..." → t("common.error"), t("equipment.*") |
| ServiceRuleFormScreen.tsx | "Chyba", "Nepodarilo sa..." → t("common.error"), t("equipment.loadServiceRuleFailed") |

## 3. Backend Functions Changed (Firebase)

| Function | Codes introduced |
|----------|------------------|
| team.ts: assertOwner | errors.project.notFound, errors.auth.notAllowed |
| team.ts: addProjectMemberByEmail | errors.auth.required, errors.invalid.projectId, errors.invalid.email, errors.user.notFound, errors.precondition.ownerAlreadyMember |
| team.ts: removeProjectMember | errors.auth.required, errors.invalid.projectId, errors.invalid.memberId, errors.member.notFound |
| team.ts: updateMemberPermissions | errors.auth.required, errors.invalid.memberId, errors.member.notFound |

## 4. Guardrails Added

- **I18nContext.tsx:** `__DEV__` missingKey logging – `console.warn(\`[i18n] Missing key: ${locale} -> "${key}"\`)` when key not found
- **scripts/i18n-audit.js:** Loads EN as canonical, diffs all languages, exits 1 if any missing keys (CI-ready)
- **scripts/i18n-add-missing.js:** Adds missing keys to all locales using EN value as fallback
- **package.json:** `npm run i18n:audit`, `npm run i18n:add-missing`

## 5. Key Naming Convention (used)

- common.*
- onboarding.*
- auth.* / login.* / register.*
- home.*
- projects.*
- projectOverview.*
- projectMembers.*
- tasks.*
- taskDetail.*
- expense.*
- equipment.*
- notifications.*
- account.*
- ocr.*
- events.*
- maps.*
- errors.* (matches backend codes)

## 6. Run Audit

```bash
npm run i18n:audit
```

Fails (exit 1) if any language has missing keys.
