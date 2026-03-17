/**
 * Sync manager — downloads and parses the RKN blocked domains dump
 * from GitHub and/or API, stores them in the local database.
 *
 * Implements: delta sync, fallback chain, exponential backoff.
 * Sprint 5 (DEV-S5-03): Bloom Filter rebuild after sync.
 */

import { BloomFilter } from './bloom.js';

const DUMP_URL = 'https://raw.githubusercontent.com/zapret-info/z-i/master/dump.csv';
const API_URL = 'https://reestr.rublacklist.net/api/v3/domains/';

/** Backoff schedule in milliseconds: 1m, 5m, 15m, 1h */
const BACKOFF_STEPS = [60_000, 300_000, 900_000, 3_600_000];

/** Retry alarm name */
const RETRY_ALARM = 'syncRetry';

/** chrome.storage.local key for serialized bloom filter */
const BLOOM_STORAGE_KEY = 'bloomFilter';

export class SyncManager {
  /** @type {import('./db.js').DomainDB} */
  #db;

  /** Current retry attempt index (into BACKOFF_STEPS) */
  #retryCount = 0;

  /** Current backoff in ms */
  #backoffMs = 0;

  /** Whether the last sync ended in error */
  #lastSyncError = false;

  /**
   * @param {import('./db.js').DomainDB} db — initialized DomainDB instance
   */
  constructor(db) {
    this.#db = db;
  }

  // ─── DEV-S3-03: Main entry point with fallback chain ───

  /**
   * Main sync entry point with fallback chain:
   * 1. Delta sync via API rublacklist
   * 2. Full sync via GitHub dump
   * 3. Use cache (do nothing, keep current DB)
   *
   * @returns {Promise<{source: 'api'|'github'|'cache', success: boolean, count: number}>}
   */
  async sync() {
    // Attempt 1: delta sync via API
    try {
      console.log('[rknus] sync(): Attempting delta sync via API...');
      const result = await this.deltaSync();
      this.#resetBackoff();
      this.#lastSyncError = false;
      console.log(`[rknus] sync(): Delta sync succeeded. ${result.count} domains.`);
      return { source: 'api', success: true, count: result.count };
    } catch (err) {
      console.warn('[rknus] sync(): Delta sync failed:', err.message);
    }

    // Attempt 2: full sync via GitHub dump
    try {
      console.log('[rknus] sync(): Falling back to full sync via GitHub...');
      const result = await this.fullSync();
      this.#resetBackoff();
      this.#lastSyncError = false;
      console.log(`[rknus] sync(): Full sync succeeded. ${result.count} domains.`);
      return { source: 'github', success: true, count: result.count };
    } catch (err) {
      console.warn('[rknus] sync(): Full sync failed:', err.message);
    }

    // Attempt 3: use cache — keep current DB, schedule retry
    console.warn('[rknus] sync(): All sources failed. Using cached data.');
    this.#lastSyncError = true;
    this.#scheduleRetry();

    const stats = await this.#db.getStats();
    return { source: 'cache', success: false, count: stats.count };
  }

  // ─── DEV-S3-02: Delta sync ───

  /**
   * Delta sync: fetch only new domains since last sync via API.
   * If no lastSync exists, fetches all domains from the API.
   * Adds new domains to DB without clearing existing data.
   *
   * @returns {Promise<{count: number}>}
   */
  async deltaSync() {
    console.log('[rknus] Starting delta sync...');

    const lastSync = await this.getLastSync();
    let url = API_URL;

    if (lastSync) {
      // Send ?since= with ISO timestamp
      url += `?since=${encodeURIComponent(lastSync)}`;
      console.log(`[rknus] Delta sync since: ${lastSync}`);
    } else {
      console.log('[rknus] No previous sync timestamp, fetching all from API.');
    }

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const domains = await response.json();

    if (!Array.isArray(domains)) {
      throw new Error('API response is not an array');
    }

    console.log(`[rknus] Delta sync: received ${domains.length} domains from API.`);

    // Convert API response (array of domain strings) into records
    const now = new Date().toISOString();
    const records = domains
      .filter(d => typeof d === 'string' && d.includes('.'))
      .map(domain => {
        let normalized = domain.trim().toLowerCase();
        if (normalized.startsWith('*.')) normalized = normalized.slice(2);
        if (normalized.startsWith('www.')) normalized = normalized.slice(4);
        return {
          domain: normalized,
          added_at: now,
          reason: '',
          registry_id: '',
        };
      })
      .filter(r => r.domain && !(/^\d+\.\d+\.\d+\.\d+$/.test(r.domain)));

    // Add to DB without clearing (delta — append only)
    if (records.length > 0) {
      await this.#db.bulkPut(records);
    }

    const timestamp = new Date().toISOString();
    await this.#saveLastSync(timestamp);

    console.log(`[rknus] Delta sync complete. ${records.length} domains added/updated.`);
    return { count: records.length };
  }

  // ─── Full sync (existing, from GitHub CSV dump) ───

