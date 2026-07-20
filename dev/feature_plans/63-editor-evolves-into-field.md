# Phase 63 — Data editor: `evolvesInto` field on the Pokemon detail form

**Recommended agent:** Sonnet · low effort.
**Prereqs:** none (standalone; not part of a batch). **Read first:** this file only.
**Goal:** The data editor's Pokemon detail form exposes an **Evolves into** control so a
baby's `evolvesInto` (the baby → mega link) can be authored in the GUI. Ends green; the
first real baby/mega pair (Numel → Mega Camerupt) can be linked without hand-editing JSON.

## Context you need

**Why this exists.** Phase 42 shipped the baby/mega data schema, validation, and runtime,
but never added the editor UI for the one field that establishes the link. The link is
one-directional and declared on the *baby*:

- A baby is any pokemon whose type list includes `BABY` (must also have ≥1 real type).
- The baby's `evolvesInto` field points at the mega by **name or id** (either resolves).
- A "mega" is implicit: any record referenced by some baby's `evolvesInto`. The mega
  record itself carries no marker. See `map/locations.js` `computeMegaTargetKeys` /
  `isMegaPokemon` (~lines 740–760) and `findPokemonByNameOrId`.

**Validation already enforces it** (`dev/editor/validate.js:117-125`): `evolvesInto` is
optional even on babies, but if present it **must resolve** to a real pokemon (name or id),
else rule `pokemon.bad-evolves-into`. So an empty selection must **remove** the key, not
store `""` (which would fail validation).

**The example to build against.** The owner committed the records `Numel` (id `0322`,
`type1: BABY`, types FIRE/GROUND) and `Mega Camerupt` (id `9323`), but `Numel` has **no
`evolvesInto` yet** — that is exactly what this field lets the owner set.

**File to change:** `dev/editor/tab_pokemon.js` (the only file). Relevant parts:
- `renderForm(el, draft, api)` (~line 160) builds the form as static `innerHTML` (rows for
  Name/ID, the three type `<select>`s via `typeSelectHtml`, then the four stat inputs) and
  attaches **one** delegated `input` listener (~line 186) that does
  `draft[field] = STAT_FIELDS.includes(field) ? Number(...) : value` then
  `api.markDirty(); api.refreshPreview()`.
- `EditorListView.escapeAttr` / `escapeHtml` are the escaping helpers already used here
  (e.g. line 164). `EditorApp.store.data.pokemon` is the full pokemon array.

**Serialization is safe:** `pokemon.json` is written with plain `JSON.stringify(data, null,
2)` (`dev/editor/format_json.js:61`, `PLAIN_FILES`), so a new key just serializes in
insertion order (after `baseSpeed`) — no key-order table to update, and records without the
key stay untouched.

**Design decisions (locked):**
- Always show the control (it is a harmless optional field on non-babies); label it clearly
  so its baby→mega purpose is obvious. Do **not** try to conditionally show it only for
  BABY types — the form does not re-render on type change, and that rework is out of scope.
- Use a `<select>`: first option `(none)` with value `""`, then every pokemon **except the
  record itself**, option value = pokemon **name**, display `Name (id)`.
- Mark an option `selected` when `p.name === current || p.id === current`, so a record that
  already stores an **id** still highlights correctly.
- Empty selection ⇒ `delete draft.evolvesInto`; any other value ⇒ `draft.evolvesInto = value`.

## Steps

- [x] 1. **`dev/editor/tab_pokemon.js`** — add a helper next to `typeSelectHtml` (~line 152):

  ```js
  function evolvesIntoSelectHtml(draft) {
      const current = draft.evolvesInto || '';
      const options = ['<option value="">(none)</option>'].concat(
          EditorApp.store.data.pokemon
              .filter((p) => p.name !== draft.name)
              .map((p) => {
                  const selected = (p.name === current || p.id === current) ? ' selected' : '';
                  const label = `${EditorListView.escapeHtml(p.name)} (${EditorListView.escapeHtml(p.id)})`;
                  return `<option value="${EditorListView.escapeAttr(p.name)}"${selected}>${label}</option>`;
              })
      ).join('');
      return `<select name="evolvesInto">${options}</select>`;
  }
  ```

- [x] 2. **`dev/editor/tab_pokemon.js`** — in `renderForm`'s template, add a new form row
  after the stats row (after the `HP/ATK/DEF/SPD` row, before the BST `<p>`):

  ```js
              <div class="editor-form-row">
                  <label>Evolves into <span class="editor-form-hint">(baby → mega target)</span>
                      ${evolvesIntoSelectHtml(draft)}
                  </label>
              </div>
  ```

  (If `.editor-form-hint` is not already a class in `dev/editor/editor.css`, drop the
  `<span>` and just use the plain label text `Evolves into (baby → mega target)` — do not
  add new CSS for this phase.)

