# Time Tracking Test Checklist

## End-to-end manual test steps for iOS + Android

### Prerequisites
- [ ] App built with `npx expo run:android` or `npx expo run:ios` (native modules required for GPS/notifications)
- [ ] User logged in with at least one project (owner or editor)
- [ ] Firestore rules deployed with `timeEntries` and `users.activeTimer` support

---

### 1. Timer FAB (HomeScreen)
- [ ] **Idle:** Timer FAB visible above calendar FAB (right edge), shows clock icon
- [ ] **Active:** When timer running, FAB shows elapsed time (HH:MM) + stop icon
- [ ] **Tap:** Opens QuickTimeModal bottom sheet

### 2. QuickTimeModal – Project picker
- [ ] Search input filters projects by name
- [ ] Recent/filtered projects shown as chips (up to 10)
- [ ] Selecting a project highlights the chip

### 3. QuickTimeModal – Mode toggle
- [ ] Segment control: Timer | Manual
- [ ] Switching modes updates the form

### 4. Timer mode – Start
- [ ] Select project, tap **Start** → timer starts
- [ ] FAB updates to show elapsed time
- [ ] Modal shows "Currently tracking: [Project name]" + elapsed + **Stop** button
- [ ] Location permission denied → timer still starts (no crash)

### 5. Timer mode – Stop
- [ ] Tap **Stop** → time entry saved, modal dismisses, FAB resets
- [ ] Firestore: `timeEntries` has new doc, `users/{uid}.activeTimer` cleared

### 6. Manual mode
- [ ] Select project, choose date, enter hours + minutes, optional note
- [ ] Tap **Save** → entry saved, modal dismisses
- [ ] Firestore: `timeEntries` has doc with `mode: "manual"`, `date: "YYYY-MM-DD"`

### 7. Safety – Auto-stop (12h)
- [ ] Simulate: set device time forward 13h or mock `activeTimer.startedAt` in Firestore
- [ ] Open app → auto-stop runs, alert shown, entry created with `flags.autoStopped: true`

### 8. Safety – Reminders (2h)
- [ ] Start timer, wait 2h (or mock notification trigger)
- [ ] Local notification: "Timer beží – [Project name]"

### 9. Permissions
- [ ] **Owner/editor:** Can create time entries
- [ ] **Viewer:** Gets permission error when trying to start timer or save manual entry

### 10. Offline
- [ ] Disable network, try Start/Stop → user-friendly error (no crash)

---

## Firestore verification

### `users/{uid}`
When timer running:
```json
{
  "activeTimer": {
    "projectId": "...",
    "projectNameSnapshot": "...",
    "startedAt": "2025-03-03T...",
    "source": "home_quick_timer",
    "gpsStart": { "lat": ..., "lng": ..., "accuracyM": ..., "timestamp": "...", "source": "gps" } | null,
    "reminderIds": ["..."]
  }
}
```

### `timeEntries/{id}`
```json
{
  "projectId": "...",
  "projectNameSnapshot": "...",
  "userId": "...",
  "userNameSnapshot": "...",
  "startedAt": "...",
  "endedAt": "...",
  "durationMinutes": 120,
  "mode": "timer" | "manual",
  "date": "YYYY-MM-DD",  // manual only
  "note": "..." | null,
  "gpsStart": {...} | null,
  "gpsEnd": {...} | null,
  "flags": { "autoStopped": true } | null,
  "createdAt": "...",
  "updatedAt": "..."
}
```
