# Sprint 6 — Content Script: Test Plan

## QA-S6-01: Manual Checklist

### Banner on blocked sites
- [ ] Content script loads on regular (non-blocked) sites without errors
- [ ] Banner appears at the top of the page on a blocked site
- [ ] Banner text contains the domain name and "реестре РКН"
- [ ] Banner close button (✕) removes the banner from the page
- [ ] After closing, banner does NOT reappear on page reload within the same session (sessionStorage key `rknus-banner-dismissed`)
- [ ] Banner reappears in a new session (new tab / cleared sessionStorage)

### Link highlighting
- [ ] Links pointing to blocked domains get `data-rknus-blocked="true"` attribute
- [ ] Blocked links have red outline (2px solid #EF4444) and wavy underline
- [ ] Tooltip appears on mouseenter over a blocked link with text "⛔ domain — в реестре РКН"
- [ ] Tooltip disappears on mouseleave
- [ ] Tooltip is positioned near the cursor and does not overflow viewport

### Shadow DOM isolation
- [ ] Banner and tooltip elements live inside a closed Shadow DOM (`#rknus-host`)
- [ ] Host page styles (e.g., `* { color: green }`) do NOT leak into banner/tooltip
- [ ] Banner/tooltip styles do NOT affect host page elements
- [ ] Host element has `all: initial` and `pointer-events: none` (banner itself has `pointer-events: auto`)

### Compatibility
- [ ] Content script does not break google.com (search, navigation work)
- [ ] Content script does not break youtube.com (video playback, comments work)
- [ ] Content script does not break vk.com (feed, messaging work)
- [ ] No console errors from the extension on these sites

### Settings integration
- [ ] When `contentScriptEnabled` is `false` in chrome.storage.sync, content script does NOT inject banner or scan links
- [ ] When `contentScriptEnabled` is `true` (default), content script works normally

### Performance (throttling)
- [ ] Pages with >500 links do not freeze the main thread
- [ ] Domains are checked in batches of 50 (BATCH_SIZE)
- [ ] Between batches, the script yields via requestIdleCallback / setTimeout
- [ ] No visible UI jank on link-heavy pages (e.g., Wikipedia article with many references)

---

## QA-S6-03: Regression Checklist

### Extension stability
- [ ] Extension does not crash (no uncaught exceptions in console) on:
  - google.com
  - youtube.com
  - vk.com
  - wikipedia.org
  - github.com
- [ ] Console does not contain errors originating from `[rknus]` on non-blocked sites
- [ ] Host page styles are not visibly altered by the extension (no layout shifts, no color changes)
- [ ] Previously working features still function:
  - Badge text updates on tab switch
  - Popup shows correct status
  - Options page saves/loads settings
  - Sync mechanism works
