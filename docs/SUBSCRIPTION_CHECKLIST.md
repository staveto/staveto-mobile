# Kontrola predplatného – checklist pred publikáciou

## 1. RevenueCat

- [ ] **API kľúče** v `.env`:
  - `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (goog_xxx)
  - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (appl_xxx)
- [ ] **Produkt** `staveto_monthly_1499` vytvorený v RevenueCat
- [ ] **Entitlement** `pro` prepojený s produktom
- [ ] **Offering** `default` obsahuje mesačný balík
- [ ] **Google Play credentials** – service account JSON nahratý v RevenueCat (Android)
- [ ] **App Store Connect** credentials (iOS)

## 2. App Store Connect (iOS)

- [ ] **Produkty** vytvorené v App Store Connect → Subscriptions:
  - `staveto_monthly_1499` (Staveto Pro – s trialom)
  - `staveto_monthly_1499_notrial` (Staveto Pro – No Trial)
- [ ] **Status** oboch produktov musí byť „Ready to Submit“ – nie „Developer Action Needed“
- [ ] Ak je „Developer Action Needed“: otvor produkt → vyrieš chýbajúce údaje (metadata, cenová úroveň, súhlas atď.)
- [ ] **RevenueCat** – produkty prepojené s App Store Connect product IDs
- [ ] **Sandbox tester** – pre testovanie na iOS použiť Sandbox Apple ID v Nastaveniach

## 3. Google Play Console (Android)

- [ ] **Predplatné** vytvorené: mesačný plán 14,99 €
- [ ] **Base plan** aktívny
- [ ] **Managed Publishing** – ak je zapnuté, produkty môžu byť nedostupné. Odporúčané: vypnúť v Publishing overview alebo počkať 1–2 h po publikovaní.
- [ ] **Produkt ID** v Play Console = `staveto_monthly_1499` (alebo presne to, čo je v RevenueCat)
- [ ] **Internal testing** – overiť nákup na internom testovacom tracku

## 4. RevenueCat Webhook

- [ ] **Webhook URL** v RevenueCat Dashboard → Project Settings → Integrations:
  ```
  https://europe-west1-staveto-mvp-5f251.cloudfunctions.net/revenuecatWebhook
  ```
- [ ] **Authorization** – ak webhook vyžaduje secret, nastaviť v Cloud Function
- [ ] Webhook aktualizuje `users/{uid}`: `isPro`, `currentPeriodEndAt`, `subscriptionStatus`

## 5. Firebase

- [ ] **Cloud Function** `getBillingStatus` nasadená
- [ ] **Cloud Function** `revenuecatWebhook` nasadená
- [ ] **checkEntitlement** – používa sa pre OCR limity

## 6. Aplikácia (kód)

- [ ] **configurePurchases(uid)** – volané v AuthContext po prihlásení
- [ ] **PaywallScreen** – zobrazuje sa pri limite (paywallTrigger)
- [ ] **SubscriptionScreen** – „Aktivovať Pro“ volá `purchaseMonthly()`
- [ ] **Expo Go** – predplatné nefunguje, treba dev-client / EAS build

## 7. Testovanie

1. **Internal testing track** – nainštalovať AAB z Play Console
2. **Prihlásiť sa** – RevenueCat sa nakonfiguruje s `uid`
3. **Účet → Predplatné** → „Aktivovať Pro“
4. **Google Play** – zobrazenie cenovej ponuky a dokončenie nákupu
5. **Po úspechu** – `refreshUser()` načíta nový billing status
6. **Webhook** – po nákube RevenueCat odošle event → Firestore `isPro: true`

## Časté problémy

| Problém | Riešenie |
|---------|----------|
| „No products available“ (iOS) | App Store Connect: skontroluj „Developer Action Needed“. Produkty musia byť Ready. RevenueCat ↔ App Store Connect mapovanie. |
| „No products available“ (Android) | Managed Publishing zapnuté – vypnúť alebo počkať. Overiť mapovanie produktu RevenueCat ↔ Play Console. |
| Nákup prebehne, ale isPro zostane false | Skontrolovať webhook URL a logy v RevenueCat. Overiť, či `app_user_id` = Firebase uid. |
| „Purchase failed“ pri zrušení | OK – používateľ zatvoril platobnú obrazovku. Aplikácia to teraz ignoruje (žiadny toast). |
| V emulátore nefunguje | Platby vyžadujú skutočné zariadenie s Google účtom. Použiť Internal testing na reálnom zariadení. |
