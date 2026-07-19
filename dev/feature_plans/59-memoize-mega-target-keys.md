# Phase 59 — Memoize mega-target keys in map/locations.js

**Recommended agent:** Sonnet · low effort.
**Prereqs:** 58 (green baseline). **Read first:** `57-bugfix-perf-overview.md` (Locked spec →
"Phase 59 memoization contract").
**Goal:** `getMegaTargetKeys(gameData)` computes its Set once per gameData object instead of on
every call, with tests proving identical behavior and object-identity invalidation. Pool
builders drop from ≈1.8 ms to well under 0.2 ms per call.

## Context you need

- `map/locations.js` (IIFE on `window.PokeLocations`). Current shape, ~lines 725–743:
  ```js
  function getMegaTargetKeys(gameData) {
      const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
      const keys = new Set();

      pokemon.filter(isBabyPokemon).forEach(baby => {
          const mega = findPokemonByNameOrId(gameData, baby.evolvesInto);
          if (!mega) return;
          keys.add(mega.name);
          keys.add(mega.id);
      });

      return keys;
  }

  function isMegaPokemon(record, gameData) {
      if (!record) return false;
      const keys = getMegaTargetKeys(gameData);
      return keys.has(record.name) || keys.has(record.id);
  }
  ```
  `isObtainablePokemon` calls `isMegaPokemon` per record, and `getObtainablePokemonPool` /
  `getWildPokemonPool` call `isObtainablePokemon` per species — that is the O(n²).
- Why a `WeakMap` keyed by the gameData object is correct: `arena/arena_data.js
  loadGameData()` builds a **new** object every load (`arena.GameData =
  normalizeGameData(...)`), and tests build fresh fixture objects per test. Nothing mutates
  `gameData.pokemon` after load, so object identity is a safe cache key and entries are
  garbage-collected with their gameData.
- `getMegaTargetKeys` is exported on `PokeLocations` (used by the data skill docs and tests) —
  keep the export and the signature.
- Test home: `tests/pokemon_pools.test.js`. It already requires the module via
  `tests/helpers/arena_env` and has `fixtureGameData()` (a 5-record set where
  `Fixture Baby.evolvesInto = 'Fixture Mega'`) plus `makePokemon(name, id, types, extra)`.
  Its real-data test asserts `getWildPokemonPool(gameData, []).length === 160` — that
  assertion doubles as the behavior-identity check against live data.

## Steps

- [ ] 1. **`map/locations.js`** — add a module-level cache directly above
  `getMegaTargetKeys` and make the function consult it. Rename the current body to a private
  compute helper:
  ```js
  // Cache keyed by the gameData object itself: loadGameData() replaces
  // arena.GameData with a fresh object on every load, so object identity is
  // the invalidation and stale entries are garbage-collected with their data.
  const megaKeyCache = new WeakMap();

  function getMegaTargetKeys(gameData) {
      if (!gameData || typeof gameData !== 'object') return computeMegaTargetKeys(gameData);

      let keys = megaKeyCache.get(gameData);

      if (!keys) {
          keys = computeMegaTargetKeys(gameData);
          megaKeyCache.set(gameData, keys);
      }

      return keys;
  }

  function computeMegaTargetKeys(gameData) {
      const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
      const keys = new Set();

      pokemon.filter(isBabyPokemon).forEach(baby => {
          const mega = findPokemonByNameOrId(gameData, baby.evolvesInto);
          if (!mega) return;
          keys.add(mega.name);
          keys.add(mega.id);
      });

      return keys;
  }
  ```
  Do not export `computeMegaTargetKeys` and do not change `isMegaPokemon`,
  `isObtainablePokemon`, or any pool function — they now benefit automatically.
- [ ] 2. **`tests/pokemon_pools.test.js`** — append these tests after the existing
  `findPokemonByNameOrId` test:
  ```js
  test('getMegaTargetKeys is memoized per gameData object and stays correct', () => {
      const gameData = fixtureGameData();
      const first = P.getMegaTargetKeys(gameData);

      assert.deepEqual([...first].sort(), ['9002', 'Fixture Mega']);
      // Same object in, same cached Set out.
      assert.equal(P.getMegaTargetKeys(gameData), first);
  });

  test('a different gameData object gets freshly computed keys', () => {
      const gameData = fixtureGameData();
      P.getMegaTargetKeys(gameData);

      const other = fixtureGameData();
      other.pokemon.push(
          makePokemon('Other Mega', '9102', ['WATER', 'DRAGON']),
          makePokemon('Other Baby', '9101', ['WATER', 'BABY'], { evolvesInto: 'Other Mega' })
      );
      const keys = P.getMegaTargetKeys(other);

      assert.deepEqual([...keys].sort(), ['9002', '9102', 'Fixture Mega', 'Other Mega']);
      // The first object's cache entry is untouched.
      assert.deepEqual([...P.getMegaTargetKeys(gameData)].sort(), ['9002', 'Fixture Mega']);
  });

  test('memoization does not change pool verdicts', () => {
      const gameData = fixtureGameData();
      const [baby, mega, , plainA] = gameData.pokemon;

      // Call twice: the second pass runs entirely from cache.
      for (let pass = 0; pass < 2; pass += 1) {
          assert.equal(P.isObtainablePokemon(plainA, gameData), true);
          assert.equal(P.isObtainablePokemon(baby, gameData), false);
          assert.equal(P.isObtainablePokemon(mega, gameData), false);
          assert.deepEqual(
              P.getObtainablePokemonPool(gameData).map(record => record.name).sort(),
              ['Fixture Plain A', 'Fixture Plain B']
          );
      }
  });
  ```

## Verification

- [ ] `node tests/run_all.js` green — including the untouched real-data assertion that
  `getWildPokemonPool(gameData, []).length === 160` (proves live behavior is unchanged).
- [ ] Timing sanity — before this phase, 100 calls measured 184 ms; after, expect < 20 ms:
  ```bash
  node -e "
  require('./tests/helpers/arena_env');
  require('./map/locations.js');
  const L = globalThis.PokeLocations;
  const gd = { pokemon: require('./pokemon.json') };
  const t = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) L.getObtainablePokemonPool(gd);
  console.log('100 calls:', Number(process.hrtime.bigint() - t) / 1e6, 'ms');
  "
  ```

## Out of scope / do not touch

No changes to `isMegaPokemon`/`isObtainablePokemon`/pool function bodies, exports, or any
caller (`map/area.js`, `map/capture.js`, `map/mart.js`, `map/event_effects.js`). No other
caching anywhere (in particular, do not cache pools themselves — only the key Set). Do not
`git commit`.
