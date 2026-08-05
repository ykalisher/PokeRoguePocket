# Phase 91 — Starter decks: the Starters tab in the data editor

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phases 89 and 90. **Read first:** `88-starter-decks-overview.md`.
**Goal:** `node dev/editor/server.js` → 127.0.0.1:8932 has a **Starters** tab where the
owner can edit the three existing decks, add new ones, and delete ones nothing references.
Saving an untouched deck produces an empty `git diff`.

## Context you need

One new file — **`dev/editor/tab_starters.js`** — plus two one-line registrations. Read
`dev/editor/tab_locations.js` (400 lines) for the overall tab shape and
`dev/editor/tab_trainers.js` (489 lines) for the deck-builder UI; between them they contain
everything this tab needs, and **all the CSS already exists**.

**Tab module contract** (from `tab_locations.js`):

```js
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';
    …
    function render(root) { … return EditorListView.createListView({ … }); }
    EditorApp.registerTab('starters', { label: 'Starters', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
```

`createListView({ root, columns, records, getKey, searchFields, filters, defaultSort,
onSelect })` returns a handle; `EditorApp.openEditor({ kind, fileName, record, template,
renderPreview, renderForm })` opens the detail editor. `record: null` means "new", in which
case `template()` supplies the blank draft. `renderForm(el, draft, api)` gets
`api.markDirty()` and `api.refreshPreview()`.

**`fileName` is `'starter_decks'`** — the base name, matching
`EditorApp.store.data.starter_decks`. (`FILE_TO_TAB` maps the *dotted* name
`'starter_decks.json'` → `'starters'`; phase 90 added that.)

**The deck-builder to reuse**, from `tab_trainers.js`:

- `DECK_KINDS` (~21) — `[{ field, kind, label, storeKey }]` for pokemon/attacks/items.
- `deckBuilderSectionHtml(spec, draft)` (~273) — a type-ahead `.editor-picker` input plus a
  `.editor-deck-rows` list.
- `deckRowsHtml(spec, draft)` (~257) — one `.editor-deck-row` per card with a
  `.editor-stepper` (`−` / count / `+`).
- The four listeners in `renderForm` (~340–437): `input` (filter the picker), `keydown`
  (Enter picks the single match), `mousedown` (click a result), `focusout` (hide results),
  and `click` (the steppers).

**The one adaptation.** Trainers store repeated names in a flat array
(`["Mind Break", "Mind Break", "Trick"]`) and `groupCounts()` derives the display counts.
Starter decks store the grouped form directly (`[{ name: "Surf", count: 2 }]`) and
`pokemon` stays a plain name array with no counts. So:

- **pokemon** — reuse the trainer behavior verbatim (flat name array, `+`/`−` push/splice).
  Two of the same Pokemon is legal.
- **attacks / items** — the rows render straight from `{ name, count }`; `+` increments
  `count`, `−` decrements and **removes the entry when it would hit 0**; the picker
  increments an existing entry rather than adding a duplicate object.

Write those as three small helpers (`entriesFor`, `bumpEntry`, `addEntry`) rather than
copying `groupCounts` — the data is already grouped.

**Round-trip fidelity is binding.** Mutate the `structuredClone` draft in place. Do not add
keys the record did not have; when the user empties `attacks`, leave `[]` (the shape the
data file already uses) rather than deleting the key — but never introduce a key that was
absent. After any save, `git diff starter_decks.json` must contain only the intended change.

**Validation surfaces itself.** `computePredictedIssues()` in `dev/editor/app.js` renders
every error in the file being edited into the form's issue box on each `markDirty()`, so the
phase-90 rules (`starterDecks.unknown-pokemon`, `starterDecks.bad-type`,
`locations.starter-coverage`, …) appear automatically. Do not re-implement any check here.

**Delete is already guarded:** `EditorApp.requestDelete('starterDeck', 'starter_decks',
record)` runs `findReferences` first. Starter decks are not referenced by anything, so
deletes will go through — which is correct, but means the `starterDecks.none-enabled` rule
from phase 90 is the only thing stopping the owner from deleting the last deck. Confirm
that 409 actually fires (verification below).

## Steps

- [x] 1. **`dev/editor/tab_starters.js`** — new file with the standard header comment
  (what the tab is, and a pointer to `88-starter-decks-overview.md`), the IIFE wrapper, and
  `const escapeHtml = EditorListView.escapeHtml; const escapeAttr = EditorListView.escapeAttr;`.

- [x] 2. **`dev/editor/tab_starters.js`** — `columns()` for the list view:
  - portrait thumbs for the deck's Pokemon (reuse `EditorPreview`'s portrait path helper —
    grep `EditorPreview.` in `tab_trainers.js`/`tab_locations.js` for the exact name);
  - `name` (sortable);
  - `id` (sortable);
  - `type` rendered with `EditorPreview.typeIconHtml`;
  - card totals — `pokemon.length` Pokemon / summed attack `count` / summed item `count`;
  - an enabled dot: `<span class="editor-dot editor-dot--on|--off">`, exactly as
    `tab_locations.js` does it.

- [x] 3. **`dev/editor/tab_starters.js`** — `template()` for a new deck, in the canonical
  key order of the data file:

  ```js
      function template() {
          return { id: '', name: '', type: '', pokemon: [], attacks: [], items: [], enabled: true };
      }
  ```

