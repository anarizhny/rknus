/**
 * Popup script — communicates with the background service worker
 * to display domain block status and manage sync actions.
 *
 * Sprint 4: theme application, edge-case rendering.
 */

// --- DEV-S4-03: Theme application ---

/**
 * Apply theme to the document based on chrome.storage.sync.
 */
async function applyTheme() {
  const result = await chrome.storage.sync.get({ theme: 'system' });
  const html = document.documentElement;
  if (result.theme === 'light') {
    html.setAttribute('data-theme', 'light');
  } else if (result.theme === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else {
    html.removeAttribute('data-theme');
  }
}

// --- State rendering ---

const STATES = ['blocked', 'clean', 'loading', 'error', 'empty-db', 'not-applicable'];

/**
 * Hide all state elements, then show the one matching `state`.
 * @param {string} state
 */
function showState(state) {
  for (const s of STATES) {
    const el = document.getElementById(`state-${s}`);
    if (el) el.style.display = 'none';
  }
  const active = document.getElementById(`state-${state}`);
  if (active) active.style.display = 'block';
}

/**
 * Fill domain text into the correct state's domain element.
 * @param {string} state
 * @param {string|null} domain
 */
function fillDomain(state, domain) {
  const id = state === 'blocked' ? 'blocked-domain' : 'clean-domain';
  const el = document.getElementById(id);
  if (el) el.textContent = domain || '';
}

/**
 * Fill block details (reason, date, registry ID).
 * @param {object|null} details
 */
function fillDetails(details) {
  const reasonEl = document.getElementById('blocked-reason');
  const dateEl = document.getElementById('blocked-date');
  const idEl = document.getElementById('blocked-id');

  if (reasonEl) reasonEl.textContent = details?.reason || '\u2014';
  if (dateEl) dateEl.textContent = formatDate(details?.added_at) || '\u2014';
  if (idEl) idEl.textContent = details?.registry_id ? `#${details.registry_id}` : '\u2014';
}

/**
 * Fill database statistics into both blocked and clean state panels.
 * @param {{count: number, lastUpdate: string|null}} stats
 */
function fillStats(stats) {
  const countFormatted = stats?.count?.toLocaleString('ru-RU') || '0';
  const updatedFormatted = stats?.lastUpdate
    ? formatRelativeTime(stats.lastUpdate)
    : 'никогда';

  // Fill stats in blocked, clean, and not-applicable states
  for (const prefix of ['blocked', 'clean', 'na']) {
    const countEl = document.getElementById(`${prefix}-db-count`);
    const updatedEl = document.getElementById(`${prefix}-db-updated`);
    if (countEl) countEl.textContent = countFormatted;
    if (updatedEl) updatedEl.textContent = updatedFormatted;
  }
}

/**
 * Format an ISO date string as DD.MM.YYYY.
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  if (!isoString) return '\u2014';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('ru-RU');
  } catch {
    return isoString;
  }
}

/**
 * Format an ISO timestamp as a human-readable relative time string.
 * @param {string} isoString
 * @returns {string}
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();

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

// --- DEV-S4-05: Edge-case rendering ---

const EDGE_CASE_STATUS = {
  CHROME_INTERNAL: 'Служебная страница',
  ABOUT:           'Нет сайта для проверки',
  LOCAL_FILE:      'Проверка недоступна',
  IP_ADDRESS:      'IP-адрес',
  LOCALHOST:       'Локальный сервер',
  DATA_URI:        'Нет сайта для проверки',
  NO_URL:          'Нет сайта для проверки',
  INVALID:         'Некорректный адрес',
};

/**
 * Render the not-applicable state for edge-case URLs.
 * @param {string} type — classification type
 * @param {string} displayName — text to display as domain
 * @param {string} hint — explanatory text
 */
function renderEdgeCase(type, displayName, hint) {
  const domainEl = document.getElementById('na-domain');
  const statusEl = document.getElementById('na-status');
  const hintEl = document.getElementById('na-hint');

  if (domainEl) domainEl.textContent = displayName || '';
  if (statusEl) statusEl.textContent = EDGE_CASE_STATUS[type] || 'Нет сайта для проверки';
  if (hintEl) hintEl.textContent = hint || '';
}

// --- Freshness indicator ---

const FRESHNESS_MAP = {
  fresh:    { modifier: 'fresh',    text: 'актуальна' },
  stale:    { modifier: 'stale',    text: 'обновление рекомендуется' },
  outdated: { modifier: 'outdated', text: 'устарела' },
  error:    { modifier: 'error',    text: 'ошибка синхронизации' },
};

/**
 * Set the freshness indicator dot and text in both blocked and clean panels.
 * @param {string|undefined} freshness — one of 'fresh', 'stale', 'outdated', 'error'
 */
function fillFreshness(freshness) {
  const entry = FRESHNESS_MAP[freshness] || FRESHNESS_MAP.error;

  for (const prefix of ['blocked', 'clean']) {
    const dotEl = document.getElementById(`${prefix}-freshness-dot`);
    const textEl = document.getElementById(`${prefix}-freshness-text`);

    if (dotEl) {
      // Remove all modifier classes, then add the correct one
      for (const key of Object.keys(FRESHNESS_MAP)) {
        dotEl.classList.remove(`popup__freshness-dot--${key}`);
      }
      dotEl.classList.add(`popup__freshness-dot--${entry.modifier}`);
    }

    if (textEl) {
      textEl.textContent = entry.text;
    }
  }
}

// --- Sync button ---

let syncInProgress = false;

/**
 * Set the sync button visual state on all sync buttons.
 * @param {'idle'|'syncing'|'done'|'error'} state
 * @param {string} [errorMsg]
 */
function setSyncButtonState(state, errorMsg) {
  const buttons = document.querySelectorAll('[id^="btn-sync"]');
  for (const btn of buttons) {
    btn.classList.remove('popup__btn--syncing', 'popup__btn--done', 'popup__btn--error');
    btn.disabled = false;
    btn.title = '';

    switch (state) {
      case 'syncing':
        btn.classList.add('popup__btn--syncing');
        btn.textContent = 'Обновление...';
        btn.disabled = true;
        break;
      case 'done':
        btn.classList.add('popup__btn--done');
        btn.textContent = 'Обновлено \u2713';
        btn.disabled = true;
        break;
      case 'error':
        btn.classList.add('popup__btn--error');
        btn.textContent = 'Ошибка обновления';
        btn.disabled = true;
        if (errorMsg) btn.title = errorMsg;
        break;
      case 'idle':
      default:
        btn.textContent = 'Обновить базу';
        break;
    }
  }
}

/**
 * Handle sync button click.
 */
async function handleSyncClick() {
  if (syncInProgress) return;
  syncInProgress = true;
  setSyncButtonState('syncing');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'syncNow' });

    if (response?.success) {
      setSyncButtonState('done');
      if (response.stats) fillStats(response.stats);
      if (response.freshness) fillFreshness(response.freshness);
      setTimeout(() => setSyncButtonState('idle'), 2000);
    } else {
      setSyncButtonState('error', response?.error || 'Неизвестная ошибка');
      setTimeout(() => setSyncButtonState('idle'), 3000);
    }
  } catch (err) {
    setSyncButtonState('error', err.message);
    setTimeout(() => setSyncButtonState('idle'), 3000);
  } finally {
    syncInProgress = false;
  }
}

// --- Retry button ---

async function handleRetryClick() {
  showState('loading');
  await loadStatus();
}

// --- Load status from background ---

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getStatus' });

    if (!response) {
      showState('error');
      return;
    }

    const { state, domain, details, stats, freshness, type, hint } = response;

    // DEV-S4-05: Handle not-applicable edge-cases
    if (state === 'not-applicable') {
      showState('not-applicable');
      renderEdgeCase(type, domain, hint);
      fillStats(stats);
      return;
    }

    showState(state);
    fillDomain(state, domain);
    fillStats(stats);
    fillFreshness(freshness);

    if (state === 'blocked' && details) {
      fillDetails(details);
    }
  } catch (err) {
    console.error('[rknus] Popup error:', err);
    showState('error');
  }
}

// --- Initialization ---

async function init() {
  // DEV-S4-03: Apply theme before rendering
  await applyTheme();

  showState('loading');

  await loadStatus();

  // Bind sync buttons (one in blocked state, one in clean state)
  for (const btn of document.querySelectorAll('[id^="btn-sync"]')) {
    btn.addEventListener('click', handleSyncClick);
  }

  // Bind retry button
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleRetryClick);
  }
}

document.addEventListener('DOMContentLoaded', init);
