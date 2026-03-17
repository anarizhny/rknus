/**
 * Options page script — loads/saves settings via chrome.storage.sync,
 * manages database operations, and applies theme.
 *
 * Sprint 4: DEV-S4-01, DEV-S4-03
 */

// --- Defaults ---

const DEFAULTS = {
  dataSource: 'github',
  customUrl: '',
  syncInterval: 360,
  notificationsEnabled: true,
  theme: 'system',
  bloomFilterEnabled: false,
};

// Map select values to minutes
const SYNC_INTERVAL_MAP = {
  '60': 60,
  '360': 360,
  '720': 720,
  '1440': 1440,
  '0': 0,          // manual only
};

// --- DOM references ---

function $(id) {
  return document.getElementById(id);
}

function getDataSourceRadios() {
  return document.querySelectorAll('input[name="dataSource"]');
}

function getThemeRadios() {
  return document.querySelectorAll('input[name="theme"]');
}

// --- Theme application (DEV-S4-03) ---

/**
 * Apply theme to the document.
 * @param {'light'|'dark'|'system'} theme
 */
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'light') {
    html.setAttribute('data-theme', 'light');
  } else if (theme === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else {
    // system — remove attribute, let CSS media query handle it
    html.removeAttribute('data-theme');
  }
}

// --- Toast ---

let toastTimeout = null;

/**
 * Show a brief toast notification.
 * @param {string} message
 */
function showToast(message) {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'options__toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('options__toast--visible');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('options__toast--visible');
  }, 2000);
}

// --- Custom URL visibility ---

function updateCustomUrlVisibility(dataSource) {
  const customUrlGroup = $('custom-url-group');
  if (customUrlGroup) {
    if (dataSource === 'custom') {
      customUrlGroup.style.display = 'block';
    } else {
      customUrlGroup.style.display = 'none';
    }
  }
}

// --- Save a single setting ---

/**
 * Save settings to chrome.storage.sync and show toast.
 * @param {object} settings — partial settings object
 */
async function saveSettings(settings) {
  // If syncInterval changed, also update syncIntervalMinutes for background alarm
  if ('syncInterval' in settings) {
    settings.syncIntervalMinutes = settings.syncInterval;
  }

  await chrome.storage.sync.set(settings);
  showToast('Сохранено');

  // Notify background about settings change
  chrome.runtime.sendMessage({
    type: 'settingsChanged',
    settings,
  }).catch(() => {
    // background may not be listening for this message type — ok
  });
}

// --- Load settings and populate UI ---

async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULTS);

  // Data source radios
  for (const radio of getDataSourceRadios()) {
    radio.checked = radio.value === result.dataSource;
  }
  updateCustomUrlVisibility(result.dataSource);

  // Custom URL
  const customUrlInput = $('custom-url');
  if (customUrlInput) {
    customUrlInput.value = result.customUrl || '';
  }

  // Sync interval select
  const syncIntervalSelect = $('sync-interval');
  if (syncIntervalSelect) {
    syncIntervalSelect.value = String(result.syncInterval);
  }

  // Notifications toggle
  const notificationsToggle = $('notifications-toggle');
  if (notificationsToggle) {
    notificationsToggle.checked = result.notificationsEnabled;
  }

  // Theme radios
  for (const radio of getThemeRadios()) {
    radio.checked = radio.value === result.theme;
  }

  // Bloom filter toggle
  const bloomToggle = $('bloom-toggle');
  if (bloomToggle) {
    bloomToggle.checked = result.bloomFilterEnabled;
  }

  // Apply theme
  applyTheme(result.theme);
}

// --- Bind event listeners ---

