# Phase 66 — Editor: show "Evolves into" only for BABY pokemon

**Recommended agent:** Sonnet · low effort.
**Prereqs:** none (independent of Phase 65; the `evolvesInto` control already exists from
Phase 63). **Read first:** `64-dev-friction-cleanup-overview.md`.
**Goal:** In the data editor's Pokemon detail form, the "Evolves into (baby → mega
target)" row is visible **only when a type slot is `BABY`**, updating live as types are
edited. Removing the last BABY type hides the row and clears the link. Ends green.

## Context you need

**This supersedes a locked Phase 63 decision.** Phase 63
(`63-editor-evolves-into-field.md`) intentionally showed the control on every pokemon and
locked *"Do not try to conditionally show it only for BABY types — the form does not
re-render on type change, and that rework is out of scope."* Phase 66 is the owner's
reversal and implements exactly that deferred reactive visibility. Do **not** edit Phase
63's file or tick/untick its checkboxes (its one open box is the owner's manual browser
verify).

**File to change: `dev/editor/tab_pokemon.js` (the only file).** Current shape:
- `isLegendary(record)` helper at ~lines 11-13:
  `return [record.type1, record.type2, record.type3].includes('LEGENDARY');` — copy this
  pattern for `isBaby`.
- `renderForm(el, draft, api)` (~177-226) sets `el.innerHTML` once. The Evolves-into row
  is `<div class="editor-form-row"><label>Evolves into (baby → mega target)
  ${evolvesIntoSelectHtml(draft)}</label></div>` (~198-202). `evolvesIntoSelectHtml`
  builds `<select name="evolvesInto">` with `(none)` + every other pokemon.
- One delegated `input` listener is bound to **`el`** (~208-225). `evolvesInto` picks are
  special-cased (empty ⇒ `delete draft.evolvesInto`); everything else lands in the `else`
  branch `draft[field] = STAT_FIELDS.includes(field) ? Number(value) : value` (~216).
- `template()` (~101-113) seeds new pokemon with `type1:'NORMAL'`, `type2/3:'NONE'`.

**Why the listener matters:** it is bound to `el`, so you must **not** call `renderForm`
again on a type change (that would bind a *second* listener and double-fire). Toggle the
row in place instead.

**Why clearing is safe:** mega detection (`map/locations.js` `computeMegaTargetKeys`,
~748) only reads `evolvesInto` on `isBabyPokemon` records, and `dev/editor/validate.js:123`
only flags `evolvesInto` when present *and* unresolved. So deleting it on a non-baby is a
no-op at runtime and cannot introduce a validation error.

## Steps

- [ ] 1. **`dev/editor/tab_pokemon.js`** — add an `isBaby` helper right after `isLegendary`
  (~line 13):
  ```js
  function isBaby(record) {
      return [record.type1, record.type2, record.type3].includes('BABY');
  }
  ```

- [ ] 2. **`dev/editor/tab_pokemon.js`** — in `renderForm`'s template, give the
  Evolves-into row (~198-202) a stable hook and initial hidden state via the native
  `hidden` attribute (no CSS needed):
  ```js
  <div class="editor-form-row" data-role="evolves-into-row"${isBaby(draft) ? '' : ' hidden'}>
      <label>Evolves into (baby → mega target)
          ${evolvesIntoSelectHtml(draft)}
      </label>
  </div>
  ```
  A new pokemon starts `type1:'NORMAL'`, so the row starts hidden — correct. This template
  is rebuilt on the framework's open/save/revert re-renders, so initial visibility stays
  correct there too.

- [ ] 3. **`dev/editor/tab_pokemon.js`** — in the delegated `input` listener (~208-225),
  after `draft[field]` is updated (i.e. after the `if (field === 'evolvesInto') … else …`
  block, before `api.markDirty()`), react to type changes by toggling the row and clearing
  a stranded link:
  ```js
  if (field === 'type1' || field === 'type2' || field === 'type3') {
      const row = el.querySelector('[data-role="evolves-into-row"]');
      const baby = isBaby(draft);
      row.hidden = !baby;
      if (!baby && draft.evolvesInto !== undefined) {
          delete draft.evolvesInto;                       // matches the "(none)" idiom
          const select = row.querySelector('select[name="evolvesInto"]');
          if (select) select.value = '';                  // reset dropdown to (none)
      }
  }
  ```
  Do **not** re-invoke `renderForm`. `api.markDirty()` / `api.refreshPreview()` at the end
  of the handler still run for every field, unchanged.

## Verification

- [ ] `node --check dev/editor/tab_pokemon.js` passes.
- [ ] `node tests/run_all.js` stays green (the editor tests drive the server/validator,
  not the form DOM, so none assume the row is always visible — confirm nothing went red).
- [ ] Browser check via the editor (`node dev/editor/server.js` → `127.0.0.1:8932`, using
  the `verify` skill or manually):
  - Open an ordinary pokemon (e.g. **Blastoise**) → the Evolves-into row is **hidden**.
  - Open **Numel** (BABY) → the row is **visible**.
  - On a non-baby, set a type slot to **BABY** → the row **appears** immediately.
  - With a BABY type, set **Evolves into → Mega Camerupt**, then change that type slot away
    from BABY → the row **hides**; Save → the record has **no** `evolvesInto` in
    `pokemon.json` and the Issues tab reports no `pokemon.bad-evolves-into`.
  - Restore a BABY type → the row reappears showing **(none)**.
  - (If the GUI cannot be driven, at minimum load `tab_pokemon.js` in a headless page /
    Node harness with stub `EditorApp`/`EditorPreview`/`EditorListView` globals — as Phase
    63 did — render the form and assert `[data-role="evolves-into-row"]`'s `hidden` flips
    between `draft.type1='NORMAL'` and `'BABY'`, and that a `NORMAL` type input event
    deletes a pre-set `draft.evolvesInto`.)

## Out of scope / do not touch

- **Ground rules** (see `64-dev-friction-cleanup-overview.md`): never `git commit` unless
  asked; never run `scripts/manage_*`; don't act on `TODO.md`/`dev/owner_tasks/`; no
  third-party deps; run `node tests/run_all.js` after every change.
- Edit **only** `dev/editor/tab_pokemon.js`. Do **not** touch other editor tabs,
  `dev/editor/validate.js`, `dev/editor/editor.css` (no new CSS — use the `hidden`
  attribute), `map/locations.js`, any `*.json` data file, or Phase 63's plan file.
- Do not change `evolvesIntoSelectHtml`'s option list or the `(none)`-deletes-the-key
  behavior; do not re-render the whole form on a type change (keep the single delegated
  listener). Do not alter the type `<select>`s themselves beyond the reactive toggle.
