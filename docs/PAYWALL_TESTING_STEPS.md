# Paywall & RevenueCat – Testing Steps (Android Internal Testing)

## Summary of Changes

1. **RevenueCat integration** (`src/services/billing.ts`)
   - `configurePurchases(userId?)` – called in App.tsx on mount, and in AuthContext after login
   - `getEntitlement()` – prefers RevenueCat, fallback to Cloud Function when API key not set
   - `getOfferings()` – fetches RevenueCat offerings
   - `purchaseMonthly()` – `Purchases.purchasePackage(monthlyPackage)`
   - `restorePurchases()` – `Purchases.restorePurchases()`

2. **PaywallScreen** (`src/screens/PaywallScreen.tsx`)
   - Header, benefits list, pricing card (14.99 €/month)
   - "Select Plan" CTA → `purchaseMonthly()`
   - "Restore purchases" link → `restorePurchases()`
   - Debug logs (offerings, packages, entitlements) in __DEV__
   - "No products available" message when offerings are empty

3. **SubscriptionScreen**
   - Staveto Pro card is clickable → navigates to Paywall (when not entitled)
   - When entitled, shows "Active" and hides CTA

4. **Paywall trigger** (`src/services/paywallTrigger.ts`)
   - Tracks: `project_created`, `task_created`, `app_opened`
   - Rule: `projects >= 1 && tasks >= 3` → show paywall once
   - Integrated in: HomeScreen (app_opened), ProjectOverviewScreen (task_created), ProjectsScreen (project_created)

5. **Navigation**
   - PaywallScreen added to RootNavigator as modal

## Environment

Set in EAS secrets or `.env`:
```
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxxxx
```

## RevenueCat Setup

1. Create project in RevenueCat dashboard
2. Add Android app with package `com.staveto.app`
3. Configure Google Play credentials (service account JSON)
4. Create Product in RevenueCat → link to Play Console subscription
5. Create Offering "default" with entitlement "pro"

## Play Console Setup

1. Create subscription product (e.g. monthly 14.99€)
2. Add base plan
3. Activate product

## Build & Test Commands (Windows PowerShell)

```powershell
cd c:\Users\Marek\Staveto_Cursor\staveto-app_v2\mobile

# 1. Install deps (already done)
npm install

# 2. Set env (or use EAS secrets)
$env:EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY = "goog_xxxxx"

# 3. Prebuild
npx expo prebuild --platform android --clean

# 4. Build AAB for Internal testing
eas build --platform android --profile internal

# 5. Download AAB from EAS, upload to Play Console → Internal testing
```

## Manual Test Flow

1. **Without entitlement**
   - Create 1 project (ProjectsScreen)
   - Create 3 tasks (ProjectOverviewScreen)
   - Open Home → paywall should appear automatically (once)

2. **SubscriptionScreen**
   - Tap Staveto Pro card → Paywall opens

3. **PaywallScreen**
   - Tap "Select Plan" → Google Play purchase flow
   - Or tap "Restore purchases" if already purchased

4. **With entitlement**
   - SubscriptionScreen shows "Active", card not clickable
   - PaywallScreen shows "You already have Pro access"
