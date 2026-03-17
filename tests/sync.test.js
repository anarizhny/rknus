import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomainDB } from '../lib/db.js';
import { SyncManager } from '../lib/sync.js';

// ────────────────────────────────────────────
// QA-S1-05  Unit-тесты sync.js
// QA-S3-01  Delta sync
// QA-S3-02  Fallback chain
// QA-S3-03  Exponential backoff
// QA-S3-04  SW recovery integration
// ────────────────────────────────────────────

// Mock chrome.storage.local (callback-style) + chrome.alarms
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((key, cb) => {
        if (typeof cb === 'function') cb({ ...storageData });
      }),
      set: vi.fn((obj, cb) => {
        Object.assign(storageData, obj);
        if (typeof cb === 'function') cb();
      }),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
};

// Mock global fetch
globalThis.fetch = vi.fn();

describe('SyncManager', () => {
  let db;
  let sync;

  beforeEach(async () => {
    // Reset storage
    for (const k of Object.keys(storageData)) delete storageData[k];
    vi.clearAllMocks();

    db = new DomainDB();
    await db.init();
    await db.clear();
    sync = new SyncManager(db);
  });

  // ── CSV parsing (via fullSync) ────────────
  describe('CSV parsing via fullSync', () => {
    it('parses correct CSV lines into domain records', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;blocked-site.com;https://blocked-site.com;Roskomnadzor;2024-01-15;12345',
        '5.6.7.8;another.ru;https://another.ru;Court;2024-03-20;67890',
      ].join('\n');

      fetch.mockResolvedValueOnce({
        ok: true,
        text: async () => csv,
      });

      const result = await sync.fullSync();
      expect(result.count).toBe(2);
      expect(db.has('blocked-site.com')).toBe(true);
      expect(db.has('another.ru')).toBe(true);
    });

    it('skips lines with empty domain field', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;;https://example.com;Org;2024-01-01;111',
        '5.6.7.8;valid.com;https://valid.com;Org;2024-01-01;222',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(1);
      expect(db.has('valid.com')).toBe(true);
    });

    it('skips malformed lines with fewer than 2 fields', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        'broken-line-no-semicolons',
        '5.6.7.8;good.com;https://good.com;Org;2024-01-01;333',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(1);
      expect(db.has('good.com')).toBe(true);
    });

    it('strips wildcard prefix *.', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;*.wildcard.com;https://wildcard.com;Org;2024-01-01;444',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(1);
      expect(db.has('wildcard.com')).toBe(true);
    });

    it('strips www. prefix', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;www.example.com;https://example.com;Org;2024-01-01;555',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(1);
      expect(db.has('example.com')).toBe(true);
    });

    it('skips IP-only entries', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;5.6.7.8;https://5.6.7.8;Org;2024-01-01;666',
        '1.2.3.4;real-domain.com;https://real-domain.com;Org;2024-01-01;777',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(1);
      expect(db.has('real-domain.com')).toBe(true);
    });

    it('deduplicates domains', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.2.3.4;dupe.com;url1;Org;2024-01-01;111',
        '5.6.7.8;dupe.com;url2;Org;2024-01-02;222',
        '9.0.1.2;unique.com;url3;Org;2024-01-03;333',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.fullSync();
      expect(result.count).toBe(2);
    });
  });

  // ── fullSync ──────────────────────────────
  describe('fullSync', () => {
    it('writes parsed data into the database', async () => {
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.1.1.1;test-domain.com;https://test-domain.com;TestOrg;2024-05-01;999',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      await sync.fullSync();

      const record = await db.lookup('test-domain.com');
      expect(record).not.toBeNull();
      expect(record.domain).toBe('test-domain.com');
      expect(record.reason).toBe('TestOrg');
      expect(record.registry_id).toBe('999');
    });

    it('clears old data before writing new data', async () => {
      // Pre-populate
      await db.bulkPut([
        { domain: 'old.com', added_at: '', reason: '', registry_id: '' },
      ]);
      expect(db.has('old.com')).toBe(true);

      const csv = [
        'ip;domain;url;org;date;decision',
        '1.1.1.1;new.com;https://new.com;Org;2024-01-01;100',
      ].join('\n');

      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      await sync.fullSync();

      expect(db.has('old.com')).toBe(false);
      expect(db.has('new.com')).toBe(true);
    });

    it('saves lastSync timestamp', async () => {
      const csv = 'ip;domain;url;org;date;decision\n1.1.1.1;x.com;u;O;2024-01-01;1\n';
      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      await sync.fullSync();

      expect(storageData.lastSync).toBeDefined();
      // Should be a valid ISO timestamp
      expect(new Date(storageData.lastSync).toISOString()).toBe(storageData.lastSync);
    });

    it('throws on network error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network failure'));
      await expect(sync.fullSync()).rejects.toThrow('Network failure');
    });

    it('throws on non-OK response', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      await expect(sync.fullSync()).rejects.toThrow('Failed to fetch dump: 503');
    });
  });

  // ── getLastSync ───────────────────────────
  describe('getLastSync()', () => {
    it('returns null when never synced', async () => {
      const result = await sync.getLastSync();
      expect(result).toBeNull();
    });

    it('returns the timestamp after a sync', async () => {
      storageData.lastSync = '2024-11-01T12:00:00.000Z';
      const result = await sync.getLastSync();
      expect(result).toBe('2024-11-01T12:00:00.000Z');
    });
  });

  // ────────────────────────────────────────────
  // QA-S3-01  Delta sync
  // ────────────────────────────────────────────
  describe('deltaSync', () => {
    it('fetches with ?since= parameter when lastSync exists', async () => {
      storageData.lastSync = '2024-11-01T12:00:00.000Z';

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['new-domain.com'],
      });

      await sync.deltaSync();

      expect(fetch).toHaveBeenCalledTimes(1);
      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('?since=');
      expect(calledUrl).toContain(encodeURIComponent('2024-11-01T12:00:00.000Z'));
    });

    it('fetches without ?since= when no lastSync', async () => {
      // storageData has no lastSync

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['some-domain.com'],
      });

      await sync.deltaSync();

      const calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('?since=');
    });

    it('parses JSON array of domains and adds to DB without clearing', async () => {
      // Pre-populate DB with existing domain
      await db.bulkPut([
        { domain: 'existing.com', added_at: '2024-01-01', reason: '', registry_id: '' },
      ]);
      expect(db.has('existing.com')).toBe(true);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['new-site.ru', 'another-site.org'],
      });

      const result = await sync.deltaSync();

      // New domains added
      expect(result.count).toBe(2);
      expect(db.has('new-site.ru')).toBe(true);
      expect(db.has('another-site.org')).toBe(true);

      // Old domain still present (no clear)
      expect(db.has('existing.com')).toBe(true);
    });

    it('adds nothing when API returns empty array', async () => {
      await db.bulkPut([
        { domain: 'keep-me.com', added_at: '2024-01-01', reason: '', registry_id: '' },
      ]);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await sync.deltaSync();

      expect(result.count).toBe(0);
      // Existing data untouched
      expect(db.has('keep-me.com')).toBe(true);
    });

    it('updates lastSync after successful delta sync', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['delta.com'],
      });

      await sync.deltaSync();

      expect(storageData.lastSync).toBeDefined();
      expect(new Date(storageData.lastSync).toISOString()).toBe(storageData.lastSync);
    });

    it('strips *. and www. prefixes from delta domains', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['*.wildcard.net', 'www.prefixed.org'],
      });

      const result = await sync.deltaSync();

      expect(result.count).toBe(2);
      expect(db.has('wildcard.net')).toBe(true);
      expect(db.has('prefixed.org')).toBe(true);
    });

    it('skips IP-only entries from delta response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['192.168.1.1', 'valid.com'],
      });

      const result = await sync.deltaSync();

      expect(result.count).toBe(1);
      expect(db.has('valid.com')).toBe(true);
    });

    it('throws on non-OK API response', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(sync.deltaSync()).rejects.toThrow('API request failed: 500');
    });

    it('throws when API response is not an array', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'bad' }),
      });

      await expect(sync.deltaSync()).rejects.toThrow('API response is not an array');
    });
  });

  // ────────────────────────────────────────────
  // QA-S3-02  Fallback chain
  // ────────────────────────────────────────────
  describe('sync() fallback chain', () => {
    it('returns source: "api" when API (deltaSync) succeeds', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['domain-a.com', 'domain-b.ru'],
      });

      const result = await sync.sync();

      expect(result.source).toBe('api');
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('falls back to source: "github" when API fails but GitHub succeeds', async () => {
      // API call fails
      fetch.mockRejectedValueOnce(new Error('API timeout'));

      // GitHub call succeeds
      const csv = [
        'ip;domain;url;org;date;decision',
        '1.1.1.1;github-domain.com;url;Org;2024-01-01;100',
        '2.2.2.2;github-domain2.ru;url;Org;2024-01-01;101',
      ].join('\n');
      fetch.mockResolvedValueOnce({ ok: true, text: async () => csv });

      const result = await sync.sync();

      expect(result.source).toBe('github');
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('falls back to source: "cache" when both API and GitHub fail', async () => {
      // Pre-populate DB to simulate cached data
      await db.bulkPut([
        { domain: 'cached.com', added_at: '2024-01-01', reason: '', registry_id: '' },
        { domain: 'cached2.com', added_at: '2024-01-01', reason: '', registry_id: '' },
      ]);

      // API fails
      fetch.mockRejectedValueOnce(new Error('API down'));
      // GitHub fails
      fetch.mockRejectedValueOnce(new Error('GitHub down'));

      const result = await sync.sync();

      expect(result.source).toBe('cache');
      expect(result.success).toBe(false);
      expect(result.count).toBe(2);
    });

    it('returns { source, success, count } shape on all paths', async () => {
      // Test with API success
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['a.com'],
      });

      const result = await sync.sync();

      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('count');
      expect(typeof result.source).toBe('string');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.count).toBe('number');
    });

    it('cache fallback still has existing data count', async () => {
      // Pre-populate with 3 cached domains
      await db.bulkPut([
        { domain: 'c1.com', added_at: '', reason: '', registry_id: '' },
        { domain: 'c2.com', added_at: '', reason: '', registry_id: '' },
        { domain: 'c3.com', added_at: '', reason: '', registry_id: '' },
      ]);

      // Both fail
      fetch.mockRejectedValueOnce(new Error('fail1'));
      fetch.mockRejectedValueOnce(new Error('fail2'));

      const result = await sync.sync();

      expect(result.source).toBe('cache');
      expect(result.count).toBe(3);
    });
  });

  // ────────────────────────────────────────────
  // QA-S3-03  Exponential backoff
  // ────────────────────────────────────────────
  describe('exponential backoff', () => {
    /**
     * Helper: simulate a full sync failure (both API and GitHub fail).
     * This triggers #scheduleRetry which increments backoff.
     */
    async function failSync() {
      fetch.mockRejectedValueOnce(new Error('API fail'));
      fetch.mockRejectedValueOnce(new Error('GitHub fail'));
      await sync.sync();
    }

    /**
     * Helper: simulate a successful sync (API succeeds).
     * This triggers #resetBackoff.
     */
    async function succeedSync() {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['ok.com'],
      });
      await sync.sync();
    }

    it('sets backoff to 60000ms (1 min) after 1st failure', async () => {
      await failSync();
      expect(sync.getNextRetryMs()).toBe(60_000);
    });

    it('sets backoff to 300000ms (5 min) after 2nd failure', async () => {
      await failSync();
      await failSync();
      expect(sync.getNextRetryMs()).toBe(300_000);
    });

    it('sets backoff to 900000ms (15 min) after 3rd failure', async () => {
      await failSync();
      await failSync();
      await failSync();
      expect(sync.getNextRetryMs()).toBe(900_000);
    });

    it('caps backoff at 3600000ms (1 hour) after 4+ failures', async () => {
      await failSync();
      await failSync();
      await failSync();
      await failSync();
      expect(sync.getNextRetryMs()).toBe(3_600_000);

      // 5th failure — still capped at 1 hour
      await failSync();
      expect(sync.getNextRetryMs()).toBe(3_600_000);
    });

    it('resets backoff to 0 after a successful sync', async () => {
      // Accumulate failures
      await failSync();
      await failSync();
      expect(sync.getNextRetryMs()).toBe(300_000);

      // Succeed
      await succeedSync();
      expect(sync.getNextRetryMs()).toBe(0);
    });

    it('creates a chrome.alarms retry alarm on failure', async () => {
      await failSync();
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'syncRetry',
        { delayInMinutes: 1 }, // 60000ms / 60000 = 1 min
      );
    });

    it('clears retry alarm on success', async () => {
      await failSync();
      await succeedSync();
      expect(chrome.alarms.clear).toHaveBeenCalledWith('syncRetry');
    });

    it('reports lastSyncError=true after failure, false after success', async () => {
      expect(sync.lastSyncError).toBe(false);

      await failSync();
      expect(sync.lastSyncError).toBe(true);

      await succeedSync();
      expect(sync.lastSyncError).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  // QA-S3-04  SW recovery integration test
  // ────────────────────────────────────────────
  describe('SW recovery: DB init → Set loaded → lookup works', () => {
    it('after init, domains from DB are available via has()', async () => {
      // Simulate data that was persisted in IndexedDB before SW was killed
      const freshDb = new DomainDB();
      await freshDb.init();
      await freshDb.bulkPut([
        { domain: 'blocked.ru', added_at: '2024-01-01', reason: 'RKN', registry_id: '123' },
        { domain: 'blocked2.com', added_at: '2024-02-01', reason: 'Court', registry_id: '456' },
      ]);

      // Simulate SW wake-up: create a new DB instance and init
      const recoveredDb = new DomainDB();
      await recoveredDb.init();

      // The in-memory Set should be loaded from IndexedDB
      expect(recoveredDb.has('blocked.ru')).toBe(true);
      expect(recoveredDb.has('blocked2.com')).toBe(true);
      expect(recoveredDb.has('clean-site.com')).toBe(false);
    });

    it('after recovery, lookup returns full record', async () => {
      const freshDb = new DomainDB();
      await freshDb.init();
      await freshDb.bulkPut([
        { domain: 'test-recover.ru', added_at: '2024-06-01', reason: 'TestOrg', registry_id: '789' },
      ]);

      // Simulate SW recovery
      const recoveredDb = new DomainDB();
      await recoveredDb.init();

      const record = await recoveredDb.lookup('test-recover.ru');
      expect(record).not.toBeNull();
      expect(record.domain).toBe('test-recover.ru');
      expect(record.reason).toBe('TestOrg');
      expect(record.registry_id).toBe('789');
    });

    it('SyncManager works with a recovered DB', async () => {
      // Populate data
      const freshDb = new DomainDB();
      await freshDb.init();
      await freshDb.bulkPut([
        { domain: 'persisted.com', added_at: '2024-01-01', reason: '', registry_id: '' },
      ]);

      // Simulate SW recovery
      const recoveredDb = new DomainDB();
      await recoveredDb.init();

      const recoveredSync = new SyncManager(recoveredDb);

      // Delta sync adds new domains on top of recovered data
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ['new-after-recovery.com'],
      });

      await recoveredSync.deltaSync();

      expect(recoveredDb.has('persisted.com')).toBe(true);
      expect(recoveredDb.has('new-after-recovery.com')).toBe(true);
    });
  });
});
