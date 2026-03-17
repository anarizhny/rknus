/**
 * QA-S5-03 — Performance бенчмарки BloomFilter
 *
 * Эти тесты всегда проходят. Результаты выводятся через console.log.
 */
import { describe, it, expect } from 'vitest';
import { BloomFilter } from '../lib/bloom.js';

describe('BloomFilter performance benchmarks', () => {
  const N = 100_000;

  it(`benchmark: add ${N.toLocaleString()} elements`, () => {
    const bf = new BloomFilter(N, 0.001);

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      bf.add(`domain-${i}.example.com`);
    }
    const elapsed = performance.now() - start;

    console.log(`\n=== BLOOM FILTER BENCHMARK ===`);
    console.log(`ADD ${N.toLocaleString()} elements: ${elapsed.toFixed(2)} ms`);
    console.log(`  Per element: ${(elapsed / N * 1000).toFixed(2)} us`);

    expect(true).toBe(true);
  });

  it(`benchmark: has ${N.toLocaleString()} lookups (all hits)`, () => {
    const bf = new BloomFilter(N, 0.001);
    for (let i = 0; i < N; i++) {
      bf.add(`domain-${i}.example.com`);
    }

    const start = performance.now();
    let found = 0;
    for (let i = 0; i < N; i++) {
      if (bf.has(`domain-${i}.example.com`)) found++;
    }
    const elapsed = performance.now() - start;

    console.log(`HAS ${N.toLocaleString()} lookups (hits): ${elapsed.toFixed(2)} ms`);
    console.log(`  Per lookup: ${(elapsed / N * 1000).toFixed(2)} us`);
    console.log(`  Found: ${found}/${N} (should be ${N})`);

    expect(found).toBe(N);
  });

  it(`benchmark: has ${N.toLocaleString()} lookups (all misses)`, () => {
    const bf = new BloomFilter(N, 0.001);
    for (let i = 0; i < N; i++) {
      bf.add(`domain-${i}.example.com`);
    }

    const start = performance.now();
    let falsePositives = 0;
    for (let i = 0; i < N; i++) {
      if (bf.has(`miss-${i}.other.net`)) falsePositives++;
    }
    const elapsed = performance.now() - start;

    const fpr = falsePositives / N;
    console.log(`HAS ${N.toLocaleString()} lookups (misses): ${elapsed.toFixed(2)} ms`);
    console.log(`  Per lookup: ${(elapsed / N * 1000).toFixed(2)} us`);
    console.log(`  False positives: ${falsePositives}/${N} (FPR: ${(fpr * 100).toFixed(4)}%)`);

    expect(true).toBe(true);
  });

  it('benchmark: memory size', () => {
    const bf = new BloomFilter(N, 0.001);
    for (let i = 0; i < N; i++) {
      bf.add(`domain-${i}.example.com`);
    }

    const sizeBytes = bf.size;
    const sizeKB = sizeBytes / 1024;
    const sizeMB = sizeKB / 1024;

    console.log(`MEMORY SIZE for ${N.toLocaleString()} elements (FPR=0.1%):`);
    console.log(`  ${sizeBytes.toLocaleString()} bytes`);
    console.log(`  ${sizeKB.toFixed(2)} KB`);
    console.log(`  ${sizeMB.toFixed(4)} MB`);

    // Serialization size
    const serialized = bf.serialize();
    const jsonSize = JSON.stringify(serialized).length;
    console.log(`SERIALIZED (JSON) size: ${(jsonSize / 1024).toFixed(2)} KB`);
    console.log(`=== END BENCHMARK ===\n`);

    expect(sizeBytes).toBeGreaterThan(0);
  });
});
