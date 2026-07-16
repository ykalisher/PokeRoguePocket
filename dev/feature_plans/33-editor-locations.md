# Phase 33 — Locations editor

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 29 (editor framework; 30–32 not required). **Read first:**
`25-data-editor-overview.md`.
**Goal:** The Locations tab is fully editable: themed preview panel, type pickers, five
color inputs, enabled toggle, canonical background handling, and live warnings for the two
location graph rules. Ends green with byte-clean no-op saves.

## Context you need

- Location record: `{ id, name, terrain, types: [2-4 unique PokeTypes], theme: { accent,
  glow, surface, bgDeep, bgMid } (lowercase 6-digit hex), background:
  "assets/backgrounds/<id>.png", enabled }`. 12 records today, all enabled, **all
  backgrounds missing on disk** (`assets/backgrounds/` is empty — expect the missing-file
  note everywhere until phase 34 uploads land).
- LEFT preview pane: a panel that *applies* the draft theme — set the five values as CSS
  custom properties on the panel (`--loc-accent`, `--loc-glow`, `--loc-surface`,
  `--loc-bg-deep`, `--loc-bg-mid`, the same names `static/styles.css` uses on `body`
  ~`:92-121`) and style it like a slice of the game's backdrop: name + terrain in accent
  color, surface-colored card area, bgDeep→bgMid gradient. Below: the type icons row and
  the background `<img>` (or a "missing file" placeholder — check the `/api/assets`
  backgrounds listing, don't rely on img 404s). Re-render on every input; color changes
  must repaint instantly.
- RIGHT form: `id` (slug, unique — but **warn, don't auto-rewrite**, that renaming an id
  desyncs the canonical background filename), `name` (unique), `terrain` text, `types[]`
  chip-picker (PokeType minus NONE/LEGENDARY; enforce 2–4 unique in the draft-level hints),
  five `<input type="color">` bound to the theme keys (write lowercase hex — `<input
  type="color">` yields lowercase; keep it), `enabled` toggle, and the background row:
  read-only current path + a "set canonical path" button (writes
  `assets/backgrounds/<id>.png` into the draft) — no free-text path editing.
- **Graph-rule live warnings** (the two dataset rules, `locations.starter-coverage` and
  `locations.graph-disconnected`): run `validateAll` with the draft applied on every
  types/enabled change and surface those two codes prominently ("disabling this breaks
  WATER starter coverage", "enabled locations no longer form a connected graph"). The
  server guard blocks the save regardless — the form should predict it.
- Add-new template per the overview's canonical key order; seed the theme with the neutral
  values from `NEUTRAL_LOCATION_THEME` in `arena/arena_data.js` (~`:469` — copy the five
  hex values into the template literally, they're static). Locations are never referenced
  by other records — `requestDelete` only confirms (the guard still blocks when removal
  breaks the dataset rules, incl. `locations.min-count` ≥ 8).
- Good test subjects: `tidepool-coast` (WATER/ICE — one of only three WATER locations,
  with `murkwater-marsh` and `harbor-boardwalk`; disabling all three trips starter
  coverage), `meadow-market` (4 types — the max).

## Steps

- [x] 1. **`dev/editor/tab_locations.js`** — the full editor per the context: themed
  preview panel, form, canonical-background button, graph-rule live warnings, add-new,
  delete.
- [x] 2. **`dev/editor/editor.css`** — the preview panel styling (theme-variable-driven
  gradient/surface/accent layout, swatch labels for the five colors, missing-background
  placeholder). Reuse chip/picker styles.
- [x] 3. **Round-trip check** (part of the work): open `tidepool-coast` and `meadow-market`,
  Save with zero edits → `git diff locations.json` empty (this exercises the inline
  `types` array and inline `theme` object formatting). Then change one theme color, Save,
  confirm the diff is that single line, and restore with `git checkout -- locations.json`.

## Verification

- [x] `node tests/run_all.js` green.
- [x] Browser: open `tidepool-coast` — the preview panel shows its gold-on-teal theme;
  dragging the `accent` color input repaints the panel live; type icons show WATER + ICE;
  the background row shows the canonical path with a missing-file placeholder.
- [x] Disable `tidepool-coast`, `murkwater-marsh`, and `harbor-boardwalk` in sequence
  (without saving the last one): the `locations.starter-coverage` warning appears naming
  WATER; attempting Save is refused by the 409 dialog; re-enable, confirm the warning
  clears, Revert to be safe.
- [x] Add a new location (template theme, 2 types), save, confirm the guard passes and the
  list shows 13 rows with its swatch strip; delete it again. `git diff locations.json`
  empty at the end; kill the server.
- [x] The step-3 no-op saves left no diff.

## Out of scope / do not touch

No background uploads (phase 34 — the placeholder only reports), no edits to
`map/locations.js` (`LEVEL_CONFIG` / `STARTER_DECKS` are game code and stay out of the GUI
per the locked spec), no game code, no server/shared-module edits, no lingering data diffs.
Inherit all batch ground rules from `25-data-editor-overview.md` (no `git commit`, no
`scripts/manage_*`, no `TODO.md`, no third-party deps, run `node tests/run_all.js` after
every change).
