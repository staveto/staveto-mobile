# Offline-First / Poor-Network Fast Path

This document describes changes made to eliminate long hangs when internet is weak or unavailable.

## Scan Summary (Top Hang Risks)

### Top 10 Firestore reads/screens most likely to hang
1. **projects.ts** `listAllMyProjectsInternal` – project list (main entry) – ✅ smart reads
2. **projects.ts** `getProject`, `listProjectPhases` – project detail – ✅ smart reads
3. **projects.ts** `createPhase` – getDoc + getDocs for verify/order – ⚠️ raw reads
4. **problems.ts** `listProblems`, `getProblem` – ✅ smart reads
5. **tasks.ts** `listTasksByProject`, `getTaskById` – ✅ smart reads
6. **useProjectAccess** `fetchProjectAccess` – getDoc(projectRef) – ⚠️ raw read
7. **projectMembers** `listProjectMembers` – ✅ getDocsSmart + forceServer timeout
8. **RootNavigator** `getDoc(users)` – gate check – low frequency
9. **AuthContext** `getDoc(users)` – auth flow – low frequency
10. **subscription.ts** `getDoc(users)` – billing – may need server for entitlements

### Server-only reads
- **CloneProjectModal** – `getDoc(..., { source: 'server' })` – ✅ wrapped withTimeout(8s)
- **firestoreSmartRead** – internal `source: 'server'` for forceServer path – ✅ has timeout

### Main Functions entrypoints
- `firebase.ts` `getCallable` – ✅ wrapped withTimeout(6s), user-friendly error
- `functionsClient.ts` `getCallableWithTimeout` – custom timeout
- Call sites: cloneProjectStructure, syncMyProjectsSharedCount, extractInvoiceData, getBillingStatus, checkEntitlement, redeemPromoCode, calculateDistanceKm, addProjectMemberByEmail, removeProjectMember, etc.

### Heaviest Storage image lists
1. **ProblemsListScreen** – ProblemPhotoThumb per problem – ✅ getDownloadUrlSmart
2. **ProjectPhotosScreen** – grid of attachment images – ✅ getDownloadUrlSmart
3. **ProjectOverviewDashboardScreen** – last 6 photos – ⚠️ getAttachmentURL (raw)
4. **ProjectOverviewScreen** – many attachment thumbnails – ⚠️ getAttachmentURL
5. **TaskDetailScreen** – attachment thumbnails – ⚠️ getAttachmentURL

## Overview

When offline or on poor network, screens render quickly from cache/local storage instead of waiting 10–30s on network timeouts. Online behavior still refreshes data from the server.

## New Files

### `src/utils/withTimeout.ts`
- `withTimeout(promise, ms?, label?)` – rejects with `TimeoutError` (code: `TIMEOUT`) after `ms` (default 6000)
- `isTimeoutOrOfflineError(err)` – detects timeout/network errors for user-friendly messages

### `src/services/firestoreSmartRead.ts`
- `getDocSmart(ref, opts?)` – cache-first when offline/poor, server-first when online
- `getDocsSmart(query, opts?)` – same logic for queries
- `runSmartRead(readFn, opts?)` – generic helper
- **SmartReadOptions**: `poorTypes` (default `['cellular','unknown']`), `forceServer`, `preferCacheWhenPoor` (default true)
- When `forceServer`: uses 8s timeout to avoid UI hang; fallback to cache on failure
- Uses NetInfo: offline = `!isConnected` or `type === 'none'` or `!isInternetReachable`; poor = type in `poorTypes`
- Proper TypeScript types: `FirebaseFirestoreTypes.DocumentSnapshot`, `QuerySnapshot`

### `src/services/storageSmart.ts`
- `getDownloadUrlSmart(path, onlineStatus)` – returns `null` when offline/poor (no Storage fetch); fetches URL when online

### `src/hooks/useOnlineStatus.ts`
- Returns `{ isOnline, isOffline, isPoorNetwork, loading, netInfo }`
- Subscribes to `NetInfo.addEventListener`

### `src/components/OfflineBanner.tsx`
- i18n: `offline.bannerOffline` / `offline.bannerPoor`
- "Offline – showing saved data" / "Weak signal – loading from cache"
- Integrated in `RootNavigator` (top of main app stack)

## Modified Files

### Firestore reads (replaced with smart reads)

| File | Change | Reason |
|------|--------|--------|
| `src/services/projects.ts` | `listAllMyProjectsInternal`, `getProject`, `listProjectPhases`, `createPhase` use `getDocSmart`/`getDocsSmart` | Project list/phases are main entry; cache-first avoids long hangs |
| `src/hooks/useProjectAccess.ts` | `fetchProjectAccess` uses `getDocSmart` for project doc | Permission checks block UI; cache-first is fast |
| `src/services/projectMembers.ts` | `listProjectMembers` uses `getDocsSmart` with `forceServer` when needed; 8s timeout built-in | Fresh data after add/remove; timeout prevents hang |
| `src/services/problems.ts` | `listProblems`, `getProblem`, `countOpenProblems` use smart reads | Problems list is a hot path |
| `src/services/tasks.ts` | `listTasksByProject`, `getTaskById`, `updateTaskStatus`, `reorderTask`, `moveTaskToPhase` use smart reads | Tasks are heavily used |
| `src/hooks/useProjectAccess.ts` | `refresh` and `fetchProjectAccess` use `getDocSmart` for project + members | Permission checks block UI; cache-first is fast |
| `src/components/CloneProjectModal.tsx` | Server-only `getDoc` wrapped with `withTimeout(8s)` | Verify project exists before clone; no cache fallback; timeout prevents hang |

### Functions timeout

| File | Change |
|------|--------|
| `src/firebase.ts` | `getCallable` wraps calls with `withTimeout(6s)`; maps timeout/offline to user-friendly error |
| `src/services/functionsClient.ts` | `getCallableWithTimeout(name, timeoutMs)` for custom timeouts |

### Storage / image loading

| File | Change |
|------|--------|
| `src/screens/ProblemsListScreen.tsx` | `ProblemPhotoThumb` uses `getDownloadUrlSmart`; placeholder when offline/poor |
| `src/screens/ProjectPhotosScreen.tsx` | Load and `openPhoto` use `getDownloadUrlSmart`; modal shows `common.noConnection` when URL unavailable |
| `src/screens/ProjectOverviewDashboardScreen.tsx` | Last 6 photos use `getDownloadUrlSmart`; skips fetch when offline/poor |

### UI / layout

| File | Change |
|------|--------|
| `src/navigation/RootNavigator.tsx` | Wraps main stack with `OfflineBanner` at top |
| `src/i18n/translations.ts` | Added `offline.bannerOffline`, `offline.bannerPoor`, `common.noConnection` |

## Server-Only Reads (kept with timeout)

- **CloneProjectModal**: Must verify project exists on server before clone Cloud Function (no cache fallback)
- **projectMembers** when `forceFromServer`: Need fresh member list after add/remove; `getDocsSmart` with `forceServer` uses 8s timeout

## How to Extend

1. **New Firestore reads**: Use `getDocSmart`/`getDocsSmart` for non–billing/security-critical data
2. **New Functions calls**: Use `getCallable` (already wrapped) or `getCallableWithTimeout` for custom timeout
3. **New Storage image lists**: Use `getDownloadUrlSmart(path, { isOffline, isPoorNetwork })` and show placeholder when `null`
4. **Custom network logic**: Use `useOnlineStatus()` for `isOffline`/`isPoorNetwork`
5. **Custom poor types**: Pass `poorTypes: ['cellular']` to `SmartReadOptions` to treat only cellular as poor
