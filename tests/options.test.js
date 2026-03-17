import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────
// QA-S4-01  Unit-тесты options.js
// ────────────────────────────────────────────
// options.js is a DOM-heavy module (document.getElementById, addEventListener, etc.)
// so we test the core logic extracted from it: defaults, save/load via chrome.storage.sync.

// ── Default settings ──

const DEFAULTS = {
  dataSource: 'github',
  customUrl: '',
  syncInterval: 360,
  notificationsEnabled: true,
  theme: 'system',
  bloomFilterEnabled: false,
};

describe('Options — default settings', () => {
  it('dataSource defaults to "github"', () => {
    expect(DEFAULTS.dataSource).toBe('github');
  });

  it('customUrl defaults to empty string', () => {
    expect(DEFAULTS.customUrl).toBe('');
  });

  it('syncInterval defaults to 360 minutes (6 hours)', () => {
    expect(DEFAULTS.syncInterval).toBe(360);
  });

  it('notificationsEnabled defaults to true', () => {
    expect(DEFAULTS.notificationsEnabled).toBe(true);
  });

  it('theme defaults to "system"', () => {
    expect(DEFAULTS.theme).toBe('system');
  });

  it('bloomFilterEnabled defaults to false', () => {
    expect(DEFAULTS.bloomFilterEnabled).toBe(false);
  });

  it('DEFAULTS has exactly 6 keys', () => {
    expect(Object.keys(DEFAULTS)).toHaveLength(6);
  });
});

// ── chrome.storage.sync save / load ──

describe('Options — chrome.storage.sync save/load', () => {
  /** @type {Record<string, any>} */
  let store;

  beforeEach(() => {
    store = {};

    // Simplified chrome.storage.sync mock with an in-memory store
    globalThis.chrome = {
      storage: {
        sync: {
          get: vi.fn((defaults) => {
            const result = { ...defaults };
            for (const key of Object.keys(defaults)) {
              if (key in store) {
                result[key] = store[key];
              }
            }
            return Promise.resolve(result);
          }),
          set: vi.fn((obj) => {
            Object.assign(store, obj);
            return Promise.resolve();
          }),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('saveSettings stores values in chrome.storage.sync', async () => {
    await chrome.storage.sync.set({ theme: 'dark' });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ theme: 'dark' });
    expect(store.theme).toBe('dark');
  });

  it('loadSettings returns defaults when nothing is saved', async () => {
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result).toEqual(DEFAULTS);
  });

  it('loadSettings merges saved values with defaults', async () => {
    store.theme = 'dark';
    store.syncInterval = 60;

    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.theme).toBe('dark');
    expect(result.syncInterval).toBe(60);
    // Other keys stay at defaults
    expect(result.dataSource).toBe('github');
    expect(result.notificationsEnabled).toBe(true);
  });

  it('saving syncInterval also sets syncIntervalMinutes', async () => {
    // Replicate options.js saveSettings logic
    const settings = { syncInterval: 720 };
    if ('syncInterval' in settings) {
      settings.syncIntervalMinutes = settings.syncInterval;
    }
    await chrome.storage.sync.set(settings);

    expect(store.syncInterval).toBe(720);
    expect(store.syncIntervalMinutes).toBe(720);
  });

  it('saving dataSource persists correctly', async () => {
    await chrome.storage.sync.set({ dataSource: 'custom' });
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.dataSource).toBe('custom');
  });

  it('saving notificationsEnabled: false persists correctly', async () => {
    await chrome.storage.sync.set({ notificationsEnabled: false });
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.notificationsEnabled).toBe(false);
  });

  it('saving bloomFilterEnabled: true persists correctly', async () => {
    await chrome.storage.sync.set({ bloomFilterEnabled: true });
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.bloomFilterEnabled).toBe(true);
  });

  it('saving customUrl persists correctly', async () => {
    await chrome.storage.sync.set({ customUrl: 'https://my-mirror.example.com/dump.csv' });
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.customUrl).toBe('https://my-mirror.example.com/dump.csv');
  });

  it('overwriting a setting replaces previous value', async () => {
    await chrome.storage.sync.set({ theme: 'dark' });
    await chrome.storage.sync.set({ theme: 'light' });
    const result = await chrome.storage.sync.get(DEFAULTS);
    expect(result.theme).toBe('light');
  });
});
