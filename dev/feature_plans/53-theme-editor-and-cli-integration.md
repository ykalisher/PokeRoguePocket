# Phase 53 — Theme integration: editor auto-derive + CLI stops asking for colors

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 52. **Read first:** `49-editor-polish-overview.md` (Locked spec → "Type-derived theme").
**Goal:** In the locations editor, changing types re-derives an untouched theme, a
"Use type colors" button force-applies it, manual picker edits survive type changes;
`manage_locations.js` derives the theme instead of prompting for five hex values.

## Context you need

- `scripts/location_theme.js` (phase 52) exports `{ TYPE_COLORS, NEUTRAL_THEME,
  deriveLocationTheme }` via CommonJS **and** `window.LocationTheme`. The editor server
  serves any repo file, so the GUI can load it with a plain script tag.
- `dev/editor/tab_locations.js` facts (line numbers are hints):
  - `THEME_KEYS = ['accent', 'glow', 'surface', 'bgDeep', 'bgMid']` and
    `NEUTRAL_LOCATION_THEME` are defined near the top (~lines 21–31).
  - The five color pickers are rendered by `colorFieldHtml` into the theme form row
    (`formHtml`, `${THEME_KEYS.map((key) => colorFieldHtml(theme, key)).join('')}`).
  - Type chips: adds arrive in the form's `input` listener under
    `if (target.dataset.chipAdd) { ... draft[field] = (draft[field] || []).concat(target.value); paint(); ... }`;
    removes arrive in the `click` listener under
    `event.target.closest('[data-chip-remove]')` which does `draft[field].splice(index, 1); paint(); ...`.
    Both are followed by `api.markDirty(); api.refreshPreview();`.
  - `template()` for a new record uses the neutral theme and empty `types`, so with the
    "untouched" rule below, a new location auto-derives on its first chip add.
  - After phase 52, every stored location theme equals `deriveLocationTheme(location.types)`,
    so existing records also count as "untouched" and re-derive on type changes.
- `scripts/manage_locations.js` facts: `HEX_PATTERN` (~line 8), `NEUTRAL_THEME` +
  `THEME_FIELDS` (~lines 10–26), `handleAddLocation` calls `const theme = await
  askTheme(rl);` after `askTypes` (~line 77), `askTheme`/`askHex` (~lines 116–133).
  **Never run this script** — edit it and syntax-check only (owner-authorized edit, see
  overview ground rules).

## Steps

- [x] 1. **`dev/editor/index.html`** — add
  `<script src="/scripts/location_theme.js"></script>` immediately **before** the
  `<script src="/dev/editor/validate.js"></script>` tag (any spot before the tab
  scripts works; keep it with the other shared modules).
- [x] 2. **`dev/editor/tab_locations.js`** — add two helpers right after
  `NEUTRAL_LOCATION_THEME`:
  ```js
  function themesEqual(a, b) {
      return THEME_KEYS.every((key) =>
          String((a && a[key]) || '').toLowerCase() === String((b && b[key]) || '').toLowerCase());
  }

  // Auto-apply the derived theme on a types change only while the theme is
  // "untouched" (still the derivation of the previous types, or the neutral
  // template); one manual picker edit makes it sticky.
  function maybeApplyDerivedTheme(draft, previousTypes) {
      const derivePrev = window.LocationTheme.deriveLocationTheme(previousTypes);
      const untouched = themesEqual(draft.theme, derivePrev)
          || themesEqual(draft.theme, NEUTRAL_LOCATION_THEME);
      if (untouched) draft.theme = window.LocationTheme.deriveLocationTheme(draft.types || []);
  }
  ```
- [x] 3. **`dev/editor/tab_locations.js`** — in the form `input` listener's chip-add
  branch, capture the previous list and derive when the types changed:
  ```js
  if (target.dataset.chipAdd) {
      const field = target.dataset.chipAdd;
      if (target.value) {
          const before = (draft[field] || []).slice();
          draft[field] = before.concat(target.value);
          if (field === 'types') maybeApplyDerivedTheme(draft, before);
          paint();
          api.markDirty();
          api.refreshPreview();
      }
      return;
  }
  ```
- [x] 4. **`dev/editor/tab_locations.js`** — same treatment in the `click` listener's
  chip-remove branch: before the `splice`, `const before = (draft[field] || []).slice();`
  and after it, `if (field === 'types') maybeApplyDerivedTheme(draft, before);` (keep the
  existing `paint(); api.markDirty(); api.refreshPreview();`).
