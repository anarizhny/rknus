import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomainDB } from '../lib/db.js';

// ────────────────────────────────────────────
// QA-S1-03  Unit-тесты db.js
// ────────────────────────────────────────────

// Mock chrome.storage.local used by getStats -> #getLastUpdate
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((key, cb) => {
        if (typeof cb === 'function') {
          cb(storageData);
        }
      }),
      set: vi.fn((obj, cb) => {
        Object.assign(storageData, obj);
        if (typeof cb === 'function') cb();
      }),
    },
  },
};

describe('DomainDB', () => {
  let db;

  beforeEach(async () => {
    // Clear storage mock data
    for (const k of Object.keys(storageData)) delete storageData[k];
    // Fresh DB instance for each test
    db = new DomainDB();
    await db.init();
    await db.clear();
  });

  // ── init ──────────────────────────────────
  describe('init()', () => {
    it('creates the database successfully', async () => {
      const freshDb = new DomainDB();
      await expect(freshDb.init()).resolves.toBeUndefined();
    });

    it('is idempotent — second init does not throw', async () => {
      const freshDb = new DomainDB();
      await freshDb.init();
      await expect(freshDb.init()).resolves.toBeUndefined();
    });
  });

  // ── bulkPut ───────────────────────────────
  describe('bulkPut()', () => {
    it('writes a batch of records', async () => {
      const records = [
        { domain: 'blocked1.com', added_at: '2024-01-01', reason: 'test', registry_id: '1' },
        { domain: 'blocked2.com', added_at: '2024-01-01', reason: 'test', registry_id: '2' },
      ];
      await db.bulkPut(records);

      expect(db.has('blocked1.com')).toBe(true);
      expect(db.has('blocked2.com')).toBe(true);
    });

    it('records are persisted in IndexedDB', async () => {
      const records = [
        { domain: 'persisted.com', added_at: '2024-01-01', reason: 'test', registry_id: '3' },
      ];
      await db.bulkPut(records);

      const result = await db.lookup('persisted.com');
      expect(result).not.toBeNull();
      expect(result.domain).toBe('persisted.com');
    });

    it('handles empty array gracefully', async () => {
      await expect(db.bulkPut([])).resolves.toBeUndefined();
    });

    it('handles null gracefully', async () => {
      await expect(db.bulkPut(null)).resolves.toBeUndefined();
    });
  });

  // ── has ────────────────────────────────────
  describe('has()', () => {
    it('returns true for a domain in the set', async () => {
      await db.bulkPut([
        { domain: 'example.com', added_at: '2024-01-01', reason: '', registry_id: '' },
      ]);
      expect(db.has('example.com')).toBe(true);
    });

    it('returns false for a domain not in the set', () => {
      expect(db.has('not-here.com')).toBe(false);
    });
  });

  // ── lookup ─────────────────────────────────
  describe('lookup()', () => {
    it('returns the record when found', async () => {
      await db.bulkPut([
        { domain: 'found.com', added_at: '2024-06-15', reason: 'spam', registry_id: '42' },
      ]);
      const result = await db.lookup('found.com');
      expect(result).toEqual({
        domain: 'found.com',
        added_at: '2024-06-15',
        reason: 'spam',
        registry_id: '42',
      });
    });

    it('returns null when not found', async () => {
      const result = await db.lookup('missing.com');
      expect(result).toBeNull();
    });
  });

  // ── getDetails ─────────────────────────────
  describe('getDetails()', () => {
    it('returns the full record (alias for lookup)', async () => {
      await db.bulkPut([
        { domain: 'detail.com', added_at: '2024-03-01', reason: 'court order', registry_id: '99' },
      ]);
      const details = await db.getDetails('detail.com');
      expect(details).toEqual({
        domain: 'detail.com',
        added_at: '2024-03-01',
        reason: 'court order',
        registry_id: '99',
      });
    });

    it('returns null for unknown domain', async () => {
      const details = await db.getDetails('unknown.com');
      expect(details).toBeNull();
    });
  });

  // ── clear ──────────────────────────────────
  describe('clear()', () => {
    it('removes all records from DB and Set', async () => {
      await db.bulkPut([
        { domain: 'a.com', added_at: '', reason: '', registry_id: '' },
        { domain: 'b.com', added_at: '', reason: '', registry_id: '' },
      ]);
      expect(db.has('a.com')).toBe(true);

      await db.clear();

      expect(db.has('a.com')).toBe(false);
      expect(db.has('b.com')).toBe(false);
      const result = await db.lookup('a.com');
      expect(result).toBeNull();
    });
  });

  // ── getStats ───────────────────────────────
  describe('getStats()', () => {
    it('returns correct count', async () => {
      await db.bulkPut([
        { domain: 'one.com', added_at: '', reason: '', registry_id: '' },
        { domain: 'two.com', added_at: '', reason: '', registry_id: '' },
        { domain: 'three.com', added_at: '', reason: '', registry_id: '' },
      ]);
      const stats = await db.getStats();
      expect(stats.count).toBe(3);
    });

    it('returns lastUpdate from chrome.storage.local', async () => {
      storageData.lastSync = '2024-12-01T00:00:00.000Z';
      const stats = await db.getStats();
      expect(stats.lastUpdate).toBe('2024-12-01T00:00:00.000Z');
    });

    it('returns null lastUpdate when never synced', async () => {
      const stats = await db.getStats();
      expect(stats.lastUpdate).toBeNull();
    });

    it('returns count 0 on empty DB', async () => {
      const stats = await db.getStats();
      expect(stats.count).toBe(0);
    });
  });
});
