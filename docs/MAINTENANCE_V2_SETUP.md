# MAINTENANCE v2 – Setup

## 1. Nainštalovať závislosti

```bash
npm install date-fns expo-camera react-native-qrcode-svg react-native-svg
```

## 2. Pridať scheme do app.json

V `app.json` pridaj do `expo` objektu:

```json
"scheme": "staveto"
```

## 3. Firestore indexy

Spusti:

```bash
firebase deploy --only firestore:indexes
```

Alebo pridaj do `firestore.indexes.json` do poľa `indexes`:

```json
{
  "collectionGroup": "equipment",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "qrToken", "order": "ASCENDING"},
    {"fieldPath": "status", "order": "ASCENDING"}
  ]
},
{
  "collectionGroup": "tasks",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "serviceRuleId", "order": "ASCENDING"},
    {"fieldPath": "status", "order": "ASCENDING"},
    {"fieldPath": "dueDate", "order": "ASCENDING"}
  ]
}
```

## 4. Firestore rules

Pravidlá pre `equipment` a `serviceRules` sú už pokryté existujúcim wildcardom `match /{subcol}/{docId}` pod projektom – len členovia projektu majú prístup.
