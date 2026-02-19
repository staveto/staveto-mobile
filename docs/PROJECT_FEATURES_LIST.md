# Zoznam funkcií projektov v Staveto

Tento dokument sumarizuje všetky funkcie dostupné pri projektoch v mobilnej aplikácii Staveto.

---

## 1. Základné funkcie (všetky typy projektov)

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **Adresa projektu** | Adresa, krajina, mesto – editovateľné ownerom | `projects.ts` |
| **Navigácia** | Otvorenie adresy v Google Maps / Apple Maps | `openInMaps()` |
| **Počasie** | Predpoveď na 3 dni (dnes, zajtra, pozajtra) | `weather.ts` |
| **Členovia projektu** | Zoznam členov, pridávanie, oprávnenia | `projectMembers.ts` |
| **Zdieľanie** | Pozvanie používateľov podľa e-mailu, sharedItems (tasks, phases, expenses, diary, documents) | `projectMembers.ts`, `invites.ts` |
| **Úpravy projektu** | Zmena názvu, adresy, krajiny, mesta (len owner) | `projects.ts` |
| **Archivácia / mazanie** | Archivácia projektu, trvalé vymazanie (len owner) | `projects.ts` |
| **Export do CSV** | Export úloh, výdavkov, denníka do CSV súboru | `projectExport.ts` |

---

## 2. Úlohy (Tasks)

| Funkcia | Popis | Typ projektu |
|---------|-------|--------------|
| **Fázy a úlohy** | Fázy s úlohami, accordion zobrazenie | MANAGEMENT, BUILD |
| **Plochý zoznam úloh** | Úlohy bez fáz | TRADE, RESIDENTIAL, MAINTENANCE |
| **Pridanie úlohy** | FAB alebo tlačidlo „Pridať úlohu“ | Všetky |
| **Textový popis** | Multiline popis (TRADE/MAINTENANCE) alebo jednoriadkový názov (BUILD) | Všetky |
| **Hlasová nahrávka** | Nahrávanie + prepis do textu | TRADE, RESIDENTIAL, MAINTENANCE |
| **Plánovaný termín** | Voliteľný dátum splnenia | Všetky |
| **Priradenie** | Assignee (člen projektu) | Všetky |
| **Stavy** | OPEN, DONE, IN_PROGRESS, BLOCKED | Všetky |
| **Presúvanie medzi fázami** | Presun úlohy do inej fázy | MANAGEMENT, BUILD |
| **Archivácia úlohy** | Označenie ako archivovaná | Všetky |
| **Prílohy k úlohám** | Fotky, dokumenty, audio | Všetky |
| **Servisné úlohy** | Filter „Servisné“ vs „Všetky“ (len MAINTENANCE) | MAINTENANCE |

---

## 3. Výdavky (Expenses)

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **Manuálny výdavok** | Názov, suma, dátum, poznámka, kategória | `expenses.ts` |
| **Kategórie** | MATERIAL, WORK, OTHER, TRAVEL | `expenses.ts` |
| **Výdavok na cestu (TRAVEL)** | Adresa od–kam, km, sadzba/km, späť | `expenses.ts` |
| **Výpočet km** | Google Directions API (ak je API kľúč) | `mapsDistance.ts` |
| **Dodávateľ** | Názov, IČO | `expenses.ts` |
| **Príloha** | Fotka alebo PDF faktúry | `attachments.ts` |
| **OCR faktúr** | Automatické vyplnenie z fotky/PDF (dodávateľ, suma, dátum, IČO) | `invoiceOCR.ts` |
| **Väzba na fázu** | Voliteľné `phaseId` | MANAGEMENT, BUILD |
| **Väzba na úlohu** | Voliteľné `taskId` | Všetky |

---

## 4. Denník (Construction Diary / Diary)

| Funkcia | Popis | Typ projektu |
|---------|-------|--------------|
| **Stavebný denník** | Denník pre BUILD/MANAGEMENT | MANAGEMENT, BUILD |
| **Denník** | Jednoduchý denník pre TRADE/RESIDENTIAL/MAINTENANCE | TRADE, RESIDENTIAL, MAINTENANCE |
| **Polia zápisu** | Dátum, počasie, pracovníci, popis práce, materiály | Všetky |
| **Popis práce** | Text alebo hlasová nahrávka (hold-to-record) | Všetky |
| **Prílohy** | Fotky, dokumenty | Všetky |
| **Väzba na fázu** | Voliteľné `phaseId` (len BUILD) | MANAGEMENT, BUILD |

---

