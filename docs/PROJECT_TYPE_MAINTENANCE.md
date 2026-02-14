# Typ projektu ÚDRŽBA (MAINTENANCE) – detail a flow

## 1. Prehľad

**MAINTENANCE** (Údržba) je typ projektu v aplikácii Staveto určený pre správu údržbových a servisných úloh. Funkčne je **zhodný** s typmi **RESIDENTIAL** a **TRADE** – všetky tri používajú rovnakú logiku (bez fáz, plochý zoznam úloh, denník, hlasová nahrávka).

---

## 2. Identifikácia typu v kóde

| Súbor | Použitie |
|-------|----------|np
| `src/lib/types.ts` | `ProjectType = 'BUILD' \| 'MAINTENANCE' \| 'TRADE' \| 'RESIDENTIAL' \| 'MANAGEMENT'` |
| `src/helpers/role.ts` | MAINTENANCE → rola **SPRÁVCA** (administrator) |
| `src/components/ProjectTypeChip.tsx` | Ikona `construct-outline` |
| `src/screens/HomeScreen.tsx` | Ikona `construct-outline` pre MAINTENANCE/RESIDENTIAL |

---

## 3. Vytvorenie projektu ÚDRŽBA

### 3.1 Onboarding (OnboardingMvpScreen)

- Pri prvom spustení môže používateľ vybrať **Údržba / servis** (`mode === "maintenance"`).
- Táto voľba sa uloží do AsyncStorage ako `pending_onboarding`.
- **Poznámka:** Onboarding momentálne nevytvára projekt automaticky – len ukladá preferovaný mód.

### 3.2 Vytvorenie cez ProjectsScreen

V modálnom okne na vytvorenie projektu **nie je** priamo karta pre typ MAINTENANCE. Dostupné typy sú:

- MANAGEMENT (Vedenie výstavby)
- RESIDENTIAL (Údržba – v UI preložené ako "Maintenance")
- TRADE (Remeslo)

**Technicky:** MAINTENANCE projekt môže vzniknúť, ak:

- Backend alebo iný flow vytvorí projekt s `projectType: "MAINTENANCE"`, alebo
- Typ RESIDENTIAL sa v niektorých častiach mapuje/interpretuje ako MAINTENANCE.

Projekty RESIDENTIAL, TRADE a MAINTENANCE sa vytvárajú **bez šablóny** (`templateId = ""`):

```typescript
// ProjectsScreen.tsx – riadok 222
// RESIDENTIAL, TRADE, MAINTENANCE - bez šablóny
setTemplateId("");
setTemplatePhases([]);
setPhaseCustomizations(new Map());
```

### 3.3 Projekt vo Firestore (projectFactory)

Projekt sa vytvorí s:

- `projectType: "MAINTENANCE"` (alebo iný typ)
- `templateId: ""` (prázdny)
- `ownerId` z `auth.currentUser.uid`
- **Bez fáz a úloh** – bez template sa nekopírujú žiadne fázy ani tasky

---

## 4. Načítanie dát v ProjectOverviewScreen

Pri otvorení projektu typu MAINTENANCE:

```typescript
// projectType === 'MAINTENANCE' → isTradeOrMaintenance = true
const isTradeOrMaintenance = projectType === 'TRADE' || projectType === 'RESIDENTIAL' || projectType === 'MAINTENANCE';
const isBuildProject = projectType === 'BUILD' || projectType === 'MANAGEMENT';
```

### Načítané dáta

| Dátum | Načítava sa? | Poznámka |
|-------|--------------|----------|
| **Fázy** | Nie | `setPhases([])` – prázdne |
| **Úlohy** | Áno | Plochý zoznam cez `tasksService.listTasksByProject()` |
| **Výdavky** | Áno | `expensesService.listExpensesByProject()` |
| **Denník** | Áno | `constructionDiaryService.listDiaryEntries()` |
| **Dokumenty projektu** | Nie | Len pre BUILD/MANAGEMENT (`hasDocuments = isBuildProject`) |
| **Členovia** | Áno | `projectMembersService.listProjectMembers()` |

---

## 5. Úlohy (Tasks)

### 5.1 Štruktúra

- **Bez fáz** – `phaseId: null`
- **Plochý zoznam** – úlohy nie sú zoskupené podľa fáz
- **Poradie** – `order` sa počíta globálne pre všetky úlohy bez phaseId

### 5.2 Vytvorenie úlohy

```typescript
// tasks.ts – createTask
phaseId: opts?.phaseId ?? null,  // null pre TRADE/MAINTENANCE
```

Povinné je jedno z:

- textový popis úlohy (multiline), alebo
- hlasová nahrávka (`"Hlasová nahrávka"` ako štandardný názov)

### 5.3 UI pre pridanie úlohy

- **BUILD:** FAB (plávajúce tlačidlo „+“)
- **MAINTENANCE/TRADE/RESIDENTIAL:** horizontálne tlačidlo „Pridať úlohu“ (text + ikona)

Rozšírené možnosti pri vytváraní úlohy:

1. **Hlasová nahrávka** – nahrávanie cez `expo-av`, uloženie ako audio attachment
2. **Textový popis** – multiline TextInput (4 riadky)

