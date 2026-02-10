# Staveto Mobile - Export kódu, funkcií a flow

Tento dokument je technický export aktuálneho stavu aplikácie v `mobile/`.
Je určený ako referenčný podklad pre ďalšiu implementáciu.

## 1) Vstupné body aplikácie

- `index.ts` - inicializuje `react-native-gesture-handler` a registruje root component cez Expo.
- `App.tsx` - skladá root providery a spúšťa navigáciu:
  - `SafeAreaProvider`
  - `I18nProvider`
  - `NavigationContainer`
  - `AuthProvider`
  - `RootNavigator`

## 2) Architektúra priečinkov

- `src/navigation/` - stack/tab navigácia a routing.
- `src/context/` - globálne stavy (auth).
- `src/i18n/` - preklady, locale, i18n context.
- `src/screens/` - obrazovky UI.
- `src/services/` - business logika a data operácie.
- `src/lib/` - infra utility (Firestore wrapper, paths, mapy, typy).
- `src/api/` - REST klient (`client.ts`) pre Worker API.
- `src/repositories/` - repository vrstva pre katalóg šablón.
- `src/helpers/` - mapovania, role helpery, KPI helpery.

## 3) Navigácia a UX flow

### Root gate flow (`src/navigation/RootNavigator.tsx`)

1. App loading (`loading` / `onboardingLoaded`) -> loading screen.
2. Ak nie je token (`!token`):
   - `LanguageSelect` -> `OnboardingIntro` -> `Login` / `Register`
3. Ak token existuje:
   - Kontrola consent (Firestore + AsyncStorage fallback)
   - Kontrola onboarding completion (Firestore + AsyncStorage fallback)
4. Ak consent nie je OK -> `ConsentRequiredScreen`
5. Ak onboarding nie je OK -> `OnboardingMvpScreen`
6. Inak hlavná app stack:
   - `AppTabs` + detailové stack screeny (`TaskDetail`, `ProjectOverview`, `ProjectMembers`, ...)

### Tab flow (`src/navigation/AppTabs.tsx`)

- `Home` (napojený na `HomeStack`)
- `Projects`
- `Notifications`
- `Search`
- `Account`

## 4) Auth flow (Firebase-first)

### Auth state (`src/context/AuthContext.tsx`)

- Sleduje `auth().onAuthStateChanged`.
- Po prihlásení drží:
  - `token` (Firebase ID token)
  - `user` (`id`, `email`, `name`)
  - `orgId` (aktuálne UID usera)
- Exponuje:
  - `login(email, password)`
  - `register(email, password, displayName?)`
  - `logout()`
  - `loadFromStorage()`
  - `finishOnboarding()`

### Auth services (`src/services/auth.ts`)

- `register()` - Firebase create user, optional profile update, `ensureUserProfile()`, ID token.
- `login()` - Firebase sign-in, `ensureUserProfile()`, ID token.
- `loginWithGoogle()` - Google Sign-In -> Firebase credential -> token.
- `logout()` - Firebase sign-out.
- `getAuthErrorMessage()` - mapovanie auth error kódov na UX hlášky.

## 5) Dáta a backend flow

### Primárna data vrstva: Firestore

Väčšina funkcionalít ide cez `src/services/*` + `src/lib/rnFirestore.ts`.
Wrappre v `rnFirestore.ts` poskytujú API podobné web SDK (`collection`, `doc`, `query`, `getDoc`, `getDocs`, `setDoc`, `updateDoc`, `writeBatch`, ...).

### REST API vrstva (`src/api/client.ts`)

- Base URL:
  - `EXPO_PUBLIC_API_URL` (ak je nastavené), inak
  - dev fallback `http://127.0.0.1:8787`, resp. prod worker URL.
- Auth:
  - `setAuthToken(token)`
  - `setOn401(callback)` na centralizovanú reakciu pri 401.
- Hlavné endpointy:
  - `/health`
  - `/auth/login`, `/auth/register`
  - `/projects` (+ create/update/delete)
  - `/tasks` (+ create/update status)

## 6) Hlavné domény a služby

### Projekty

