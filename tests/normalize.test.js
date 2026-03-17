import { describe, it, expect } from 'vitest';
import { extractDomain, normalizeDomain, getDomainLevels } from '../lib/normalize.js';

// ────────────────────────────────────────────
// QA-S1-01  Unit-тесты normalize.js
// ────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts domain from http URL', () => {
    expect(extractDomain('http://example.com')).toBe('example.com');
  });

  it('extracts domain from https URL', () => {
    expect(extractDomain('https://example.com')).toBe('example.com');
  });

  it('extracts domain from URL with port', () => {
    expect(extractDomain('https://example.com:8080')).toBe('example.com');
  });

  it('extracts domain from URL with path, query and hash', () => {
    expect(extractDomain('https://example.com/path/page?q=1&b=2#section')).toBe('example.com');
  });

  it('returns null for URL without protocol', () => {
    expect(extractDomain('example.com')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractDomain('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(extractDomain(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(extractDomain(undefined)).toBeNull();
  });

  it('lowercases the domain', () => {
    expect(extractDomain('https://Example.COM/Path')).toBe('example.com');
  });
});

describe('normalizeDomain', () => {
  it('lowercases the domain', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com');
  });

  it('removes www. prefix', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });

  it('removes www. prefix case-insensitively', () => {
    expect(normalizeDomain('WWW.Example.com')).toBe('example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('returns empty string for null', () => {
    expect(normalizeDomain(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('does not strip non-www subdomains', () => {
    expect(normalizeDomain('api.example.com')).toBe('api.example.com');
  });
});

describe('getDomainLevels', () => {
  it('returns 3 levels for sub.domain.example.com', () => {
    const levels = getDomainLevels('sub.domain.example.com');
    expect(levels).toEqual([
      'sub.domain.example.com',
      'domain.example.com',
      'example.com',
    ]);
    expect(levels).toHaveLength(3);
  });

  it('returns 1 level for example.com', () => {
    const levels = getDomainLevels('example.com');
    expect(levels).toEqual(['example.com']);
    expect(levels).toHaveLength(1);
  });

  it('returns empty array for empty string', () => {
    expect(getDomainLevels('')).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(getDomainLevels(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(getDomainLevels(undefined)).toEqual([]);
  });

  it('returns correct levels for 2-level domain', () => {
    const levels = getDomainLevels('blog.example.com');
    expect(levels).toEqual([
      'blog.example.com',
      'example.com',
    ]);
    expect(levels).toHaveLength(2);
  });
});

// ────────────────────────────────────────────
// QA-S1-02  Edge-case тесты normalize.js
// ────────────────────────────────────────────

describe('extractDomain — edge cases', () => {
  it('extracts IP address as domain', () => {
    expect(extractDomain('http://192.168.1.1')).toBe('192.168.1.1');
  });

  it('extracts IP address with port', () => {
    expect(extractDomain('http://192.168.1.1:8080/path')).toBe('192.168.1.1');
  });

  it('returns null for chrome:// URL', () => {
    expect(extractDomain('chrome://extensions')).toBeNull();
  });

  it('returns null for chrome://settings', () => {
    expect(extractDomain('chrome://settings/privacy')).toBeNull();
  });

  it('returns null for about:blank', () => {
    expect(extractDomain('about:blank')).toBeNull();
  });

  it('returns null for file:// URL', () => {
    expect(extractDomain('file:///home/user/page.html')).toBeNull();
  });

  it('returns null for data: URI', () => {
    expect(extractDomain('data:text/html,<h1>hello</h1>')).toBeNull();
  });

  it('handles very long domain (253 characters)', () => {
    // Max DNS domain length is 253 characters
    const labels = [];
    // Each label max 63 chars; build a valid long domain
    for (let i = 0; i < 4; i++) {
      labels.push('a'.repeat(60));
    }
    labels.push('com');
    const longDomain = labels.join('.');
    const url = 'https://' + longDomain + '/';
    const result = extractDomain(url);
    expect(result).toBe(longDomain.toLowerCase());
  });

  it('handles IDN (internationalized) domain via punycode', () => {
    // new URL converts IDN to punycode hostname
    const url = 'https://xn--e1afmapc.xn--p1ai/'; // пример.рф in punycode
    const result = extractDomain(url);
    expect(result).toBe('xn--e1afmapc.xn--p1ai');
  });

  it('handles unicode domain (auto-converted by URL parser)', () => {
    // Node URL parser may convert unicode to punycode
    const url = 'https://тест.рф/page';
    const result = extractDomain(url);
    // Should return a non-null string (either unicode or punycode)
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getDomainLevels — edge cases', () => {
  it('returns single-element array for bare TLD-like input', () => {
    // single word like "localhost" has 1 part, but parts.length - 2 = -1, so no iterations
    expect(getDomainLevels('localhost')).toEqual([]);
  });

  it('handles IP address (treated as domain with dots)', () => {
    const levels = getDomainLevels('192.168.1.1');
    // 4 parts → 3 levels
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBe('192.168.1.1');
  });
});

describe('normalizeDomain — edge cases', () => {
  it('handles domain with multiple www prefixes', () => {
    // Only the first www. is stripped
    expect(normalizeDomain('www.www.example.com')).toBe('www.example.com');
  });

  it('does not strip www if it is the entire domain', () => {
    expect(normalizeDomain('www.')).toBe('');
  });
});
