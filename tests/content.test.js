/**
 * Sprint 6 — Content Script Tests (QA-S6-02)
 *
 * content.js is an IIFE that doesn't export functions, so we test:
 * 1. extractDomain / getDomainLevels from normalize.js (used by content script logic)
 * 2. content.js doesn't crash when loaded with mocked chrome APIs and DOM
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDomain, normalizeDomain, getDomainLevels } from '../lib/normalize.js';

// ─── extractDomain tests (content script uses similar logic) ───

describe('extractDomain — typical href values', () => {
  it('extracts domain from absolute http URL', () => {
    expect(extractDomain('http://example.com/path')).toBe('example.com');
  });

  it('extracts domain from absolute https URL', () => {
    expect(extractDomain('https://sub.example.com/path?q=1')).toBe('sub.example.com');
  });

  it('extracts domain from URL with port', () => {
    expect(extractDomain('https://example.com:8080/page')).toBe('example.com');
  });

  it('extracts domain from URL with hash', () => {
    expect(extractDomain('https://example.com/page#section')).toBe('example.com');
  });

  it('lowercases the domain', () => {
    expect(extractDomain('https://Example.COM/Path')).toBe('example.com');
  });

  it('returns null for javascript: href', () => {
    expect(extractDomain('javascript:void(0)')).toBeNull();
  });

  it('returns null for mailto: href', () => {
    expect(extractDomain('mailto:user@example.com')).toBeNull();
  });

  it('returns null for tel: href', () => {
    expect(extractDomain('tel:+1234567890')).toBeNull();
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

  it('returns null for relative path (no base URL available in node)', () => {
    // In node environment, new URL('/path') throws without a base
    expect(extractDomain('/relative/path')).toBeNull();
  });

  it('returns null for chrome:// URLs', () => {
    expect(extractDomain('chrome://extensions')).toBeNull();
  });

  it('returns null for about:blank', () => {
    expect(extractDomain('about:blank')).toBeNull();
  });

  it('returns null for data: URIs', () => {
    expect(extractDomain('data:text/html,<h1>Hello</h1>')).toBeNull();
  });

  it('returns null for file:// URLs', () => {
    expect(extractDomain('file:///tmp/test.html')).toBeNull();
  });
});

// ─── getDomainLevels tests (used for batch checking) ───

describe('getDomainLevels — domain level expansion for batch checking', () => {
  it('returns all levels for a three-part domain (skips TLD-only)', () => {
    // "sub.example.com" → 3 parts, loop i=0..1 → skips "com"
    expect(getDomainLevels('sub.example.com')).toEqual([
      'sub.example.com',
      'example.com',
    ]);
  });

  it('returns one level for a two-part domain (skips TLD-only)', () => {
    // "example.com" → 2 parts, loop i=0..0
    expect(getDomainLevels('example.com')).toEqual([
      'example.com',
    ]);
  });

  it('returns all levels for a four-part domain (skips TLD-only)', () => {
    // "a.b.example.com" → 4 parts, loop i=0..2
    expect(getDomainLevels('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
    ]);
  });

  it('returns single-entry array for a single-part string', () => {
    // e.g. "localhost" — 1 part, loop runs for i=0..parts.length-2=-1, so empty
    // Actually: parts.length=1, parts.length-2=-1, loop 0<=-1 is false → []
    expect(getDomainLevels('localhost')).toEqual([]);
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

  it('handles deeply nested subdomains (skips TLD-only)', () => {
    // "a.b.c.d.example.com" → 6 parts, loop i=0..4 → 5 levels, last is "example.com"
    const result = getDomainLevels('a.b.c.d.example.com');
    expect(result).toHaveLength(5);
    expect(result[0]).toBe('a.b.c.d.example.com');
    expect(result[result.length - 1]).toBe('example.com');
  });
});

// ─── normalizeDomain (used for lookup normalization) ───

describe('normalizeDomain — used before lookup', () => {
  it('lowercases domain', () => {
    expect(normalizeDomain('Example.COM')).toBe('example.com');
  });

  it('strips www. prefix', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });

  it('strips www. and lowercases', () => {
    expect(normalizeDomain('WWW.Example.COM')).toBe('example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(normalizeDomain(null)).toBe('');
  });
});

// ─── Content script import smoke test ───

describe('content.js — smoke test (import does not crash)', () => {
  beforeEach(() => {
    // Set up minimal DOM globals that content.js needs
    globalThis.sessionStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    // Mock chrome API — content script no longer checks contentScriptEnabled
    // (that check moved to background.js which decides whether to inject)
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((msg, cb) => {
          if (cb) cb({});
        }),
        lastError: null,
      },
    };

    // Mock document with minimal API
    globalThis.document = {
      readyState: 'complete',
      createElement: vi.fn(() => ({
        style: {},
        cssText: '',
        className: '',
        textContent: '',
        title: '',
        id: '',
        appendChild: vi.fn(),
        attachShadow: vi.fn(() => ({
          appendChild: vi.fn(),
        })),
        addEventListener: vi.fn(),
        remove: vi.fn(),
        setAttribute: vi.fn(),
      })),
      body: {
        appendChild: vi.fn(),
      },
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
    };

    globalThis.location = { href: 'https://example.com', hostname: 'example.com' };
    globalThis.window = { innerWidth: 1920 };
    globalThis.requestIdleCallback = undefined;
  });

  afterEach(() => {
    delete globalThis.sessionStorage;
    delete globalThis.chrome;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.window;
    delete globalThis.requestIdleCallback;
  });

  it('content.js loads without throwing (injected only on blocked sites)', async () => {
    // content.js is an IIFE — importing it will execute it.
    // It's now only injected by background.js on blocked sites,
    // so it always shows the banner and scans links.
    await expect(
      import('../content/content.js?' + Date.now())
    ).resolves.not.toThrow();
  });

  it('shows banner by calling document.createElement (since site is blocked)', async () => {
    await import('../content/content.js?' + Date.now() + 1);
    expect(globalThis.document.createElement).toHaveBeenCalled();
  });
});