function bindListeners() {
  // Data source radios
  for (const radio of getDataSourceRadios()) {
    radio.addEventListener('change', () => {
      updateCustomUrlVisibility(radio.value);
      saveSettings({ dataSource: radio.value });
    });
  }

  // Custom URL input (save on blur or Enter)
  const customUrlInput = $('custom-url');
  if (customUrlInput) {
    const saveUrl = () => saveSettings({ customUrl: customUrlInput.value });
    customUrlInput.addEventListener('blur', saveUrl);
    customUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveUrl();
      }
    });
  }

  // Sync interval select
  const syncIntervalSelect = $('sync-interval');
  if (syncIntervalSelect) {
    syncIntervalSelect.addEventListener('change', () => {
      const minutes = parseInt(syncIntervalSelect.value, 10);
      saveSettings({ syncInterval: minutes });
    });
  }

  // Notifications toggle
  const notificationsToggle = $('notifications-toggle');
  if (notificationsToggle) {
    notificationsToggle.addEventListener('change', () => {
      saveSettings({ notificationsEnabled: notificationsToggle.checked });
    });
  }

  // Theme radios
  for (const radio of getThemeRadios()) {
    radio.addEventListener('change', () => {
      applyTheme(radio.value);
      saveSettings({ theme: radio.value });
    });
  }

  // Bloom filter toggle
  const bloomToggle = $('bloom-toggle');
  if (bloomToggle) {
    bloomToggle.addEventListener('change', () => {
      saveSettings({ bloomFilterEnabled: bloomToggle.checked });
    });
  }

  // --- Database management buttons ---

  // Sync now
  const btnSyncNow = $('btn-sync-now');
  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', async () => {
      btnSyncNow.disabled = true;
      btnSyncNow.textContent = 'Обновление...';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'syncNow' });
        if (response?.success) {
          showToast('Синхронизация завершена');
          updateDbStatus();
        } else {
          showToast('Ошибка синхронизации');
        }
      } catch (err) {
        showToast('Ошибка синхронизации');
      } finally {
        btnSyncNow.disabled = false;
        btnSyncNow.textContent = 'Обновить сейчас';
      }
    });
  }

  // Clear database
  const btnClearDb = $('btn-clear-db');
  if (btnClearDb) {
    btnClearDb.addEventListener('click', async () => {
      const confirmed = confirm('Удалить все данные? База будет загружена заново при следующей синхронизации.');
      if (!confirmed) return;

      try {
        const response = await chrome.runtime.sendMessage({ type: 'clearDb' });
        if (response?.success) {
          showToast('База очищена');
          updateDbStatus();
        }
      } catch (err) {
        showToast('Ошибка очистки');
      }
    });
  }

  // Export
  const btnExport = $('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      btnExport.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'exportDb' });
        if (response?.success && response.data) {
          const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `rknus-export-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('Экспорт завершён');
        } else {
          showToast('Ошибка экспорта');
        }
      } catch (err) {
        showToast('Ошибка экспорта');
      } finally {
        btnExport.disabled = false;
      }
    });
  }

  // Import
  const btnImport = $('btn-import');
  if (btnImport) {
    btnImport.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json';
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (!Array.isArray(data)) {
            showToast('Ошибка импорта: неверный формат файла');
            return;
          }

          const response = await chrome.runtime.sendMessage({ type: 'importDb', data });
          if (response?.success) {
            showToast('Импорт завершён');
            updateDbStatus();
          } else {
            showToast('Ошибка импорта');
          }
        } catch (err) {
          showToast('Ошибка импорта: неверный формат файла');
        }
      });
      fileInput.click();
    });
  }
}

// --- Database status display ---

async function updateDbStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
    const statusEl = $('db-status');
    if (statusEl && response?.stats) {
      const count = response.stats.count?.toLocaleString('ru-RU') || '0';
      const updated = response.stats.lastUpdate
        ? formatRelativeTime(response.stats.lastUpdate)
        : 'никогда';
      statusEl.textContent = `База: ${count} доменов | Обновлено: ${updated}`;
    }
  } catch (err) {
    // ignore
  }
}

/**
 * Format an ISO timestamp as relative time string.
 * @param {string} isoString
 * @returns {string}
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) return 'только что';

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч. назад`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'вчера';
  return `${diffDays} дн. назад`;
}

// --- Initialization ---

async function init() {
  await loadSettings();
  bindListeners();
  updateDbStatus();
}

document.addEventListener('DOMContentLoaded', init);
