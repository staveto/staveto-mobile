# Cloud Functions Audit – Mobil + Web

## Prehľad

Tento dokument mapuje Cloud Functions potrebné pre mobilnú aplikáciu a web (staveto-office).

---

## Zoznam funkcií (19 callable + 2 trigger + 2 HTTP)

| Funkcia | Volá | Účel |
|---------|------|------|
| **createUserDoc** | Auth trigger | Vytvorí `users/{uid}` pri registrácii |
| **claimProjectInvites** | Mobil (AuthContext) | Prevzatie projektových pozvánok pri prihlásení |
| **listPendingInvites** | Mobil, Web | Zoznam čakajúcich projektových pozvánok |
| **acceptProjectInvite** | Mobil | Prijatie pozvánky do projektu |
| **declineProjectInvite** | Mobil | Odmietnutie pozvánky |
| **requestAccountDeletion** | Mobil | Žiadosť o vymazanie účtu (AccountScreen) |
| **extractInvoiceData** | Mobil | OCR faktúry |
| **getBillingStatus** | Mobil, Web | Stav fakturácie (AuthContext) |
| **checkEntitlement** | Mobil | Kontrola oprávnení (billing) |
| **addProjectMemberByEmail** | Mobil (members.ts) | Pridanie člena projektu podľa emailu |
| **removeProjectMember** | Mobil (projectMembers) | Odstránenie člena projektu |
| **updateMemberPermissions** | Mobil (projectMembers) | Aktualizácia oprávnení člena |
| **syncMembersByUidForProject** | Mobil (ProjectMembersScreen) | Sync `membersByUid` pre projekt |
| **syncMyProjectsSharedCount** | Mobil (ProjectsScreen, HomeScreen) | Sync počtu zdieľaní projektov |
| **backfillProjectSharedCounts** | Mobil (ProjectsScreen, HomeScreen, AccountScreen) | Backfill shared counts |
| **cloneProjectStructure** | Mobil (CloneProjectModal) | Klonovanie projektu |
| **calculateDistanceKm** | Mobil (distance.ts) | Výpočet vzdialenosti (jazda A→B) |
| **redeemPromoCode** | Mobil | Uplatnenie promo kódu (disabled) |
| **onMemberInviteCreated** | Firestore trigger | Notifikácia + push pri pozvánke člena |
| **inboundWebhook** | HTTP | WhatsApp webhook |
| **revenuecatWebhook** | HTTP | RevenueCat webhook (IAP) |

---

## Opravy vykonané (12.03.2026)

1. **getBillingStatus** – pridaný do exportu z `billing.ts` (volaný mobilom aj webom)
2. **syncMembersByUidForProject** – pridaný do exportu z `team.ts` (volaný ProjectMembersScreen)
3. **syncMyProjectsSharedCount** – pridaný do exportu z `team.ts` (volaný ProjectsScreen, HomeScreen)
4. **requestAccountDeletion** – nová funkcia (volaná AccountScreen pri mazaní účtu)
5. **revenuecatWebhook** – pridaný do exportu (RevenueCat IAP webhook)

---

## Nasadenie

Po úpravách spusti:

```bash
cd functions
npm run build
firebase deploy --only functions --project staveto-mvp-5f251
```

Po nasadení by malo byť **19 callable funkcií** + 2 trigger + 2 HTTP = 23 služieb v Cloud Run.

---

## Poznámky

- **requestAccountDeletion** – aktuálne len loguje a vracia `{ status: "requested" }`. Pre GDPR je potrebné doplniť asynchrónne mazanie (queue, scheduled job).
- **Org invites** – pre B2B org pozvánky zatiaľ nie je `acceptOrgInvite`; akceptovanie musí ísť cez Cloud Function (pozri `docs/FIRESTORE_RULES_DIFF.md`).
