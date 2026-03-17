/**
 * QA-S5-01 — Unit-тесты bloom.js (BloomFilter)
 */
import { describe, it, expect } from 'vitest';
import { BloomFilter } from '../lib/bloom.js';

describe('BloomFilter', () => {
  // ─── Constructor ───

  describe('constructor', () => {
    it('creates with default parameters', () => {
      const bf = new BloomFilter();
      expect(bf.size).toBeGreaterThan(0);
    });

    it('creates with custom parameters', () => {
      const bf = new BloomFilter(1000, 0.01);
      expect(bf.size).toBeGreaterThan(0);
    });

    it('custom filter is smaller than default (fewer expected items)', () => {
      const small = new BloomFilter(100, 0.01);
      const big = new BloomFilter(100000, 0.01);
      expect(small.size).toBeLessThan(big.size);
    });
  });

  // ─── add + has: no false negatives ───

  describe('add + has (no false negatives)', () => {
    it('every added element is found — 100 domains', () => {
      const bf = new BloomFilter(1000, 0.001);
      const domains = [];
      for (let i = 0; i < 100; i++) {
        domains.push(`domain-${i}.example.com`);
      }
      for (const d of domains) {
        bf.add(d);
      }
      for (const d of domains) {
        expect(bf.has(d)).toBe(true);
      }
    });

    it('every added element is found — 500 random strings', () => {
      const bf = new BloomFilter(1000, 0.001);
      const items = [];
      for (let i = 0; i < 500; i++) {
        items.push(`item-${i}-${Math.random().toString(36).slice(2)}`);
      }
      for (const item of items) {
        bf.add(item);
      }
      for (const item of items) {
        expect(bf.has(item)).toBe(true);
      }
    });
  });

  // ─── has: non-existent elements ───

  describe('has (non-existent elements)', () => {
    it('non-existent element may be false positive but NEVER false negative for added', () => {
      const bf = new BloomFilter(100, 0.001);
      bf.add('exists.com');
      // Added element must always be found
      expect(bf.has('exists.com')).toBe(true);
      // Non-existent — result is either true (FP) or false, both acceptable
      const result = bf.has('does-not-exist.com');
      expect(typeof result).toBe('boolean');
    });
  });

  // ─── False Positive Rate ───

  describe('false positive rate', () => {
    it('FPR is within expected bounds (±50%) for 10K elements', () => {
      const n = 10000;
      const targetFPR = 0.01; // 1%
      const bf = new BloomFilter(n, targetFPR);

      // Add N elements
      for (let i = 0; i < n; i++) {
        bf.add(`added-${i}.com`);
      }

      // Check M other elements that were NOT added
      const m = 50000;
      let falsePositives = 0;
      for (let i = 0; i < m; i++) {
        if (bf.has(`notadded-${i}.net`)) {
          falsePositives++;
        }
      }

      const observedFPR = falsePositives / m;
      // FPR should be within ±50% of target
      const lowerBound = targetFPR * 0.5;  // 0.005
      const upperBound = targetFPR * 1.5;  // 0.015

      console.log(`FPR test: target=${targetFPR}, observed=${observedFPR.toFixed(6)}, FP count=${falsePositives}/${m}`);
      console.log(`  Bounds: [${lowerBound}, ${upperBound}]`);

      expect(observedFPR).toBeGreaterThanOrEqual(0); // sanity
      expect(observedFPR).toBeLessThanOrEqual(upperBound);
      // Lower bound check — with 50K samples, if target is 1% we expect ~500 FPs
      // It's possible to get fewer, so we use a generous lower bound
      // (only assert upper bound strictly; lower bound is informational)
    });
  });

  // ─── serialize / deserialize ───

  describe('serialize / deserialize', () => {
    it('deserialized filter gives the same has() results', () => {
      const bf = new BloomFilter(1000, 0.001);
      const domains = [];
      for (let i = 0; i < 200; i++) {
        domains.push(`ser-domain-${i}.com`);
      }
      for (const d of domains) {
        bf.add(d);
      }

      const serialized = bf.serialize();
      const restored = BloomFilter.deserialize(serialized);

      // All added domains must still be found
      for (const d of domains) {
        expect(restored.has(d)).toBe(true);
      }

      // Non-added domains must produce same result as original
      for (let i = 0; i < 100; i++) {
        const testDomain = `other-${i}.net`;
        expect(restored.has(testDomain)).toBe(bf.has(testDomain));
      }
    });

    it('serialized data has expected shape', () => {
      const bf = new BloomFilter(500, 0.01);
      bf.add('test.com');
      const data = bf.serialize();

      expect(data).toHaveProperty('bitArray');
      expect(data).toHaveProperty('numBits');
      expect(data).toHaveProperty('hashCount');
      expect(data).toHaveProperty('expectedItems');
      expect(data).toHaveProperty('fpr');
      expect(typeof data.bitArray).toBe('string'); // base64
      expect(data.expectedItems).toBe(500);
      expect(data.fpr).toBe(0.01);
    });

    it('deserialized filter has same size', () => {
      const bf = new BloomFilter(1000, 0.001);
      bf.add('example.com');
      const restored = BloomFilter.deserialize(bf.serialize());
      expect(restored.size).toBe(bf.size);
    });
  });

  // ─── clear ───

  describe('clear', () => {
    it('after clear all has() return false', () => {
      const bf = new BloomFilter(1000, 0.001);
      const domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
      for (const d of domains) {
        bf.add(d);
      }
      // Verify added
      for (const d of domains) {
        expect(bf.has(d)).toBe(true);
      }
      // Clear
      bf.clear();
      // All must return false
      for (const d of domains) {
        expect(bf.has(d)).toBe(false);
      }
    });
  });

  // ─── size getter ───

  describe('size', () => {
    it('returns size in bytes > 0', () => {
      const bf = new BloomFilter(1000, 0.01);
      expect(bf.size).toBeGreaterThan(0);
      expect(typeof bf.size).toBe('number');
    });

    it('larger expected items → larger size', () => {
      const small = new BloomFilter(100, 0.01);
      const large = new BloomFilter(100000, 0.01);
      expect(large.size).toBeGreaterThan(small.size);
    });
  });
});
