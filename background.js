/**
 * Background Service Worker
 * Initializes the domain database, handles tab events,
 * performs domain lookups, and manages badge state.
 *
 * Sprint 3: configurable sync interval, fallback chain,
 * exponential backoff, SW recovery, freshness indicator.
 *
 * Sprint 4: notifications, edge-cases, database management messages.
 *
 * Sprint 5: Bloom Filter integration for memory-efficient lookups.
 *
 * Sprint 6: Content script message handlers (checkCurrentSite, checkDomains).
 */

import { DomainDB } from './lib/db.js';
import { SyncManager, RETRY_ALARM_NAME } from './lib/sync.js';
import { checkDomain } from './lib/lookup.js';
import { extractDomain, normalizeDomain, getDomainLevels } from './lib/normalize.js';

/** @type {DomainDB} */
const db = new DomainDB();

/** @type {SyncManager} */
const syncManager = new SyncManager(db);

/** Tracks whether the DB is initialized and ready */
let isReady = false;

/** @type {import('./lib/bloom.js').BloomFilter|null} */
let bloomFilter = null;

/** Whether Bloom Filter mode is enabled */
let bloomFilterEnabled = false;

/** Sync alarm name */
const SYNC_ALARM = 'syncBase';

/** Default sync interval in minutes (6 hours) */
const DEFAULT_SYNC_INTERVAL_MINUTES = 360;

/** Staleness thresholds in milliseconds */
const FRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000;      // 6 hours
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;      // 24 hours

// --- DEV-S4-02: Notification tracking (per-session) ---

/** @type {Set<string>} Domains already notified in this session */
const notifiedDomains = new Set();

// --- DEV-S4-05: URL classification ---

/**
 * Classify a URL to determine if it's a normal website or a special page.
 * @param {string} url
 * @returns {{type: string, displayName: string, hint: string}|null} — null means normal URL
 */
function classifyUrl(url) {
  if (!url) {
    return { type: 'NO_URL', displayName: '', hint: 'Откройте любой сайт, чтобы проверить его статус' };
  }

  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;

    if (protocol === 'chrome:' || protocol === 'chrome-extension:' || protocol === 'edge:') {
      return {
        type: 'CHROME_INTERNAL',
        displayName: parsed.hostname || url,
        hint: 'Проверка недоступна для внутренних страниц браузера',
      };
    }
    if (protocol === 'about:') {
      return {
        type: 'ABOUT',
        displayName: url === 'about:blank' ? 'Пустая страница' : 'Новая вкладка',
        hint: 'Откройте любой сайт, чтобы проверить его статус',
      };
    }
    if (protocol === 'file:') {
      return {
        type: 'LOCAL_FILE',
        displayName: 'Локальный файл',
        hint: 'Расширение проверяет только интернет-сайты',
      };
    }
    if (protocol === 'data:' || protocol === 'blob:') {
      return {
        type: 'DATA_URI',
        displayName: '',
        hint: 'Откройте любой сайт, чтобы проверить его статус',
      };
    }
    if (protocol === 'devtools:') {
      return {
        type: 'CHROME_INTERNAL',
        displayName: 'DevTools',
        hint: 'Проверка недоступна для внутренних страниц браузера',
      };
    }

    // localhost — not applicable
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      return {
        type: 'LOCALHOST',
        displayName: parsed.hostname,
        hint: 'Проверка недоступна для локальных адресов',
      };
    }

    // IP addresses — check as normal domain (IP may be in the registry)
    // Per spec: "Для IP-адресов — проверять как обычный домен (IP может быть в реестре)"
    // So we return null to let normal flow proceed.

    return null; // normal URL — proceed with lookup
  } catch {
    return { type: 'INVALID', displayName: url, hint: 'Не удалось разобрать адрес страницы' };
  }
}

// --- Badge helpers ---

/**
 * Set the badge to "BAN" (red) for a blocked domain.
 * @param {number} tabId
 */
