/**
 * Domain lookup pipeline — checks whether a URL's domain
 * is present in the RKN blocked domains database.
 *
 * Sprint 4 (DEV-S4-05): IP addresses are checked as-is (they may be in registry).
 * Sprint 5 (DEV-S5-02): Optional Bloom Filter pre-check for memory savings.
 */

import { extractDomain, normalizeDomain, getDomainLevels } from './normalize.js';

/**
 * Check if a string looks like an IPv4 address.
 * @param {string} str
 * @returns {boolean}
 */
function isIPv4(str) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(str);
}

/**
 * Check if a string looks like an IPv6 address (simplified check).
 * @param {string} str
 * @returns {boolean}
 */
function isIPv6(str) {
  return str.includes(':') && /^[0-9a-fA-F:]+$/.test(str);
}

/**
 * Check whether the domain of the given URL is blocked.
 *
 * Pipeline: extractDomain -> normalizeDomain -> getDomainLevels -> check each level via db.has()
 *
 * DEV-S4-05: IP addresses are checked directly (no domain level traversal).
 * DEV-S5-02: If bloomFilter is provided, uses it as a fast pre-check.
 *   - bloom negative  => domain is definitely clean (100% guarantee, no false negatives)
 *   - bloom positive   => exact check via db.lookup() (IndexedDB) to rule out false positives
 *
 * @param {string} url — full URL to check
 * @param {import('./db.js').DomainDB} db — initialized DomainDB instance
 * @param {import('./bloom.js').BloomFilter} [bloomFilter] — optional BloomFilter instance
 * @returns {Promise<{blocked: boolean, domain: string|null, details: object|null, status?: string}>}
 */
export async function checkDomain(url, db, bloomFilter) {
  const rawDomain = extractDomain(url);

  if (!rawDomain) {
    return { blocked: false, domain: null, details: null, status: 'not-applicable' };
  }

  const normalizedDomain = normalizeDomain(rawDomain);

  if (!normalizedDomain) {
    return { blocked: false, domain: null, details: null, status: 'not-applicable' };
  }

  // DEV-S4-05: IP addresses — check as-is without domain level traversal
  if (isIPv4(normalizedDomain) || isIPv6(normalizedDomain)) {
    if (bloomFilter) {
      // Bloom filter path for IPs
      if (!bloomFilter.has(normalizedDomain)) {
        // Bloom says NO => definitely not blocked
        return { blocked: false, domain: normalizedDomain, details: null };
      }
      // Bloom says maybe => confirm via IndexedDB
      const details = await db.lookup(normalizedDomain);
      if (details) {
        return { blocked: true, domain: normalizedDomain, details };
      }
      return { blocked: false, domain: normalizedDomain, details: null };
    }

    // No bloom filter — use in-memory Set
    if (db.has(normalizedDomain)) {
      const details = await db.getDetails(normalizedDomain);
      return { blocked: true, domain: normalizedDomain, details };
    }
    return { blocked: false, domain: normalizedDomain, details: null };
  }

  // Normal domain — check all levels
  const levels = getDomainLevels(normalizedDomain);

  if (bloomFilter) {
    // DEV-S5-02: Bloom filter path
    for (const level of levels) {
      if (bloomFilter.has(level)) {
        // Bloom positive => exact check via IndexedDB
        const details = await db.lookup(level);
        if (details) {
          return { blocked: true, domain: level, details };
        }
        // False positive — continue checking other levels
      }
      // Bloom negative => this level is definitely clean, try next
    }
    return { blocked: false, domain: normalizedDomain, details: null };
  }

  // No bloom filter — original in-memory Set path
  for (const level of levels) {
    if (db.has(level)) {
      const details = await db.getDetails(level);
      return { blocked: true, domain: level, details };
    }
  }

  return { blocked: false, domain: normalizedDomain, details: null };
}
