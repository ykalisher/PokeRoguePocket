# Phase 65 — De-brittle JSON-coupled unit tests

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none (independent of Phase 66). **Read first:** `64-dev-friction-cleanup-overview.md`.
**Goal:** Adding or renaming ordinary card data no longer turns the suite red. Ends green
(189+ pass / 0 fail). Only `tests/mart_stock.test.js` and `tests/pokemon_pools.test.js`
change.

## Context you need

The suite is green today and mostly data-proof. Exactly two tests break purely because
`*.json` grew or a specific card was renamed — this phase fixes only those. **Do not
touch any other test file** (see the fence).

**Mart gating is intrinsic** — `map/locations.js` `isMartOfferAllowed` (~838-847):
- attacks: gated iff `getRecordTypes(attack).includes('LEGENDARY')`.
- items: gated iff `Array.isArray(item.status) && item.status.includes('DRAGON_GEM')`.
- dragon-gem prereqs: owning both a `DRAGON`-typed attack and a `DRAGON`-typed pokemon.

`getRecordTypes` (`map/locations.js` ~84) is **not exported**, so mirror it locally in the
test as `typesOf` (handles both the `record.types` array shape and the
`type1/type2/type3` shape). Exported and usable from `globalThis.PokeLocations` (aliased
`P`): `getObtainablePokemonPool`, `isObtainablePokemon`, `getBabyPokemonPool`,
`isMegaPokemon` (obtainable already excludes legendary/baby/mega).

**Test helpers already in `mart_stock.test.js`** (top of file, ~15-51): `emptyRun()`,
`addPokemon(run, record, bench)`, `addAttack(run, record, bench)`,
`findRecord(records, name)` (asserts existence), `drawNames(records, key, run, count)`.

Run command: `node tests/run_all.js`. The mart draw test is randomized (200 iterations),
so run it 2-3 times.

## Steps

- [x] 1. **`tests/mart_stock.test.js`** — add these selector helpers next to the existing
  helpers (after `findRecord`, ~line 39). They make card selection trait-based instead of
  name-based, and each asserts its pick exists:

  ```js
  function typesOf(record) {
      if (record && Array.isArray(record.types)) return record.types;
      return record ? [record.type1, record.type2, record.type3].filter(t => t && t !== 'NONE') : [];
  }
  function itemIsDragonGem(item) {
      return Boolean(item && Array.isArray(item.status) && item.status.includes('DRAGON_GEM'));
  }
  function pick(records, predicate, label) {
      const record = records.find(predicate);
      assert.ok(record, `expected real data to contain ${label}`);
      return record;
  }
  ```

- [x] 2. **`tests/mart_stock.test.js`** — replace every `findRecord(gameData.…, '<Name>')`
  exemplar lookup with a trait-based `pick(...)`. Apply this mapping everywhere those
  names appear (Articuno, Blastoise, Surf, Dragonite, Dragon Claw):

  - legendary pokemon (was `'Articuno'`) →
    `pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon')`
  - dragon pokemon (was `'Dragonite'`) →
    `pick(gameData.pokemon, p => typesOf(p).includes('DRAGON'), 'a dragon pokemon')`
  - plain seed pokemon (was `'Blastoise'`) — must own no legendary and not satisfy dragon
    prereqs →
    `pick(gameData.pokemon, p => P.isObtainablePokemon(p, gameData) && !typesOf(p).includes('DRAGON'), 'a plain obtainable non-dragon pokemon')`
  - legendary attack (was `'Hyper Beam'` when used as a *record*) →
    `pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack')`
  - dragon attack (was `'Dragon Claw'`) →
    `pick(gameData.attacks, a => typesOf(a).includes('DRAGON'), 'a dragon attack')`
  - normal/ungated attack (was `'Surf'`) →
    `pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack')`
  - dragon-gem item (was `'Fire Gem'` when used as a *record*) →
    `pick(gameData.items, itemIsDragonGem, 'a dragon-gem item')`
  - non-gem item (a plain item, if one is looked up by name) →
    `pick(gameData.items, i => !itemIsDragonGem(i), 'a non-gem item')`

  Keep the existing per-test setup shape (which `addPokemon`/`addAttack` calls run, and
  in which run) — only the *source* of each record changes from a literal name to a
  predicate. In the "no forbidden name leaks over 200 draws" test (~127-149), derive the
  forbidden names from the same selectors, e.g. near the top of that test:
  ```js
  const forbiddenAttack = pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack').name;
  const forbiddenItem = pick(gameData.items, itemIsDragonGem, 'a dragon-gem item').name;
  ```
  and assert `!attackNames.includes(forbiddenAttack)` / `!itemNames.includes(forbiddenItem)`
  in place of the literals `'Hyper Beam'` / `'Fire Gem'`.

