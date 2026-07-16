# Phase 31 — Trainers editor + deck builder

**Recommended agent:** Sonnet · high effort.
**Prereqs:** phase 29 (editor framework; 30 not required). **Read first:**
`25-data-editor-overview.md`.
**Goal:** The Trainers tab is fully editable: sprite preview with missing-file badge, the
deck shown as mini rendered cards grouped with ×count badges, searchable pickers +
steppers to edit the three deck arrays, and the scalar form (rank/cash/spec/sprite).
Ends green with byte-clean no-op saves.

## Context you need

- Trainer record: `{ name, sprite, cash, rank, typeSpecialization, pokemon: [names],
  attacks: [names], items: [names] }`. Deck arrays are **exact battle decks** — duplicates
  are meaningful (`Gamer` runs `Mind Break` ×2). Read tolerant of nested `attacks` arrays
  (`.flat()`), but always **write a flat array**; preserve nothing else about ordering —
  append new names at the end, remove by first occurrence.
- LEFT pane (top to bottom): trainer sprite `<img>` from
  `window.PokeRogue.TrainerSprites.resolveSprite(draft.name, draft.sprite).path`, with a
  "sprite file missing" badge when the resolved `file` is absent from the `/api/assets`
  sprites listing; then three deck sections — **Pokemon / Attacks / Items** — each a grid
  of mini rendered cards (`--card-w: 48px`, via `EditorPreview.renderCardInto`) one per
  **unique** name with a `×N` count badge overlay when N > 1. Unknown names (dangling
  refs) render as a red placeholder tile instead of a card. Section headers show totals
  (e.g. "Attacks — 16"), plus a soft advisory when `attacks.length !== 4 ×
  pokemon.length` (the roster convention from batch 3; hint, not an error).
- RIGHT pane form: `name` (unique), `sprite` (text input backed by a `<datalist>` of the
  manifest names — `window.PokeRogue.TrainerSprites.sprites` deduped by `name` — plus a
  live "resolves to `<file>`" hint), `cash` (number ≥ 0), `rank` select (the five Rank
  values), `typeSpecialization` select (PokeType; warn live when rank is Elite or Ace and
  the spec is missing/invalid — the roster-minimums rule counts only spec'd trainers).
  Below: the **deck builder** — for each of the three kinds, a searchable picker
  (filter-as-you-type dropdown over the corresponding store array; reuse list_view if a
  small extraction makes that easy, else a simple filtered `<ul>`) that appends a name, and
  per-unique-name `−`/`+` steppers (0 removes the tile). Every deck change: mutate the
  draft arrays, `api.markDirty()`, `api.refreshPreview()`.
- Save/delete flow is the phase-29 framework (`saveFile('trainers')`,
  `requestDelete('trainer', …)` — trainers are referenced by `events[].trainerName`, so
  deleting `Mecha Cop` must be blocked; roster minimums also block via the server guard
  when deleting would drop Ace below 6 / Elite below 4).
- Add-new template per the overview (defaults `cash: 200`, `rank: "Standard"`, empty deck
  arrays); a new trainer with an empty deck is schema-valid (tests only cross-reference
  names that exist), so it saves fine.
- Good test subjects: `Gamer` (Ace, HUMAN spec, `Mind Break` ×2), `Waiter` (Standard,
  GOURMET, 3pk/12at/3it), `Mecha Cop` (event-referenced — blocked delete).

## Steps

- [ ] 1. **`dev/editor/tab_trainers.js`** — the full editor per the context: sprite pane,
  three mini-card deck sections with count badges + unknown-name placeholders, the scalar
  form with datalist sprite input, the deck-builder pickers/steppers, add-new, delete.
- [ ] 2. **`dev/editor/editor.css`** — mini-card grid + `×N` count badge overlay
  (absolute-positioned pill on the card corner), red placeholder tile, picker dropdown,
  stepper buttons, advisory banner. Card size comes from `--card-w: 48px` on the section
  wrapper — no transforms.
- [ ] 3. **Round-trip check** (part of the work): open `Gamer`, Save with zero edits →
  `git diff trainers.json` empty; add one `Sitrus Berry` via the picker, Save → diff is
  exactly one inserted line in Gamer's `items` array; restore with `git checkout --
  trainers.json`.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] Browser: open `Gamer` — sprite image renders; the Attacks section shows a mini
  `Mind Break` card with a `×2` badge; section counts read 4 / 16 / 5; no advisory (16 =
  4×4). The mini cards are real renders (type icons + PWR visible at 48px).
- [ ] `+` on `Mind Break` → badge reads ×3, count 17, advisory appears (17 ≠ 16); `−`
  twice → ×1; Revert restores the original deck and preview.
- [ ] Changing the `sprite` field to a manifest name updates the "resolves to" hint and the
  image live; an off-manifest value shows the missing badge (resolveSprite falls back to
  `<name>.png`).
- [ ] Setting rank to Elite with an empty spec shows the live warning; deleting `Mecha Cop`
  is blocked listing `events.json / rogue-mecha-cop`; add-new trainer saves and deletes
  cleanly. End with `git status` clean of data files; kill the server.

## Out of scope / do not touch

Events/locations editors (32–33), uploads (34 — the sprite missing badge only *reports*),
no changes to `arena/trainer_sprites.js` or any game code, no server/shared-module edits,
no lingering data diffs. Inherit all batch ground rules from `25-data-editor-overview.md`
(no `git commit`, no `scripts/manage_*`, no `TODO.md`, no third-party deps, run
`node tests/run_all.js` after every change).
