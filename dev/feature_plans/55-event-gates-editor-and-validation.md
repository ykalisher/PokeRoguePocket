# Phase 55 — Event gates: editor chips + validation

**Recommended agent:** Sonnet · high effort.
**Prereqs:** 54. **Read first:** `49-editor-polish-overview.md` (Locked spec → "Event gates").
**Goal:** The events editor can add/remove `locations` and `terrains` gate chips
(round-trip clean), the list/preview show the overrides, and bad values are validation
errors in both the editor and the Node tests.

## Context you need

All in `dev/editor/tab_events.js` unless noted; line numbers are hints — find the quoted
code. **Imitate the existing gate-chips (`types`) wiring exactly**; it is the pattern
for chip state, repaint, and round-trip fidelity (key deleted when the last chip goes).

- `chipListHtml(values, addScopeAttrs, removeAttrsFor, available)` (~line 469) builds a
  chip list but hardcodes `typeIconHtml(value)` inside each chip — location ids and
  terrain labels have no icons, hence a new plain variant below. `optionTags(list, selected)`
  already exists and is used by `chipListHtml`.
- `gateChipsHtml(draft)` (~line 479) is the model: add-select gets
  `data-scope="gate-add"`, removes get
  `data-action="chip-remove" data-chip="gate" data-chip-index="${index}"`.
- `commonZoneHtml(draft)` (~line 670) ends with
  `<label>Location gate types${gateChipsHtml(draft)}</label>` — the two new pickers go
  right after that label.
- The `change` listener (~line 933) has a `case 'gate-add':` that pushes into
  `draft.types` then falls through to `commit(repaint = true)` — copy that shape.
- The `click` listener's `chip-remove` branch (~line 1031) splices by
  `data-chip-index` and deletes the key when empty (`if (!draft.types.length) delete
  draft.types;`) — copy that shape.
- List "Gate" column: in `columns()` the entry with `key: 'types', label: 'Gate'`
  (~line 140). Preview: `eventPreviewHtml` computes `gates` from `draft.types`
  (~line 398, falls back to `'<span class="editor-muted">Any location</span>'`).
- Store access: `EditorApp.store.data.locations` is the live locations array (the
  editor loads all six JSON files).
- `dev/editor/validate.js`: `validateEvents(events, trainerNames, enums)` (~line 304)
  builds issues with `err(file, recordKey, code, message, field)`; the gate-type check
  is the `event.types !== undefined` block (~line 340). `validateAll` (~line 581)
  already has `const locations = data.locations || [];` in scope and calls
  `...validateEvents(events, trainerNames, enums)` — it just needs the 4th argument.
  The editor server and the browser both call `validateAll` with full data, so **no
  `server.js` change is needed**.
- Tests: `tests/data_validation.test.js` loads `locations` at the top (~line 42) and
  has the `'events.json entries are well-formed'` test (~line 199) with an
  `event.types !== undefined` block to mirror. `tests/editor_validation.test.js` has
  `withEvents(mutate)` + `hasCode(issues, code)` helpers — model the two new synthetic
  tests on the existing `'events: unknown effect type'` test.

## Steps

- [x] 1. **`tab_events.js`** — next to `chipListHtml`, add the plain (icon-less)
  variant and the two value providers + pickers:
  ```js
  function plainChipListHtml(values, addScopeAttrs, removeAttrsFor, available, placeholder) {
      const chips = values.map((value, index) =>
          `<span class="editor-chip">${escapeHtml(value)}` +
          `<button type="button" class="editor-chip-remove" ${removeAttrsFor(index)} aria-label="Remove ${escapeAttr(value)}">×</button></span>`
      ).join('');
      const remaining = available.filter((value) => !values.includes(value));
      return `<div class="editor-chip-list">${chips}` +
          `<select class="editor-chip-add" ${addScopeAttrs}><option value="">${placeholder}</option>${optionTags(remaining, '')}</select></div>`;
  }

  function locationIdValues() {
      return (EditorApp.store.data.locations || []).map((record) => record.id).sort();
  }

  function terrainValues() {
      // Distinct terrain labels, deduped case-insensitively, first-seen casing kept.
      const seen = new Map();
      (EditorApp.store.data.locations || []).forEach((record) => {
          const label = String(record.terrain || '').trim();
          if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
      });
      return Array.from(seen.values()).sort();
  }

  function locationChipsHtml(draft) {
      return plainChipListHtml(
          draft.locations || [],
          'data-scope="event-locations-add"',
          (index) => `data-action="chip-remove" data-chip="event-locations" data-chip-index="${index}"`,
          locationIdValues(),
          '+ location…'
      );
  }

  function terrainChipsHtml(draft) {
      return plainChipListHtml(
          draft.terrains || [],
          'data-scope="event-terrains-add"',
          (index) => `data-action="chip-remove" data-chip="event-terrains" data-chip-index="${index}"`,
          terrainValues(),
          '+ terrain…'
      );
  }
  ```
