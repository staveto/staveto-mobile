# Staveto Mobile - Export funkcii kodu (11.02.2026)

Tento dokument je datumovy export aktualneho stavu aplikacie v `mobile/` ku dnu **11.02.2026**.
Zameriava sa na subory, logiku, databazu a API vrstvu.

## 1) Prehlad klucovych suborov

- `App.tsx`
  - Root skladanie providerov a navigacie (`SafeAreaProvider`, `I18nProvider`, `AuthProvider`, `RootNavigator`).
- `src/context/AuthContext.tsx`
  - Centralny auth state, Firebase auth listener, login/register/logout flow, onboarding a consent gate.
- `src/navigation/RootNavigator.tsx`
  - Hlavna rozhodovacia logika medzi onboarding/auth/consent/app flow.
- `src/navigation/AppTabs.tsx`
  - Hlavne taby aplikacie (`Home`, `Projects`, `Notifications`, `Search`, `Account`).
- `src/services/*.ts`
  - Business logika pre domeny (projekty, ulohy, vydavky, notifikacie, predplatne, clenia projektu).
- `src/lib/rnFirestore.ts`
  - Firestore wrapper s API podobnym web SDK (`collection`, `doc`, `query`, `getDoc`, `setDoc`, `updateDoc`, `writeBatch`).
- `src/lib/firestorePaths.ts`
  - Konvencie Firestore ciest pre jednotlivé kolekcie/subkolekcie.
- `src/api/client.ts`
  - REST klient pre Cloudflare Worker API (`/health`, `/auth/*`, `/projects`, `/tasks`).
- `src/firebase.ts`
  - Inicializacia Firebase modulov (Auth, Firestore, Storage, Functions).
- `firestore.rules`, `storage.rules`
  - Bezpecnostne pravidla pre Firestore a Storage.

## 2) Logika aplikacie (flow)

### 2.1 Auth a onboarding

1. Po starte sa nacita auth stav (Firebase listener).
2. Neautentifikovany user ide cez jazyk + intro + login/register.
3. Po autentifikacii sa kontroluje consent (`pending_consent`) a onboarding (`pending_onboarding` + profil vo Firestore).
4. Az po splneni gate podmienok ide user do hlavnej app (`AppTabs` + stack screeny).

Relevantne subory:
- `src/context/AuthContext.tsx`
- `src/navigation/RootNavigator.tsx`
- `src/services/auth.ts`

### 2.2 Projektova domena

- `src/services/projects.ts`
  - Vytvorenie projektu, update, archivacia, mazanie.
  - Sprava faz (phase CRUD) pod `projects/{projectId}/phases`.
- `src/services/projectMembers.ts`
  - Sprava clenov projektu a pozvanky.

### 2.3 Ulohy a workflow

- `src/services/tasks.ts`
  - Task CRUD, status, reorder, move medzi fazami, archivacia.
- `src/services/taskService.ts`
  - Doplneny workflow pre status transition + notifikacna integracia.

### 2.4 Vydavky, prilohy, dokumenty

- `src/services/expenses.ts`
  - CRUD vydavkov, napojenie na limity predplatneho.
- `src/services/attachments.ts`
  - Upload suborov do Storage + metadata do Firestore.
- `src/services/projectDocuments.ts`
  - Dokumenty viazane na projekt.

### 2.5 Notifikacie a sync fallback

- `src/services/notifications.ts`
  - Firestore notifikacie + lokalny fallback cez AsyncStorage (`SYNC_ISSUE`).
  - Mark as read, mark all, task due/upsert flow, project activity a expense notifikacie.

## 3) Databaza a perzistencia

### 3.1 Firestore model

Primarne kolekcie:
- `users`
- `projects`
- `projects/{projectId}/phases`
- `projects/{projectId}/tasks`
- `projects/{projectId}/expenses`
- `projects/{projectId}/attachments`
- `notifications`
- `catalogTemplates`

