# Phase 30 — Attacks + Items editors

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 29 (editor framework). **Read first:** `25-data-editor-overview.md`.
**Goal:** The Attacks and Items tabs are fully editable on the phase-29 framework: live
action-card previews, enum-driven forms, artificial-attack guardrails, add/delete wired.
Ends green with byte-clean no-op saves.

## Context you need

- Reuse everything from phase 29: `EditorApp.openEditor` / `saveFile` / `requestDelete`,
  `EditorPreview.renderCardInto(el, 'attack'|'item', draft)` (the action-card renderer
  path), the `.editor-split` layout, form styling. These two tabs are deliberately the
  "pattern-following" phase — no new framework.
- Attack form fields (canonical key order in the overview): `name` (unique), `type1`
  select (PokeType minus NONE), `type2` (incl. NONE), `basePower` (number ≥ 0; 0 = pure
  effect), `status` select (Status ∪ the four artificial statuses from
  `enums.extensions.attackStatuses`, the latter visually annotated "trainer-effect"),
  `target` select (AttackTarget ∪ `TRAINER`), `statChanges` **chip list** (add-select +
  remove ×; duplicates are legal — one entry per stage step, e.g. two `SPEED_DOWN`s),
  `full_type_requirements` checkbox.
- **ARTIFICIAL guardrails** (mirror `attacks.artificial-rule` / `attacks.artificial-cap`
  from `validate.js`): while the draft has `type1`/`type2` = ARTIFICIAL, show a live
  warning unless `target === 'TRAINER'` and `status` ∈ the artificial set; show the
  current ARTIFICIAL count and warn when a save would exceed 6. The warnings predict the
  server; the write guard still 409s a forced attempt.
- Item form fields: `name` (unique), `target` select (ItemTarget), `status` chip list
  (Status), `statChanges` chip list — **new chips restricted to StatChange**, but existing
  legacy entries (Status values living in `statChanges`, e.g. `Lum Berry`'s
  `HEAL_STATUS`) must render as clearly-marked "legacy" chips that survive save untouched
  (mutate-the-clone rule — do NOT migrate them; the game's loader handles that at runtime).
  `imagePath` is not a form field: show the resolved image path (record `imagePath` or the
  UPPER_SNAKE default) read-only under the preview with a missing-file note when absent
  from the `/api/assets` items listing.
- Previews: LEFT pane `--card-w: 140px`; attack card shows type icons / PWR badge / status
  icon / stat-change arrows / target text; item card shows its picture row. Re-render on
  every `input` like phase 29.
- Add-new templates per the overview's canonical key orders. Delete goes through
  `requestDelete` — attacks/items are referenced by trainers, events, and engine decks, so
  blocked deletes list those.
- Good test subjects: `Heat Wave` (dual-type FIRE/FLYING, BURN, ALL_OPPONENTS,
  full_type_requirements true), `Sleep Powder` (basePower 0), `Fire Gem`
  (status `["DRAGON_GEM","BURN"]`), `Lum Berry` (legacy statChange), `Effect Amplifier`
  (explicit `imagePath`, SVG).

## Steps

- [ ] 1. **`dev/editor/tab_attacks.js`** — replace the read-only `onSelect` with the full
  editor: form + live preview + add-new + delete, per the field spec and guardrails above.
- [ ] 2. **`dev/editor/tab_items.js`** — same for items, including the legacy-chip
  handling and the read-only image-path note.
- [ ] 3. **`dev/editor/editor.css`** — chip-list styling (chip, remove ×, "legacy" variant,
  add-select) and the inline warning banner used by the ARTIFICIAL guardrails; reuse theme
  variables.
- [ ] 4. **Round-trip check** (part of the work): open `Heat Wave` and `Fire Gem`, Save with
  zero edits → `git diff attacks.json items.json` is empty (except the one-time
  `attacks.json` EOF newline, if this is its first-ever save); then make one real edit each,
  verify the diff is only that line, and restore both files with `git checkout`.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] Browser: open `Heat Wave` — the action card renders left with FIRE+FLYING icons;
  switching `type2` to WATER repaints the icons before saving; setting `basePower` 55→90
  updates the PWR badge live.
- [ ] Setting an attack's `type1` to ARTIFICIAL with `target: OPPONENT` shows the guardrail
  warning; attempting Save surfaces the server 409 with `attacks.artificial-rule` in the
  dialog; fixing target to TRAINER + an artificial status clears it (then Revert — don't
  keep the change).
- [ ] Open `Lum Berry` — the `HEAL_STATUS` chip renders marked "legacy"; a no-edit Save
  leaves `git diff items.json` empty. `Effect Amplifier` shows its `.svg` path with no
  missing-file note.
- [ ] Add a new item, save, delete it again; try deleting `Sitrus Berry` → blocked dialog
  lists trainer + engine-deck references. End with `git status` clean of data files; kill
  the server.

## Out of scope / do not touch

Trainers/events/locations editors (31–33), uploads (34), no framework rewrites in `app.js`
/ `list_view.js` (extend only if a small hook is genuinely missing), no `server.js` /
`validate.js` / `format_json.js` changes, no game code, no lingering data diffs. Inherit
all batch ground rules from `25-data-editor-overview.md` (no `git commit`, no
`scripts/manage_*`, no `TODO.md`, no third-party deps, run `node tests/run_all.js` after
every change).
