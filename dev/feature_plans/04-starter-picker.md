# Phase 4 — Starter picker

**Prereqs:** phase 2 (phase 3 NOT required). **Read first:** `00-overview.md`.
**Goal:** New Game shows a choose-1-of-3 starter screen; the chosen deck becomes the
run's collections; level 1's location is guaranteed to include the starter's type.
Ends green + playable.

## Context you need

- `main.js`: `handleNewGame` (~26–30) clears the two localStorage keys and
  navigates to `NEW_RUN_ROUTE = 'area.html?newRun=1'` (~7). Continue routing
  (`getSavedRunRoute`) must stay untouched.
- `map/area.js`: `consumeNewRunRequest` (~705) parses `location.search` for
  `newRun=1` and strips it with `history.replaceState`;
  `createFreshRunState` (~696) currently hardcodes `starterId: 'water'` (phase 2's
  interim bridge — you replace the hardcode, but `'water'` remains the fallback for
  a missing/invalid param). `createCardCollections()` (~1421) builds the deck with
  `findGameRecord` exact-name lookup + silent fallback creators (~1483) and
  `runStore.createPokemonCard/createAttackCard/createItemCard`.
- `PokeLocations.STARTER_DECKS` (phase 1) holds the three deck definitions,
  display names, and each deck's `type`.
- Page conventions: each activity is its own root HTML + `map/<page>.js`
  controller; pages share `static/styles.css` (+ optional per-page css); body
  classes like `menu-page` scope the styling. Look at `index.html` + a simple page
  (`mart.html`) for the skeleton and script-tag order.
- Pokemon portraits: species records expose a portrait path (grep `portraitPath`
  in `arena/arena_data.js`) — use them on the deck cards.

## Steps

- [x] 1. **`starter.html`** — new root page, same skeleton/script order as the
  other map pages (`arena/arena_data.js`, `map/run_state.js`, `map/locations.js`,
  then `map/starter.js`; no arena engine files needed). Body class `menu-page
  starter-page`; a heading ("Choose your starter deck") and a container the JS
  fills.
- [x] 2. **`map/starter.js`** — on init, `await arena.Data.loadGameData()`, render
  one card per `PokeLocations.STARTER_DECKS` entry: deck display name, its type,
  the two pokemon portraits + names, and the attack/item list (names × counts,
  straight from the deck definition — do NOT retype card names). Click/keyboard
  select → `location.href = 'area.html?newRun=1&starter=<id>'`. Simple bespoke
  markup; don't pull in `arena.Render`.
- [x] 3. **`main.js`** — `handleNewGame` still clears both localStorage keys, then
  navigates to `starter.html` (update `NEW_RUN_ROUTE` or introduce a sibling
  constant; keep the clearing exactly as-is).
- [x] 4. **`map/area.js`** — `consumeNewRunRequest` also reads the `starter` param
  and returns it; `createFreshRunState(starterId)` validates it against
  `STARTER_DECKS` (invalid/missing → `'water'`), passes it into `createRunState`,
  and chooses the L1 location with `requiredType:
  STARTER_DECKS[starterId].type`. `createCardCollections(starterId)` iterates the
  deck definition (pokemon ×1 each, attacks/items × their counts) instead of the
  hardcoded Blastoise list; keep the existing `findGameRecord` + fallback + card-
  factory structure and the collections shape (`{ pokemon, actions, bench }`).
- [x] 5. **`static/styles.css`** — small `.starter-page` section (grep the
  section-comment style, e.g. `/* --- Main Menu --- */`, and match it): responsive
  3-card row (wraps on narrow viewports), reusing existing tokens/button styles.
  No redesign of anything else.
- [x] 6. **Tests** (`tests/data_validation.test.js` or the progression file —
  match surrounding style): after `loadRealGameData()`, every pokemon/attack/item
  name in every `STARTER_DECKS` entry resolves to a real record (guards the
  "Flame Thrower"/"Will-o-wisp" traps against the silent fallback); each deck's
  `type` has ≥1 enabled location containing it.

## Verification

1. `node tests/run_all.js` green.
2. Browser (verify skill): New Game → starter page shows 3 decks with portraits;
   pick **fire** → area.html Level 1 location includes FIRE in
   `run.location.types`; `run.collections` is exactly Charizard, Typhlosion,
   2× Flame Thrower, 2× Fire Spin, 2× Will-o-wisp, 1 Sitrus Berry, 1 Withdraw Wand
   (assert via localStorage through the driver — every card must be a real record,
   no fallback stubs; fallback records are distinguishable, grep
   `createFallback` in area.js to see how). Repeat quickly for water and grass.
3. `area.html?newRun=1` with no starter param still starts a water run (fallback).
4. Continue flow from index.html is unaffected mid-run.

## Out of scope / do not touch
Level progression/gauntlet logic, events, theming (starter page uses the current
neutral look; phase 6 restyles globally), deck rules/engine.
