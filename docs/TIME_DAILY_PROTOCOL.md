# Time Daily Protocol (Tagesprotokoll)

Daily protocol view for Time Tracking: month calendar with markers on days that have time entries, tap a day to see entries with Start/End location buttons.

## Screenshots

<!-- TODO: Add screenshots -->
- Calendar view with month navigation
- Day detail with entries and location buttons

## Features

- **Month calendar**: 7 columns (Mon–Sun), day cells with markers
- **Day markers**: One dot if day has entries; two dots if > 8h
- **Today highlight**: Subtle background for current day
- **Day detail**: Selected day shows list of entries (project, time range, duration)
- **Location buttons**: "Start location" and "End location" open Apple/Google Maps when `gpsStart`/`gpsEnd` exist
- **Missing GPS**: Disabled button with "Location not recorded" when no coordinates

## Navigation

- **From Time tracking report**: Calendar icon (top right) → Daily protocol
- **From Home**: Time tracking chip → Report → Calendar icon → Daily protocol

## Data

- Uses `listTimeEntriesForMonth(userId, year, month)` → `listTimeEntries` with month boundaries
- One Firestore query per month; results cached in state
- Pull-to-refresh and month change trigger reload

## Firestore Index

The `timeEntries` collection query uses:

- `userId` (==)
- `startedAt` (>=, <=)
- `orderBy("startedAt", "desc")`

If you see a Firestore index error, add a composite index:

- Collection: `timeEntries`
- Fields: `userId` (Ascending), `startedAt` (Descending)

## Access Control

- **MVP**: Only current user's entries
- **Future**: Owner/editor can switch to view a selected member's entries (code structured to accept `userId` parameter)
