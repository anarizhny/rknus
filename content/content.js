/**
 * Content Script — Sprint 6
 *
 * DEV-S6-01: Banner warning on blocked sites
 * DEV-S6-02: Link highlighting for blocked domains
 * DEV-S6-03: Shadow DOM isolation
 * DEV-S6-04: Throttled batch checking for pages with many links
 */

(function () {
  'use strict';

  // --- DEV-S6-03: Shadow DOM ---

  /** @type {ShadowRoot|null} */
  let shadowRoot = null;

  /** @type {HTMLElement|null} */
  let hostEl = null;

  /**
   * Create the Shadow DOM host and attach a closed shadow root.
   * All banner/tooltip elements live inside the shadow root.
   * @returns {ShadowRoot}
   */
  function ensureShadowHost() {
    if (shadowRoot) return shadowRoot;

    hostEl = document.createElement('div');
    hostEl.id = 'rknus-host';
    // Make sure host does not interfere with page layout
    hostEl.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 100%; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(hostEl);

    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    // Inject styles inside shadow root
    const style = document.createElement('style');
    style.textContent = getShadowStyles();
    shadowRoot.appendChild(style);

    return shadowRoot;
  }

  /**
   * CSS styles injected into the shadow root.
   */
  function getShadowStyles() {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .rknus-banner {
        all: initial;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 16px;
        background: #DC2626;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.4;
        z-index: 2147483647;
        pointer-events: auto;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .rknus-banner-text {
        flex: 1;
        margin-right: 12px;
      }

      .rknus-banner-close {
        all: initial;
        cursor: pointer;
        pointer-events: auto;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: #fff;
        font-size: 18px;
        width: 28px;
        height: 28px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        transition: background 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .rknus-banner-close:hover {
        background: rgba(255, 255, 255, 0.35);
      }

      .rknus-tooltip {
        all: initial;
        position: fixed;
        padding: 6px 10px;
        background: #1F2937;
        color: #F9FAFB;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.4;
        border-radius: 6px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        white-space: nowrap;
        max-width: 350px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;
  }

  // --- DEV-S6-01: Banner ---

  const SESSION_KEY = 'rknus-banner-dismissed';

  /**
   * Show a warning banner at the top of the page.
   * @param {string} domain — the blocked domain name
   */
  function showBanner(domain) {
    // Don't show if already dismissed this session
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const shadow = ensureShadowHost();

    const banner = document.createElement('div');
    banner.className = 'rknus-banner';

    const text = document.createElement('span');
    text.className = 'rknus-banner-text';
    text.textContent = `\u26A0\uFE0F ${domain} \u2014 \u0441\u0430\u0439\u0442 \u0432 \u0440\u0435\u0435\u0441\u0442\u0440\u0435 \u0420\u041A\u041D`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rknus-banner-close';
    closeBtn.textContent = '\u2715';
    closeBtn.title = '\u0417\u0430\u043A\u0440\u044B\u0442\u044C';
    closeBtn.addEventListener('click', () => {
      banner.remove();
      sessionStorage.setItem(SESSION_KEY, '1');
    });

    banner.appendChild(text);
    banner.appendChild(closeBtn);
    shadow.appendChild(banner);
  }

  // --- DEV-S6-02: Link highlighting & tooltips ---

  /** @type {HTMLElement|null} Current tooltip element */
  let currentTooltip = null;

  /**
   * Extract domain from an href string.
   * @param {string} href
   * @returns {string|null}
   */
  function extractDomainFromHref(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      if (!url.protocol.startsWith('http')) return null;
      let hostname = url.hostname.toLowerCase();
      if (hostname.startsWith('www.')) hostname = hostname.slice(4);
      return hostname || null;
    } catch {
      return null;
    }
  }

  /**
   * Collect all unique domains from <a> elements on the page.
   * @returns {{ domains: string[], linksByDomain: Map<string, HTMLAnchorElement[]> }}
   */
  function collectLinkDomains() {
    const links = document.querySelectorAll('a[href]');
    /** @type {Map<string, HTMLAnchorElement[]>} */
    const linksByDomain = new Map();

    for (const link of links) {
      const domain = extractDomainFromHref(link.href);
      if (!domain) continue;
      if (!linksByDomain.has(domain)) {
        linksByDomain.set(domain, []);
      }
      linksByDomain.get(domain).push(link);
    }

    return {
      domains: Array.from(linksByDomain.keys()),
      linksByDomain,
    };
  }

  /**
   * Mark links as blocked and attach tooltip listeners.
   * @param {HTMLAnchorElement[]} links
   * @param {string} domain
   */
  function markLinks(links, domain) {
    for (const link of links) {
      link.setAttribute('data-rknus-blocked', 'true');
      link.addEventListener('mouseenter', (e) => showTooltip(e, domain));
      link.addEventListener('mouseleave', hideTooltip);
    }
  }

  /**
   * Show a tooltip near the hovered blocked link.
   * @param {MouseEvent} e
   * @param {string} domain
   */
  function showTooltip(e, domain) {
    hideTooltip();

    const shadow = ensureShadowHost();
    const tooltip = document.createElement('div');
    tooltip.className = 'rknus-tooltip';
    tooltip.textContent = `\u26D4 ${domain} \u2014 \u0432 \u0440\u0435\u0435\u0441\u0442\u0440\u0435 \u0420\u041A\u041D`;

    shadow.appendChild(tooltip);
    currentTooltip = tooltip;

    // Position near cursor
    const x = Math.min(e.clientX + 12, window.innerWidth - 360);
    const y = e.clientY + 20;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  /**
   * Hide the current tooltip.
   */
  function hideTooltip() {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  }

  // --- DEV-S6-04: Throttled batch checking ---

  /** Batch size for throttled domain checks */
  const BATCH_SIZE = 50;

  /**
   * Check domains in batches, yielding to the main thread between batches.
   * Uses requestIdleCallback where available, falls back to setTimeout.
   * @param {string[]} domains
   * @param {Map<string, HTMLAnchorElement[]>} linksByDomain
   */
  async function checkDomainsThrottled(domains, linksByDomain) {
    const schedule = typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(fn, { timeout: 200 })
      : (fn) => setTimeout(fn, 0);

    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE);

      // Send batch to background
      const results = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'checkDomains', domains: batch },
          (response) => {
            resolve(response || {});
          }
        );
      });

      // Mark blocked links from this batch
      for (const domain of batch) {
        if (results[domain]) {
          const links = linksByDomain.get(domain);
          if (links) markLinks(links, domain);
        }
      }

      // Yield to the main thread between batches (only if more remain)
      if (i + BATCH_SIZE < domains.length) {
        await new Promise((resolve) => schedule(resolve));
      }
    }
  }

  // --- Main ---

  async function main() {
    // Content script is only injected on blocked sites by background.js,
    // so we always show the banner. Extract domain from page hostname.
    const domain = location.hostname.replace(/^www\./, '').toLowerCase();

    // Don't show if already dismissed this session
    showBanner(domain);

    // DEV-S6-02: Scan links on the page for other blocked domains
    scanLinks();
  }

  /**
   * Scan all links on the page and highlight blocked ones.
   */
  function scanLinks() {
    const { domains, linksByDomain } = collectLinkDomains();
    if (domains.length === 0) return;

    // DEV-S6-04: If many links, use throttled batching
    if (domains.length > BATCH_SIZE) {
      checkDomainsThrottled(domains, linksByDomain);
    } else {
      // Small number — single batch
      chrome.runtime.sendMessage(
        { type: 'checkDomains', domains },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[rknus] checkDomains error:', chrome.runtime.lastError.message);
            return;
          }
          if (!response) return;

          for (const [domain, blocked] of Object.entries(response)) {
            if (blocked) {
              const links = linksByDomain.get(domain);
              if (links) markLinks(links, domain);
            }
          }
        }
      );
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