  /**
   * Perform a full sync: download the CSV dump, parse it, clear the DB,
   * and write all parsed domains.
   * @returns {Promise<{count: number}>} number of domains written
   */
  async fullSync() {
    console.log('[rknus] Starting full sync...');

    const response = await fetch(DUMP_URL, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch dump: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const records = this.#parseCSV(text);

    console.log(`[rknus] Parsed ${records.length} domains from dump.`);

    await this.#db.clear();
    await this.#db.bulkPut(records);

    const timestamp = new Date().toISOString();
    await this.#saveLastSync(timestamp);

    console.log(`[rknus] Full sync complete. ${records.length} domains stored.`);
    return { count: records.length };
  }

  // ─── DEV-S3-04: Exponential backoff ───

  /**
   * Get the backoff delay in ms for the next retry.
   * @returns {number}
   */
  getNextRetryMs() {
    return this.#backoffMs;
  }

  /**
   * Whether the last sync attempt ended in error.
   * @returns {boolean}
   */
  get lastSyncError() {
    return this.#lastSyncError;
  }

  /**
   * Increase backoff following the schedule: 1m → 5m → 15m → 1h (max).
   * Schedule a chrome.alarms retry with the computed delay.
   */
  #scheduleRetry() {
    const step = Math.min(this.#retryCount, BACKOFF_STEPS.length - 1);
    this.#backoffMs = BACKOFF_STEPS[step];
    this.#retryCount++;

    const delayMinutes = this.#backoffMs / 60_000;
    console.log(`[rknus] Scheduling retry in ${delayMinutes} minutes (attempt ${this.#retryCount}).`);

    // Create a one-shot alarm for the retry
    chrome.alarms.create(RETRY_ALARM, { delayInMinutes: delayMinutes });
  }

  /**
   * Reset backoff counters after a successful sync.
   */
  #resetBackoff() {
    this.#retryCount = 0;
    this.#backoffMs = 0;
    // Clear any pending retry alarm
    chrome.alarms.clear(RETRY_ALARM);
  }

  // ─── CSV parsing ───

  /**
   * Parse the CSV dump into domain records.
   * CSV format per line: IP;domain;URL;organization;date;decision_number
   * @param {string} text — raw CSV text
   * @returns {Array<{domain: string, added_at: string, reason: string, registry_id: string}>}
   */
  #parseCSV(text) {
    const lines = text.split('\n');
    /** @type {Map<string, {domain: string, added_at: string, reason: string, registry_id: string}>} */
    const domainMap = new Map();
    const now = new Date().toISOString();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split(';');
      if (fields.length < 2) continue;

      let domain = (fields[1] || '').trim().toLowerCase();
      if (!domain || domain === 'domain') continue;

      // Strip leading wildcard (*.)
      if (domain.startsWith('*.')) {
        domain = domain.slice(2);
      }

      // Strip leading www.
      if (domain.startsWith('www.')) {
        domain = domain.slice(4);
      }

      // Skip IP-only entries or obviously invalid domains
      if (!domain || /^\d+\.\d+\.\d+\.\d+$/.test(domain)) continue;
      // Must have at least one dot
      if (!domain.includes('.')) continue;

      if (domainMap.has(domain)) continue;

      const registryId = (fields[5] || '').trim();
      const org = (fields[3] || '').trim();
      const date = (fields[4] || '').trim();

      domainMap.set(domain, {
        domain,
        added_at: date || now,
        reason: org || '',
        registry_id: registryId,
      });
    }

    return Array.from(domainMap.values());
  }

  // ─── Storage helpers ───

  /**
   * Save the last sync timestamp to chrome.storage.local.
   * @param {string} timestamp — ISO string
   * @returns {Promise<void>}
   */
  #saveLastSync(timestamp) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ lastSync: timestamp }, resolve);
    });
  }

  /**
   * Get the timestamp of the last successful sync.
   * @returns {Promise<string|null>}
   */
  async getLastSync() {
    return new Promise((resolve) => {
      chrome.storage.local.get('lastSync', (result) => {
        resolve(result.lastSync || null);
      });
    });
  }

  // ─── DEV-S5-03: Bloom Filter support ───

  /**
   * Build a Bloom Filter from all domains currently in the database.
   * Uses db.getAllDomainKeys() to iterate the in-memory Set.
   *
   * @param {import('./db.js').DomainDB} db — initialized DomainDB (defaults to this.#db)
   * @returns {BloomFilter}
   */
  buildBloomFilter(db) {
    const source = db || this.#db;
    const keys = source.getAllDomainKeys();

    const expectedItems = Math.max(keys.length, 1000); // at least 1000 to avoid degenerate filter
    const filter = new BloomFilter(expectedItems, 0.001);

    for (const domain of keys) {
      filter.add(domain);
    }

    console.log(`[rknus] Bloom filter built: ${keys.length} domains, ${filter.size} bytes.`);
    return filter;
  }

  /**
   * Serialize and save the Bloom Filter to chrome.storage.local
   * for fast restoration on SW restart.
   *
   * @param {BloomFilter} bloomFilter
   * @returns {Promise<void>}
   */
  saveBloomFilter(bloomFilter) {
    return new Promise((resolve, reject) => {
      const data = bloomFilter.serialize();
      chrome.storage.local.set({ [BLOOM_STORAGE_KEY]: data }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Failed to save bloom filter: ${chrome.runtime.lastError.message}`));
        } else {
          console.log(`[rknus] Bloom filter saved to storage (${data.bitArray.length} chars base64).`);
          resolve();
        }
      });
    });
  }

  /**
   * Load a previously saved Bloom Filter from chrome.storage.local.
   * Returns null if no saved filter exists.
   *
   * @returns {Promise<BloomFilter|null>}
   */
  loadBloomFilter() {
    return new Promise((resolve) => {
      chrome.storage.local.get(BLOOM_STORAGE_KEY, (result) => {
        const data = result[BLOOM_STORAGE_KEY];
        if (!data || !data.bitArray) {
          resolve(null);
          return;
        }
        try {
          const filter = BloomFilter.deserialize(data);
          console.log(`[rknus] Bloom filter loaded from storage (${filter.size} bytes).`);
          resolve(filter);
        } catch (err) {
          console.warn('[rknus] Failed to deserialize bloom filter:', err.message);
          resolve(null);
        }
      });
    });
  }
}

/** Exported for use in background.js alarm handler */
export const RETRY_ALARM_NAME = RETRY_ALARM;
