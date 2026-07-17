# Phase 42 — Baby/mega data schema, validation, and shared obtainable-pokemon pools

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none (must land before 43, 46, 47, 48). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** The engine understands BABY pokemon and their mega evolution targets via a new
optional `evolvesInto` field; one shared eligibility helper excludes legendaries, babies,
and megas from every generic pokemon pool; validation locks the data rules. Everything is
inert and green while zero baby data exists (owner authors the cards later).

## Context you need

- `pokemon.json` (188 records): `name, type1, type2, type3, id ("0003"-style),
  baseHealth, baseAttack, baseDefense, baseSpeed`. `BABY` already exists in the
  `PokeType` enum (`scripts/data_options.js`) but no record uses it. There are no
  evolution fields or mechanics anywhere yet.
- **New schema field**: `evolvesInto` — optional string on a pokemon record naming its
  mega evolution by exact `name` OR by `id`. Meaningful on BABY-typed records; a "mega"
  is any record referenced by some baby's `evolvesInto` (there is NO mega type).
- Pool sites that must exclude babies/megas:
  - Wild pool: `getWildPokemonPool(gameData, locationTypes)` in `map/locations.js`
    (~565–573) — already excludes LEGENDARY types; callers `map/area.js` ~1124 and
    `map/capture.js` ~396.
  - Legendary capture pools: `map/area.js` (`chooseLegendaryPokemon`, ~1136) and
    `map/capture.js` (~454, near `isLegendaryPokemon` ~490) — a LEGENDARY-typed mega
    must not be capturable.
  - Event random pools: `map/event_effects.js` `chooseRandomRecord` (~292/~422 call
    sites, function ~587) — covers `gain-random-card`, `replace-*`, `trade-*` pokemon
    results. `event_effects.js` does not currently reference `PokeLocations`, so guard
    the access (`global.PokeLocations && ...`).
- Existing helpers to reuse in `map/locations.js`: `getRecordTypes` (~84),
  `uniqueByName` (~90).
- Validation lives in `tests/data_validation.test.js` (uses `scripts/data_options`) and
  is mirrored in `dev/editor/validate.js`. The data skill doc is
  `.claude/skills/data/SKILL.md`.

## Steps

- [x] 1. **`map/locations.js`** — add and export pure helpers:
  `findPokemonByNameOrId(gameData, ref)` (exact name match, else exact id match, else
  `null`); `isBabyPokemon(record)` (`getRecordTypes(record).includes('BABY')`);
  `getMegaTargetKeys(gameData)` (a `Set` of the name AND id of every record resolved
  from any baby's `evolvesInto`); `isMegaPokemon(record, gameData)`;
  `getBabyPokemonPool(gameData)`; `isObtainablePokemon(record, gameData)` — not
  LEGENDARY-typed, not baby, not mega; `getObtainablePokemonPool(gameData)`.
- [x] 2. **`map/locations.js`** — `getWildPokemonPool`: route its filtering through
  `isObtainablePokemon` (keep unique-by-name and the location-type match; the non-empty
  fallback becomes "all obtainable" instead of "all non-legendary").
- [x] 3. **`map/area.js`** and **`map/capture.js`** — in the legendary-capture pokemon
  pools, additionally exclude megas: `!PokeLocations.isMegaPokemon(record, gameData)`
  (each file already has the game data in scope at those sites; keep babies out too —
  they can't be LEGENDARY-typed *and* obtainable, but the explicit check is cheap:
  filter through `isObtainablePokemon`-style logic minus the LEGENDARY clause, or simply
  exclude `isMegaPokemon || isBabyPokemon`).
- [x] 4. **`map/event_effects.js`** — in `chooseRandomRecord`, when `cardKind ===
  'pokemon'`, filter the candidate records through
  `global.PokeLocations && global.PokeLocations.isObtainablePokemon` (skip the filter if
  `PokeLocations` is absent so the module keeps working standalone).
- [x] 5. **`tests/data_validation.test.js`** — add rules over the real data: every
  `evolvesInto` value resolves to an existing record by name or id; every BABY-typed
  pokemon has ≥1 non-BABY type; no attack in `attacks.json` uses `BABY` in any type
  slot. (`evolvesInto` stays *optional* even on babies — runtime code guards its
  absence; state that in a comment.) Mirror the same three rules in
  **`dev/editor/validate.js`**.
- [x] 6. **`dev/editor`** — verify the pokemon tab round-trips unknown fields: grep the
  save path (`dev/editor/` server + `tab_pokemon` code) for field allowlists that would
  drop `evolvesInto`; only if it is actually dropped, add a minimal passthrough.
- [x] 7. **`.claude/skills/data/SKILL.md`** — document `evolvesInto` (optional,
  name-or-id string, defines the baby→mega link), the BABY rules (≥1 other type, never
  on attacks, excluded from wild/random pools), and that megas are excluded from all
  generic pools.
- [x] 8. **`tests/pokemon_pools.test.js`** (new) — load `map/locations.js` via
  `tests/helpers/arena_env.js` (imitate `tests/run_progression.test.js`). Fixture
  gameData containing a baby (with `evolvesInto` a fixture mega), the mega, a legendary,
  and a plain species: assert `isObtainablePokemon` verdicts; `getWildPokemonPool`
  excludes baby/mega/legendary; `findPokemonByNameOrId` resolves by name and by id;
  against the REAL `pokemon.json`, `getBabyPokemonPool` is `[]` and
  `getWildPokemonPool` still returns exactly the 160 non-legendary species (no live
  behavior change today). Also require `map/event_effects.js` and assert
  `chooseRandomRecord`-driven pokemon picks from the fixture never return
  baby/mega/legendary.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `node -e` spot-check: wild pool size over real data is unchanged (160) and
  `getBabyPokemonPool(realData).length === 0`.
- [x] No browser check needed (live behavior is intentionally identical today).

## Out of scope / do not touch
Authoring any baby/mega card data (owner's job); the baby-grant event (phase 47); the
evolution cutscene (phase 48); mart stock filters (phase 43); attack usability /
`full_type_requirements` logic; starter decks.
