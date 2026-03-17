# Sprint 3 — Test Plan: Sync, Fallback, Backoff, SW Recovery

## Prerequisites
- Chrome (or Chromium-based browser) with developer mode enabled
- Extension loaded unpacked from project directory
- DevTools console open (background service worker)
- Network tab open to observe requests

---

## 1. Delta Sync

### 1.1 Automatic delta sync on timer
- [ ] Install extension, wait for initial full sync to complete (check console)
- [ ] Wait for the next alarm cycle (or manually trigger via console: `syncManager.sync()`)
- [ ] Verify in Network tab: request to `reestr.rublacklist.net/api/v3/domains/?since=<timestamp>`
- [ ] Verify console log: "Delta sync succeeded. N domains."
- [ ] Verify badge still works correctly on blocked/clean domains

### 1.2 Delta sync with no previous timestamp
- [ ] Clear `chrome.storage.local` via console: `chrome.storage.local.clear()`
- [ ] Trigger sync manually
- [ ] Verify: API request WITHOUT `?since=` parameter
- [ ] Verify: full domain list fetched from API

### 1.3 Delta sync merges with existing data
- [ ] Navigate to a known blocked domain, confirm badge shows "BAN"
- [ ] Trigger delta sync
- [ ] Verify: previously blocked domain still shows "BAN" (not cleared)
- [ ] Verify: new domains from delta are also detected

---

## 2. Fallback Chain

### 2.1 API OK (normal path)
- [ ] Ensure network is working
- [ ] Trigger sync
- [ ] Console should show: "Delta sync succeeded" with source: 'api'

### 2.2 API fail, GitHub OK
- [ ] Block API domain via hosts file or DevTools network throttling (block `reestr.rublacklist.net`)
- [ ] Trigger sync
- [ ] Console: "Delta sync failed" then "Full sync succeeded" with source: 'github'
- [ ] Badge still works correctly after GitHub sync

### 2.3 Both fail, use cache
- [ ] Block both `reestr.rublacklist.net` and `raw.githubusercontent.com`
- [ ] Trigger sync
- [ ] Console: "All sources failed. Using cached data."
- [ ] Existing badge states should still work (cached DB is intact)
- [ ] Retry alarm should be scheduled (check `chrome.alarms.getAll()` in console)

### 2.4 Recovery after cache fallback
- [ ] Unblock network
- [ ] Wait for retry alarm to fire (or manually trigger)
- [ ] Verify sync succeeds and source is 'api' or 'github'
- [ ] Verify retry alarm is cleared

---

## 3. Exponential Backoff

### 3.1 Backoff schedule
- [ ] Block all sync sources
- [ ] Trigger sync repeatedly, check console for retry intervals:
  - 1st failure: retry in 1 minute
  - 2nd failure: retry in 5 minutes
  - 3rd failure: retry in 15 minutes
  - 4th+ failure: retry in 60 minutes (max)

### 3.2 Backoff reset on success
- [ ] After accumulating failures, unblock network
- [ ] Let retry succeed
- [ ] Verify next failure starts again from 1 minute (schedule reset)

### 3.3 Alarm verification
- [ ] After a failure, run `chrome.alarms.getAll()` in console
- [ ] Verify 'syncRetry' alarm exists with correct delay
- [ ] After success, verify 'syncRetry' alarm is gone

---

## 4. Service Worker Recovery

### 4.1 SW killed and restarted
- [ ] Load extension, verify initial sync completes
- [ ] Navigate to a blocked domain, confirm "BAN" badge
- [ ] Kill SW: go to `chrome://serviceworker-internals/`, find extension, click "Stop"
- [ ] Navigate to a new tab with a blocked domain
- [ ] Verify: SW restarts, DB re-initializes from IndexedDB, badge shows "BAN"

### 4.2 SW recovery re-creates sync alarm
- [ ] After SW restart, run `chrome.alarms.getAll()` in console
- [ ] Verify 'syncBase' alarm exists
- [ ] Verify periodic sync continues working

### 4.3 SW recovery triggers sync if stale
- [ ] Kill SW
- [ ] Manually set lastSync to 25 hours ago via console:
  ```
  chrome.storage.local.set({ lastSync: new Date(Date.now() - 25*60*60*1000).toISOString() })
  ```
- [ ] Navigate to trigger SW restart
- [ ] Verify: console shows "Database is outdated... Triggering sync..."

---

## 5. Freshness Indicator

### 5.1 Fresh state (< 6 hours)
- [ ] Complete a successful sync
- [ ] Open popup immediately
- [ ] Verify freshness indicator shows "fresh" / green state

### 5.2 Stale state (6-24 hours)
- [ ] Set lastSync to 12 hours ago via console
- [ ] Open popup
- [ ] Verify freshness shows "stale" / yellow state

### 5.3 Outdated state (> 24 hours)
- [ ] Set lastSync to 30 hours ago via console
- [ ] Open popup
- [ ] Verify freshness shows "outdated" / red state

### 5.4 Error state
- [ ] Block all sync sources
- [ ] Trigger sync (all fail)
- [ ] Open popup
- [ ] Verify freshness shows "error"

---

## 6. Manual Sync (via popup)

- [ ] Open popup, click "Update" button
- [ ] Verify popup shows loading state during sync
- [ ] Verify popup updates to show new stats and freshness after sync completes
- [ ] Verify console shows sync result with source

---

## 7. Configurable Sync Interval

- [ ] Open options page (or use console): `chrome.storage.sync.set({ syncIntervalMinutes: 60 })`
- [ ] Verify console: "Sync interval changed to 60 minutes. Recreating alarm."
- [ ] Verify `chrome.alarms.getAll()` shows 'syncBase' with 60-minute period
- [ ] Reset: `chrome.storage.sync.set({ syncIntervalMinutes: 360 })`
