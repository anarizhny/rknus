import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DomainDB } from '../lib/db.js';
import { checkDomain } from '../lib/lookup.js';

// ────────────────────────────────────────────
// QA-S1-04  Unit-тесты lookup.js
// ────────────────────────────────────────────

// Mock chrome.storage.local (needed by DomainDB#getLastUpdate)
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((key, cb) => { if (typeof cb === 'function') cb({}); }),
      set: vi.fn((obj, cb) => { if (typeof cb === 'function') cb(); }),
    },
  },
};

describe('checkDomain', () => {
  let db;

  beforeAll(async () => {
    db = new DomainDB();
    await db.init();
    await db.bulkPut([
      { domain: 'blocked.com', added_at: '2024-01-01', reason: 'court order', registry_id: '100' },
      { domain: 'another-blocked.ru', added_at: '2024-02-15', reason: 'extremism', registry_id: '200' },
    ]);
  });

  it('returns blocked: true for a blocked URL', async () => {
    const result = await checkDomain('https://blocked.com/some/path', db);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('blocked.com');
    expect(result.details).not.toBeNull();
    expect(result.details.registry_id).toBe('100');
  });

  it('returns blocked: false for a clean URL', async () => {
    const result = await checkDomain('https://clean-site.org/', db);
    expect(result.blocked).toBe(false);
    expect(result.domain).toBe('clean-site.org');
    expect(result.details).toBeNull();
  });

  it('detects blocked parent domain for subdomain URL', async () => {
    const result = await checkDomain('https://sub.deep.blocked.com/page', db);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('blocked.com');
  });

  it('returns not-applicable for chrome:// URL', async () => {
    const result = await checkDomain('chrome://extensions', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('returns not-applicable for empty URL', async () => {
    const result = await checkDomain('', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  it('returns not-applicable for null URL', async () => {
    const result = await checkDomain(null, db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  it('returns blocked: false with empty database', async () => {
    const emptyDb = new DomainDB();
    await emptyDb.init();
    await emptyDb.clear();

    const result = await checkDomain('https://anything.com/', emptyDb);
    expect(result.blocked).toBe(false);
    expect(result.domain).toBe('anything.com');
  });
});
