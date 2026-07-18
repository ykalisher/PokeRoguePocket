# Phase 56 — Balance-notes "i" button (Pokemon + Attacks sections)

**Recommended agent:** Sonnet · low effort.
**Prereqs:** 50 (independent of 51–55). **Read first:** `49-editor-polish-overview.md`.
**Goal:** A small round "i" button in the editor header, visible only while the Pokemon
or Attacks section is active (list *and* detail views), opening a modal with the owner's
balance notes **verbatim**.

## Context you need

- `dev/editor/index.html`: `<header class="editor-header">` holds the title and
  `<nav id="editor-tabs">`. The button must be a **sibling** of the nav, not inside it —
  `renderTabBar()` in `app.js` rewrites the nav's `innerHTML` on every `registerTab`
  call and would wipe anything placed inside.
- `dev/editor/app.js`: module-level `activeTab` + `tabs` Map; `registerTab(name,
  config)` stores the config as-is, so an extra `info` key rides along untouched;
  `showTab(name)` sets `activeTab` — and **`activeTab` does not change when a detail
  editor opens**, so one hook in `showTab` covers list and detail views. `showModal({
  title, bodyHtml })` and `escapeHtml` already exist file-private in app.js — wire the
  click inside app.js and nothing needs exporting. `init()` is where one-time DOM
  wiring belongs.
- `dev/editor/editor.css`: match the `.editor-tab` pill look (border
  `1px solid rgba(251, 246, 232, 0.18)`, `background: rgba(0, 0, 0, 0.18)`,
  `color: var(--muted)`, hover brightens).
- Tab registrations to extend: `EditorApp.registerTab('pokemon', { label: 'Pokemon',
  render });` at the bottom of `dev/editor/tab_pokemon.js`, and the matching line in
  `dev/editor/tab_attacks.js`.
- `dev/verify/drive_editor.py` asserts `#editor-tabs .editor-tab` count == 7; a sibling
  button doesn't disturb that.
- **The note text is sacred**: the owner said "it should be exactly as written". Copy
  the arrays below character-for-character (em dashes `—`, inconsistent `:` vs `—`,
  numbering, casing). Do not normalize anything.

## Steps

- [ ] 1. **`dev/editor/index.html`** — inside the header, after the
  `<nav id="editor-tabs" ...></nav>` line, add:
  ```html
  <button type="button" id="editor-info-btn" class="editor-info-btn" hidden aria-label="Balance notes">i</button>
  ```
- [ ] 2. **`dev/editor/app.js`** — add next to `paintActiveTab`:
  ```js
  function updateInfoButton() {
      const button = document.getElementById('editor-info-btn');
      if (!button) return;
      const tab = tabs.get(activeTab);
      button.hidden = !(tab && tab.info);
  }
  ```
  and call `updateInfoButton();` at the end of `showTab(name)` (after the
  `tab.onShow` line).