- [x] 3. **`dev/editor/tab_pokemon.js`** — in the `input` listener (~line 186), special-case
  the new field so an empty pick removes the key:

  ```js
      el.addEventListener('input', (event) => {
          const field = event.target.name;
          if (!field) return;

          if (field === 'evolvesInto') {
              if (event.target.value) draft.evolvesInto = event.target.value;
              else delete draft.evolvesInto;
          } else {
              draft[field] = STAT_FIELDS.includes(field) ? Number(event.target.value) : event.target.value;
          }

          if (STAT_FIELDS.includes(field)) {
              el.querySelector('[data-role="bst"]').textContent = bst(draft);
          }

          api.markDirty();
          api.refreshPreview();
      });
  ```

## Verification

- [x] `node --check dev/editor/tab_pokemon.js` passes.
- [x] `node tests/run_all.js` green (189 pass / 0 fail, stable across 3 runs). **NOTE:** the
  owner's Numel/Mega-Camerupt commit left 5 tests red at HEAD (independent of the editor
  change). Per a follow-up owner instruction these were fixed alongside this phase — see the
  addendum below — so the suite is now green.
- [x] Editor logic verified out-of-browser (self-contained harness with the real escaping
  helpers): `evolvesIntoSelectHtml` renders `(none)` selected when unset, selects the target
  when linked by **name** or by **id**, excludes the record itself, and lists Mega Camerupt
  as an option. Empty pick path `delete draft.evolvesInto` confirmed by code inspection.
- [ ] Browser check via the editor (`node dev/editor/server.js` → 127.0.0.1:8932): open the
  **Numel** record, set **Evolves into → Mega Camerupt (9323)**, Save. Confirm `pokemon.json`
  now has `"evolvesInto": "Mega Camerupt"` on Numel and the Issues tab reports no
  `pokemon.bad-evolves-into` error. Re-open, set it back to **(none)**, Save, and confirm the
  key is removed (not left as `""`). (If you cannot drive the GUI, at minimum load the file
  in a browser/headless page and assert `evolvesIntoSelectHtml` returns a `<select>` whose
  `(none)` option is selected when `draft.evolvesInto` is unset.)

## Out of scope / do not touch

- **Ground rules (binding, inherited from AGENTS.md/CLAUDE.md):** never `git commit` unless
  explicitly asked; never run or extend `scripts/manage_*`; do not act on `TODO.md` or
  `dev/owner_tasks/`; no third-party deps/build step; run `node tests/run_all.js` after
  every change.
- Do **not** edit `pokemon.json` as part of this phase (setting Numel's real link is the
  owner's call / the verification step above, not a required data change). Do not add or
  rename engine/runtime baby/mega logic in `map/locations.js`, and do not change
  `dev/editor/validate.js` — the rule already exists.
- Do not add conditional (BABY-only) visibility, new CSS beyond the optional hint reuse, or
  touch any other editor tab.

## Addendum — mega-exclusion + green-baseline fix (owner follow-up, out of the original fence)

Requested by the owner after the editor field landed; recorded here so the change is not
lost. **This deliberately steps outside the "do not touch runtime/tests" fence above.**

- **`map/locations.js`** — `isMegaPokemon` now also treats a record as a mega **by
  convention**: `id > 9000` (new `isMegaByConvention`), in addition to the existing
  evolvesInto-target detection. This keeps every mega (Mega Camerupt 9323, Mega Sharpedo
  9319, Mega Beedrill 9015) out of wild/obtainable/mart/trade pools even before a baby is
  linked to it. **Id, not name**, is the rule on purpose — names are unreliable (Meganium,
  id 0154, starts with "Mega" but is not a mega), and all mega cards are authored with
  ids > 9000.
- **Tests updated** (the owner's Numel/Mega commit had left these red at HEAD, or the new
  rule required fixture ids ≤ 9000):
  - `tests/run_progression.test.js` — fallback test now asserts the pool == obtainable pool
    and leaks no legendary/baby/mega.
  - `tests/pokemon_pools.test.js` — baby-pool test reflects Numel; obtainable-count test now
    recomputes the expected set independently (survives ordinary pokemon additions); added a
    dedicated `isMegaPokemon` id>9000 test that also guards the Meganium (id 0154) case;
    plain fixtures renumbered ≤ 9000.
  - `tests/mart_stock.test.js` — trade fixture ids renumbered ≤ 9000; legal-items count
    8 → 9 (owner added `MOOMOO_MILK`).
  - `tests/baby_event.test.js` — real-data nursery-egg test flipped to "reachable now that a
    baby exists".
  - `tests/editor_validation.test.js` — dropped the stale "expect a `Linoone.png` orphan
    portrait" assertion (owner removed that asset; there are now 0 orphan portraits), keeping
    the missing-background check.

**Mega detection uses id > 9000, not name** (owner's second follow-up): the name-prefix
branch (`/^Mega\b/`) was removed from `isMegaByConvention` because names are unreliable —
Meganium (id 0154) starts with "Mega" but is not a mega. All mega cards are authored with
ids > 9000, so id alone is the correct, non-fragile signal.

**Note:** this work was completed while the owner was committing in parallel; an
intermediate state of it was picked up in commit `9722661`. The runtime + test edits above
are the final id-only version and leave `node tests/run_all.js` green (189/0).