## 5. Dokumenty projektu

| Funkcia | Popis | Typ projektu |
|---------|-------|--------------|
| **Dokumenty projektu** | Zoznam dokumentov s prílohami | Len MANAGEMENT, BUILD |
| **Typy dokumentov** | plan, permit, contract, report, other | `projectDocuments.ts` |
| **Príloha** | PDF, obrázok – upload do Storage | `attachments.ts` |
| **Väzba na fázu** | Voliteľné `phaseId` | MANAGEMENT, BUILD |

---

## 6. Prílohy (Attachments)

| Funkcia | Popis | Kontext |
|---------|-------|---------|
| **Fotka** | expo-image-picker | Úlohy, výdavky, denník, dokumenty |
| **Dokument** | expo-document-picker | Výdavky, denník, dokumenty |
| **Audio** | expo-av (hlasová nahrávka) | Úlohy, denník |
| **Storage** | Firebase Storage | Všetky prílohy |
| **Metadata** | Firestore (taskId, expenseId, phaseId) | `attachments.ts` |

---

## 7. Equipment (zariadenia) – len MAINTENANCE

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **Zoznam zariadení** | CRUD zariadení s QR kódom | `equipment.ts` |
| **QR kód** | Generovanie a skenovanie QR | `EquipmentQrScreen`, `QrScanScreen` |
| **Fotka zariadenia** | Voliteľná fotka | `equipment.ts` |
| **Archivácia** | Označenie zariadenia ako archivované | `equipment.ts` |
| **Service Rules** | Pravidlá údržby pre zariadenie | `serviceRules.ts` |

---

## 8. Service Rules & Service Tasks – len MAINTENANCE

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **Service Rules** | Interval (týždne/mesiace), checklist | `serviceRules.ts` |
| **Automatické úlohy** | Generovanie servisných úloh podľa `nextDueAt` | `serviceTasks.ts`, `serviceAutoNext.ts` |
| **Filter úloh** | „Servisné úlohy“ vs „Všetky“ | ProjectOverviewScreen |

---

## 9. Fázy (len MANAGEMENT, BUILD)

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **Vytvorenie fázy** | Názov, poradie | `projects.ts` |
| **Úprava fázy** | Zmena názvu, status (active/completed/later) | `projects.ts` |
| **Vymazanie fázy** | Odstránenie fázy (úlohy ostávajú) | `projects.ts` |
| **Pridanie fáz zo šablóny** | Import fáz z katalógu | `addPhasesToProject.ts` |

---

## 10. Doplnkové funkcie (feature flags)

| Funkcia | Popis | Feature flag |
|---------|-------|--------------|
| **Updates (WhatsApp)** | Správy od dodávateľov cez WhatsApp | `whatsappDiaryEnabled` |
| **Dodávatelia (Suppliers)** | Zoznam dodávateľov projektu | `contractorsEnabled` |
| **Zmluvníci (Contractors)** | Zoznam zmluvníkov | `contractorsEnabled` |

---

## 11. Projektové udalosti (Events)

| Funkcia | Popis | Služba |
|---------|-------|--------|
| **História** | Záznamy: task_created, expense_added, diary_added, … | `projectEvents.ts` |
| **Last seen** | Posledné zobrazenie projektu používateľom | `projectEvents.ts` |
| **Nové udalosti** | Počet nových od poslednej návštevy | HomeScreen |

---

## 12. Súhrn podľa typu projektu

| Funkcia | MANAGEMENT/BUILD | TRADE | RESIDENTIAL | MAINTENANCE |
|---------|------------------|-------|-------------|-------------|
| Fázy a úlohy | Áno | Nie (plochý zoznam) | Nie | Nie |
| Denník | Stavebný denník | Denník | Denník | Denník |
| Výdavky + OCR | Áno | Áno | Áno | Áno |
| Dokumenty projektu | Áno | Nie | Nie | Nie |
| Equipment | Nie | Nie | Nie | Áno |
| Service Rules | Nie | Nie | Nie | Áno |
| Hlasová nahrávka pri úlohách | Nie | Áno | Áno | Áno |
| Členovia, zdieľanie | Áno | Áno | Áno | Áno |
| Export CSV | Áno | Áno | Áno | Áno |
| Adresa, počasie | Áno | Áno | Áno | Áno |
| Updates (WhatsApp) | Voliteľné | Voliteľné | Voliteľné | Voliteľné |
| Dodávatelia | Voliteľné | Voliteľné | Voliteľné | Voliteľné |

---

*Posledná aktualizácia: február 2025*
