/**
 * QA-S5-02 — Интеграционный тест Bloom Filter + lookup + DomainDB
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DomainDB } from '../lib/db.js';
import { BloomFilter } from '../lib/bloom.js';
import { checkDomain } from '../lib/lookup.js';

// Mock chrome.storage.local (needed by DomainDB#getLastUpdate)
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((key, cb) => { if (typeof cb === 'function') cb({}); }),
      set: vi.fn((obj, cb) => { if (typeof cb === 'function') cb(); }),
    },
  },
};

describe('Bloom + lookup integration', () => {
  let db;
  let bloom;

  const blockedDomains = [
    { domain: 'blocked.com', added_at: '2024-01-01', reason: 'court order', registry_id: '100' },
    { domain: 'banned-site.ru', added_at: '2024-02-15', reason: 'extremism', registry_id: '200' },
    { domain: 'illegal.org', added_at: '2024-03-10', reason: 'drugs', registry_id: '300' },
  ];

  beforeAll(async () => {
    db = new DomainDB();
    await db.init();
    await db.bulkPut(blockedDomains);

    // Build BloomFilter from DomainDB keys
    const keys = db.getAllDomainKeys();
    bloom = new BloomFilter(Math.max(keys.length, 100), 0.001);
    for (const key of keys) {
      bloom.add(key);
    }
  });

  it('blocked domain → blocked: true (bloom positive, IDB confirms)', async () => {
    const result = await checkDomain('https://blocked.com/page', db, bloom);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('blocked.com');
    expect(result.details).not.toBeNull();
    expect(result.details.registry_id).toBe('100');
  });

  it('clean domain → blocked: false (bloom negative, skips IDB)', async () => {
    const result = await checkDomain('https://clean-site.org/', db, bloom);
    expect(result.blocked).toBe(false);
    expect(result.domain).toBe('clean-site.org');
    expect(result.details).toBeNull();
  });

  it('subdomain of blocked → blocked: true (bloom finds parent)', async () => {
    const result = await checkDomain('https://sub.deep.blocked.com/path', db, bloom);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('blocked.com');
  });

  it('another blocked domain works correctly', async () => {
    const result = await checkDomain('https://banned-site.ru/', db, bloom);
    expect(result.blocked).toBe(true);
    expect(result.domain).toBe('banned-site.ru');
  });

  it('non-applicable URL returns not-applicable with bloom', async () => {
    const result = await checkDomain('chrome://extensions', db, bloom);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe('not-applicable');
  });

  it('bloom false positive is handled correctly (bloom says yes, IDB says no → clean)', async () => {
    // To simulate a false positive scenario, we create a bloom filter
    // that contains extra entries not in the DB.
    // We add a fake domain to bloom but NOT to the database.
    const customBloom = new BloomFilter(100, 0.001);

    // Add all real blocked domains to bloom
    for (const d of blockedDomains) {
      customBloom.add(d.domain);
    }

    // Add a domain to bloom that is NOT in IndexedDB — simulates false positive
    customBloom.add('false-positive-domain.com');

    // Verify bloom says "yes" for this domain
    expect(customBloom.has('false-positive-domain.com')).toBe(true);

    // But IDB does not have it, so lookup should return blocked: false
    const result = await checkDomain('https://false-positive-domain.com/', db, customBloom);
    expect(result.blocked).toBe(false);
    expect(result.domain).toBe('false-positive-domain.com');
    expect(result.details).toBeNull();
  });

  it('multiple clean domains are all correctly identified', async () => {
    const cleanDomains = [
      'https://google.com/',
      'https://github.com/repo',
      'https://stackoverflow.com/questions',
      'https://example.net/path',
    ];

    for (const url of cleanDomains) {
      const result = await checkDomain(url, db, bloom);
      expect(result.blocked).toBe(false);
    }
  });
});
