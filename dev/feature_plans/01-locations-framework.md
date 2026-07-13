# Phase 1 — Locations data + framework module (inert)

**Prereqs:** none. **Read first:** `00-overview.md`.
**Goal:** `locations.json` exists, loads through the engine, and `map/locations.js`
(`window.PokeLocations`) provides all selection/config logic — but NOTHING calls it
yet. Gameplay is byte-for-byte unchanged. Ends green + playable.

## Context you need

- Data files live at the repo ROOT (`pokemon.json`, `attacks.json`, `items.json`,
  `trainers.json`, `events.json`). `locations.json` joins them there.
- `arena/arena_data.js`: `loadGameData` fetches each file inside a `Promise.all`
  (~line 472) with `fallbackRecords` per file used on fetch failure (defined ~lines
  60–309); `normalizeGameData` (~line 440) maps raw records through per-type
  normalizers. There is an existing `compactTypes`/type-normalization helper used for
  pokemon — grep for it and reuse.
- Canonical enums: `scripts/data_options.js` (CommonJS). `PokeType` has 25 real types
  + `NONE`. `Rank` = Standard/Ace/Special/Boss/Elite.
- Trainer data facts (relevant to `chooseTrainer`): every trainer has
  `typeSpecialization`; current ranks: 19 Standard, 2 Ace (Gamer:HUMAN,
  Rocker:ELECTRIC), 2 Special (Giovanni:GROUND, Mecha Cop:STEEL), 8 Boss, 0 Elite.
  (Phase 3 seeds Elites/Aces — not your job.)