function setBadgeBanned(tabId) {
  chrome.action.setBadgeText({ text: 'BAN', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#EF4444', tabId });
}

/**
 * Set the badge to "OK" (green) for a clean domain.
 * @param {number} tabId
 */
function setBadgeClean(tabId) {
  chrome.action.setBadgeText({ text: 'OK', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#22C55E', tabId });
}

/**
 * Set the badge to "..." (grey) while loading.
 * @param {number} tabId
 */
function setBadgeLoading(tabId) {
  chrome.action.setBadgeText({ text: '...', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#6B7280', tabId });
}

/**
 * Clear the badge (empty) for special pages.
 * @param {number} tabId
 */
function setBadgeEmpty(tabId) {
  chrome.action.setBadgeText({ text: '', tabId });
}

// --- DEV-S3-01: Configurable sync interval ---

/**
 * Read the sync interval from chrome.storage.sync.
 * Falls back to DEFAULT_SYNC_INTERVAL_MINUTES if not set.
 * @returns {Promise<number>} interval in minutes
 */
function getSyncIntervalMinutes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('syncIntervalMinutes', (result) => {
      resolve(result.syncIntervalMinutes || DEFAULT_SYNC_INTERVAL_MINUTES);
    });
  });
}

// --- DEV-S3-06: Freshness indicator ---

/**
 * Compute the freshness of the database based on last sync timestamp.
 * @param {string|null} lastUpdate — ISO timestamp of last sync
 * @param {boolean} syncError — whether the last sync attempt failed
 * @returns {'fresh'|'stale'|'outdated'|'error'}
 */
function computeFreshness(lastUpdate, syncError) {
  if (syncError) return 'error';
  if (!lastUpdate) return 'outdated';

  const ageMs = Date.now() - new Date(lastUpdate).getTime();

  if (ageMs < FRESH_THRESHOLD_MS) return 'fresh';
  if (ageMs < STALE_THRESHOLD_MS) return 'stale';
  return 'outdated';
}

// --- DEV-S4-02: Notifications ---

/**
 * Read whether notifications are enabled from chrome.storage.sync.
 * @returns {Promise<boolean>}
 */
function getNotificationsEnabled() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ notificationsEnabled: true }, (result) => {
      resolve(result.notificationsEnabled);
    });
  });
}

/**
 * Show a notification for a blocked domain (once per session per domain).
 * @param {string} domain
 */
async function notifyBlocked(domain) {
  // Already notified this session
  if (notifiedDomains.has(domain)) return;

  // Check if notifications are enabled
  const enabled = await getNotificationsEnabled();
  if (!enabled) return;

  notifiedDomains.add(domain);

  chrome.notifications.create(`blocked-${domain}`, {
    type: 'basic',
    iconUrl: 'assets/icon-128.png',
    title: '\u26A0\uFE0F ' + domain + ' заблокирован',
    message: 'Этот сайт находится в реестре РКН',
    priority: 0,
    requireInteraction: false,
  });
}

// --- DEV-S4-02: Notification button handlers ---

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('blocked-')) {
    const domain = notificationId.replace('blocked-', '');
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?domain=' + domain) });
  }
  chrome.notifications.clear(notificationId);
});

// --- DEV-S6: Programmatic content script injection ---

/**
 * Inject content script and CSS into a tab (only for blocked sites).
 * Uses chrome.scripting API instead of declarative content_scripts
 * to avoid requesting <all_urls> permission.
 * @param {number} tabId
 * @param {string} domain — the blocked domain name
 */
async function injectContentScript(tabId, domain) {
  try {
    // Check if content script is enabled in settings
    const { contentScriptEnabled } = await chrome.storage.sync.get({ contentScriptEnabled: true });
    if (!contentScriptEnabled) return;

    // Inject CSS first, then JS
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css'],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });

    console.log(`[rknus] Content script injected into tab ${tabId} for ${domain}`);
  } catch (err) {
    // Expected to fail on chrome:// pages, etc.
    console.debug(`[rknus] Could not inject content script: ${err.message}`);
  }
}

