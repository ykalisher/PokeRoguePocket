# Editor polish, type-derived themes, event gates, info notes — batch overview

Owner request (2026-07-18): fix three dev-editor usability bugs, derive location theme
colors from the location's types (retroactively), add per-location / per-terrain event
gates, and surface the owner's balance notes behind an "i" button in the editor.

## Ground rules (binding)

- Never `git add` / `git commit` / `git push` unless the owner explicitly asks.
- Never **run** `scripts/manage_*.js` (interactive, owner-only). Phase 53 **edits**
  `scripts/manage_locations.js` — that specific edit was explicitly requested by the
  owner on 2026-07-18 and overrides the AGENTS.md "do not extend" default. Do not touch
  `scripts/manage_events.js` at all.
- Never act on `TODO.md`.
- No third-party libraries, build tools, or runtime dependencies. The game ships plain
  JS/HTML/CSS; dev-only tooling uses Node built-ins (plus the approved Python/Playwright
  in `dev/verify/`).
- Run `node tests/run_all.js` after every change (a PostToolUse hook also runs
  `node --check` on each edited JS file).
- Never rename game internals to match UI wording (`'boss'`/`'capture'` node types etc.).
- Line numbers given in phase files are **hints from 2026-07-18 and may drift** — locate
  code by the quoted snippets/function names, not by line number alone.

## What is being built (context)

Six owner asks, split across phases 50–56:

1. **Inline-edit input too big** — the pokemon list's inline stat editor injects an
   `<input type="number">` whose intrinsic ~170px width blows out the auto-layout table
   column. (Phase 51)
2. **List jumps to top after an inline edit** — the commit path rebuilds the scroll
   container (`.editor-table-wrap`) via `outerHTML`, losing `scrollTop`. (Phase 51)
3. **Location ID editing drops the cursor after each character** — the locations form
   repaints the entire form on every `id` keystroke. (Phase 51)
4. **Type-derived location theme colors** — a location's 5-color `theme` should default
   from its `types` (colors sourced from the type icon SVGs), applied retroactively to
   all existing locations; manual per-location overrides must still work; the
   `manage_locations.js` CLI stops prompting for colors. (Phases 52–53)
5. **Event gates by location id / terrain** — optional `locations` and `terrains` arrays
   on events that, when non-empty, **override** the existing `types` gate; editable in
   the dev editor and validated. (Phases 54–55)
6. **"i" info button** — shows the owner's balance notes **verbatim**, only on the
   Pokemon and Attacks sections (list *and* detail views). (Phase 56)

