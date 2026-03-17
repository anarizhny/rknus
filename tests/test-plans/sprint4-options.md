# Sprint 4 — Manual Test Plan: Options Page & Notifications

## Prerequisites
- Extension installed in Chrome (developer mode, Load unpacked)
- Database synced (at least one sync completed)

---

## 1. Page opens correctly
- [ ] Navigate to `chrome-extension://<id>/options/options.html`
- [ ] Page renders without errors (check DevTools console)
- [ ] All UI sections visible: Data Source, Sync Interval, Notifications, Theme, Database Management

## 2. Settings save and restore on reload
- [ ] Change Data Source radio to "Custom URL" -> reload page -> radio is still "Custom URL"
- [ ] Change Sync Interval to "12 hours" -> reload page -> select shows "12 hours"
- [ ] Toggle Notifications OFF -> reload page -> toggle is still OFF
- [ ] Change Theme to "Dark" -> reload page -> radio is "Dark" and theme is dark
- [ ] Toggle Bloom Filter ON -> reload page -> toggle is still ON
- [ ] Enter custom URL -> reload page -> URL is preserved

## 3. Theme switching applies instantly
- [ ] Select "Dark" theme -> page immediately switches to dark colors (no reload needed)
- [ ] Select "Light" theme -> page immediately switches to light colors
- [ ] Select "System" theme -> page follows OS preference (if OS is dark -> dark, etc.)

## 4. Custom URL field visibility
- [ ] When Data Source is "GitHub" -> Custom URL input is hidden
- [ ] When Data Source is "API" -> Custom URL input is hidden
- [ ] When Data Source is "Custom URL" -> Custom URL input is visible
- [ ] Switch from "Custom URL" back to "GitHub" -> Custom URL input hides again

## 5. Sync Now button
- [ ] Click "Sync Now" -> button text changes to "Updating..." and button is disabled
- [ ] After sync completes -> button re-enables, text reverts to "Sync Now"
- [ ] Toast message "Sync complete" appears
- [ ] Database status line updates with new count and timestamp

## 6. Clear Database button with confirm dialog
- [ ] Click "Clear Database" -> browser confirm() dialog appears
- [ ] Click "Cancel" in confirm -> nothing happens, data preserved
- [ ] Click "OK" in confirm -> database is cleared
- [ ] Toast message "Database cleared" appears
- [ ] Database status shows "0 domains"

## 7. Export downloads JSON
- [ ] Click "Export" -> browser downloads a .json file
- [ ] File name format: `rknus-export-YYYY-MM-DD.json`
- [ ] File content is a JSON array of domain records
- [ ] Each record has: domain, added_at, reason, registry_id

## 8. Import loads JSON
- [ ] Click "Import" -> file picker dialog opens
- [ ] Select a valid exported JSON file -> toast "Import complete"
- [ ] Database status updates with new count
- [ ] Invalid file (not JSON) -> toast "Import error: invalid file format"
- [ ] JSON that is not an array -> toast "Import error: invalid file format"

## 9. Notifications on blocked site visit
- [ ] Enable notifications in settings
- [ ] Navigate to a blocked domain -> Chrome notification appears with domain name
- [ ] Notification shows only once per domain per session (visit same domain again -> no second notification)
- [ ] Disable notifications in settings -> navigate to blocked domain -> no notification
- [ ] Click on notification -> opens popup page for that domain

---

## Summary
| # | Area                    | Pass | Fail | Notes |
|---|-------------------------|------|------|-------|
| 1 | Page opens              |      |      |       |
| 2 | Save / restore          |      |      |       |
| 3 | Theme instant switch    |      |      |       |
| 4 | Custom URL visibility   |      |      |       |
| 5 | Sync Now button         |      |      |       |
| 6 | Clear DB + confirm      |      |      |       |
| 7 | Export JSON             |      |      |       |
| 8 | Import JSON             |      |      |       |
| 9 | Notifications           |      |      |       |
