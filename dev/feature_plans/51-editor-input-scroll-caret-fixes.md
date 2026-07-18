# Phase 51 — Editor input size, scroll preservation, ID caret fixes

**Recommended agent:** Sonnet · low effort.
**Prereqs:** 50 (green baseline). **Read first:** `49-editor-polish-overview.md`.
**Goal:** Inline stat editing uses a compact input and no longer jumps the list back to
the top; typing in a location's ID field never loses the cursor. All verified in a real
browser.

## Context you need

Three independent bugs, three files. Line numbers are 2026-07-18 hints — locate by the
quoted code.

1. **Oversized inline input.** `dev/editor/list_view.js` (`beginCellEdit`, ~line 206)
   injects `<input type="number" class="editor-cell-input">` into a stat cell.
   `.editor-cell-input` in `dev/editor/editor.css` (~line 571) has `width: 100%`, but the
   table is auto-layout and the cell is content-sized, so the input falls back to its
   ~170px intrinsic width and blows out the column. Fix is CSS-only: fixed narrow width
   + hidden number spinners.
2. **Scroll lost on commit.** In `list_view.js`, `commit()` (~line 241) calls
   `renderBody()`, which does `wrap.outerHTML = renderTable(visible)` on
   `.editor-table-wrap` — and that element is itself the scroll container
   (`max-height: 68vh; overflow: auto`), so replacing it resets `scrollTop`.
   `scrollSelectedIntoView()` doesn't help because inline cell edits never select the
   row. The other `renderBody()` callers (search input, filter selects, sort header
   clicks) *should* keep jumping to the top — only the commit path preserves scroll.
   (Confirmed: no second re-render happens after a save — `computeIssues` only bumps a
   version counter that matters on the next tab switch.)