- Wild-pool logic being replaced later: `getAvailablePokemonForCurrentTerrain`
  exists in BOTH `map/area.js` (~1016) and `map/capture.js` (~385) — dedupe by name,
  drop legendaries (a pokemon is legendary iff `LEGENDARY` appears in its type
  slots), hard-filter WATER, fall back to all non-legendaries if empty. Your
  `getWildPokemonPool` reproduces this with location types instead of WATER. Do NOT
  modify area.js/capture.js in this phase (that's phase 2).
- CLI style reference: `scripts/manage_events.js` (567 lines) — readline/promises,
  numbered Add/List/Remove/Exit menu loop, self-contained prompt helpers
  (`askString`, `askEnum` validating against `data_options`, `askUniqueId`,
  `formatId` slugifier, `readJsonArray`), `fs.writeFileSync(FILE,
  JSON.stringify(list, null, 2) + '\n')`. There is NO shared helper module —
  manage_locations.js is self-contained like its siblings.

## Steps

- [x] 1. **Create `locations.json`** (repo root) with these 12 records. Schema per
  record:

  ```json
  {
    "id": "tidepool-coast",
    "name": "Tidepool Coast",
    "terrain": "Waterfront",
    "types": ["WATER", "ICE"],
    "theme": { "accent": "#e8c266", "glow": "#4ab0c8", "surface": "#143a4a",
               "bgDeep": "#081b26", "bgMid": "#123240" },
    "background": "assets/backgrounds/tidepool-coast.png",
    "enabled": true
  }
  ```

  | id | name | terrain | types | accent / glow / surface / bgDeep / bgMid |
  |---|---|---|---|---|
  | tidepool-coast | Tidepool Coast | Waterfront | WATER, ICE | #e8c266 #4ab0c8 #143a4a #081b26 #123240 |
  | emerald-canopy | Emerald Canopy | Forest | GRASS, BUG, FLYING | #b8d96a #3fae6e #1b3d2a #0a1f14 #14301f |
  | cinder-ridge | Cinder Ridge | Volcanic | FIRE, ROCK, GROUND | #f2a35c #d95f3b #402420 #1c0f0c #2e1a14 |
  | thunder-flats | Thunder Flats | Power Plant | ELECTRIC, STEEL, FLYING | #f2d95c #6aa8d9 #2a3140 #12151c #1f2531 |
  | mystic-hollow | Mystic Hollow | Ruins | PSYCHIC, FAIRY, GHOST | #d9a0e8 #7a6ad9 #2e2440 #140f1f #221a33 |
  | murkwater-marsh | Murkwater Marsh | Swamp | WATER, POISON, GRASS | #b5cc66 #66a68c #22362c #0e1a13 #1a2a20 |
  | frostpeak-pass | Frostpeak Pass | Mountain | ICE, ROCK, FIGHTING | #cfe8f2 #7fb4d9 #2a3a47 #101a22 #1d2c38 |
  | old-boneyard | Old Boneyard | Graveyard | GHOST, DARK, GROUND | #d9c9a0 #8a7a9e #332e33 #16121a #262029 |
  | harbor-boardwalk | Harbor Boardwalk | Harbor | WATER, HUMAN, NORMAL | #f2b95c #5c9ed9 #24384a #0f1824 #1b2b3a |
  | dragons-rest | Dragon's Rest | Caldera | DRAGON, FIRE, FLYING | #e8865c #a05cd9 #3a2635 #190f18 #2b1a28 |
  | neon-arcade | Neon Arcade | City | ELECTRIC, DARK, HUMAN | #f25ca8 #5cf2d9 #241f33 #0f0c1a #1b1626 |
  | meadow-market | Meadow Market | Meadow | NORMAL, FAIRY, GOURMET, GRASS | #f2d05c #8fcc66 #2e3a24 #141a0f #24301b |

  `background` = `assets/backgrounds/<id>.png` for every record — the files don't
  exist yet (the owner will drop them in later; phase 6's CSS makes a missing image
  harmless, and pre-filling the path means images activate automatically). Palettes
  may be refined in phase 6; don't bikeshed them here.

- [x] 2. **Wire into `arena/arena_data.js`:** add `normalizeLocation(record)`
  (require non-empty `id` + `name`, normalize `types` uppercase via the existing
  type helper, default any missing theme fields to the neutral values
  `#e0b84f/#4ab0a5/#232f3d/#10161f/#1b2836`, `enabled: record.enabled !== false`,
  return `null` on invalid → filtered out); add `locations` to `normalizeGameData`
  mirroring the events line; add `loadJson('locations.json',
  fallbackRecords.locations)` to the `Promise.all`; add
  `fallbackRecords.locations` = the tidepool-coast, murkwater-marsh, cinder-ridge
  records verbatim (covers WATER/GRASS/FIRE starters when fetch fails).

- [x] 3. **Create `map/locations.js`** — IIFE exporting `window.PokeLocations`,
  **zero `document`/DOM access at load time**. Contents:
  - `TOTAL_LEVELS = 4`.
  - `LEVEL_CONFIG` (frozen) — exactly:

    ```js
    const LEVEL_CONFIG = Object.freeze({
        1: { nodeCount: 12, layout: 'branching',
             forcedTypes: { 1: 'capture', 2: 'capture', 3: 'battle' },
             weights: { battle: 38, capture: 26, event: 21, shop: 15 },
             caps: { capture: 4, shop: 2 },
             battleRanks: [{ rank: 'Standard', weight: 100 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        2: { nodeCount: 12, layout: 'branching', forcedTypes: {},
             weights: { battle: 44, capture: 22, event: 21, shop: 13 },
             caps: { capture: 3, shop: 2 },
             battleRanks: [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        3: { nodeCount: 12, layout: 'branching', forcedTypes: {},
             weights: { battle: 52, capture: 16, event: 20, shop: 12 },
             caps: { capture: 2, shop: 1 },
             battleRanks: [{ rank: 'Ace', weight: 100 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        4: { nodeCount: 5, layout: 'gauntlet',
             forcedTypes: { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'battle' },
             weights: null, caps: null,
             battleRanks: [{ rank: 'Elite', weight: 100 }],
             bossRanks: [{ rank: 'Elite', weight: 100 }] }
    });
    ```

  - `STARTER_DECKS` (frozen) — ids `water`/`grass`/`fire`, display names
    `Tide Caller`/`Verdant Bloom`/`Ember Heart`, `type` WATER/GRASS/FIRE, and the
    exact card lists from `00-overview.md` (shape:
    `pokemon: ['Blastoise', 'Feraligatr']`,
    `attacks: [['Surf', 2], ...]`, `items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]`).
    Mind the name traps: `'Flame Thrower'`, `'Will-o-wisp'`.
  - `getLocations(gameData)` → enabled locations; `getLocationById(gameData, id)`;
    `createLocationSnapshot(location)` → `{id, name, terrain, types, theme,
    background}` (plain copy, safe defaults).
  - `chooseNextLocation(gameData, { requiredType, previousTypes, visitedIds,
    previousId })` — base pool = enabled locations; primary filter: if
    `requiredType` set → `types.includes(requiredType)`, else if `previousTypes`
    set → intersection non-empty; then exclude `visitedIds`. **Fallback ladder**
    (first non-empty pool wins, uniform random pick):
    1. type-filter ∧ not visited
    2. type-filter ∧ only `id !== previousId`
    3. not visited (type filter dropped)
    4. any enabled with `id !== previousId`
    5. any enabled
    6. none → return the first `fallbackRecords`-style built-in (never null with
       any data present; only an empty/broken locations.json reaches this).
  - `chooseTrainer(gameData, { level, nodeType, locationTypes, excludeNames })` —
    roll a rank from `battleRanks`/`bossRanks` weights for the level, then pick
    uniformly from the first non-empty rung. **Special rank is excluded from every
    rung.** Rungs: (1) rolled rank ∧ `typeSpecialization ∈ locationTypes` ∧ name not
    excluded; (2) any rank allowed for this node/level ∧ type match ∧ not excluded;
    (3) rolled rank, any type, not excluded; (4) any allowed rank, not excluded;
    (5) drop `excludeNames`, retry 1–4; (6) any non-Special trainer.
  - `isAllowedTrainerRank(trainer, nodeType, level)` — true iff trainer rank ∈
    (ranks configured for that node type at that level ∪ {'Standard'}) and rank ≠
    'Special'. (Used by phase 3's encounter sanitizer; define it now, test it now.)
  - `getWildPokemonPool(gameData, locationTypes)` — unique-by-name, non-legendary,
    any type slot ∈ `locationTypes`; if empty → all non-legendaries (never empty).

- [x] 4. **Create `scripts/manage_locations.js`** in the manage_events.js style
  (self-contained; copy the helper patterns, don't import from siblings). Menu:
  Add / List / Remove / Exit. Add flow prompts: name → auto-slug id (`formatId` +
  `askUniqueId`) → terrain label → 2–4 types (repeated `askEnum` over `PokeType`
  minus `NONE`/`LEGENDARY`, enforce 2–4, no duplicates) → 5 optional theme hexes
  (validate `/^#[0-9a-f]{6}$/i`, default to the neutral palette from step 2) →
  optional background path (default `assets/backgrounds/<id>.png`) → enabled
  (default true). List shows id, name, types, enabled. Write with 2-space JSON +
  trailing newline. **Never run it** — `node --check scripts/manage_locations.js`
  is your only validation (the PostToolUse hook runs it on save anyway).

- [x] 5. **Add script tags** for `map/locations.js` to `area.html`, `capture.html`,
  `mart.html`, `event.html`, `game.html` — immediately after the
  `map/run_state.js` tag in each. The module is inert; pages must behave
  identically.

- [x] 6. **Tests.**
  - Extend `tests/data_validation.test.js` (match its existing style — it
    `require`s `scripts/data_options.js` and reads JSON off disk): locations is an
    array with ≥8 records; ids and names unique; `types` length 2–4, all ∈
    `PokeType`, none `NONE`/`LEGENDARY`; theme values are 6-digit hex when present;
    `background`, when present, starts with `assets/backgrounds/`; **each starter
    type (from `PokeLocations.STARTER_DECKS`) appears in ≥1 enabled location**;
    **the shared-type overlap graph over enabled locations is connected** (BFS).
  - New `tests/run_progression.test.js` — `require('./helpers/arena_env')` first,
    then `require` `../map/locations.js` and read `globalThis.PokeLocations`.
    Cover: LEVEL_CONFIG shape (levels exactly 1–4, weights sum to 100 in every
    rank mix, spec table values verbatim, L1 forced steps, L4 gauntlet config);
    `chooseNextLocation` ladder with small fixture gameData (requiredType filter,
    overlap filter, visited exclusion, each relax rung, non-null with non-empty
    data); `chooseTrainer` with fixture trainers (weight-100 configs return only
    that rank; type match preferred; **Special never returned even when it's the
    only type match or the only trainer left of a rank**; excludeNames respected
    and dropped before failing); `isAllowedTrainerRank` (Ace allowed on L2/L3
    battle, Elite on L4, Standard always, Special never); `getWildPokemonPool`
    (type filtering, legendary exclusion, empty→all-non-legendary fallback) using
    `loadRealGameData()`.

## Verification

1. `node tests/run_all.js` green.
2. `node -e "const env=require('./tests/helpers/arena_env'); env.loadRealGameData().then(()=>console.log(env.arena.GameData.locations.length))"`
   prints 12.
3. Browser sanity (verify skill): start a new run, play one battle — behavior and
   visuals identical to before this phase; no console errors on any run page
   (`window.PokeLocations` defined everywhere).

## Out of scope / do not touch
Gameplay wiring (area.js/capture.js/game.js logic), run-state shape, graph
generation, theming, `TODO.md`, git commits, running any manage script.