- [x] 3. **`tests/mart_stock.test.js`** — fix the hard-coded count test (title ~114,
  asserts `99` / `9`). Replace the two magic-number assertions with the **relative** form
  and add non-empty / meaningful-filter guards:

  ```js
  const legendaryAttackCount = gameData.attacks.filter(a => typesOf(a).includes('LEGENDARY')).length;
  const gemItemCount = gameData.items.filter(itemIsDragonGem).length;
  assert.equal(legalAttacks.length, gameData.attacks.length - legendaryAttackCount);
  assert.equal(legalItems.length, gameData.items.length - gemItemCount);
  assert.ok(legendaryAttackCount > 0 && gemItemCount > 0, 'gated cards must exist so the filter is meaningful');
  assert.ok(legalAttacks.length > 0 && legalItems.length > 0, 'filtered pools must stay non-empty');
  ```
  Update the test title to drop the `99` / `9` literals, e.g.
  `'filtered pools drop exactly the gated cards for an ineligible run'`. (The sibling test
  at ~161-162 already uses `=== gameData.attacks.length` — this matches that idiom.)

- [x] 4. **`tests/pokemon_pools.test.js`** — in the `getBabyPokemonPool` real-data test
  (~130-138):
  - Keep `assert.ok(babies.length >= 1, …)` but change its message to drop the specific
    species, e.g. `'expected at least one authored BABY-typed species'`.
  - **Delete** the line `assert.ok(babies.some(record => record.name === 'Numel'), …)` (~134).
  - Keep the per-record BABY check (`babies.forEach(... includes('BABY') ...)`, ~135-137).
  - Optionally retitle to `'getBabyPokemonPool returns only BABY-typed species from real pokemon.json'`.
  Leave the recompute-the-expected-set test below it (~140-162) untouched — it is already
  the gold-standard data-proof pattern.

## Verification

- [x] `node tests/run_all.js` green, run **2-3 times** (the mart draw test is randomized).
- [x] `git diff --name-only` shows **only** `tests/mart_stock.test.js` and
  `tests/pokemon_pools.test.js` changed — no other file.
- [x] Data-proof sanity check (reasoned, do not commit): confirm the count test now uses
  `gameData.attacks.length` / `gameData.items.length` minus the computed gated counts, so
  appending an ordinary attack or a non-gem item would keep it green. Confirm no remaining
  `findRecord(...)` or literal card-name string survives in `mart_stock.test.js` for the
  card *selection* paths (`grep -n "findRecord\|'Articuno'\|'Blastoise'\|'Surf'\|'Dragonite'\|'Dragon Claw'\|'Hyper Beam'\|'Fire Gem'" tests/mart_stock.test.js`).

## Out of scope / do not touch

- **Ground rules** (see `64-dev-friction-cleanup-overview.md`): never `git commit` unless
  asked; never run `scripts/manage_*`; don't act on `TODO.md`/`dev/owner_tasks/`; no
  third-party deps; run `node tests/run_all.js` after every change.
- Do **not** modify `data_validation.test.js`, `editor_validation.test.js`,
  `effect_boost.test.js`, `baby_event.test.js`, the byte-exact format snapshots in
  `editor_format.test.js`, the `LEVEL_CONFIG` snapshot in `run_progression.test.js`, or
  the `editor_api` `effectTypes` count — all intentionally kept strict.
- Do **not** edit any `*.json` data file, `map/locations.js`, or engine code. This phase
  is test-only. Do not "strengthen" or add new tests beyond the edits above.
