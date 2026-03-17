/**
 * Domain normalization utilities.
 */

/**
 * Extract the domain (hostname) from a URL string.
 * Returns null for non-http(s) URLs or invalid input.
 * @param {string} url
 * @returns {string|null}
 */
export function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Normalize a domain: lowercase, strip leading "www.".
 * @param {string} domain
 * @returns {string}
 */
export function normalizeDomain(domain) {
  if (!domain) return '';
  let d = domain.toLowerCase().trim();
  if (d.startsWith('www.')) {
    d = d.slice(4);
  }
  return d;
}

/**
 * Get all domain levels for hierarchical lookup.
 * e.g. "sub.domain.example.com" → ["sub.domain.example.com", "domain.example.com", "example.com"]
 * Stops at second-level domain (skips TLD-only).
 * @param {string} domain
 * @returns {string[]}
 */
export function getDomainLevels(domain) {
  if (!domain) return [];
  const parts = domain.split('.');
  const levels = [];
  // Need at least 2 parts for a valid domain (e.g. example.com)
  for (let i = 0; i <= parts.length - 2; i++) {
    levels.push(parts.slice(i).join('.'));
  }
  return levels;
}