// --- Core logic ---

/**
 * Check the domain for a given tab and update the badge accordingly.
 * DEV-S4-05: uses classifyUrl for edge-cases.
 * @param {number} tabId
 */
async function handleTab(tabId) {
  if (!isReady) {
    setBadgeLoading(tabId);
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';

    // DEV-S4-05: Classify URL for edge-cases
    const classification = classifyUrl(url);
    if (classification) {
      setBadgeEmpty(tabId);
      return;
    }

    // DEV-S5: pass bloomFilter if enabled, otherwise undefined (uses in-memory Set)
    const bf = bloomFilterEnabled ? bloomFilter : undefined;
    const result = await checkDomain(url, db, bf);

    if (result.status === 'not-applicable') {
      setBadgeEmpty(tabId);
    } else if (result.blocked) {
      setBadgeBanned(tabId);
      console.log(`[rknus] BLOCKED: ${result.domain}`);

      // DEV-S4-02: Show notification
      notifyBlocked(result.domain);

      // DEV-S6: Inject content script on blocked sites only
      injectContentScript(tabId, result.domain);
    } else {
      setBadgeClean(tabId);
    }
  } catch (err) {
    console.warn('[rknus] Error checking tab:', err.message);
    setBadgeEmpty(tabId);
  }
}

/**
 * Run the sync (with fallback chain), then log the result.
 * DEV-S5-03: Rebuild Bloom Filter after successful sync if enabled.
 * @returns {Promise<{source: string, success: boolean, count: number}>}
 */
async function runSync() {
  console.log('[rknus] Sync triggered.');
  const result = await syncManager.sync();
  console.log(`[rknus] Sync finished. Source: ${result.source}, success: ${result.success}, count: ${result.count}`);

  // DEV-S5-03: Rebuild bloom filter after successful sync
  if (bloomFilterEnabled && result.success) {
    try {
      bloomFilter = syncManager.buildBloomFilter(db);
      await syncManager.saveBloomFilter(bloomFilter);
      console.log('[rknus] Bloom filter rebuilt and saved after sync.');
    } catch (err) {
      console.warn('[rknus] Failed to rebuild bloom filter after sync:', err.message);
    }
  }

  return result;
}

// --- DEV-S3-05: SW recovery & initialization ---

/**
 * Ensure the sync alarm exists, creating it if needed.
 * Reads the configurable interval from chrome.storage.sync.
 */
async function ensureSyncAlarm() {
  const intervalMinutes = await getSyncIntervalMinutes();

  // If manual (0), remove alarm
  if (intervalMinutes === 0) {
    await chrome.alarms.clear(SYNC_ALARM);
    console.log('[rknus] Sync alarm cleared (manual mode).');
    return;
  }

  const existing = await chrome.alarms.get(SYNC_ALARM);

  if (!existing) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: intervalMinutes });
    console.log(`[rknus] Sync alarm (re)created: every ${intervalMinutes} minutes.`);
  } else {
    console.log(`[rknus] Sync alarm already exists. Next: ${new Date(existing.scheduledTime).toISOString()}`);
  }
}

/**
 * Check if the database is stale (>24h since last sync) and trigger sync if so.
 */
async function checkAndSyncIfStale() {
  const lastSync = await syncManager.getLastSync();

  if (!lastSync) {
    console.log('[rknus] No last sync found, triggering sync...');
    await runSync();
    return;
  }

  const ageMs = Date.now() - new Date(lastSync).getTime();
  if (ageMs > STALE_THRESHOLD_MS) {
    console.log(`[rknus] Database is outdated (${Math.round(ageMs / 3_600_000)}h old). Triggering sync...`);
    await runSync();
  } else {
    console.log(`[rknus] Database is fresh enough (${Math.round(ageMs / 3_600_000)}h old).`);
  }
}