- [x] 2. **`tab_events.js`** — in `commonZoneHtml`, right after the
  `<label>Location gate types${gateChipsHtml(draft)}</label>` line, add:
  ```html
  <label>Only at locations${locationChipsHtml(draft)}</label>
  <label>Only at terrains${terrainChipsHtml(draft)}</label>
  <span class="editor-hint">If either override list is set, it replaces the type gate: the event appears only at those location ids / terrains.</span>
  ```
- [x] 3. **`tab_events.js`** — in the `change` listener's `switch`, add two cases
  modeled on `gate-add`:
  ```js
  case 'event-locations-add':
      if (value) { draft.locations = draft.locations || []; draft.locations.push(value); }
      break;
  case 'event-terrains-add':
      if (value) { draft.terrains = draft.terrains || []; draft.terrains.push(value); }
      break;
  ```
- [x] 4. **`tab_events.js`** — in the `click` listener's `chip-remove` branch, add two
  branches modeled on `chip === 'gate'`:
  ```js
  } else if (chip === 'event-locations') {
      draft.locations.splice(chipIndex, 1);
      if (!draft.locations.length) delete draft.locations;
  } else if (chip === 'event-terrains') {
      draft.terrains.splice(chipIndex, 1);
      if (!draft.terrains.length) delete draft.terrains;
  }
  ```
- [x] 5. **`tab_events.js`** — make the list "Gate" column override-aware (replace its
  `render`):
  ```js
  render: (record) => {
      const locs = Array.isArray(record.locations) ? record.locations : [];
      const terrs = Array.isArray(record.terrains) ? record.terrains : [];
      if (locs.length || terrs.length) {
          return locs.concat(terrs).map((value) => `<span class="editor-badge">${escapeHtml(value)}</span>`).join(' ');
      }
      return Array.isArray(record.types) && record.types.length
          ? record.types.map(typeIconHtml).join('')
          : '<span class="editor-muted">Any</span>';
  }
  ```
- [x] 6. **`tab_events.js`** — same precedence in `eventPreviewHtml`: replace the
  `const gates = ...` expression with:
  ```js
  const locs = Array.isArray(draft.locations) ? draft.locations : [];
  const terrs = Array.isArray(draft.terrains) ? draft.terrains : [];
  let gates;
  if (locs.length || terrs.length) {
      gates = locs.concat(terrs).map((value) => `<span class="editor-badge">${escapeHtml(value)}</span>`).join(' ');
  } else if (Array.isArray(draft.types) && draft.types.length) {
      gates = draft.types.map(typeIconHtml).join('');
  } else {
      gates = '<span class="editor-muted">Any location</span>';
  }
  ```
- [x] 7. **`dev/editor/validate.js`** — give `validateEvents` a 4th parameter and the
  two checks. Signature: `function validateEvents(events, trainerNames, enums, locations)`.
  At the top of the function add:
  ```js
  const locationIds = new Set((locations || []).map((record) => record && record.id).filter(Boolean));
  const terrainSet = new Set((locations || [])
      .map((record) => String((record && record.terrain) || '').trim().toLowerCase())
      .filter(Boolean));
  ```
  and directly after the `event.types !== undefined` gate-type block add:
  ```js
  if (event.locations !== undefined) {
      if (!Array.isArray(event.locations)) {
          issues.push(err('events.json', key, 'events.bad-locations', `${key}: locations must be an array`, 'locations'));
      } else {
          event.locations.forEach((id) => {
              if (!locationIds.has(id)) {
                  issues.push(err('events.json', key, 'events.unknown-location', `${key}: unknown location id ${id}`, 'locations'));
              }
          });
      }
  }
  if (event.terrains !== undefined) {
      if (!Array.isArray(event.terrains)) {
          issues.push(err('events.json', key, 'events.bad-terrains', `${key}: terrains must be an array`, 'terrains'));
      } else {
          event.terrains.forEach((label) => {
              const norm = String(label || '').trim().toLowerCase();
              if (!norm || !terrainSet.has(norm)) {
                  issues.push(err('events.json', key, 'events.unknown-terrain', `${key}: unknown terrain ${label}`, 'terrains'));
              }
          });
      }
  }
  ```
  Then in `validateAll`, change the call to
  `...validateEvents(events, trainerNames, enums, locations),`.
