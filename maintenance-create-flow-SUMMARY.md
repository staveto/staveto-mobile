# Maintenance Project Creation – Summary & Test Steps

## Summary

The Create Project flow is updated so that when **Maintenance** is selected, the UI focuses on asset management instead of construction/job-style fields.

### Changes

1. **Header & subtitle (step 1)**  
   - When `projectType === MAINTENANCE`:  
     - Header: "New maintenance group"  
     - Subtitle: "Manage your tools, vehicles and machines in one place."

2. **Form fields (step 2)**  
   - **MAINTENANCE**: Country/City/Address replaced with:
     - Group name (required) – placeholder: "e.g. Company fleet, Workshop tools"
     - Base location (optional) – placeholder: "e.g. Bratislava workshop"
     - Note/description (optional) – multiline
   - **Build/Home/Jobs**: Unchanged (Name, Country, City, Address)

3. **"This project will include"**  
   - **MAINTENANCE**: Equipment list, Service schedules, Maintenance history, Costs  
   - **Build/Home/Jobs**: Unchanged (Tasks, Expenses, Diary, etc.)

4. **Backend**  
   - Still creates `ProjectDoc` with `projectType: "MAINTENANCE"`.  
   - For MAINTENANCE: `addressText` = base location + note (joined by newline); `countryCode` and `city` are not set.

5. **Summary step (step 3)**  
   - MAINTENANCE: Shows Group name, Base location, Note with correct labels.

---

## Test Steps

### Maintenance flow

1. Open Projects tab → tap "New project".
2. Select **Maintenance** (bottom card).
3. **Step 1**: Confirm header "New maintenance group" and subtitle "Manage your tools, vehicles and machines in one place."
4. Tap **Continue**.
5. **Step 2**: Confirm fields:
   - Group name * (required)
   - Base location (optional)
   - Note (optional)
6. Confirm "This project will include": Equipment, Service schedules, Maintenance history, Costs.
7. Enter group name (e.g. "Company fleet"), optionally base location and note.
8. Tap **Continue**.
9. **Step 3**: Confirm summary shows Group name, Base location, Note.
10. Tap **Create project**.
11. Confirm project is created and appears in the list.

### Build/Home/Jobs unchanged

1. Open Projects tab → tap "New project".
2. Select **Build** (or Home/Jobs).
3. **Step 2**: Confirm fields are still Name, Country, City, Address.
4. Confirm "This project will include" shows Tasks, Expenses, Diary, Phases, Documents (for Build).
5. Create project and confirm it works as before.

### Validation

- Try creating a Maintenance project with empty group name → error "Enter a group name".
- Create with only group name (no base location, no note) → should succeed.

---

## Patch

Apply with: `git apply maintenance-create-flow-improved.patch`

Files modified: `src/screens/ProjectsScreen.tsx`, `src/i18n/translations.ts`
