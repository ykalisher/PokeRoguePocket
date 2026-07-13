# Phase 2 — Run state v2 + location-driven level 1

**Prereqs:** phase 1. **Read first:** `00-overview.md`.
**Goal:** the run persists a level counter and a location snapshot; level 1 picks a
real location (interim water-starter default) and its types drive wild-pokemon
pools and the map header. **This is the single save-format break** — do it once,
completely. Ends green + playable.

## Context you need

- `map/run_state.js` (`window.PokeRun`): `STORAGE_VERSION = 1` (~line 9), key
  `pokemon-rogue-pocket-run`. `createRunState({ area, collections })` (~15–40).
  `normalizeRunState` (~357) **returns null on any version mismatch** and rebuilds
  the object field-by-field — anything you don't copy there is silently dropped on
  every load. Same for `normalizeAreaState` (~378).
- `map/area.js`: `restoreOrCreateRunState` (~669) → `consumeNewRunRequest` (~705,
  parses `?newRun=1`, strips it via `history.replaceState`) →
  `createFreshRunState` (~696) calls `runStore.createRunState({ area:
  createAreaGraph(), collections: createCardCollections() })`. Frozen `AREA_THEME`
  (~13) feeds the header render (~294–297, includes the literal string
  "Area 1 of 4") and stamps `terrain` onto capture encounters (~795).
- Wild-pool placeholder duplicated in `map/area.js`
  `getAvailablePokemonForCurrentTerrain` (~1016) and `map/capture.js` (~385) — both
  marked `// TODO: Replace this WATER placeholder…`. Replace BOTH in this phase.
- `main.js`: `loadSavedRunState` (~68–77) raw-parses the run JSON for the Continue
  button with **no version check** — a v1 save would route into pages that then
  silently discard it.
- `PokeLocations` (phase 1): `chooseNextLocation`, `createLocationSnapshot`,
  `getWildPokemonPool`, `STARTER_DECKS`, `TOTAL_LEVELS`.

## Steps

- [x] 1. **`map/run_state.js`:** bump `STORAGE_VERSION` to 2. Extend
  `createRunState` to accept and set `{ area, collections, location, starterId,
  level }` → new top-level fields:
  `level` (default 1), `starterId` (default `'water'`), `location` (snapshot object
  or null), `visitedLocationIds` (default `location ? [location.id] : []`),
  `runCompleted: false`, `runCompletedAt: null`. Add `bossNodeId` to the area state
  (default `'boss-12'` — the current graph's terminal node id).
- [x] 2. **Normalizers (same commit):** `normalizeRunState` — carry `level`
  (integer clamp 1–4, default 1), `starterId` (non-empty string, default
  `'water'`), `location: normalizeLocationSnapshot(run.location)`,
  `visitedLocationIds` (array of strings, default `[]`), `runCompleted` (Boolean),
  `runCompletedAt` (`|| null`). New `normalizeLocationSnapshot`: null unless it has
  a non-empty `id` and non-empty `types` array; carries name/terrain/theme/
  background with safe defaults. `normalizeAreaState` — carry
  `bossNodeId: area.bossNodeId || 'boss-12'`. Lenient defaults everywhere: a v2
  save written before a later phase must still load after that phase.
- [x] 3. **`map/area.js` — new-run location:** in `createFreshRunState`, choose the
  L1 location: `PokeLocations.chooseNextLocation(arena.GameData, { requiredType:
  PokeLocations.STARTER_DECKS['water'].type })` (hardcoded `'water'` with a brief
  comment that phase 4 threads the real starter choice through), snapshot it, and
  pass `location`, `starterId: 'water'`, `level: 1` into `createRunState`.
- [x] 4. **`map/area.js` — repair path:** in the restore branch, if a loaded v2 run
  has `location == null` (mid-development save), choose one the same way, set
  `visitedLocationIds`, and save. Keeps every v2 save playable.
- [x] 5. **`map/area.js` — display + stamping:** header renders from run state, not
  `AREA_THEME`: location `name`, `terrain` pill, and
  `Level ${run.level} of ${PokeLocations.TOTAL_LEVELS}` (replaces "Area 1 of 4").
  Capture-encounter creation stamps `terrain: run.location.terrain`. Delete the
  `AREA_THEME` constant once nothing references it (grep to confirm).
- [x] 6. **Wild pools (both files, same commit):**
  `getAvailablePokemonForCurrentTerrain` in `map/area.js` AND `map/capture.js`
  become delegates to `PokeLocations.getWildPokemonPool(arena.GameData,
  run.location.types)` (each file already has access to the loaded run — grep how
  each obtains it). Keep the functions' names/callers; only the body changes.
  Legendary-capture logic stays untouched.
- [x] 7. **`main.js` Continue guard:** `loadSavedRunState` returns null unless
  `run.version === 2` (match how the file is structured; a local constant is fine —
  note it must track `PokeRun.STORAGE_VERSION`). Old v1 saves now grey out/hide
  Continue instead of ghost-routing.
- [x] 8. **Tests** (extend `tests/run_progression.test.js`): `createRunState` v2
  field shape; normalize round-trip preserves
  level/starterId/location/visitedLocationIds/runCompleted/bossNodeId; v1 blob →
  null; missing-location v2 blob still normalizes (location null, not a crash);
  `normalizeLocationSnapshot` rejects id-less/typeless input.

## Verification

1. `node tests/run_all.js` green.
2. Browser (verify skill): New Game → area page shows a location name + terrain +
   "Level 1 of 4"; the L1 location's `types` always include WATER (water default);
   capture options match the location types (check 2–3 new runs; inspect
   `JSON.parse(localStorage['pokemon-rogue-pocket-run']).location` via the driver);
   reload mid-run → same location persists; battle → win → return still works.
3. Seed a fake v1 save (`localStorage` write via driver), load `index.html` →
   Continue does not offer the stale run.

## Out of scope / do not touch
Level transitions (boss clear stays terminal), graph generation, trainer selection,
rank mixes, starter picker UI, events, theming.
