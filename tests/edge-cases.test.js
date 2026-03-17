import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DomainDB } from '../lib/db.js';
import { checkDomain } from '../lib/lookup.js';

// ────────────────────────────────────────────
// QA-S4-02  Edge-cases: special URLs & IP addresses
// ────────────────────────────────────────────

// Mock chrome.storage.local (needed by DomainDB#getLastUpdate)
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((_key, cb) => { if (typeof cb === 'function') cb({}); }),
      set: vi.fn((_obj, cb) => { if (typeof cb === 'function') cb(); }),
    },
  },
};

describe('Edge-cases — special URLs', () => {
  let db;

  beforeAll(async () => {
    db = new DomainDB();
    await db.init();
    // Seed DB with a blocked IP and a blocked domain for IP-lookup tests
    await db.bulkPut([
      { domain: 'blocked.com', added_at: '2024-01-01', reason: 'court order', registry_id: '100' },
      { domain: '93.184.216.34', added_at: '2024-03-01', reason: 'court order', registry_id: '300' },
    ]);
  });

  // ── chrome:// ──

  it('chrome://extensions returns not-applicable', async () => {
    const result = await checkDomain('chrome://extensions', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('chrome://settings/privacy returns not-applicable', async () => {
    const result = await checkDomain('chrome://settings/privacy', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  // ── about:blank ──

  it('about:blank returns not-applicable', async () => {
    const result = await checkDomain('about:blank', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  // ── file:// ──

  it('file:///C:/test.html returns not-applicable', async () => {
    const result = await checkDomain('file:///C:/test.html', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('file:///home/user/doc.pdf returns not-applicable', async () => {
    const result = await checkDomain('file:///home/user/doc.pdf', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  // ── data: URI ──

  it('data:text/html,<h1>Hello</h1> returns not-applicable', async () => {
    const result = await checkDomain('data:text/html,<h1>Hello</h1>', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('data:image/png;base64,abc returns not-applicable', async () => {
    const result = await checkDomain('data:image/png;base64,abc', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  // ── blob: ──

  it('blob:http://example.com/uuid returns not-applicable', async () => {
    // blob: URLs have protocol "blob:" — extractDomain should return null
    const result = await checkDomain('blob:http://example.com/550e8400-e29b-41d4-a716-446655440000', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  // ── Empty / null URL ──

  it('empty string returns not-applicable', async () => {
    const result = await checkDomain('', db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('null returns not-applicable', async () => {
    const result = await checkDomain(null, db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });

  it('undefined returns not-applicable', async () => {
    const result = await checkDomain(undefined, db);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
    expect(result.domain).toBeNull();
  });
});

describe('Edge-cases — IP addresses', () => {
  let db;

  beforeAll(async () => {
    db = new DomainDB();
    await db.init();
    await db.bulkPut([
      { domain: '93.184.216.34', added_at: '2024-03-01', reason: 'court order', registry_id: '300' },
      { domain: '203.0.113.50', added_at: '2024-04-01', reason: 'extremism', registry_id: '400' },
    ]);
  });

  it('blocked IPv4 address is detected as blocked', async () => {
    const result = await checkDomain('http://93.184.216.34/page', db);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('93.184.216.34');
    expect(result.details).not.toBeNull();
    expect(result.details.registry_id).toBe('300');
  });

  it('clean IPv4 address is not blocked', async () => {
    const result = await checkDomain('http://8.8.8.8/', db);
    expect(result.blocked).toBe(false);
    expect(result.domain).toBe('8.8.8.8');
    expect(result.details).toBeNull();
  });

  it('IPv4 with port is checked correctly', async () => {
    const result = await checkDomain('http://203.0.113.50:8080/api', db);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('203.0.113.50');
  });

  it('IPv4 address does not trigger domain-level traversal', async () => {
    // Ensure IP is checked as-is, not split into octets
    const result = await checkDomain('http://93.184.216.34/', db);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('93.184.216.34');
  });
});
