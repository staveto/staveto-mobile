Backup Notes - 2026-02-07

Purpose:
Snapshot of current workspace changes for WhatsApp Diary + Meta webhook migration.

Important:
- Do NOT commit secrets.
- The file `functions/.env.staveto-mvp-5f251` may contain secrets and should stay untracked.

Root changes:
- Modified: `functions/package.json`, `functions/package-lock.json`, `functions/src/index.ts`
- Added: `functions/src/whatsapp/` (Meta webhook)

Mobile changes:
- Modified: `mobile/firestore.indexes.json`, `mobile/firestore.rules`, `mobile/package.json`,
  `mobile/package-lock.json`, `mobile/src/i18n/translations.ts`,
  `mobile/src/lib/types.ts`, `mobile/src/navigation/RootNavigator.tsx`,
  `mobile/src/screens/AccountScreen.tsx`, `mobile/src/screens/ProjectOverviewScreen.tsx`
- Added:
  `mobile/src/lib/phone.ts`
  `mobile/src/services/features.ts`
  `mobile/src/services/contractors.ts`
  `mobile/src/services/suppliers.ts`
  `mobile/src/services/updates.ts`
  `mobile/src/screens/contractors/`
  `mobile/src/screens/projects/`

Runtime note:
- Functions are Gen2, region `europe-west1`.
- Webhook URL format (Gen2): `https://<service>-<hash>-ew.a.run.app`
