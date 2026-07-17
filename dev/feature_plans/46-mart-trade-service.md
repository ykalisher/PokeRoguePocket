# Phase 46 — Mart service: typed 1:1 pokemon trade

**Recommended agent:** Sonnet · high effort.
**Prereqs:** 42 (eligibility pools) + 44 (services panel). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** Each mart offers one free trade, with both types shown in advance: the player
trades away one of their pokemon matching the mart's "wanted" type and receives a random
obtainable species of the mart's "offered" type. Pokemon count is unchanged (1:1).

## Context you need

- **Spec**: wanted/accepted type = randomly picked from the distinct types present on
  the player's active+bench pokemon; offered type = randomly picked from types that have
  ≥1 *obtainable* species (`isObtainablePokemon` from phase 42 — so the result is never
  a legendary, baby, or mega; Locked-spec assumption 1). Babies/legendaries may be
  traded away. Free, once per mart.
- Both types are rolled **when the mart encounter is created** and persisted on it, so
  they survive re-entry: `map/area.js` `getOrCreateMartEncounter` (~966) creates the
  encounter; `sanitizeMartEncounter` (~1039) runs on revisit; `normalizeMartEncounters`
  (`map/run_state.js` ~491) needs defaults for the new fields.
- Receiving a pokemon: `runStore.createPokemonCard(record, 'player',
  runStore.allocateCardId(run, 'pokemon', record.name))` then
  `runStore.addPokemonCard(run, card)` (precedent: `createCardsFromRecord` in
  `map/event_effects.js` ~427). After any pokemon change:
  `balancePokemonCollections` + `rebuildActionDeckForActivePokemon` + `saveRunState`.
- Selection plumbing in `map/mart.js`: `selectPokemon` / `getPokemonCardById` (~321),
  the "Your Pokemon" grid, and the `data-mart-service` click branches (44/45).
- Record types via `PokeLocations.getRecordTypes(record)` (ignores `'NONE'` slots).

## Steps

- [ ] 1. **`map/locations.js`** — add and export pure helpers:
  `rollMartTradeTypes(run, gameData)` → `{ acceptedType, offeredType }` (accepted:
  uniform over the distinct type set of the player's active+bench pokemon — reuse
  `getRunPokemonRecords` from 43; offered: uniform over the set of types having ≥1
  obtainable species; return `null` if the player owns no pokemon);
  `chooseTradeResultRecord(gameData, offeredType, excludeName)` → uniform over
  obtainable species whose types include `offeredType`, excluding `excludeName` when
  possible (fall back to including it if it's the only match).
- [ ] 2. **`map/area.js`** — `getOrCreateMartEncounter`: stamp
  `tradeAcceptedType` / `tradeOfferedType` (from `rollMartTradeTypes`) and
  `tradeUsed: false` on new encounters. `sanitizeMartEncounter`: when `tradeUsed` is
  false and either field is missing (old saves) or the player no longer owns a pokemon
  of `tradeAcceptedType` or the offered type's obtainable pool is empty (data changed),
  re-roll both via `rollMartTradeTypes`.
- [ ] 3. **`map/run_state.js`** — `normalizeMartEncounters`: defaults
  `tradeAcceptedType: encounter.tradeAcceptedType || null`, same for
  `tradeOfferedType`, and `tradeUsed: Boolean(encounter.tradeUsed)`.
- [ ] 4. **`map/mart.js`** — add a "Trade" row to the Services section showing both
  types up front (e.g. `Wanted: WATER → Offered: FIRE`); button
  (`data-mart-service="trade"`) enabled when `!tradeUsed` and the *selected* pokemon's
  types include the accepted type; helper text when the selected pokemon doesn't match
  or nothing is selected. On confirm: remove the selected card from its collection,
  `chooseTradeResultRecord` (exclude the traded-away name), create+add the new card,
  balance + rebuild + save, set `tradeUsed = true`, message
  `Traded <old> for <new>.`, re-render. If the accepted type became orphaned mid-visit
  (e.g. the matching pokemon was just released), re-run the sanitize re-roll instead of
  dead-ending.
- [ ] 5. **`tests/mart_stock.test.js`** (extend, fixture gameData incl. a
  baby/mega/legendary) — `rollMartTradeTypes`: accepted ∈ the run's owned types, offered
  always has ≥1 obtainable species; `chooseTradeResultRecord` over ~200 rolls never
  returns a legendary/baby/mega and always matches the offered type; a simulated trade
  keeps total pokemon count constant.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill: mart shows both types before any commitment; selecting a
  non-matching pokemon keeps the button disabled; trading swaps exactly one pokemon
  (counter unchanged), the received pokemon's types include the offered type; the
  service is used on re-entry; a different mart rolls fresh types.

## Out of scope / do not touch
Paid or repeatable trades; the wandering-trader event (already filtered via 42); offer
stock; the PC (deleted in 44); trade animations.
