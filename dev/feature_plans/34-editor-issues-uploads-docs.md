# Phase 34 — Issues tab v2, asset uploads, smoke driver, docs

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phases 26–33 (the whole editor). **Read first:** `25-data-editor-overview.md`.
**Goal:** The Issues tab becomes actionable — jump-links to the owning record, severity
filtering, and **Upload** buttons that fix missing assets in place; a Playwright smoke
driver covers the editor end to end; the repo docs mention the tool. Ends green; the batch
is complete.

## Context you need

- Phase 28 built the read-only Issues tab from `EditorApp.computeIssues()`; every issue
  carries `{ severity, file, recordKey, field?, code, message }`. The missing-asset warning
  codes (`assets.missing-portrait`, `assets.missing-sprite`, `assets.missing-item-image`,
  `assets.missing-background`) map 1:1 onto the four upload routes from the overview's
  Upload table — `recordKey` is the record name/id the route wants as `:key`. Orphan codes
  (`assets.orphan-*`) are informational only: **never** offer to delete files.
- Upload client flow: `<input type="file" accept="image/png">` per missing-asset row →
  `fetch('/api/assets/<dir>/' + encodeURIComponent(recordKey), { method: 'POST', body:
  file })` → on 201, re-fetch `/api/assets`, recompute issues, repaint tab + badge, toast
  the returned `path`. On 4xx show the server's `error` message. (The server derives the
  filename; the client never sends one.)
- Jump-links: reuse the mechanism from phase 29's blocked-delete dialog — switch to the
  owning tab and `selectRecord(recordKey)`. Wire every non-dataset issue row
  (`recordKey !== "(dataset)"`, files ≠ `engine`/`assets`-orphans) to one. Also surface
  upload affordances inside record editors where earlier phases left notes (the pokemon
  portrait note from 29, the trainer sprite badge from 31, the location background
  placeholder from 33) — same client flow, small "Upload…" button beside each.
- **Smoke driver** `dev/verify/drive_editor.py`, following the conventions of the existing
  drivers (read `dev/verify/lib.py` first; run with `.cache/venv/bin/python` — if
  `dev/verify/.cache/venv` is missing, run `bash dev/verify/setup.sh` once). Differences
  from the battle drivers: the editor is served by the **Node** server, so the driver
  spawns `node dev/editor/server.js --port 8933` itself (subprocess + wait for the port),
  navigates to `http://127.0.0.1:8933/`, and must kill the server in a `finally`. Assert:
  the seven tabs render; the Pokemon tab shows 100+ rows; selecting the first row renders
  an element matching `.editor-preview .playing-card`; an inline stat edit round-trips
  (edit → re-read via `/api/data` → value changed); then **restore** the file (`git
  checkout -- pokemon.json` via subprocess); screenshot `dev/verify/editor_smoke.png`.
  Non-zero exit on any page error, like `drive_arena.py`.
- Docs (exact, minimal edits):
  - **`CLAUDE.md`** repo map: add a row `| `dev/` | agent tooling: `verify/` browser
    drivers, `hooks/` edit-check hook |` → extend that existing row's text with
    "`editor/` local data-editor GUI (`node dev/editor/server.js` → 127.0.0.1:8932)".
    Also fix the stale trainer count in the data row: "`trainers.json` (44)" → the current
    actual count (95 today — check with `node -e` at implementation time).
  - **`AGENTS.md`**: phase 27 already added the `dev/editor/` exemption sentence — verify
    it's present; do not double-add.
- The `verify` skill documents the Playwright venv usage; the game server on 8931 is not
  involved here.

## Steps

- [ ] 1. **`dev/editor/tab_issues.js`** — upgrade per the context: severity filter
  (all/errors/warnings), grouping by file, jump-links on record-owned rows, Upload buttons
  on the four missing-asset codes, orphan rows rendered informational (no actions).
- [ ] 2. **`dev/editor/app.js`** — add the shared `EditorApp.uploadAsset(dir, key, file)`
  client helper (POST + refresh assets + recompute issues + toast) used by the Issues tab
  and the in-editor buttons.
- [ ] 3. **`dev/editor/tab_pokemon.js` / `tab_trainers.js` / `tab_locations.js` /
  `tab_items.js`** — turn the existing missing-asset notes/badges into "Upload…" buttons
  calling `uploadAsset` (portrait / sprite / background / item image respectively).
- [ ] 4. **`dev/verify/drive_editor.py`** — the smoke driver per the context (own server
  spawn on 8933, tab walk, preview-card assert, inline-edit round-trip + git restore,
  screenshot, clean exit codes, server killed in `finally`).
- [ ] 5. **`CLAUDE.md`** — the two doc edits (dev/ row mention + trainer count fix).
  Confirm the `AGENTS.md` sentence from phase 27 exists; add it only if missing.
- [ ] 6. **Upload round-trip check** (part of the work): with the server running, use the
  Issues tab to upload a PNG (use an existing repo PNG as the source file, e.g.
  `assets/card-backs/POKEMON_CARD_BACK.png`) for one location background → file appears at
  `assets/backgrounds/<id>.png`, the warning row disappears, the badge count drops. Then
  delete the uploaded file (`rm assets/backgrounds/<id>.png`) so the repo returns to its
  pre-check state.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] The step-6 upload round-trip behaved exactly as described, and the uploaded file was
  removed afterwards (`git status` clean, `assets/backgrounds/` empty again).
- [ ] `dev/verify/.cache/venv/bin/python dev/verify/drive_editor.py` exits 0 and writes
  `dev/verify/editor_smoke.png` showing the editor with a rendered card in the preview
  pane; `pokemon.json` is unchanged afterwards.
- [ ] An `assets.orphan-portrait` row (Linoone.png) renders with no action buttons; a
  `trainers.*` error row (introduce one transiently by editing a copy? — simpler: verify
  jump-links using a warning row with a recordKey, e.g. a missing item image jumps to that
  item) navigates to the right tab + record.
- [ ] `CLAUDE.md` diff is exactly the two documented edits; `bash
  dev/feature_plans/status.sh` reports the whole 25-batch DONE once every box above is
  ticked.

## Out of scope / do not touch

Never delete or overwrite existing asset files (uploads may only fill **missing** ones
during verification, and the test upload is removed afterwards); no new validation rules;
no game-code changes; no changes to `dev/verify/lib.py` or the existing battle drivers; no
edits to earlier phase files beyond ticking boxes. Inherit all batch ground rules from
`25-data-editor-overview.md` (no `git commit`, no `scripts/manage_*`, no `TODO.md`, no
third-party deps, 127.0.0.1 only, run `node tests/run_all.js` after every change).
