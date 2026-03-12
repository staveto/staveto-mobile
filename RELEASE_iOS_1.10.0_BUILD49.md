# Staveto iOS Release – 1.10.0 (Build 49)

**Goal:** Fix Apple rejections 2.1(a) Sign in with Apple on iPad + 3.1.1 promo code unlocking.

---

## A) Preflight Verification ✅

### 1. Promo Code Removal (3.1.1)

| Check | Status | Location |
|-------|--------|----------|
| `redeemPromoCode` removed from client | ✅ | `mobile/src/services/subscription.ts` – no redeemPromoCode, no promo source |
| Promo strings removed from translations | ✅ | `mobile/src/i18n/translations.ts` – no promo keys |
| `redeemPromoCode` disabled server-side | ✅ | `functions/src/promo.ts` – throws `PROMO_DISABLED` |
| No promo entitlement in billing | ✅ | `functions/src/billing.ts` – no `source === "promo"` logic |

**Note:** `functions/src/index.ts` still exports `redeemPromoCode`; the function is disabled and always throws.

### 2. Promo Unlock Entry Points (grep)

```
functions/src/index.ts:1090  – export (disabled)
functions/src/promo.ts:8     – definition (throws PROMO_DISABLED)
mobile/docs/offline-first-changes.md  – docs only
mobile/RELEASE_FIXES_SUMMARY.md      – docs only
```

**No client-side calls.** No `promoCode` or `source === "promo"` in runtime code.

### 3. Apple Sign-In Robustness (2.1(a))

| Check | Status | Location |
|-------|--------|----------|
| `loginWithApple` wrapped in try/catch | ✅ | `auth.ts` L198–279 |
| Missing identityToken → auth/cancelled | ✅ | `auth.ts` L232–236 |
| Technical errors masked | ✅ | `auth.ts` L268–278 → auth/apple-unavailable |
| LoginScreen: no error for auth/cancelled | ✅ | `LoginScreen.tsx` L104–105: `if (code === "auth/cancelled") return` |
| `isAvailableAsync` guarded | ✅ | `auth.ts` L200–205: check before call |

### 4. Post-Login Init (no blocking error)

| Step | Status |
|------|--------|
| `configurePurchases` | ✅ Individual try/catch, log only |
| `fetchBillingStatus` | ✅ Individual try/catch, log only |
| `claimProjectInvites` | ✅ `.catch()` – fire-and-forget |
| User doc load | ✅ try/catch, fallback user |

**AuthContext:** Failures are logged; user always enters app with fallback state. No red overlay/alert.

---

## B) Build

### Commands Run

```powershell
cd "c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile"
eas build --platform ios --profile production --non-interactive
```

### Build Info

- **Build URL:** https://expo.dev/accounts/info.staveto/projects/stavetoapp/builds/fb034d73-79f4-4d9d-b90f-c7d6e9d3c6b5
- **Build ID:** `fb034d73-79f4-4d9d-b90f-c7d6e9d3c6b5`
- **Version:** 1.10.0
- **Build Number:** 49 (EAS remote auto-increment from 48)
- **Profile:** production

**Note:** `appVersionSource: "remote"` in eas.json – EAS uses remote build numbers. Local `buildNumber` in app.json is ignored for the build.

### Plugins / Entitlements

- `expo-apple-authentication` in plugins ✅
- `usesAppleSignIn: true` in app.json ✅
- No missing entitlements reported

---

## C) Test Checklist (before submission)

| Test | Pass/Fail |
|------|-----------|
| Fresh install → Sign in with Apple → no error, enters app | ⬜ |
| Cancel Apple sign-in → no error (silent) | ⬜ |
| Promo code unlock impossible (no UI, no API) | ⬜ |
| Purchase / Restore works (RevenueCat) | ⬜ |

---

## D) App Store Connect Submission Checklist

1. **App Store Connect** → My Apps → Staveto
2. **Version:** Create or select 1.10.0 (or 1.10.1 if you prefer)
3. **Build:** Attach build 49 from TestFlight / EAS
4. **App Privacy:** Ensure no “Data Used to Track You”
5. **Metadata:**
   - Privacy Policy link
   - Terms of Use (EULA) link
6. **Subscriptions:** Attached and not “Developer Action Needed”
7. **Review Notes** (paste):

   ```
   Sign in with Apple fixed on iPad to prevent any error message after sign-in; cancellation handled silently.
   Promo-code based unlocking removed; Pro access unlocked only via App Store IAP (RevenueCat) or Restore Purchases.
   ```

8. **Submit for Review**

---

## E) Code Changes This Session

- **AuthContext.tsx:** `configurePurchases` and `fetchBillingStatus` wrapped in individual try/catch; failures logged only, user still enters app.
- **app.json:** iOS `buildNumber` set to 47 (EAS uses remote 49 for this build).

---

## Remaining Risks / Unknowns

- **EAS Free tier:** Build may queue longer; check status at https://expo.dev/accounts/info.staveto/projects/stavetoapp/builds
- **TestFlight:** Verify build 49 on TestFlight before submitting to App Review
- **Docs:** `RELEASE_FIXES_SUMMARY.md` and `offline-first-changes.md` still mention promo; docs only, no runtime impact