Typy a paths:
- `src/lib/types.ts`
- `src/lib/firestorePaths.ts`

### 3.2 Local storage (AsyncStorage)

Pouzite kluce:
- `staveto_onboarding_done`
- `pending_consent`
- `pending_onboarding`
- `@staveto:local_notifications`
- `@staveto:pending_notification_reads`

Vyuzitie:
- onboarding/consent fallback stavy
- lokalne notifikacie pri sync alebo network probleme

### 3.3 Security rules

- `firestore.rules`
  - Access policy pre users/projects/notifications/billing/catalóg.
- `storage.rules`
  - Access policy pre uploadovane subory a profile assets.

## 4) API vrstva

### 4.1 Cloudflare Worker REST klient

Subor:
- `src/api/client.ts`

Hlavne body:
- Base URL:
  - `EXPO_PUBLIC_API_URL`, inak dev fallback `http://127.0.0.1:8787`,
  - v produkcii fallback `https://staveto-app-api.workers.dev`.
- Endpoint API:
  - `/health`
  - `/auth/login`, `/auth/register`
  - `/projects` (+ create/update/delete)
  - `/tasks` (+ create/update status)
- Podpora auth tokenu:
  - `setAuthToken(token)`
  - `setOn401(fn)`

### 4.2 Firebase integrations

- Auth: `@react-native-firebase/auth`
- Firestore: primarna data vrstva
- Storage: prilohy
- Functions: pozvanky/predplatne (`claimProjectInvites`, billing sessions)

## 5) Export funkcii (klucove moduly)

### 5.1 `src/services/auth.ts`
- `register`
- `login`
- `loginWithGoogle`
- `logout`
- `getAuthErrorMessage`

### 5.2 `src/services/projects.ts`
- `createProject`
- `listProjectPhases`
- `getProject`
- `listMyProjects`
- `listAllMyProjects`
- `updateProject`
- `deleteProject`
- `archiveProject`
- `unarchiveProject`
- `createPhase`
- `updatePhase`
- `deletePhase`

### 5.3 `src/services/tasks.ts`
- `createTask`
- `listTasksByProject`
- `listMyTasks`
- `updateTaskStatus`
- `getTaskById`
- `updateTaskAssignee`
- `archiveTask`
- `reorderTask`
- `moveTaskToPhase`
- `updateTaskTitle`
- `deleteTask`

### 5.4 `src/services/notifications.ts`
- `listNotifications`
- `markNotificationAsRead`
- `markAllAsRead`
- `upsertTaskDueNotification`
- `markTaskNotificationsRead`
- `createExpenseAddedNotification`
- `createProjectActivityNotification`
- `recordSyncIssue`
- `runNotificationsSelfCheck`

### 5.5 `src/services/subscription.ts`
- `getUserSubscription`
- `getUserTier`
- `getSubscriptionLimits`
- `subscribeToSubscription`
- `createCheckoutSession`
- `createBillingPortalSession`
- `checkLimit`
- `initializeFreeSubscription`

## 6) Potvrdene poznamky a rizika ku 11.02.2026

- `src/services/taskService.ts` importuje `createNotification` z `src/services/notifications.ts`, ale tato funkcia nie je v subore exportovana/definovana.
  - Prakticky to predstavuje riziko runtime chyby pri volani notifikacneho flow.
- `src/services/notifications.ts` (`runNotificationsSelfCheck`) tiez vola `createNotification`, ktora v module chyba.
- V `src/api/client.ts` je podpora token auth (`setAuthToken`, `setOn401`), ale aktualne volania tychto setterov v aplikacnom flow nie su evidovane.
  - REST klient sa javí ako ciastocne debug vrstva (napr. testy v `AccountScreen`).

## 7) Stav exportu

- Datum snapshotu: `11.02.2026`
- Scope: mobilna aplikacia (`mobile/`)
- Fokus: subory, logika, databaza, API
