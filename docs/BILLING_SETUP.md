# Billing & OCR Limits Setup

## Firestore Schema

### users/{uid}
New fields (server-only, written by Cloud Functions):
- `subscriptionStatus`: "trial" | "active" | "expired" | "none"
- `trialStartAt`, `trialEndAt`: Timestamp
- `currentPeriodStartAt`, `currentPeriodEndAt`: Timestamp
- `planId`: "staveto_monthly_1499"
- `entitlement`: boolean

### users/{uid}/usage/{periodKey}
- `periodKey`: "trial" or "YYYY-MM"
- `ocrUsed`: number
- `lastOcrAt`: Timestamp
- `requestIds`: string[] (idempotency)
- `updatedAt`: Timestamp

### config/limits (optional)
Create in Firestore Console to override defaults:
```json
{
  "ocrTrialLimit": 5,
  "ocrMonthlyLimit": 30,
  "ocrCooldownSeconds": 60
}
```
If not created, defaults are used.

## Deployment

1. Deploy Firestore rules: `firebase deploy --only firestore:rules`
2. Deploy Functions: `firebase deploy --only functions`
3. (Optional) Create `config/limits` document in Firestore Console

## Test Steps

1. **Trial user**: New user gets 14-day trial. OCR works up to 5 uses (trial limit).
2. **Limit reached**: After 5 OCR (trial) or 30 (paid), backend returns LIMIT_REACHED.
3. **Cooldown**: Two OCR requests within 60s – second returns COOLDOWN with seconds remaining.
4. **Idempotency**: Same attachment OCR twice (same requestId) – only consumes 1 credit.
5. **Subscription screen**: Shows OCR X/Y, status (trial/active/expired).
6. **Promo code**: Still works; updates subscription to PRO.