- Súbor: `src/services/projects.ts`
- Kľúčové exporty:
  - `createProject`, `getProject`, `listMyProjects`, `listAllMyProjects`
  - `updateProject`, `deleteProject`, `archiveProject`, `unarchiveProject`
  - fázy: `listProjectPhases`, `createPhase`, `updatePhase`, `deletePhase`

Flow:
- projekty sú viazané na `auth.currentUser.uid` (`ownerId`)
- aktívne projekty filtrujú `archivedAt`
- fázy sa ukladajú pod `projects/{projectId}/phases` (cez `paths`)

### Úlohy

- Súbor: `src/services/tasks.ts`
- Kľúčové exporty:
  - `createTask`, `listTasksByProject`, `listMyTasks`
  - `updateTaskStatus`, `updateTaskAssignee`, `updateTaskTitle`
  - `getTaskById`, `reorderTask`, `moveTaskToPhase`
  - `archiveTask`, `deleteTask`

Flow:
- tasky sú uložené pod projektom (`paths.projectTasks(projectId)`)
- soft delete cez `isActive=false`
- pri tvorbe tasku sa rieši poradie (`order`) podľa fázy alebo globálne
- notifikácie sú synchronizované cez `notifications` service

### Notifikácie

- Súbor: `src/services/notifications.ts`
- Exporty:
  - `listNotifications`, `markNotificationAsRead`, `markAllAsRead`
  - task due flow: `upsertTaskDueNotification`, `markTaskNotificationsRead`
  - `createExpenseAddedNotification`, `createProjectActivityNotification`
  - diagnostika: `recordSyncIssue`, `runNotificationsSelfCheck`

### Predplatné

- Súbor: `src/services/subscription.ts`
- Exporty:
  - `getUserSubscription`, `getUserTier`, `getSubscriptionLimits`
  - `checkLimit`
  - Stripe/Firebase Functions flow: `createCheckoutSession`, `createBillingPortalSession`
  - `initializeFreeSubscription`

### Ďalšie domény

- `projectMembers.ts` - členovia projektu, invite/remove.
- `projectOverviewService.ts` - prehľadové agregácie a štatistiky projektu.
- `expenses.ts` - náklady/faktúry.
- `attachments.ts` - upload/list/delete príloh + URL.
- `constructionDiary.ts` - stavebný denník.
- `contractors.ts`, `suppliers.ts` - dodávatelia.
- `projectFactory.ts`, `templateService.ts`, `repositories/catalogRepo.ts` - templaty a bootstrap projektu.
- `invoiceOCR.ts` - OCR integrácia cez Firebase Functions.

## 7) Konfigurácia a infra súbory

- `app.json` - Expo konfigurácia aplikácie.
- `eas.json` - build/deploy profily.
- `.env.example` - env premenné (`EXPO_PUBLIC_API_URL`, Firebase, Google client id).
- `firestore.rules`, `firestore.indexes.json`, `storage.rules` - bezpečnostné pravidlá/indexy.
- `src/firebase.ts` - inicializácia Firebase (`auth`, `db`, `storage`, `functions`).

## 8) Kompletný index exportovaných funkcií (hlavné moduly)

Poznámka: nižšie sú exportované funkcie, ktoré sú dnes verejne dostupné z najdôležitejších modulov.

### Core / Context / Navigation

- `src/context/AuthContext.tsx`
  - `AuthProvider`
  - `useAuth`
- `src/i18n/I18nContext.tsx`
  - `I18nProvider`
  - `useI18n`
- `src/navigation/RootNavigator.tsx`
  - `RootNavigator`
- `src/navigation/AppTabs.tsx`
  - `AppTabs`
- `src/navigation/HomeStack.tsx`
  - `HomeStack`

### API a infra

- `src/api/client.ts`
  - `setAuthToken`
  - `setOn401`
  - `getBaseURL`
  - `api` (objekt endpoint funkcií)
- `src/lib/rnFirestore.ts`
  - `collection`, `collectionGroup`, `doc`, `where`, `orderBy`, `limit`, `query`
  - `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`
  - `writeBatch`, `serverTimestamp`, `onSnapshot`

