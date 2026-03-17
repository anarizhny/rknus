/**
 * IndexedDB wrapper for the blocked domains database.
 * Provides persistent storage with an in-memory Set for O(1) lookups.
 */

const DB_NAME = 'rknus';
const DB_VERSION = 1;
const STORE_NAME = 'blocked_domains';

export class DomainDB {
  /** @type {IDBDatabase|null} */
  #db = null;

  /** @type {Set<string>} */
  #domainSet = new Set();

  /**
   * Open (or create) the IndexedDB database and load all domains into the in-memory Set.
   * @returns {Promise<void>}
   */
  async init() {
    await this.#openDB();
    await this.#loadSet();
  }

  /**
   * Open the IndexedDB database, creating the object store and index if needed.
   * @returns {Promise<void>}
   */
  #openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'domain' });
          store.createIndex('domain', 'domain', { unique: true });
        }
      };

      request.onsuccess = (event) => {
        this.#db = event.target.result;
        resolve();
      };

      request.onerror = (event) => {
        reject(new Error(`IndexedDB open failed: ${event.target.error}`));
      };
    });
  }

  /**
   * Load all domains from IndexedDB into the in-memory Set.
   * @returns {Promise<void>}
   */
  #loadSet() {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        this.#domainSet = new Set(request.result);
        resolve();
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to load domain set: ${event.target.error}`));
      };
    });
  }

  /**
   * O(1) check whether a domain is in the blocked set.
   * @param {string} domain
   * @returns {boolean}
   */
  has(domain) {
    return this.#domainSet.has(domain);
  }

  /**
   * Insert or update multiple domain records in bulk.
   * Also updates the in-memory Set.
   * @param {Array<{domain: string, added_at: string, reason: string, registry_id: string|number}>} domains
   * @returns {Promise<void>}
   */
  async bulkPut(domains) {
    if (!domains || domains.length === 0) return;

    const BATCH_SIZE = 5000;

    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE);
      await this.#putBatch(batch);
    }

    // Update in-memory Set
    for (const record of domains) {
      this.#domainSet.add(record.domain);
    }
  }

  /**
   * Put a single batch into IndexedDB within one transaction.
   * @param {Array<{domain: string, added_at: string, reason: string, registry_id: string|number}>} batch
   * @returns {Promise<void>}
   */
  #putBatch(batch) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const record of batch) {
        store.put(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(new Error(`bulkPut failed: ${event.target.error}`));
    });
  }

  /**
   * Look up a single domain. Returns the record or null.
   * @param {string} domain
   * @returns {Promise<{domain: string, added_at: string, reason: string, registry_id: string|number}|null>}
   */
  lookup(domain) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(domain);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (event) => reject(new Error(`lookup failed: ${event.target.error}`));
    });
  }

  /**
   * Get detailed information for a domain. Alias for lookup.
   * @param {string} domain
   * @returns {Promise<{domain: string, added_at: string, reason: string, registry_id: string|number}|null>}
   */
  async getDetails(domain) {
    return this.lookup(domain);
  }

  /**
   * Delete all records from the store and clear the in-memory Set.
   * @returns {Promise<void>}
   */
  clear() {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.#domainSet.clear();
        resolve();
      };

      request.onerror = (event) => reject(new Error(`clear failed: ${event.target.error}`));
    });
  }

  /**
   * Get all records from the database.
   * Used for export functionality.
   * @returns {Promise<Array<{domain: string, added_at: string, reason: string, registry_id: string|number}>>}
   */
  getAll() {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (event) => reject(new Error(`getAll failed: ${event.target.error}`));
    });
  }

  /**
   * Get all domain keys from the in-memory Set.
   * Used for building Bloom Filter without a full IndexedDB scan.
   * @returns {string[]}
   */
  getAllDomainKeys() {
    return Array.from(this.#domainSet);
  }

  /**
   * Get database statistics.
   * @returns {Promise<{count: number, lastUpdate: string|null}>}
   */
  async getStats() {
    const count = await this.#getCount();
    const lastUpdate = await this.#getLastUpdate();
    return { count, lastUpdate };
  }

  /**
   * Count all records in the store.
   * @returns {Promise<number>}
   */
  #getCount() {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(new Error(`count failed: ${event.target.error}`));
    });
  }

  /**
   * Retrieve the last sync timestamp from chrome.storage.local.
   * @returns {Promise<string|null>}
   */
  #getLastUpdate() {
    return new Promise((resolve) => {
      chrome.storage.local.get('lastSync', (result) => {
        resolve(result.lastSync || null);
      });
    });
  }
}