Placeholder: `"Popis úlohy..."` (namiesto `"tasks.taskPlaceholder"` pre BUILD).

### 5.4 Zobrazenie úloh

- Zoznam úloh bez fáz (žiadne accordion fázy)
- Každá úloha: checkbox (status), názov, detail pri kliknutí
- Empty state: „Projekt nemá žiadne úlohy“ + hint „Pridajte úlohy pomocou tlačidla nižšie“

---

## 6. Denník

- Sekcia **„Denník“** (nie „Stavebný denník“)
- Pridávanie zápisov: text alebo hlasová nahrávka
- Polia: dátum, počasie, pracovníci, popis práce, materiály
- Voliteľné prílohy (obrázky)

---

## 7. Výdavky (Expenses)

- Plne podporované – pridávanie, úprava, mazanie
- OCR faktúr – podpora pri fotení/importe faktúr
- Kategórie: WORK, MATERIAL, OTHER
- Voliteľné pole `phaseId` – pre MAINTENANCE typicky `null`

---

## 8. Dokumenty projektu

- **Nie sú k dispozícii** pre MAINTENANCE – `hasDocuments = isBuildProject`
- Sekcia „Dokumenty projektu“ sa nezobrazuje

---

## 9. Adresa a počasie

- Sekcia adresy je zobrazená (ak je zadaná alebo je užívateľ owner)
- Predpoveď počasia – rovnaká ako u ostatných typov projektov

---

## 10. Rola a zobrazenie

| Aspekt | MAINTENANCE |
|--------|-------------|
| Rola (role.ts) | SPRÁVCA (ADMIN) |
| Farba roly | `colors.primary` (oranžová) |
| Ikona projektu | `construct-outline` |
| Label v UI | `projectType.maintenance` → „Údržba“ / „Maintenance“ |

---

## 11. Flow diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ VYTVORENIE PROJEKTU MAINTENANCE                                          │
└─────────────────────────────────────────────────────────────────────────┘
     │
     ├─► ProjectsScreen: výber typu (ak je MAINTENANCE v UI)
     │   alebo iný zdroj (backend, migrácia)
     │
     ├─► projectFactory.createProjectFromTemplate()
     │   • templateId = ""
     │   • projectType = "MAINTENANCE"
     │   • Bez fáz a úloh
     │
     └─► Firestore: projects/{id}
              └─ projectMembers/{ownerId}

┌─────────────────────────────────────────────────────────────────────────┐
│ PREHĽAD PROJEKTU (ProjectOverviewScreen)                                 │
└─────────────────────────────────────────────────────────────────────────┘
     │
     ├─► Načítanie: tasks, expenses, diaryEntries
     │   (phases = [], documents = null)
     │
     ├─► [ÚLOHY]
     │   ├─ Pridanie: textový popis alebo hlasová nahrávka
     │   ├─ Označenie ako DONE / OPEN
     │   └─ Detail úlohy (attachmenty, priradenie)
     │
     ├─► [VÝDAVKY]
     │   ├─ Pridanie manuálne
     │   └─ Foto faktúry → OCR → predvyplnenie
     │
     ├─► [DENNÍK]
     │   └─ Zápisy (text/voice), počasie, pracovníci
     │
     └─► Bottom bar: „Pridať úlohu“ (textové tlačidlo)
```

---

## 12. Súhrn rozdielov oproti BUILD/MANAGEMENT

| Funkcia | BUILD / MANAGEMENT | MAINTENANCE |
|---------|-------------------|-------------|
| Fázy | Áno | Nie |
| Šablóna pri vytvorení | Áno (eu-construction-v1) | Nie |
| Úlohy – fázy | Áno, phaseId | Nie, phaseId = null |
| Pridanie úlohy – hlas | Nie | Áno |
| Pridanie úlohy – multiline text | Nie (1 riadok) | Áno (4 riadky) |
| FAB vs tlačidlo | FAB | Textové tlačidlo |
| Denník | Stavebný denník | Denník |
| Dokumenty projektu | Áno | Nie |
| Výdavky | Áno | Áno |
| Rola | STAVBYVEDÚCI / REMESELNÍK | SPRÁVCA |

---

## 13. Súbory s implementáciou MAINTENANCE

| Súbor | Účel |
|-------|------|
| `src/lib/types.ts` | Definícia ProjectType |
| `src/helpers/role.ts` | Mapovanie MAINTENANCE → SPRÁVCA |
| `src/components/ProjectTypeChip.tsx` | Ikona construct-outline |
| `src/screens/HomeScreen.tsx` | Ikona v dashboarde |
| `src/screens/ProjectsScreen.tsx` | Vytvorenie bez šablóny |
| `src/screens/ProjectOverviewScreen.tsx` | Hlavná logika (úlohy, denník, výdavky) |
| `src/services/projectFactory.ts` | Vytvorenie projektu |
| `src/services/tasks.ts` | Úlohy s phaseId = null |
| `src/services/projects.ts` | Typ projektu v rozhraní |
| `src/i18n/translations.ts` | Preklady "projectType.maintenance", "onboardingMvp.optionMaintenance" |