### Services (domain API)

- `src/services/auth.ts`
  - `register`, `login`, `loginWithGoogle`, `logout`, `getAuthErrorMessage`
- `src/services/projects.ts`
  - `createProject`, `listProjectPhases`, `getProject`, `listMyProjects`, `listAllMyProjects`
  - `updateProject`, `deleteProject`, `archiveProject`, `unarchiveProject`
  - `createPhase`, `updatePhase`, `deletePhase`
- `src/services/tasks.ts`
  - `createTask`, `listTasksByProject`, `listMyTasks`
  - `updateTaskStatus`, `getTaskById`, `updateTaskAssignee`
  - `archiveTask`, `reorderTask`, `moveTaskToPhase`, `updateTaskTitle`, `deleteTask`
- `src/services/taskService.ts`
  - `updateTaskStatus`, `assignTask`, `assignTaskToTrade`, `assignTaskToUserAndTrade`
- `src/services/notifications.ts`
  - `listNotifications`, `markNotificationAsRead`, `markAllAsRead`
  - `upsertTaskDueNotification`, `markTaskNotificationsRead`
  - `createExpenseAddedNotification`, `createProjectActivityNotification`
  - `recordSyncIssue`, `runNotificationsSelfCheck`
- `src/services/subscription.ts`
  - `getUserSubscription`, `getUserTier`, `getSubscriptionLimits`, `subscribeToSubscription`
  - `createCheckoutSession`, `createBillingPortalSession`, `checkLimit`, `initializeFreeSubscription`
- `src/services/projectOverviewService.ts`
  - `getProjectPhases`, `getProjectTasks`, `getPhaseTasks`
  - `calculatePhaseStats`, `calculateProjectStats`
  - `getProjectOverview`, `getMyProjects`, `getMyProjectsDenormalized`
- `src/services/attachments.ts`
  - `uploadAttachment`, `listAttachments`, `getAttachmentURL`, `deleteAttachment`, `linkAttachmentToExpense`
- `src/services/expenses.ts`
  - `createExpense`, `listExpensesByProject`, `updateExpense`, `deleteExpense`
- `src/services/projectMembers.ts`
  - `listProjectMembers`, `inviteMemberByEmail`, `removeMember`
- `src/services/contractors.ts`
  - `listContractors`, `getContractor`, `createContractor`, `updateContractor`, `deleteContractor`
- `src/services/suppliers.ts`
  - `listProjectSuppliers`, `addSupplierToProject`
- `src/services/constructionDiary.ts`
  - `createDiaryEntry`, `listDiaryEntries`, `updateDiaryEntry`, `deleteDiaryEntry`
- `src/services/projectDocuments.ts`
  - `createProjectDocument`, `listProjectDocuments`, `updateProjectDocument`, `deleteProjectDocument`
- `src/services/templateService.ts`
  - `getTemplate`, `getTemplatePhases`, `getTemplateTasks`, `getTemplatesByType`
- `src/services/projectFactory.ts`
  - `instantiateTemplate`, `createProjectFromTemplate`
- `src/services/account.ts`
  - `requestAccountDeletion`
- `src/services/invoiceOCR.ts`
  - `extractInvoiceData`

## 9) Rýchly implementačný checklist pre nové feature

1. Definuj doménu a Firestore paths (`src/lib/firestorePaths.ts`).
2. Pridaj service funkcie do `src/services/<domain>.ts`.
3. Pridaj/rozšír screen v `src/screens/`.
4. Napoj navigáciu v `src/navigation/RootNavigator.tsx` alebo tab/stack.
5. Ak treba global state, rozšír context (`AuthContext` alebo nový context).
6. Doplň notifikácie/subscription limity, ak feature mení task/project count.
7. Otestuj gate flow: bez tokenu, bez consentu, bez onboardingu, po prihlásení.

---

Ak chceš, ďalší krok viem spraviť automaticky: vygenerujem k tomuto aj "dependency mapu" (kto importuje koho) a "flow diagram" pre konkrétnu feature, ktorú ideš implementovať.
