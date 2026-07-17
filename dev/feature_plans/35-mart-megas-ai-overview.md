# Mart services, gym-leader polish, rival AI & mega evolutions — batch overview

Batch 5, phases 36–48. Owner's July 2026 post-playtest feature list: three new
once-per-mart services, mart stock gating, user-facing renames, baby→mega evolution,
smarter rival targeting, prize-money rebalance, battle-header cleanup, and map-generation
guarantees. Each phase is one self-contained session; read this file plus your phase file
and nothing else first.

## Ground rules (binding)

- Never `git add`/`git commit` unless the owner explicitly asks.
- Never run or extend `scripts/manage_*.js`; edit the JSON data files directly.
- Never act on `TODO.md`.
- Plain JS/HTML/CSS only — no third-party libraries, frameworks, build tools, or runtime
  dependencies.
- Run `node tests/run_all.js` after every change (~3s; syntax-checks all tracked JS and
  runs the whole suite).
- Browser checks use the `verify` skill: serve with
  `python3 -m http.server 8931 --bind 127.0.0.1` from the repo root, drive with the
  committed Playwright drivers in `dev/verify/` (do not rebuild them), stop with
  `pkill -f "http.server 8931"`.
- Line anchors in phase files (`~NNN`) are drift-prone hints captured 2026-07-17. Locate
  code by the quoted identifier or string, not the number.
- The map pages (`map/mart.js`, `map/area.js`, `map/event.js`) re-render via innerHTML
  and use a single delegated click listener per page. Keep that architecture; do not add
  per-element listeners.

## What is being built (context)

- **Mart overhaul** (phases 43–46): stock gating (no LEGENDARY-typed attacks without a
  legendary pokemon; no dragon-gem items without a DRAGON attack + DRAGON pokemon), and a
  new "Services" panel replacing the Pokemon PC box with three once-per-mart services:
  Release a pokemon (free, needs ≥4 pokemon), Remove an attack (50 coins), and a typed
  1:1 pokemon trade (free).
- **Renames** (37): all user-facing text says "Gym Leader" (was "Boss") and
  "Wild Pokemon Encounter" (was "Capture Spot"). Internal identifiers do not change.
- **Baby→mega evolution** (42, 47, 48): a new optional `evolvesInto` field on pokemon
  records; BABY-typed pokemon in the active deck evolve into their mega after a
  gym-leader win via a full-screen cutscene. Babies are granted only by a dedicated
  event; babies and megas never appear in wild/trade/random pools.
- **Battle tuning** (38–40): stat-pill cleanup, NORMAL-overrides-HUMAN stat precedence,
  and KO-aware rival targeting.
- **Economy & map** (36, 41): rank-standardized prize money and capture/event guarantees
  on levels 1–3.

## Locked spec (owner decisions — do not relitigate)

- Prize money by trainer rank: Standard 50, Ace 100, Special 150, Boss 200, Elite 250.
- The Boss→Gym Leader and Capture Spot→Wild Pokemon Encounter renames are **user-facing
  text only**. Internal names stay: node type `'boss'`, trainer rank `'Boss'`,
  `bossNodeId`, CSS class names, test fixtures, `type: 'capture'`.
- The Pokemon PC box is **deleted outright** (feature + `pokemon-rogue-pocket-pc`
  localStorage key). A pokemon stored there by an old save is **discarded** — owner's
  explicit decision.
- Mart services are each usable **once per mart node** and their used-state persists on
  re-entry (stored on the mart encounter).
- Babies are granted **only** by the dedicated event (phase 47). No BABY-typed attacks;
  every baby has ≥1 non-BABY type; there is **no mega type** — a "mega" is simply a
  pokemon referenced by some baby's `evolvesInto`.
- Map guarantees apply to **levels 1–3 only**; the level-4 gauntlet is untouched.
- Owner authors all baby/mega card data later. Until then every baby/mega code path must
  be inert and green against live data (zero babies exist today).

### Flagged assumptions (owner may override later; implement as written)

1. Trade "offered type" rolls only among types with ≥1 *obtainable* species (obtainable =
   not LEGENDARY-typed, not baby, not a mega target), so trades never yield
   legendaries/babies/megas. Babies and legendaries may be traded *away*.
2. For rival AI, a "status attack" = an attack that inflicts a battle status and has
   `basePower === 0`. Damaging attacks with secondary statuses use the damage rule.
3. The mega cutscene fires on boss-node wins **where the run continues**; the final run
   victory skips it. Bench babies do not evolve (active deck only). Multiple babies
   evolve sequentially. The run is mutated and saved **before** the animation plays
   (refresh-safe).
4. Mart stock eligibility is evaluated when the encounter is created/repaired; existing
   stock is not retro-upgraded when the player later gains a legendary.
5. The attack-removal service may remove the player's last attack card (spec is silent;
   the deck rebuild handles it).

## Cross-phase architecture facts