Phase 50 first restores the currently-red test suite (2 pre-existing failures from the
owner's `ad26697 "Change locations"` commit) so every later phase can require green.

## Locked spec

### Type-derived theme (phases 52–53)

- Per-type colors come from `assets/types-svgs/<TYPE>.svg`: the icon `<circle>`'s
  `fill` is the **bright** tone, its `stroke` the **mid** tone. The full extracted table
  is baked into `scripts/location_theme.js` (phase 52 contains the complete file).
- `deriveLocationTheme(types)` maps types → the five theme slots, keys built **in this
  order**: `accent, glow, surface, bgDeep, bgMid`.
  - `t1 = types[0]`, `t2 = types[1] || t1`, `t3 = types[2] || t1`, `t4 = types[3] || t2`.
  - `accent = bright(t1)` (primary), `glow = bright(t2)` (secondary),
    `surface = mix('#0b0e13', mid(t3), 0.30)`,
    `bgDeep = mix('#07090d', mid(t4), 0.12)`,
    `bgMid = mix('#0b0e13', mid(t4), 0.22)`,
    where `mix(a, b, t)` is per-channel linear interpolation (t = weight of b),
    output lowercase 6-digit hex.
  - Empty/absent types → a fresh copy of the neutral palette
    (`#e0b84f / #4ab0a5 / #232f3d / #10161f / #1b2836`).
- Worked examples (use these to self-check the math):
  - `['FIRE','ROCK']` → `{"accent":"#ff9024","glow":"#e7e5af","surface":"#4f250d","bgDeep":"#151718","bgMid":"#242626"}`
  - `['WATER','ICE']` → `{"accent":"#2da2fd","glow":"#c3e4ee","surface":"#081f4a","bgDeep":"#0f191d","bgMid":"#192a2f"}`
  - `['GHOST','DARK','MONSTER']` → `{"accent":"#876dad","glow":"#a6a6a6","surface":"#0d1f1c","bgDeep":"#0b0d11","bgMid":"#121419"}`
- **Retroactive**: phase 52 overwrites the `theme` of **all 13** locations in
  `locations.json` — including the two hand-authored ones (`cinnabar-island-volcano`,
  `cinnabar-mansion`). Owner asked for this explicitly.
- **Manual overrides stay**: the editor keeps its five color pickers. Types changes
  auto-re-derive the theme **only when the current theme is untouched** (equals the
  derived theme of the previous type set, or the neutral palette); a "Use type colors"
  button force-applies the derivation. The stored JSON is always plain hex values —
  runtime (`map/locations.js applyLocationTheme`, `arena/arena_data.js
  normalizeLocation`) is **never changed**.

### Event gates (phases 54–55)

- Two new **optional** event fields: `locations` (array of location ids) and `terrains`
  (array of terrain labels).
- Semantics: if **either** list is non-empty it **replaces** the `types` gate entirely.
  At a location the event is then available iff
  `(locations non-empty AND location.id ∈ locations) OR (terrains non-empty AND
  norm(location.terrain) ∈ norm(terrains))`, with `norm = trim + lowercase`.
  With neither set, the existing PokeType-overlap gate applies unchanged.
- Ungated lookups (no location passed — `getEventById`, saved-encounter restore) keep
  returning every event, including override-gated ones.
- Round-trip fidelity: the editor only writes the fields when chips exist and deletes
  the key when the last chip is removed (same pattern as the existing `types` gate).
- Validation: unknown location id → error `events.unknown-location`; terrain matching no
  location's terrain (normalized) → error `events.unknown-terrain`.

## Cross-phase architecture facts

- **Editor stack** (`dev/editor/`): `server.js` (Node-builtin HTTP server, port 8932,
  serves any repo file + `/api/data|enums|assets|issues`, `PUT /api/data/:file` with a
  validation write-guard), `index.html` (script tags, no modules), `app.js`
  (`window.EditorApp`: store, `registerTab(name, {label, render})`, `showTab`, private
  `showModal({title, bodyHtml})`, `saveFile`, `openEditor`), `list_view.js` (generic
  table; only pokemon stat columns are inline-`editable`), `validate.js`
  (`validateAll(data, {enums, assetIndex, engineRefs})`, UMD export, also required by
  Node tests), `preview.js`, `format_json.js` (`formatDataFile(name, data)` — the
  canonical on-disk format; `events`/`locations` use the "smart" inline style),
  `tab_*.js` (one per section).
- **Tab wiring convention in `tab_events.js`**: text inputs commit via the delegated
  `input` listener with `commit(false)` (no repaint — this is why caret survives);
  selects/checkboxes via `change` with `commit(true)` (structural repaint); buttons and
  chip-removes via `click` with `commit(true)`. Chip adds are `<select
  class="editor-chip-add" data-scope="...">`; removes are buttons with
  `data-action="chip-remove" data-chip="..." data-chip-index="N"`.
- **`locations.json` record**: `{ id, name, terrain (free-text label), types (2–4
  uppercase PokeTypes), theme {accent, glow, surface, bgDeep, bgMid — lowercase hex},
  background, enabled }`. 13 records. Terrains currently in use: Volcanic, Urban,
  Factory, Cave, Safari, Island, Forest, Lake.
- **Run location snapshot** (`map/run_state.js normalizeLocationSnapshot`): `run.location
  = { id, name, terrain, types, theme, background }` — already carries everything the
  new gate needs.
- **Event selection** (`map/event_effects.js`, `window.PokeEvents`):
  `getAvailableEvents(gameData, locationTypes)` / `matchesLocationTypes` /
  `chooseEvent(gameData, run)` / `getEventById` (ungated on purpose). Callers in
  `map/area.js`: `hasAvailableEvents()` and two `chooseEvent(arena.GameData, state.run)`
  sites.
- **Tests**: `node tests/run_all.js` (syntax-check + full suite, ~3s). Live-data editor
  validation tests build their env via `tests/helpers/editor_env.js`. Browser
  verification: `verify` skill; `dev/verify/drive_editor.py` smoke-drives the editor
  headless (spawns its own server on port 8933, fails on any page error, restores
  `pokemon.json` via git checkout). One-time setup: `bash dev/verify/setup.sh`.
- The editor GUI can load repo scripts directly (e.g. `<script
  src="/scripts/location_theme.js">`) because `server.js` serves any repo file.

## Phases

| File | What it does | Order notes |
|------|--------------|-------------|
| `50-restore-green-baseline.md` | Fix the 2 pre-existing test failures (locations.json format drift, removed `meadow-market` id) | First — later phases require green |
| `51-editor-input-scroll-caret-fixes.md` | Owner bugs 1–3: input width, scroll preservation, ID caret | Independent of 52+ |
| `52-location-theme-module.md` | `scripts/location_theme.js` + unit tests + retroactive rewrite of all location themes | Needs 50 |
| `53-theme-editor-and-cli-integration.md` | Editor auto-derive + "Use type colors" button; `manage_locations.js` stops asking for colors | Needs 52 |
| `54-event-location-terrain-gates-runtime.md` | `event_effects.js`/`area.js` gate overrides + runtime tests + data-skill doc | Independent of 51–53 |
| `55-event-gates-editor-and-validation.md` | `tab_events.js` chip pickers, gate column/preview, `validate.js` checks + tests | Needs 54 |
| `56-balance-notes-info-button.md` | "i" button + modal with the owner's verbatim balance notes | Independent |