async function initialize() {
  try {
    console.log('[rknus] Initializing database...');
    await db.init();
    isReady = true;

    const stats = await db.getStats();
    console.log(`[rknus] DB ready. ${stats.count} domains loaded. Last update: ${stats.lastUpdate || 'never'}`);

    // DEV-S5: Read bloomFilterEnabled setting
    bloomFilterEnabled = await new Promise((resolve) => {
      chrome.storage.sync.get({ bloomFilterEnabled: false }, (result) => {
        resolve(result.bloomFilterEnabled);
      });
    });
    console.log(`[rknus] Bloom filter mode: ${bloomFilterEnabled ? 'ON' : 'OFF'}`);

    // DEV-S5-03: If bloom mode enabled, try to load saved filter or rebuild
    if (bloomFilterEnabled && stats.count > 0) {
      bloomFilter = await syncManager.loadBloomFilter();
      if (!bloomFilter) {
        console.log('[rknus] No saved bloom filter, rebuilding...');
        bloomFilter = syncManager.buildBloomFilter(db);
        await syncManager.saveBloomFilter(bloomFilter);
      }
    }

    // DEV-S3-05: Ensure alarm exists (re-create if SW was killed)
    await ensureSyncAlarm();

    // If the database is empty, trigger initial sync
    if (stats.count === 0) {
      console.log('[rknus] Database empty, starting initial sync...');
      await runSync();
    } else {
      // DEV-S3-05: Check freshness — if >24h, trigger sync
      await checkAndSyncIfStale();
    }
  } catch (err) {
    console.error('[rknus] Initialization failed:', err.message);
  }
}

// --- Event listeners ---

// Tab navigation completed
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    handleTab(tabId);
  }
});

// Tab switched
chrome.tabs.onActivated.addListener((activeInfo) => {
  handleTab(activeInfo.tabId);
});

// Periodic sync alarm + retry alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    runSync();
  } else if (alarm.name === RETRY_ALARM_NAME) {
    console.log('[rknus] Retry alarm fired.');
    runSync();
  }
});

// DEV-S3-01: React to sync interval changes from settings
// DEV-S5: React to bloomFilterEnabled changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.syncIntervalMinutes) {
    const newInterval = changes.syncIntervalMinutes.newValue || DEFAULT_SYNC_INTERVAL_MINUTES;
    console.log(`[rknus] Sync interval changed to ${newInterval} minutes. Recreating alarm.`);
    if (newInterval === 0) {
      chrome.alarms.clear(SYNC_ALARM);
    } else {
      chrome.alarms.clear(SYNC_ALARM, () => {
        chrome.alarms.create(SYNC_ALARM, { periodInMinutes: newInterval });
      });
    }
  }

  // DEV-S5: Handle bloom filter toggle
  if (area === 'sync' && changes.bloomFilterEnabled) {
    bloomFilterEnabled = changes.bloomFilterEnabled.newValue;
    console.log(`[rknus] Bloom filter mode changed to: ${bloomFilterEnabled ? 'ON' : 'OFF'}`);

    if (bloomFilterEnabled) {
      // Build and save bloom filter
      if (isReady) {
        bloomFilter = syncManager.buildBloomFilter(db);
        await syncManager.saveBloomFilter(bloomFilter);
      }
    } else {
      // Disable bloom filter — fall back to in-memory Set
      bloomFilter = null;
    }
  }
});