3. **ID caret loss.** In `dev/editor/tab_locations.js`, `renderForm`'s `input` listener
   ends with `if (field === 'id') paint();` (~line 290), where `paint()` does
   `el.innerHTML = formHtml(draft)` — rebuilding the whole form on every keystroke
   destroys the focused `<input name="id">`. The repaint exists only so the background
   block (`backgroundRowHtml`, ~lines 204–220: canonical-path hint + "Set canonical
   path" button disabled-state) tracks the id. Fix: re-render just that block. The
   "Set canonical path" button keeps working because its click handler is delegated on
   `el`; the preview pane already refreshes via `api.refreshPreview()`.

## Steps

- [ ] 1. **`dev/editor/editor.css`** — replace the `.editor-cell-input` rule's
  `width: 100%;` with a fixed compact width and add spinner suppression. Final result:
  ```css
  .editor-cell-input {
      width: 6ch;
      box-sizing: border-box;
      padding: 3px 6px;
      border-radius: 4px;
      border: 1px solid var(--gold);
      background: rgba(0, 0, 0, 0.3);
      color: #fbf6e8;
      font: inherit;
      font-variant-numeric: tabular-nums;
      text-align: right;
      -moz-appearance: textfield;
      appearance: textfield;
  }

  .editor-cell-input::-webkit-outer-spin-button,
  .editor-cell-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
  }
  ```
- [ ] 2. **`dev/editor/list_view.js`** — give `renderBody` an options parameter that
  preserves the scroll offsets across the `outerHTML` replacement:
  ```js
  // Replaces only the count + table, leaving the toolbar DOM alone.
  function renderBody(options) {
      const preserveScroll = Boolean(options && options.preserveScroll);
      const visible = visibleRecords();
      const countEl = root.querySelector('.editor-count');
      if (countEl) countEl.textContent = `${visible.length} record${visible.length === 1 ? '' : 's'}`;
      const wrap = root.querySelector('.editor-table-wrap');
      const scroll = preserveScroll && wrap ? { top: wrap.scrollTop, left: wrap.scrollLeft } : null;
      if (wrap) wrap.outerHTML = renderTable(visible);
      if (scroll) {
          // The fresh wrap starts at 0/0; restore instead of scrollSelectedIntoView,
          // which could undo the restore.
          const fresh = root.querySelector('.editor-table-wrap');
          if (fresh) {
              fresh.scrollTop = scroll.top;
              fresh.scrollLeft = scroll.left;
          }
          return;
      }
      scrollSelectedIntoView();
  }
  ```
- [ ] 3. **`dev/editor/list_view.js`** — in `commit()` inside `beginCellEdit`, change the
  post-save call `renderBody();` to `renderBody({ preserveScroll: true });`. Leave every
  other `renderBody()` call site argument-less.
- [ ] 4. **`dev/editor/tab_locations.js`** — in `formHtml(draft)`, wrap the background
  block in a named container: change `${backgroundRowHtml(draft)}` to
  `<div data-role="background-row">${backgroundRowHtml(draft)}</div>`.
- [ ] 5. **`dev/editor/tab_locations.js`** — in the form `input` listener, replace
  `if (field === 'id') paint();` with a subtree-only refresh:
  ```js
  if (field === 'id') {
      const row = el.querySelector('[data-role="background-row"]');
      if (row) row.innerHTML = backgroundRowHtml(draft);
  }
  ```
  Do not touch the `paint()` calls in the chip-add/remove or button click handlers
  (those are click-driven; there is no caret to lose).

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `cd dev/verify && .cache/venv/bin/python drive_editor.py` passes (its inline-edit
  round-trip exercises the new commit path; run `bash dev/verify/setup.sh` once first if
  `.cache/venv` doesn't exist).
- [ ] Browser check passes — save the script below as
  `<scratchpad>/check_phase51.py`, run it with
  `dev/verify/.cache/venv/bin/python <scratchpad>/check_phase51.py` from the repo root;
  it must print `OK`. (It reuses `drive_editor.py`'s server harness and restores
  `pokemon.json` afterwards; `pokemon.json` must be git-clean before the run.)
  ```python
  import sys
  sys.path.insert(0, 'dev/verify')
  from drive_editor import serving_editor, git_restore
  from playwright.sync_api import sync_playwright

  failures = []
  with serving_editor() as base_url, sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      page = browser.new_page()
      page.on('pageerror', lambda err: failures.append(f'pageerror: {err}'))
      try:
          page.goto(base_url + '/')
          page.wait_for_selector('table.editor-table tbody tr.editor-row', timeout=15000)

          # --- 1+2: compact input, scroll survives the commit ---
          rows = page.query_selector_all('table.editor-table tbody tr.editor-row')
          key = rows[40].get_attribute('data-key')  # deep row => wrap must scroll
          cell = f'tr.editor-row[data-key="{key}"] td[data-editable-col-key="baseHealth"]'
          page.click(cell)  # Playwright scrolls the row into view first
          width = page.evaluate(f"document.querySelector('{cell} input').getBoundingClientRect().width")
          if width > 80:
              failures.append(f'inline input too wide: {width}px')
          before = page.evaluate("document.querySelector('.editor-table-wrap').scrollTop")
          if before <= 0:
              failures.append('expected the table to be scrolled before committing')
          original = page.evaluate(f"document.querySelector('{cell} input').value")
          page.fill(cell + ' input', str(int(original) + 1))
          page.press(cell + ' input', 'Enter')
          page.wait_for_function(
              "(sel) => { const c = document.querySelector(sel);"
              " return c && !c.querySelector('input') && !c.classList.contains('is-saving'); }",
              arg=cell, timeout=10000)
          after = page.evaluate("document.querySelector('.editor-table-wrap').scrollTop")
          if abs(after - before) > 2:
              failures.append(f'scroll jumped after commit: {before} -> {after}')

          # --- 3: location ID typing keeps the caret ---
          page.click('#editor-tabs .editor-tab[data-tab="locations"]')
          visible_row = '.editor-tab-panel:not([hidden]) table.editor-table tbody tr.editor-row'
          page.wait_for_selector(visible_row, timeout=15000)
          page.click(visible_row)
          page.wait_for_selector('input[name="id"]', timeout=15000)
          start = page.evaluate("document.querySelector('input[name=\\'id\\']').value")
          page.click('input[name="id"]')
          page.keyboard.type('-abc', delay=40)
          end = page.evaluate("document.querySelector('input[name=\\'id\\']').value")
          focused = page.evaluate(
              "document.activeElement === document.querySelector('input[name=\\'id\\']')")
          if end != start + '-abc':
              failures.append(f'ID typing lost characters: {end!r} (wanted {(start + "-abc")!r})')
          if not focused:
              failures.append('ID input lost focus while typing')
          # The location edit is never saved, so only pokemon.json needs restoring.
      finally:
          git_restore('pokemon.json')
          browser.close()

  if failures:
      print('FAIL:\n' + '\n'.join(failures))
      sys.exit(1)
  print('OK')
  ```
- [ ] Sorting and searching the pokemon list still snap the table back to the top
  (quick manual check, or confirm no `preserveScroll` was added to those call sites).

## Out of scope / do not touch

No behavior changes beyond the three fixes: don't restructure `renderBody`'s callers,
don't add row selection to inline edits, don't touch `app.js`, `tab_events.js`, or any
data JSON. Do not `git commit`.
