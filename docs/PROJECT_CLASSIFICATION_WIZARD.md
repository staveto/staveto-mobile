# Project Classification & Creation Wizard

## Summary

Project creation was redesigned to remove the confusing "Haus" (RESIDENTIAL) type and introduce a clear, future-proof project classification with 3 engine types and 3 optional attribute fields.

## Changes

### Data Model (Firestore)

**New optional fields on `projects` collection:**
- `workType`: `"NEW_BUILD"` | `"RENOVATION"` | `"INSTALLATION"` | `"SERVICE"` (nullable)
- `businessMode`: `"DIRECT"` | `"SUBCONTRACT"` | `"INTERNAL"` (nullable)
- `creationMode`: `"AI"` | `"MANUAL"` | `"TEMPLATE"` (nullable)
- `isTemplate`: `boolean` – when true, project is hidden from normal list

**Default handling:** Existing projects omit these fields; app handles nulls gracefully.

### Engine Types (3 only)

| Engine | Firestore `projectType` | Description |
|--------|-------------------------|-------------|
| Bau (Build) | `BUILD` or `MANAGEMENT` | Phases, schedule, larger projects |
| Aufträge (Trade) | `TRADE` | Quick tasks, expenses, quotes |
| Wartung (Maintenance) | `MAINTENANCE` | Equipment, intervals, service |

### Backward Compatibility

- **RESIDENTIAL** projects remain in Firestore unchanged.
- In UI: RESIDENTIAL projects appear under **Aufträge (TRADE)** filter.
- Legacy badge shown on RESIDENTIAL project cards.
- No destructive migrations.

### New Project Creation (4-step wizard)

1. **Engine** – 3 cards: Bau, Aufträge, Wartung
2. **Work Type** – 4 chips (optional): Neubau, Renovierung, Installation, Service
3. **Business Mode** – 3 chips (optional): Direktkunde, Subauftrag, Intern
4. **Creation Mode** – 3 buttons: Mit KI, Manuell, Aus Vorlage

### Project Actions Menu

- Bearbeiten
- Teilen / Mitglieder (navigate to members screen)
- Duplizieren (duplicate structure; no expenses/time entries)
- Als Vorlage speichern (toggle `isTemplate` flag)
- Archivieren
- Löschen

### Filters

- Type: Alle | Bau | Aufträge | Wartung (RESIDENTIAL removed)
- Ownership: Alle | Meine | Geteilt
- Templates: Projects with `isTemplate=true` are hidden from normal list (no filter yet).

---

## Manual Test Steps

1. **Create each engine project**
   - Create BUILD project → verify it appears and opens
   - Create TRADE project → verify it appears and opens
   - Create MAINTENANCE project → verify it appears and opens

2. **Legacy RESIDENTIAL**
   - If you have an existing RESIDENTIAL project, verify:
     - It appears under "Aufträge" filter
     - Legacy badge is shown on the card
     - Project opens and works normally

3. **Duplicate**
   - Duplicate a project → verify new project is created
   - Verify expenses and time entries are NOT copied

4. **Filters**
   - Switch between Alle | Bau | Aufträge | Wartung
   - Verify counts and displayed projects match

5. **Save as template**
   - Mark project as template → verify it disappears from list
   - Remove from templates → verify it reappears