- [x] 5. **`dev/editor/tab_locations.js`** — in `formHtml`, append a button to the theme
  row (after the five `colorFieldHtml` pickers, inside the same `.editor-form-row`):
  ```html
  <button type="button" class="editor-btn" data-action="apply-type-theme">Use type colors</button>
  ```
  and add a branch to the `click` listener (alongside the existing
  `data-action="set-canonical-background"` branch):
  ```js
  const themeBtn = event.target.closest('[data-action="apply-type-theme"]');
  if (themeBtn) {
      draft.theme = window.LocationTheme.deriveLocationTheme(draft.types || []);
      paint();
      api.markDirty();
      api.refreshPreview();
      return;
  }
  ```
- [x] 6. **`scripts/manage_locations.js`** — stop prompting for colors:
  - Add `const { deriveLocationTheme } = require('./location_theme');` next to the
    `data_options` require.
  - Delete `HEX_PATTERN`, the `NEUTRAL_THEME` block, and `THEME_FIELDS`.
  - In `handleAddLocation`, replace `const theme = await askTheme(rl);` with
    `const theme = deriveLocationTheme(types);` (it already runs after `askTypes`).
  - Delete the now-unused `askTheme` and `askHex` functions.
  - Change nothing else (menu flow, `writeLocations`, other prompts stay as they are).

## Verification

- [x] `node tests/run_all.js` green.
- [x] `node -e "const m = require('./scripts/manage_locations.js')"` is **not** how to
  check the CLI (it would launch the interactive menu) — instead confirm syntax only:
  `node --check scripts/manage_locations.js` (the edit hook does this too) and
  `grep -c askTheme scripts/manage_locations.js` prints `0`.
- [x] `cd dev/verify && .cache/venv/bin/python drive_editor.py` passes (catches
  script-tag/load-order mistakes — any page error fails it).
- [x] Browser check passes — save as `<scratchpad>/check_phase53.py`, run with
  `dev/verify/.cache/venv/bin/python <scratchpad>/check_phase53.py` from the repo root;
  must print `OK`. Nothing is saved, so no git restore is needed:
  ```python
  import sys
  sys.path.insert(0, 'dev/verify')
  from drive_editor import serving_editor
  from playwright.sync_api import sync_playwright

  failures = []
  ACCENT = "document.querySelector('input[type=color][data-theme-key=accent]')"
  with serving_editor() as base_url, sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      page = browser.new_page()
      page.on('pageerror', lambda err: failures.append(f'pageerror: {err}'))
      try:
          page.goto(base_url + '/')
          page.wait_for_selector('#editor-tabs .editor-tab[data-tab="locations"]', timeout=15000)
          page.click('#editor-tabs .editor-tab[data-tab="locations"]')
          visible_row = '.editor-tab-panel:not([hidden]) table.editor-table tbody tr.editor-row'
          page.wait_for_selector(visible_row, timeout=15000)
          page.click(visible_row)
          page.wait_for_selector('input[type=color][data-theme-key=accent]', timeout=15000)

          before = page.evaluate(ACCENT + '.value')
          # Remove the first type chip: theme is untouched post-phase-52, so it re-derives.
          page.click('[data-chip-remove="types"]')
          derived = page.evaluate(ACCENT + '.value')
          if derived == before:
              failures.append('removing a type chip did not re-derive the accent')

          # Manually override the accent, then change types again: override must survive.
          page.evaluate(
              "() => { const el = " + ACCENT + "; el.value = '#123456';"
              " el.dispatchEvent(new Event('input', { bubbles: true })); }")
          page.select_option('select.editor-chip-add[data-chip-add="types"]', index=1)
          kept = page.evaluate(ACCENT + '.value')
          if kept != '#123456':
              failures.append(f'manual accent was clobbered by a types change: {kept}')

          # "Use type colors" force-reapplies the derivation.
          page.click('[data-action="apply-type-theme"]')
          reset = page.evaluate(ACCENT + '.value')
          if reset == '#123456':
              failures.append('"Use type colors" did not overwrite the manual accent')
      finally:
          browser.close()

  if failures:
      print('FAIL:\n' + '\n'.join(failures))
      sys.exit(1)
  print('OK')
  ```

## Out of scope / do not touch

Do not run `scripts/manage_locations.js`. Do not change `scripts/location_theme.js`'s
constants (tuning happens only if the owner asks). Do not touch runtime theme code
(`map/locations.js`, `arena/arena_data.js`) or save any location from the browser
check. Do not `git commit`.