// --- Message handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatus') {
    (async () => {
      try {
        // DB not yet initialized
        if (!isReady) {
          sendResponse({
            state: 'loading',
            domain: null,
            details: null,
            stats: { count: 0, lastUpdate: null },
            freshness: 'error',
          });
          return;
        }

        const stats = await db.getStats();

        // DEV-S3-06: Compute freshness
        const freshness = computeFreshness(stats.lastUpdate, syncManager.lastSyncError);

        // DB is empty — first launch or no data
        if (stats.count === 0) {
          sendResponse({ state: 'empty-db', domain: null, details: null, stats, freshness });
          return;
        }

        // Get active tab and check domain
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || '';

        // DEV-S4-05: Check edge-cases
        const classification = classifyUrl(url);
        if (classification) {
          sendResponse({
            state: 'not-applicable',
            type: classification.type,
            domain: classification.displayName,
            hint: classification.hint,
            details: null,
            stats,
            freshness,
          });
          return;
        }

        // DEV-S5: pass bloomFilter if enabled
        const bf = bloomFilterEnabled ? bloomFilter : undefined;
        const result = await checkDomain(url, db, bf);

        if (result.blocked) {
          sendResponse({ state: 'blocked', domain: result.domain, details: result.details, stats, freshness });
        } else {
          sendResponse({ state: 'clean', domain: result.domain || '', details: null, stats, freshness });
        }
      } catch (err) {
        console.error('[rknus] getStatus error:', err.message);
        sendResponse({ state: 'error', domain: null, details: null, stats: { count: 0, lastUpdate: null }, freshness: 'error' });
      }
    })();
    return true; // async response
  }

  if (message.type === 'syncNow') {
    (async () => {
      try {
        const result = await syncManager.sync();
        const stats = await db.getStats();
        const freshness = computeFreshness(stats.lastUpdate, syncManager.lastSyncError);
        sendResponse({ success: result.success, source: result.source, stats, freshness });
      } catch (err) {
        console.error('[rknus] syncNow error:', err.message);
        sendResponse({ success: false, error: err.message, freshness: 'error' });
      }
    })();
    return true; // async response
  }

  // --- DEV-S4-01: Database management messages ---

  if (message.type === 'clearDb') {
    (async () => {
      try {
        await db.clear();
        sendResponse({ success: true });
      } catch (err) {
        console.error('[rknus] clearDb error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'exportDb') {
    (async () => {
      try {
        const data = await db.getAll();
        sendResponse({ success: true, data });
      } catch (err) {
        console.error('[rknus] exportDb error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'importDb') {
    (async () => {
      try {
        const data = message.data;
        if (!Array.isArray(data)) {
          sendResponse({ success: false, error: 'Invalid data format: expected array' });
          return;
        }
        await db.bulkPut(data);
        sendResponse({ success: true });
      } catch (err) {
        console.error('[rknus] importDb error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // --- DEV-S6-06: Content script message handlers ---

  if (message.type === 'checkCurrentSite') {
    (async () => {
      try {
        if (!isReady || !sender.tab || !sender.tab.url) {
          sendResponse({ blocked: false, domain: null, details: null });
          return;
        }

        const bf = bloomFilterEnabled ? bloomFilter : undefined;
        const result = await checkDomain(sender.tab.url, db, bf);

        sendResponse({
          blocked: result.blocked,
          domain: result.domain,
          details: result.details,
        });
      } catch (err) {
        console.warn('[rknus] checkCurrentSite error:', err.message);
        sendResponse({ blocked: false, domain: null, details: null });
      }
    })();
    return true;
  }

  if (message.type === 'checkDomains') {
    (async () => {
      try {
        const domains = message.domains;
        if (!Array.isArray(domains) || !isReady) {
          sendResponse({});
          return;
        }

        /** @type {Object<string, boolean>} */
        const results = {};

        for (const domain of domains) {
          const normalized = normalizeDomain(domain);
          if (!normalized) {
            results[domain] = false;
            continue;
          }

          // Check all domain levels (sub.example.com -> example.com)
          const levels = getDomainLevels(normalized);
          let found = false;

          if (bloomFilterEnabled && bloomFilter) {
            for (const level of levels) {
              if (bloomFilter.has(level)) {
                const details = await db.lookup(level);
                if (details) {
                  found = true;
                  break;
                }
              }
            }
          } else {
            for (const level of levels) {
              if (db.has(level)) {
                found = true;
                break;
              }
            }
          }

          results[domain] = found;
        }

        sendResponse(results);
      } catch (err) {
        console.warn('[rknus] checkDomains error:', err.message);
        sendResponse({});
      }
    })();
    return true;
  }
});

// Start
initialize();
console.log('[rknus] Background service worker started.');