- [x] 8. **`tests/data_validation.test.js`** — in the events test, build the sets once
  before `events.forEach` (next to `const trainerNames = ...`):
  ```js
  const locationIds = new Set(locations.map(location => location.id));
  const terrainSet = new Set(locations.map(location => String(location.terrain || '').trim().toLowerCase()).filter(Boolean));
  ```
  and add, directly after the `event.types !== undefined` block:
  ```js
  if (event.locations !== undefined) {
      assert.ok(Array.isArray(event.locations), `${event.id}: locations must be an array`);
      event.locations.forEach(id => {
          assert.ok(locationIds.has(id), `${event.id}: unknown location id ${id}`);
      });
  }

  if (event.terrains !== undefined) {
      assert.ok(Array.isArray(event.terrains), `${event.id}: terrains must be an array`);
      event.terrains.forEach(label => {
          assert.ok(terrainSet.has(String(label).trim().toLowerCase()), `${event.id}: unknown terrain ${label}`);
      });
  }
  ```
- [x] 9. **`tests/editor_validation.test.js`** — add two synthetic tests next to the
  existing events tests:
  ```js
  test('events: unknown location id in locations override', () => {
      const data = withEvents((events) => { events[0].locations = ['not-a-real-place']; });
      const issues = validateAll(data, { enums: live.enums });
      assert.ok(hasCode(issues, 'events.unknown-location'));
  });

  test('events: unknown terrain in terrains override', () => {
      const data = withEvents((events) => { events[0].terrains = ['NotATerrain']; });
      const issues = validateAll(data, { enums: live.enums });
      assert.ok(hasCode(issues, 'events.unknown-terrain'));
  });
  ```

## Verification

- [x] `node tests/run_all.js` green.
- [x] `cd dev/verify && .cache/venv/bin/python drive_editor.py` passes.
- [x] Browser check passes — save as `<scratchpad>/check_phase55.py`, run with
  `dev/verify/.cache/venv/bin/python <scratchpad>/check_phase55.py` from the repo root;
  must print `OK` (nothing is saved):
  ```python
  import sys
  sys.path.insert(0, 'dev/verify')
  from drive_editor import serving_editor
  from playwright.sync_api import sync_playwright

  failures = []
  with serving_editor() as base_url, sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      page = browser.new_page()
      page.on('pageerror', lambda err: failures.append(f'pageerror: {err}'))
      try:
          page.goto(base_url + '/')
          page.wait_for_selector('#editor-tabs .editor-tab[data-tab="events"]', timeout=15000)
          page.click('#editor-tabs .editor-tab[data-tab="events"]')
          visible_row = '.editor-tab-panel:not([hidden]) table.editor-table tbody tr.editor-row'
          page.wait_for_selector(visible_row, timeout=15000)
          page.click(visible_row)
          page.wait_for_selector('select[data-scope="event-locations-add"]', timeout=15000)

          page.select_option('select[data-scope="event-locations-add"]', 'seafoam-islands')
          page.wait_for_selector('[data-chip="event-locations"]', timeout=5000)
          page.select_option('select[data-scope="event-terrains-add"]', 'Island')
          page.wait_for_selector('[data-chip="event-terrains"]', timeout=5000)

          preview = page.text_content('.editor-preview') or ''
          if 'seafoam-islands' not in preview or 'Island' not in preview:
              failures.append('preview does not show the override badges')

          # Removing both chips must drop the draft keys again (round-trip clean).
          page.click('[data-chip="event-locations"]')
          page.click('[data-chip="event-terrains"]')
          if page.query_selector('[data-chip="event-locations"]') or page.query_selector('[data-chip="event-terrains"]'):
              failures.append('chip removal left override chips behind')
      finally:
          browser.close()

  if failures:
      print('FAIL:\n' + '\n'.join(failures))
      sys.exit(1)
  print('OK')
  ```
  (If the preview panel's root selector differs, find the preview container class in
  `app.js`'s `openEditor` and adjust the `.editor-preview` selector — the assertion is
  that the two chosen values appear in the rendered preview.)
- [x] Round-trip stays clean: with the editor server running, opening and saving an
  untouched event must not change `events.json` — or simply confirm the last chip
  removal deletes the keys (the browser check asserts this) and that
  `git diff events.json` is empty after the checks.

## Out of scope / do not touch

Do not add the new fields to any live event in `events.json` (the owner authors those).
Do not touch `scripts/manage_events.js` or `map/` (done in phase 54). The events list's
"Gate types" filter dropdown still filters by `types` only — leave it. Do not
`git commit`.
