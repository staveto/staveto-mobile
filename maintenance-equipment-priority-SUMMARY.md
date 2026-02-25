# Maintenance Project UI – Equipment-First Refactor

## Summary

Refactored the Maintenance project overview to prioritize equipment over tasks, aligning the UI with the asset-centric mental model.

### Changes

1. **Equipment section (top)**
   - Increased visual prominence: stronger border, shadow, elevation
   - Section title: 22px, fontWeight 800
   - Equipment count in header: `Equipment (N)` (unchanged)

2. **Bottom CTA**
   - Primary button: "+ Add equipment" (was "Add equipment")
   - Icon: `add` instead of `add-circle`
   - Dropdown: Add service plan, Add task (manual) – unchanged

3. **Header**
   - Top-right "+" button remains hidden for MAINTENANCE (unchanged)

4. **Section order**
   - Equipment → Service plans → Open service tasks → Expenses → Diary → Faults (unchanged)

5. **Translations**
   - `projectOverview.addEquipmentCta`: "+ Add equipment" (EN), "+ Pridať zariadenie" (SK)

---

## UX Reasoning (3 bullets)

- **Asset-first mental model:** Maintenance is about managing equipment, not tasks. Putting Equipment first and making "+ Add equipment" the main CTA shifts focus from "project with tasks" to "equipment management."

- **Clear hierarchy:** Equipment at the top and as the primary action, with Service plans and manual tasks in the dropdown, makes the flow obvious: add equipment → add service plans → handle tasks.

- **Reduced friction:** The main action is one tap away. Service plans and manual tasks stay available but secondary, matching how maintenance managers typically work.

---

## Patch

Apply with: `git apply maintenance-equipment-priority.patch`

Files modified: `src/screens/ProjectOverviewScreen.tsx`, `src/i18n/translations.ts`
