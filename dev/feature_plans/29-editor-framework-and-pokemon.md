# Phase 29 — Detail-editor framework + complete Pokemon tab

**Recommended agent:** Sonnet · high effort.
**Prereqs:** phase 28 (shell + lists). **Read first:** `25-data-editor-overview.md`.
**Goal:** The generic edit framework exists (draft/dirty/save/revert, delete-with-references,
add-new) and the Pokemon tab is fully editable: live card preview on the left, form on the
right, inline stat editing in the list, BST everywhere, id suggestion for new pokemon.
Ends green; a stat edit round-trips to disk with a one-line git diff.

## Context you need

- The overview's **"Locked spec"** owner decisions define the save semantics (hybrid), the
  delete rule (blocked while referenced, jump-links, no force in UI), preview-left layout,
  and the byte-clean-diff requirement (mutate a `structuredClone` draft; never rebuild
  records from form state; the FIRST save of `pokemon.json` adds its missing trailing
  newline — one byte, expected once).
- Framework home is `dev/editor/app.js` (+ `editor.css`): when a list row is selected the
  tab shows an `.editor-split` two-pane detail area — LEFT `.editor-preview` pane, RIGHT
  `.editor-form` pane — below (or replacing) the list; a slim "back to list / record
  picker" strip keeps navigation cheap. Framework API for tab modules:
  - `EditorApp.openEditor({ kind, fileName, record | null /* null = add-new */, template,
    renderPreview(el, draft), renderForm(el, draft, api) })` — owns: `draft =
    structuredClone(record) ?? template()`, dirty flag + indicator on the Save button,
    `api.markDirty()` / `api.refreshPreview()`, Save → `EditorApp.saveFile(fileName)`,
    Revert, and a confirm prompt when leaving a dirty editor (record switch or tab switch).
  - `EditorApp.saveFile(fileName)` — PUT `/api/data/<fileName>` with the store's full array
    (draft spliced in / appended); on 200 update store, recompute issues badge, toast; on
    409 render the returned `issues[]` in a blocking dialog (message + code list) and keep
    the draft dirty. Implement the real `api.putData` (replacing the phase-28 stub).
  - `EditorApp.requestDelete(kind, fileName, record)` — `EditorValidation.findReferences(
    store.data, kind, name, engineRefs)`; non-empty → "Blocked: referenced by …" dialog
    listing `{file, recordKey, field}` rows as jump-links (switch tab + select record);
    empty → confirm → splice → `saveFile` (the server's write guard is the backstop).
- Inline editing (list path): flesh out the `editable` column flag from phase 28 —
  `editable: { parse: Number, validate(v, record) -> true|"msg" }`; the cell renders an
  `<input type="number">` on focus/click; **Enter or blur commits** (PUT immediately via the
  same `saveFile`), **Escape reverts**; a failed validate/409 flashes the cell and restores
  the old value. Only the pokemon stat columns use it this phase.
- Pokemon form (RIGHT pane): `name` (text, uniqueness-checked against the other 187),
  `id` (text, `/^\d{4}$/` + uniqueness), `type1` select (PokeType minus NONE), `type2`/
  `type3` selects (PokeType incl. NONE), the four stats (`<input type="number" min="1">`),
  and a computed BST readout that updates as stats change. Add-new uses the overview's
  canonical key order + id suggestion (`String(max numeric id + 1).padStart(4, '0')` →
  `"1001"` today; smallest unused if > 9999).
- Pokemon preview (LEFT pane): wrapper `style="--card-w: 140px"`,
  `EditorPreview.renderCardInto(el, 'pokemon', draft)` re-run on every form `input` event —
  type and stat edits repaint the card instantly (the renderer is a pure string function;
  no debounce). Under the card: the portrait path, plus a "portrait missing" note when
  `<name>.png` isn't in the `/api/assets` portraits listing (uploads arrive in phase 34 —
  the note can mention that).
- Delete test subjects: `Blastoise` is referenced by the default battle deck AND the water
  starter deck (engine refs) — a good blocked-delete demo. A freshly added record is the
  deletable case.
- Validation source for form-side hints: `EditorValidation.validateAll` run on a copy of
  the store with the draft applied — show errors touching this record next to the Save
  button (predicting the server verdict). Cheap at this data size; recompute on input.

## Steps

- [x] 1. **`dev/editor/app.js`** — the framework per the context: `openEditor`, `saveFile`
  (real PUT + 409 dialog), `requestDelete` (+ jump-links), dirty guard, toasts. Keep it
  type-agnostic — pokemon specifics stay in the tab file.
- [x] 2. **`dev/editor/editor.css`** — detail-pane styling: `.editor-split` two-pane grid
  (preview left, form right), form rows/labels/selects in the game theme, Save button dirty
  dot, blocking-dialog + toast styling, invalid-cell flash for inline edits.
- [x] 3. **`dev/editor/list_view.js`** — implement the `editable` cell behavior
  (input on click, Enter/blur commit, Escape revert, error flash) and a
  `selectRecord(key)` method so jump-links can land on a record.
- [x] 4. **`dev/editor/tab_pokemon.js`** — wire it all: `onSelect` → `openEditor` with the
  pokemon form/preview renderers; "Add pokemon" button (template + id suggestion); "Delete"
  button in the editor → `requestDelete`; stat columns become `editable` (parse Number,
  validate finite > 0) committing via `saveFile`; keep BST live (recompute cell on commit).
- [x] 5. **Manual data round-trip check** (part of the work, not just verification): with
  the server running, edit one stat inline, confirm the PUT lands, then `git diff
  pokemon.json` shows ONLY that stat line (plus, the first time, the end-of-file newline),
  then restore with `git checkout -- pokemon.json`.

## Verification

- [x] `node tests/run_all.js` green.
- [x] Browser at `http://127.0.0.1:8932/`: selecting Venusaur opens the split view — the
  in-game card renders on the LEFT (portrait, GRASS/POISON icons, stat grid); changing
  `type2` to FIRE in the form repaints the card's type icons **before** saving; Revert
  restores; Save persists and the list row updates.
- [x] Inline path: double-click Venusaur's ATK cell, type a new value, Enter → toast, `git
  diff pokemon.json` shows exactly that line changed (± the one-time EOF newline); Escape
  during an edit leaves the file untouched. Restore afterwards (`git checkout -- pokemon.json`).
- [x] Add-new: "Add pokemon" suggests id `1001`, a filled form saves, the record appears in
  the list with correct BST; deleting that same record succeeds after its confirm.
- [x] Blocked delete: deleting `Blastoise` is refused with a dialog listing at least the
  engine default-deck and water-starter references (plus any trainers), each a working
  jump-link. `pokemon.json` unchanged afterwards.
- [x] Dirty guard: edit a field, click another record → prompt appears; cancel keeps the
  draft. Kill the server; `git status` shows no data-file changes at the end.

## Out of scope / do not touch

Attacks/items/trainers/events/locations remain read-only lists (phases 30–33); no uploads
(34); no `server.js` / `validate.js` / `format_json.js` changes beyond a strictly-required
bug fix with tests kept green; no game code, and end with no lingering data-file diffs.
Inherit all batch ground rules from `25-data-editor-overview.md` (no `git commit`, no
`scripts/manage_*`, no `TODO.md`, no third-party deps, run `node tests/run_all.js` after
every change).
