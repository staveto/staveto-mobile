# Maintenance UI Refactor – Summary & UX Reasoning

## Summary

Refactored the Maintenance project overview to prioritize equipment over tasks, aligning the UI with the asset-centric mental model.

### Changes

1. **Equipment section (top, emphasized)**
   - At top of scroll content (unchanged position)
   - Equipment count in header: "Equipment (N)"
   - Prominent primary "Add equipment" button in section header
   - Card-style layout with border and background

2. **Service plans section (new)**
   - New section between Equipment and Open service tasks
   - Shows service plans count
   - Tappable row → navigates to Equipment list with service rule modal

3. **Section order**
   - Equipment
   - Service plans
   - Open service tasks
   - Expenses
   - Diary
   - Faults

4. **Bottom CTA**
   - Label changed from "New task" to "Add equipment"
   - Dropdown options reordered: Add equipment, Add service plan, Add task (manual)

5. **Tasks section**
   - Renamed to "Open service tasks" for MAINTENANCE

6. **Top-right "+"**
   - No change (header add icon is for members, not tasks)

---

## UX Reasoning (3 bullets)

- **Asset-first mental model:** Maintenance is about managing equipment; tasks are outcomes of service plans. Putting Equipment first and making "Add equipment" the primary CTA reinforces that the main job is to register and maintain assets, not to create ad-hoc tasks.

- **Clear hierarchy:** Equipment → Service plans → Tasks reflects the flow: add equipment, define schedules, then work through generated tasks. Manual tasks stay available but are secondary, reducing confusion for asset managers.

- **Reduced cognitive load:** One primary action ("Add equipment") instead of "New task" avoids the wrong default. The dropdown keeps Add service plan and Add task accessible without competing for attention.

---

## Patch

Apply with: `git apply maintenance-ui-refactor.patch`

File modified: `src/screens/ProjectOverviewScreen.tsx`
