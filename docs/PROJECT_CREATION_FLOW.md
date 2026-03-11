# Flow vytvárania projektu (Mobile)

## Spustenie

1. Používateľ klikne **+ Neues Projekt** (FAB) na ProjectsScreen.
2. Otvorí sa modal „Neues Projekt“.
3. `newStep = 1` → zobrazí sa **CreateProjectWizard**.

---

## KROK 1: CreateProjectWizard (4 vnútorné kroky)

Wizard má vlastné kroky a vlastné tlačidlá Zurück / Weiter.

### Step 1 – Engine (povinné)

- **3 karty:** Bau / Aufträge / Wartung
- **Povinné:** engineType
- Ak nie je vybraté → Weiter disabled
- **Akcia:** `setEngineType(type)`

### Step 2 – Work Type (voliteľné)

- **4 chips:** Neubau / Renovierung / Installation/Montage / Service/Reparatur
- **Voliteľné:** workType
- Toggle logika: druhý klik zruší výber
- Weiter je vždy enabled

### Step 3 – Business Mode (voliteľné)

- **3 chips:** Direktkunde / Subauftrag / Intern
- **Voliteľné:** businessMode
- Toggle logika
- Weiter je vždy enabled

### Step 4 – Creation Mode (povinné)

- **3 tlačidlá:** Mit KI / Manuell / Aus Vorlage
- **Povinné:** creationMode
- Ak nie je vybraté → Weiter disabled
- **Akcia:** `setCreationMode(mode)`

### Dokončenie wizardu

Po stlačení Weiter v Step 4 sa volá `onComplete(wizardResult)`.

V **handleWizardComplete** (ProjectsScreen):

- uloží `wizardResult`
- nastaví `selectedType = engineType` (BUILD/TRADE/MAINTENANCE)
- nastaví `creationMethod`:
  - ak `creationMode === "TEMPLATE"` a `engineType === "BUILD"` → `"template"`
  - ak `creationMode === "MANUAL"` → `"empty"`
  - inak (AI) → zatiaľ `"empty"` (len sa uloží do projektu ako meta)
- nastaví `newStep = 2`

---

## KROK 2: Detaily projektu (`newStep = 2`)

UI sa rozvetvuje podľa `selectedType`.

### A) MAINTENANCE

- Názov skupiny (povinné)
- Standort / base location
- Notiz (voliteľné)

### B) BUILD / TRADE

- Názov projektu (povinné)
- Krajina (chips)
- Mesto
- Adresa

### C) Iba pre BUILD

- Sekcia: „Wie möchtest du starten?“
  - **Empfohlene Vorlage** → `creationMethod = "template"`
  - **Leeres Projekt** → `creationMethod = "empty"`

### Logika šablóny (BUILD + template)

Ak `selectedType === "BUILD"` a `creationMethod === "template"`:

- spustí sa `loadDefaultTemplatePhases()`
- používa sa `DEFAULT_TEMPLATE_ID = "eu-construction-v1"`
- načíta fázy z `catalogTemplates/eu-construction-v1/phases`
- vytvorí `phaseCustomizations`: default všetky enabled=true, status `"active"`

### Validácia v kroku 2

- `newName.trim()` musí byť neprázdny
- ak `loadingPhases` → Weiter disabled
- **Tlačidlá:** Zurück | Weiter → `newStep = 3`

---

## KROK 3: Zhrnutie (`newStep = 3`)

- Zobrazí sa súhrn: názov, typ, spôsob vytvorenia, adresa/lokácia
- **Tlačidlá:** Zurück | **Projekt erstellen** → volá `onCreate()`

---

## onCreate(): vytvorenie projektu vo Firestore

### 1) Validácia

- `orgId` musí byť nastavené
- `selectedType` musí byť nastavený
- `newName.trim()` nesmie byť prázdne

### 2) Rozhodnutie o template

- `shouldUseTemplate` je true len ak:
  - `selectedType === "BUILD"` a `creationMethod === "template"`
- `finalTemplateId = shouldUseTemplate ? "eu-construction-v1" : ""`

### 3) Príprava parametrov

- **addressText:** pre MAINTENANCE = baseLocation + "\n" + note; inak adresa
- **countryCode, city:** pre MAINTENANCE sa neposielajú
- **phaseCustomizations:** len ak `shouldUseTemplate` a customizácie existujú
- **Meta z wizardu:** workType, businessMode, creationMode

### 4) Volanie projectFactory

`projectFactory.createProjectFromTemplate({ projectType, templateId, name, addressText, countryCode, city, phaseCustomizations, workType, businessMode, creationMode })`

### 5) Po úspechu

- `closeNewModal()` + reset state
- `load()` refresh zoznamu
- Analytics + paywall flow

---

## Server-side: projectFactory.instantiateTemplate()

1. **Auth:** berie `auth.currentUser.uid` ako ownerId (nepreposiela sa z klienta)
2. **Načítanie template:** ak `templateId !== ""` → načíta phases a tasks; pri chybe pokračuje s prázdnou štruktúrou (okrem permission-denied)
3. **Vytvorenie projektu:** `setDoc(projectRef, projectData)`
4. **Vytvorenie člena:** batch zapíše `members/{ownerId}`
5. **Notifikácia:** `createProjectCreatedNotification`
6. **Zápis fáz + úloh:** ak template → batch vytvorí fázy a úlohy podľa phaseCustomizations; status úloh podľa phase status (active/later/completed → OPEN/DONE…)

---

## Zjednodušená schéma

```
Wizard vyberie 3 veci:
├── Engine (Bau/Aufträge/Wartung) → určuje projectType
├── Meta (workType + businessMode) → doplnkové tagy, neprepínajú UI modul
└── Creation (AI/Manual/Template) → určí či sa kopíruje šablóna

Potom: detailné údaje (názov + adresa) → create → project doc + owner member + optional template phases/tasks
```

---

## Kľúčové pravidlá

- `creationMode === AI` sa zatiaľ používa len ako meta (žiadna extra logika)
- Template sa reálne používa len pre BUILD
- `ownerId` je vždy z auth
- Projekty sú filtrované v UI podľa projectType (Bau vs Aufträge vs Wartung)
- RESIDENTIAL je legacy a správa sa ako TRADE

---

## Edge cases

| Situácia | Správanie |
|----------|-----------|
| User zruší modal v kroku 1 | `closeNewModal()` resetuje všetok state (selectedType, wizardResult, newStep, newName, …) |
| User zruší modal v kroku 2 | Rovnako – full reset |
| User stlačí Zurück v kroku 2 | `newStep = 1`, `selectedType = null`, `wizardResult = null` – vracia sa na wizard |
| User stlačí Zurück v kroku 3 | `newStep = 2` – vracia sa na detaily |
| `loadingPhases` beží | Weiter disabled, aby sa nepreskočil krok |
| Template load zlyhá | Projekt sa vytvorí bez fáz/úloh (fallback v projectFactory) |
| `orgId` je prázdne | `onCreate` zobrazí chybu „not signed in“ |
| Route param `openNew=true` | useFocusEffect otvorí modal a resetne state |
| User vyberie BUILD + MANUAL | `creationMethod = "empty"`, `finalTemplateId = ""` |
| User vyberie TRADE + TEMPLATE | `creationMethod = "empty"` (template sa nepoužíva pre TRADE) |