- Run state: `map/run_state.js`, exported as `global.PokeRun` (`runStore` on pages).
  Collections shape `{ pokemon, actions, bench: { pokemon, actions } }`; active pokemon
  cap 6 (`ACTIVE_POKEMON_LIMIT`). **After any change to the pokemon collections you must
  call `balancePokemonCollections(run)` then `rebuildActionDeckForActivePokemon(run)`** —
  attack usability depends on active types — then `saveRunState(run)`.
- Mart encounters persist per node in `run.martEncounters[nodeId]`, normalized by
  `normalizeMartEncounters` (`map/run_state.js` ~491). **Every new encounter field needs
  a default there** so old saves load cleanly.
- Mart stock names are chosen/repaired in **four** places that must all agree:
  `chooseMartCardNames` + `sanitizeMartCardNames` (`map/area.js` ~1094/~1053) and
  `chooseOfferNames` + `repairOfferNames` (`map/mart.js` ~656/~621).
- Shared pure helpers (pool eligibility, trade rolls, mart-offer gating) live in
  `map/locations.js` (`window.PokeLocations`) — pure logic, loadable in Node via
  `tests/helpers/arena_env.js` (see `tests/run_progression.test.js` for the pattern).
- Card records: pokemon cards carry `.pokemon` (fields `name, type1..type3, id,
  baseHealth, baseAttack, baseDefense, baseSpeed`); action cards carry `.attack` or
  `.item`. "Legendary" = a type slot equals `'LEGENDARY'` (see `isLegendaryPokemon`,
  `map/capture.js` ~490); dragon gem = item whose `status` array includes
  `'DRAGON_GEM'` (see `itemIsDragonGem`, `map/capture.js` ~535).
- Battle-engine test hooks: append to the `// Exposed for tests:` block at the bottom of
  `arena/arena_controller.js` (~3347) with a phase comment, mirroring phases 20–21.
- The battle→map seam: win overlay Continue (`data-battle-flow-action="continue"`,
  `arena/game.js` ~69) → `completeBattleAndReturnToMap()` (~250) →
  `window.location.href = 'area.html'`. Boss detection `isFinalNodeBattle()` (~403),
  run-complete detection `isRunVictory()` (~412). Game data handle: `arena.GameData`.

## Failure-mode ledger (recurring traps)

- **Old saved runs** (`pokemon-rogue-pocket-run`): every new mart-encounter field
  (`releaseUsed`, `attackRemovalUsed`, `tradeUsed`, `tradeAcceptedType`,
  `tradeOfferedType`) gets a `normalizeMartEncounters` default; missing trade types are
  back-filled by `sanitizeMartEncounter` on first visit.
- **Empty pools**: zero babies authored → the baby event is never offered, the cutscene
  is inert, `getBabyPokemonPool` returns `[]`. Mart filtered pools stay ≥ stock sizes
  (99 legal attacks ≥ 8; 8 legal items ≥ 4).
- **Mart re-entry**: encounters persist per node — bought names and used-service flags
  must survive `sanitizeMartEncounter`/`repairMartEncounter`.
- **AI safety**: `chooseOpponentTarget` must still return `null` on empty candidates;
  all-statused enemies fall back to the damage rule; group targets unchanged.
- **Map generation**: `includeEvents: false` must still produce **zero** event nodes
  (locked by an existing test) while capture guarantees hold; forced steps, the boss
  node, and the `{columns, edges, nodes}` graph shape are frozen.

## Phases

| File | What | Order / deps |
|------|------|--------------|
| `36-prize-money-standardization.md` | trainers.json cash by rank (50/100/150/200/250) | none |
| `37-gym-leader-wild-encounter-rename.md` | UI renames + CLAUDE.md naming-split note | none |
| `38-battle-stat-pill-cleanup.md` | drop 5 redundant battle-header pills, keep KO | none |
| `39-normal-human-stat-precedence.md` | NORMAL suppresses HUMAN ×2; regression tests | none |
| `40-rival-ai-targeting.md` | KO-aware + status-aware rival attack targeting | none |
| `41-map-capture-event-guarantees.md` | ≥3 captures/location, per-path capture+event, L1–L3 | none |
| `42-baby-mega-schema-and-pools.md` | `evolvesInto` schema, validation, obtainable-pool helpers | before 43/46/47/48 |
| `43-mart-stock-filters.md` | legendary-attack & dragon-gem stock gating | after 42 |
| `44-mart-release-and-pc-removal.md` | delete PC box; Release service | after 43 |
| `45-mart-attack-removal-service.md` | Remove-an-attack service (50 coins) | after 44 |
| `46-mart-trade-service.md` | typed 1:1 trade service | after 42 + 44 (numerically after 45) |
| `47-baby-grant-event.md` | nursery event granting a random baby | after 42 |
| `48-mega-evolution-cutscene.md` | post-gym-leader evolution cutscene | after 42 + 37 |