- [x] 4. **`dev/editor/tab_starters.js`** — the three entry helpers:

  ```js
      function entriesFor(draft, field) {
          if (!Array.isArray(draft[field])) draft[field] = [];
          return draft[field];
      }

      function addEntry(draft, field, name) {
          const entries = entriesFor(draft, field);
          const existing = entries.find((entry) => entry.name === name);
          if (existing) existing.count += 1;
          else entries.push({ name, count: 1 });
      }

      function bumpEntry(draft, field, name, delta) {
          const entries = entriesFor(draft, field);
          const index = entries.findIndex((entry) => entry.name === name);
          if (index === -1) return;
          entries[index].count += delta;
          if (entries[index].count < 1) entries.splice(index, 1);
      }
  ```

- [x] 5. **`dev/editor/tab_starters.js`** — `renderPreview(el, draft)`: a starter card that
  mirrors what `starter.html` shows — the type label, the Pokemon portraits with names, and
  the `count× name` card list. Read `map/starter.js`'s `renderDeckCard` (~31) and match its
  content so the preview is honest about what the player will see. Reuse
  `EditorPreview`'s portrait helper; a missing portrait should degrade to the name, not a
  broken image.

- [x] 6. **`dev/editor/tab_starters.js`** — `renderForm(el, draft, api)`:
  - Row 1: `id` (text, with the hint **"Changing the id of a deck already in use breaks
    saved runs — they fall back to the first deck."**), `name` (text).
  - Row 2: `type` (select over `EditorApp.store.enums.PokeType`, excluding `NONE`;
    `tab_locations.js`'s `typeValues()` is the model), `enabled` (checkbox).
  - Then three deck-builder sections for pokemon / attacks / items, copied from
    `tab_trainers.js`'s `deckBuilderSectionHtml` + `deckRowsHtml`, with `attacks`/`items`
    reading `{ name, count }` via step 4's helpers and `pokemon` keeping the flat-array
    behavior.
  - Wire the same five listeners (`input`, `keydown`, `mousedown`, `focusout`, `click`) as
    `tab_trainers.js` `renderForm`; the `click` handler routes to `bumpEntry(±1)` for
    attacks/items and to `push`/`splice` for pokemon.
  - Every mutation ends with `refreshDeckRows(field)` (or `paint()` for the scalar fields),
    `api.markDirty()` and `api.refreshPreview()`.

- [x] 7. **`dev/editor/tab_starters.js`** — `render(root)`: an `+ Add starter deck` toolbar
  button plus `EditorListView.createListView({ root: …, columns: columns(), records:
  EditorApp.store.data.starter_decks, getKey: (record) => record.id, searchFields: ['name',
  'id'], filters: [type, enabled], defaultSort: { key: 'name', direction: 'asc' }, onSelect:
  openStarterEditor })`. Copy the filter shapes from `tab_locations.js`.

- [x] 8. **`dev/editor/tab_starters.js`** — `EditorApp.registerTab('starters', { label:
  'Starters', render });` as the last statement.

- [x] 9. **`dev/editor/index.html`** — add `<script src="/dev/editor/tab_starters.js"></script>`
  in the tab-module block. Tab bar order follows script order, so put it after
  `tab_locations.js` and before `tab_issues.js`.

- [x] 10. **`node tests/run_all.js`** — green (it syntax-checks every tracked JS file, which
  is the main automated guard for a tab module).

- [x] 11. Drive the editor in a browser and actually use the tab. Adapt
  `dev/verify/drive_editor.py` (it spawns `node dev/editor/server.js --port 8933` itself
  and restores any file it writes) into `dev/verify/phase91_editor_starters.py`, and
  screenshot to `dev/verify/phase91_editor_starters.png`. Exercise:
  - the list shows three decks with portraits, type icons and card totals;
  - opening `water` shows a preview matching `starter.html`;
  - `+`/`−` on `Surf` moves its count 2 → 3 → 2, and `−` at count 1 removes the row;
  - the picker adds a new attack at count 1;
  - typing a nonsense id/type surfaces the phase-90 error in the form issue box and Save is
    refused;
  - `+ Add starter deck` → fill in a fourth deck → Save → it appears on `starter.html`.
  - **Restore afterwards**: `git checkout -- starter_decks.json` so the repo ships the same
    three decks.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `dev/verify/phase91_editor_starters.py` runs clean and its screenshot shows the
  Starters tab with a deck open.
- [x] Round-trip: open `water`, change nothing, Save → `git diff starter_decks.json` empty.
  Then bump `Surf` to 3, Save → the diff is exactly that one `count`. Restore the file.
- [x] Deleting a starter deck is possible, but deleting the **last enabled** one is refused
  with `starterDecks.none-enabled` (409). Restore afterwards.
- [x] A deck saved with a type no enabled location covers is refused with
  `locations.starter-coverage` and the message names the fix.
- [x] End-to-end: add a fourth deck in the editor, reload `starter.html` (served on 8931),
  confirm four cards render and a run started from the new one gets its cards. Then remove
  the fixture deck and confirm `git status` shows `starter_decks.json` unchanged.

## Out of scope / do not touch

`dev/editor/validate.js`, `dev/editor/server.js`, `dev/editor/format_json.js` (phase 90
finished them — if a rule is missing, note it rather than adding it here),
`dev/editor/editor.css` (every class this tab needs already exists; if something genuinely
has none that fits, say so rather than restyling the editor), the other tab modules, and
all of `map/**` and `arena/**`. Do not author new starter decks beyond a temporary
verification fixture that you then remove.
