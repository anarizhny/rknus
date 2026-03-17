/**
 * Chrome Extension API mocks for Vitest.
 */
import { vi } from 'vitest';

const messageListeners = [];
const alarmListeners = [];

const chrome = {
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 1, url: '' }),
  },

  action: {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },

  storage: {
    local: {
      get: vi.fn().mockImplementation((keys) => {
        return Promise.resolve({});
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },

  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    onAlarm: {
      addListener: vi.fn((cb) => {
        alarmListeners.push(cb);
      }),
    },
  },

  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn((cb) => {
        messageListeners.push(cb);
      }),
    },
  },
};

/**
 * Reset all mocks to their default state.
 */
export function resetChromeMocks() {
  chrome.tabs.query.mockReset().mockResolvedValue([]);
  chrome.tabs.get.mockReset().mockResolvedValue({ id: 1, url: '' });
  chrome.action.setBadgeText.mockReset().mockResolvedValue(undefined);
  chrome.action.setBadgeBackgroundColor.mockReset().mockResolvedValue(undefined);
  chrome.storage.local.get.mockReset().mockImplementation(() => Promise.resolve({}));
  chrome.storage.local.set.mockReset().mockResolvedValue(undefined);
  chrome.alarms.create.mockReset();
  chrome.alarms.clear.mockReset();
  chrome.alarms.get.mockReset().mockResolvedValue(null);
  chrome.alarms.onAlarm.addListener.mockReset();
  chrome.runtime.sendMessage.mockReset().mockResolvedValue(undefined);
  chrome.runtime.onMessage.addListener.mockReset();
  messageListeners.length = 0;
  alarmListeners.length = 0;
}

export default chrome;
