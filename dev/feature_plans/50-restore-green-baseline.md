# Phase 50 — Restore green baseline

**Recommended agent:** Haiku · low effort.
**Prereqs:** none. **Read first:** `49-editor-polish-overview.md`.
**Goal:** `node tests/run_all.js` fully green again, with zero data-value changes to `locations.json`.

## Context you need

The owner's commit `ad26697 "Change locations"` rewrote `locations.json` with the
interactive CLI (plain `JSON.stringify(..., null, 2)`) and replaced the location roster.
That broke exactly two tests:

1. `tests/editor_format.test.js` — "locations.json formats byte-exact against the live
   file". The canonical on-disk format comes from
   `dev/editor/format_json.js`'s `formatDataFile('locations', data)` (the "smart" style
   that inlines short `types` arrays and `theme` objects on one line); the live file is
   currently in the expanded plain style.
2. `tests/editor_validation.test.js` — test `'locations: disconnected graph'` (around
   line 163) mutates `locations.find((location) => location.id === 'meadow-market')`,
   but `meadow-market` no longer exists, so `isolated` is `undefined` and the test
   throws `TypeError: Cannot set properties of undefined (setting 'types')`.

Verified replacement for the test: `lavender-town` (types `GHOST/HUMAN/MONSTER`) works —
each of its types is still covered by another enabled location (GHOST: cinnabar-mansion,
old-chateau; HUMAN: cinnabar-mansion, castelia-city; MONSTER: old-chateau, cerulean-cave,
lake-of-rage), it contains no starter type (starters are WATER/GRASS/FIRE), and no other
location has BABY or FOSSIL, so setting its types to `['BABY','FOSSIL']` isolates it.
Simulating exactly that mutation against the live data yields **only** the error code
`locations.graph-disconnected` — the assertion the test wants.

## Steps

- [ ] 1. **`locations.json`** — rewrite the file through the canonical formatter without
  changing any data:
  ```bash
  node -e "
  const fs = require('fs');
  const { formatDataFile } = require('./dev/editor/format_json.js');
  const data = JSON.parse(fs.readFileSync('locations.json', 'utf8'));
  fs.writeFileSync('locations.json', formatDataFile('locations', data));
  "
  ```
- [ ] 2. **`tests/editor_validation.test.js`** — in the `'locations: disconnected graph'`
  test (~line 163): change `'meadow-market'` to `'lavender-town'` and replace the
  comment above the mutation so it stays truthful, e.g.:
  ```js
  // lavender-town's types (GHOST/HUMAN/MONSTER) are all also covered by other
  // enabled locations and include no starter type, so isolating it doesn't
  // break starter coverage — only the connectivity rule.
  ```
  Leave the `['BABY', 'FOSSIL']` mutation and the
  `locations.graph-disconnected` assertion exactly as they are.

## Verification

- [ ] `node tests/run_all.js` green (both formerly-failing tests now pass).
- [ ] `locations.json` data is byte-identical *as data* — this prints `DATA IDENTICAL`:
  ```bash
  node -e "
  const fs = require('fs');
  const a = JSON.parse(fs.readFileSync('locations.json', 'utf8'));
  const b = JSON.parse(require('child_process').execSync('git show HEAD:locations.json'));
  console.log(JSON.stringify(a) === JSON.stringify(b) ? 'DATA IDENTICAL' : 'DATA CHANGED');
  "
  ```

## Out of scope / do not touch

Do not change any location's values (that happens in phase 52). Do not touch
`scripts/manage_locations.js`, `dev/editor/format_json.js`, or any other test. Do not
`git commit`.
