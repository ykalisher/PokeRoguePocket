# Phase 43 — Mart stock eligibility filters (legendary attacks & dragon gems)

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 42 (helpers file ordering; no hard code dependency). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** The mart never stocks a LEGENDARY-typed attack unless the player owns a
LEGENDARY-typed pokemon (active or bench), and never stocks a dragon-gem item unless the
player has both a DRAGON-typed attack and a DRAGON-typed pokemon — enforced at stock
creation and every repair/sanitize path.

## Context you need

- Mart stock is 8 attacks + 4 items, chosen as uniform random distinct names with **no
  filtering** at encounter creation: `map/area.js` `getOrCreateMartEncounter` (~966) →
  `chooseMartCardNames(collectionKey, count)` (~1094). Repair paths that refill/dedupe
  the same lists and must apply the same filter: `sanitizeMartCardNames` (`map/area.js`
  ~1053, called from `sanitizeMartEncounter` ~1040) and `repairOfferNames` /
  `chooseOfferNames` (`map/mart.js` ~621/~656). Already-bought names live in
  `boughtAttackNames`/`boughtItemNames` and must survive sanitize untouched.
- Detection precedents (`map/capture.js`): `isLegendaryPokemon` (~490) — record types
  include `'LEGENDARY'`; attack legendary check (~577); `itemIsDragonGem` (~535) — item
  `status` array includes `'DRAGON_GEM'`.
- Run cards: `run.collections.pokemon` / `run.collections.bench.pokemon` carry
  `.pokemon` records; `run.collections.actions` / `bench.actions` carry `.attack` or
  `.item`.
- Pool sizes stay sufficient after filtering: 116−17 = 99 legal attacks ≥ 8;
  14−6 = 8 legal items ≥ 4 — the draw can never come up short.
- Accepted behavior (Locked spec assumption 4): stock is evaluated at encounter
  creation/repair; gaining a legendary later does not retro-upgrade an existing mart's
  stock.

## Steps

- [ ] 1. **`map/locations.js`** — add pure, run-aware helpers (exported):
  `getRunPokemonRecords(run)` and `getRunAttackRecords(run)` (active + bench);
  `runOwnsLegendaryPokemon(run)`; `runHasDragonGemPrereqs(run)` (≥1 DRAGON-typed attack
  AND ≥1 DRAGON-typed pokemon); `isMartOfferAllowed(record, collectionKey, run)` — for
  `'attacks'`: allowed unless the attack is LEGENDARY-typed and
  `!runOwnsLegendaryPokemon(run)`; for `'items'`: allowed unless the item's `status`
  includes `'DRAGON_GEM'` and `!runHasDragonGemPrereqs(run)`; other collections always
  allowed. Reuse `getRecordTypes`.
- [ ] 2. **`map/area.js`** — `chooseMartCardNames` and `sanitizeMartCardNames`: filter
  the candidate records / replacement names through
  `locations.isMartOfferAllowed(record, collectionKey, state.run)`. Walk the existing
  sanitize logic carefully so bought names are preserved exactly as today.
- [ ] 3. **`map/mart.js`** — `chooseOfferNames` and `repairOfferNames`: apply the same
  filter with `state.run`.
- [ ] 4. **`tests/mart_stock.test.js`** (new) — load `map/locations.js` via
  `tests/helpers/arena_env.js` with the real JSON data: build fixture runs (a) with and
  without a LEGENDARY pokemon, (b) with and without DRAGON attack+pokemon; assert
  `isMartOfferAllowed` verdicts on a known LEGENDARY attack (e.g. `Hyper Beam`), a
  normal attack, a gem item (e.g. `Fire Gem`), and a normal item; then over ~200
  iterations of the filtered draw for the ineligible run, assert no forbidden name ever
  appears while eligible runs can still draw the full range.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill: fresh run (starter decks have no legendary and, unless fire/water
  luck says otherwise, check the actual deck for DRAGON prereqs) → enter a shop node;
  read the offer names from the DOM and assert none is a LEGENDARY-typed attack or a
  dragon gem; leave and re-enter the same mart — stock identical and still compliant.

## Out of scope / do not touch
Prices and stock counts (8×70 / 4×90); the capture-reward dragon-gem logic in
`map/capture.js` (already conditional); the mart services (phases 44–46); `buyOffer`;
baby/mega pool logic (42 owns it).