- [ ] 3. **`dev/editor/app.js`** — near `showModal`, add the body renderer:
  ```js
  function infoNotesHtml(lines) {
      return `<div class="editor-info-notes">${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;
  }
  ```
  and wire the click once in `init()` (before the final `showTab(tabOrder[0])` call):
  ```js
  const infoButton = document.getElementById('editor-info-btn');
  if (infoButton) {
      infoButton.addEventListener('click', () => {
          const tab = tabs.get(activeTab);
          if (tab && tab.info) showModal({ title: tab.info.title, bodyHtml: infoNotesHtml(tab.info.lines) });
      });
  }
  ```
- [ ] 4. **`dev/editor/editor.css`** — add after the `.editor-tab` rules:
  ```css
  .editor-info-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: 1px solid rgba(251, 246, 232, 0.18);
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.18);
      color: var(--muted);
      font: inherit;
      font-weight: 700;
      font-style: italic;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .editor-info-btn:hover {
      color: #fbf6e8;
      border-color: var(--gold);
  }

  .editor-info-notes p {
      margin: 0 0 6px;
      white-space: pre-wrap;
  }
  ```
- [ ] 5. **`dev/editor/tab_pokemon.js`** — extend the registration at the bottom of the
  file to (text verbatim):
  ```js
  EditorApp.registerTab('pokemon', {
      label: 'Pokemon',
      render,
      info: {
          title: 'Pokemon balance notes',
          lines: [
              '1. major legendaries — 410 BST',
              '2. Minor legendaries: 390 BST',
              '3. Fossil major legendaries: 350 BST',
              '4. Fossil minor legendaries: 330 BST',
              '5. Dragon types — 370',
              '6. High-tier non-legendaries — 350-360',
              '7. Low-tier non-legendaries — 330-340',
              '8. Non-legendary fossils — 310'
          ]
      }
  });
  ```
- [ ] 6. **`dev/editor/tab_attacks.js`** — same shape at the bottom of the file (text
  verbatim):
  ```js
  EditorApp.registerTab('attacks', {
      label: 'Attacks',
      render,
      info: {
          title: 'Attack balance notes',
          lines: [
              'Legendary two-type attacks no effect: 85 for single opponent, 80 for all opponents',
              'Legendary two-type attacks + effect: 80 for single opponent, 75 for all opponents',
              'Legendary single-type attacks no effect: 75 for single opponent, 70 for all',
              'Legendary single-type attacks + effect: 70 for single opponent, 65 for all',
              'two-type attacks no effect: 70 for single opponent, 65 for all',
              'two-type attacks + effect: 65 for single opponent, 60 for all',
              'single-type attack no effect: 60 for single opponent, 55 for all',
              'single-type attack + effect: 55 for single opponent, 50 for all'
          ]
      }
  });
  ```

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `cd dev/verify && .cache/venv/bin/python drive_editor.py` passes (still 7 tabs).
- [ ] Browser check passes — save as `<scratchpad>/check_phase56.py`, run with
  `dev/verify/.cache/venv/bin/python <scratchpad>/check_phase56.py` from the repo root;
  must print `OK`:
  ```python
  import sys
  sys.path.insert(0, 'dev/verify')
  from drive_editor import serving_editor
  from playwright.sync_api import sync_playwright

  failures = []

  def visible(page):
      return page.evaluate("!document.getElementById('editor-info-btn').hidden")

  with serving_editor() as base_url, sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      page = browser.new_page()
      page.on('pageerror', lambda err: failures.append(f'pageerror: {err}'))
      try:
          page.goto(base_url + '/')
          page.wait_for_selector('#editor-tabs .editor-tab', timeout=15000)

          if not visible(page):
              failures.append('button hidden on the Pokemon tab')
          page.click('#editor-info-btn')
          body = page.text_content('.editor-modal-body') or ''
          if '410 BST' not in body or 'Non-legendary fossils — 310' not in body:
              failures.append('pokemon notes missing or altered')
          page.click('[data-action="close-modal"]')

          # Still visible while a detail editor is open.
          page.click('.editor-tab-panel:not([hidden]) table.editor-table tbody tr.editor-row')
          page.wait_for_selector('[data-action="back"]', timeout=15000)
          if not visible(page):
              failures.append('button hidden while editing a pokemon')
          page.click('[data-action="back"]')

          page.click('#editor-tabs .editor-tab[data-tab="items"]')
          if visible(page):
              failures.append('button visible on the Items tab')

          page.click('#editor-tabs .editor-tab[data-tab="attacks"]')
          if not visible(page):
              failures.append('button hidden on the Attacks tab')
          page.click('#editor-info-btn')
          body = page.text_content('.editor-modal-body') or ''
          if '85 for single opponent, 80 for all opponents' not in body:
              failures.append('attack notes missing or altered')
      finally:
          browser.close()

  if failures:
      print('FAIL:\n' + '\n'.join(failures))
      sys.exit(1)
  print('OK')
  ```
- [ ] Diff the eight note lines in `tab_attacks.js` and the eight in `tab_pokemon.js`
  against the arrays in this file — they must be character-identical (watch the `—` em
  dashes).

## Out of scope / do not touch

No notes on any other tab (items, trainers, events, locations, issues get no `info`
key). Do not export `showModal` from EditorApp. Do not edit the note wording, ever —
if a line looks inconsistent, that is how the owner wrote it. Do not `git commit`.
