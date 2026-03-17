/**
 * Bloom Filter implementation for memory-efficient domain lookup.
 *
 * Uses FNV-1a hash with double hashing scheme:
 *   h(i, x) = (h1(x) + i * h2(x)) mod m
 *
 * Guarantees: no false negatives. May produce false positives at the
 * configured rate (default 0.1%).
 */

/**
 * FNV-1a 32-bit hash with an optional seed.
 * @param {string} str — input string
 * @param {number} seed — seed value mixed into the offset basis
 * @returns {number} unsigned 32-bit hash
 */
function fnv1a(str, seed = 0) {
  // FNV offset basis XOR'd with seed for variation
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  const FNV_PRIME = 0x01000193;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash;
}

export class BloomFilter {
  /** @type {Uint8Array} */
  #bitArray;

  /** @type {number} — total number of bits */
  #numBits;

  /** @type {number} — number of hash functions */
  #hashCount;

  /** @type {number} — expected number of items */
  #expectedItems;

  /** @type {number} — target false positive rate */
  #fpr;

  /**
   * Create a new Bloom Filter.
   *
   * @param {number} expectedItems — expected number of items to insert (n)
   * @param {number} falsePositiveRate — desired false positive rate (p), e.g. 0.001
   */
  constructor(expectedItems = 500000, falsePositiveRate = 0.001) {
    this.#expectedItems = expectedItems;
    this.#fpr = falsePositiveRate;

    const n = expectedItems;
    const p = falsePositiveRate;
    const LN2 = Math.LN2;

    // Optimal bit array size: m = -(n * ln(p)) / (ln(2)^2)
    this.#numBits = Math.ceil(-(n * Math.log(p)) / (LN2 * LN2));

    // Optimal number of hash functions: k = (m / n) * ln(2)
    this.#hashCount = Math.max(1, Math.round((this.#numBits / n) * LN2));

    // Allocate byte array (ceil(numBits / 8))
    const byteLength = Math.ceil(this.#numBits / 8);
    this.#bitArray = new Uint8Array(byteLength);
  }

  // ─── Private helpers ───

  /**
   * Get the bit positions for an item using double hashing.
   * h(i) = (h1 + i * h2) mod m
   * @param {string} item
   * @returns {number[]} array of bit positions
   */
  #getPositions(item) {
    const h1 = fnv1a(item, 0);
    const h2 = fnv1a(item, 0x9e3779b9); // golden ratio seed
    const positions = new Array(this.#hashCount);

    for (let i = 0; i < this.#hashCount; i++) {
      // Ensure non-negative via unsigned shift
      positions[i] = ((h1 + Math.imul(i, h2)) >>> 0) % this.#numBits;
    }

    return positions;
  }

  /**
   * Set a bit at position pos.
   * @param {number} pos
   */
  #setBit(pos) {
    const byteIndex = pos >>> 3;        // pos / 8
    const bitOffset = pos & 7;          // pos % 8
    this.#bitArray[byteIndex] |= (1 << bitOffset);
  }

  /**
   * Test a bit at position pos.
   * @param {number} pos
   * @returns {boolean}
   */
  #getBit(pos) {
    const byteIndex = pos >>> 3;
    const bitOffset = pos & 7;
    return (this.#bitArray[byteIndex] & (1 << bitOffset)) !== 0;
  }

  // ─── Public API ───

  /**
   * Add an item to the filter.
   * @param {string} item
   */
  add(item) {
    const positions = this.#getPositions(item);
    for (const pos of positions) {
      this.#setBit(pos);
    }
  }

  /**
   * Test whether an item might be in the filter.
   * - Returns true  → item is *probably* in the set (may be a false positive)
   * - Returns false → item is *definitely not* in the set (no false negatives)
   *
   * @param {string} item
   * @returns {boolean}
   */
  has(item) {
    const positions = this.#getPositions(item);
    for (const pos of positions) {
      if (!this.#getBit(pos)) return false;
    }
    return true;
  }

  /**
   * Clear the filter (reset all bits to 0).
   */
  clear() {
    this.#bitArray.fill(0);
  }

  /**
   * Size of the bit array in bytes.
   * @returns {number}
   */
  get size() {
    return this.#bitArray.byteLength;
  }

  /**
   * Serialize the filter to a plain object suitable for storage.
   * The bit array is encoded as a base64 string.
   *
   * @returns {{ bitArray: string, numBits: number, hashCount: number, expectedItems: number, fpr: number }}
   */
  serialize() {
    // Convert Uint8Array to base64
    let binary = '';
    for (let i = 0; i < this.#bitArray.length; i++) {
      binary += String.fromCharCode(this.#bitArray[i]);
    }
    const base64 = btoa(binary);

    return {
      bitArray: base64,
      numBits: this.#numBits,
      hashCount: this.#hashCount,
      expectedItems: this.#expectedItems,
      fpr: this.#fpr,
    };
  }

  /**
   * Restore a BloomFilter from a serialized object.
   *
   * @param {{ bitArray: string, numBits: number, hashCount: number, expectedItems: number, fpr: number }} data
   * @returns {BloomFilter}
   */
  static deserialize(data) {
    const filter = new BloomFilter(data.expectedItems, data.fpr);

    // Restore internal state
    filter.#numBits = data.numBits;
    filter.#hashCount = data.hashCount;

    // Decode base64 back to Uint8Array
    const binary = atob(data.bitArray);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    filter.#bitArray = bytes;

    return filter;
  }
}
