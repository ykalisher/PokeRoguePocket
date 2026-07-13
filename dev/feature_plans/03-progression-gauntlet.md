# Phase 3 — Multi-level progression, gauntlet, difficulty, victory

**Prereqs:** phases 1–2. **Read first:** `00-overview.md`.
**Goal:** a full 4-level run: per-level maps generated from `LEVEL_CONFIG`, boss
clear advances to the next location, level 4 is the Elite gauntlet, winning it ends
the run in victory. Trainer selection follows the rank mixes. Elite/Ace trainers are
seeded. Largest phase — a documented cut point is given at the bottom. Ends green +
playable (full run winnable).

## Context you need

- Graph generation lives in `map/area.js` (~1271–1419): `createAreaGraph`,
  `addBranchSegment`, `createNode`/`createStepNode`, `getForcedLocationType`
  (forces steps 1–2 capture, 3 battle, 12 boss), `pickRandomLocationType` +
  `RANDOM_LOCATION_TYPES` weights (~26–31), `getRandomLocationTypes` (~1600, drops
  `event` when `hasAvailableEvents()` is false). Constants (~8–12):
  `AREA_NODE_COUNT=12`, `LANE_COUNT=5`, `OPENING_LINEAR_STEPS=3`,
  `BOSS_NODE_ID='boss-12'`. Node x-position formula in `createNode` (~1365) assumes
  12 steps. Graph shape `{ columns, edges, nodes }` — renderers depend on it, keep
  it identical.
- Encounters: created lazily in `moveToNode` (~219–286); battles pre-rolled by
  `ensureBattleNodeEncounters` (~1143); **`sanitizeBattleEncounter` (~1165) +
  `trainerMatchesNodeRank` (~1209) re-validate on every page load and re-roll any
  trainer whose rank doesn't match the node** — currently hardcoded
  battle→standard, boss→boss. If you ship rank mixes without replacing this, every
  Ace/Elite gets re-rolled on each load (churn bug).
- Trainer selection: `chooseTrainerForNode`/`chooseStandardTrainer`/
  `chooseBossTrainer`/`chooseTrainerByRank` (~1182–1215) — rank-only uniform pick.
- Battle side: `arena/game.js` — `isBossBattle` (~353) is **rank-based**
  (`rank === 'boss'`) and drives `getBattleKicker` (~349) and
  `completeBattleAndReturnToMap` (~207–224), which on a boss win sets
  `area.completed = true` (terminal today: area.html renders "Cleared"). Loss flow
  (~193–205, `startOver` ~226) is unaffected.
- Run state v2 (phase 2): `run.level`, `run.location`, `run.visitedLocationIds`,
  `run.runCompleted`, `run.area.bossNodeId` all exist and normalize.
- Encounter maps (`battleEncounters` etc.) are keyed by node id, and node ids
  repeat across levels (`node-4-1` exists in every map) — stale entries MUST be
  wiped on level transition.
- Trainer sprites: `trainers.json` records have a `sprite` field;
  `arena/trainer_sprites.js` (2.2k lines, NEVER read whole) holds embedded sprite
  data. Before seeding, grep how existing `sprite` values resolve and whether
  unknown sprites have a graceful fallback — reuse existing sprite keys for the new
  trainers if adding new sprite data is nontrivial.

## Steps

- [x] 1. **Move graph generation into `map/locations.js`** as
  `createAreaGraph(level, { includeEvents })`, driven by `LEVEL_CONFIG[level]`:
  - `branching` layout = today's algorithm parametrized by `nodeCount`, `weights`,
    `caps`, `forcedTypes` (final step always `'boss'`-type, id
    `boss-${nodeCount}`); x-position formula uses `nodeCount` instead of 12.
  - Caps: thread a mutable `{capture, shop}` counter through node creation; forced
    nodes count toward caps; a capped type's weight is 0 for later rolls; battle is
    never capped.
  - `includeEvents === false` → event weight 0 (replaces `getRandomLocationTypes`).
  - `gauntlet` layout (L4): 6 single-node columns, strictly linear edges —
    `start` (step 0) → step 1 shop → steps 2–4 battle → step 5 type `'boss'` id
    `boss-5`. Same `{columns, edges, nodes}` shape.
  - Delete the moved code + now-unused constants from `area.js`; area.js calls
    `PokeLocations.createAreaGraph(run.level, { includeEvents:
    hasAvailableEvents(...) })`. `run.area.bossNodeId` is set from the generated
    graph everywhere a graph is installed.
  - Every hardcoded `BOSS_NODE_ID`/`AREA_NODE_COUNT` reference (grep both,
    including route-status rendering ~369 and `isLastThirdMapNode` ~1032) derives
    from `run.area.bossNodeId` / graph max step instead.
- [x] 2. **Level transition.** In `map/locations.js`:
  `advanceRunToNextLevel(run, gameData)` — `run.level += 1`; next location via
  `chooseNextLocation(gameData, { previousTypes: run.location.types, visitedIds:
  run.visitedLocationIds, previousId: run.location.id })`; push to
  `visitedLocationIds`; snapshot to `run.location`; fresh area state (new graph for
  the new level, `currentNodeId:'start'`, `visitedNodeIds:['start']`,
  `traveledPathKeys:[]`, all four `active*NodeId` null, `completed:false`, correct
  `bossNodeId`); **wipe all four encounter maps**; leave `collections`, `cash`,
  `nextCardId`, `starterId` untouched. In `map/area.js`: `advanceLevelIfNeeded()`
  in the restore flow — if `area.completed && !run.runCompleted && run.level <
  PokeLocations.TOTAL_LEVELS` → advance, re-apply state,
  `ensureBattleNodeEncounters()`, save, popup `Entering <name> — Level N of 4`.
- [x] 3. **Final-node detection + victory (`arena/game.js`).** Replace rank-based
  `isBossBattle` with nodeId-based: active encounter's nodeId ===
  `run.area.bossNodeId`. Kicker: L1–3 final → "Boss Battle"; L4 battles → "Elite
  Battle"; L4 final → "Final Battle". On final-node win: `area.completed = true`
  as today, plus `runCompleted = true` + `runCompletedAt` when
  `run.level >= TOTAL_LEVELS`. When `runCompleted`, the win overlay is a
  victory/champion message with Start Over + Main Menu only (no continue-to-map);
  `area.html` loaded with `runCompleted` shows the completed map with a victory
  banner (reuse the existing area-complete render path, keyed off the new flag).
- [x] 4. **Trainer selection wiring (`map/area.js`, same commit as rank mixes).**
  `chooseTrainerForNode` and friends collapse into
  `PokeLocations.chooseTrainer(arena.GameData, { level: run.level, nodeType,
  locationTypes: run.location.types, excludeNames })`. `excludeNames` = trainer
  names already assigned to battle encounters in the current area (gives gauntlet
  dedupe and general variety; the chooser's ladder already drops it when the pool
  is too small). Replace `trainerMatchesNodeRank` inside
  `sanitizeBattleEncounter` with `PokeLocations.isAllowedTrainerRank(trainer,
  nodeType, run.level)` — type mismatch must NOT trigger a re-roll (type is a
  selection preference, not an invariant).
- [x] 5. **Seed trainers (`trainers.json`, direct edit — owner-authorized).**
  ~6 Elite-rank trainers with distinct `typeSpecialization`s spread across the
  seeded locations' types (suggested: WATER, FIRE, GRASS, PSYCHIC, DARK, DRAGON)
  and ~7 Ace-rank trainers similarly spread (today's Aces cover only
  HUMAN/ELECTRIC). Each with full `pokemon`/`attacks`/`items` lists
  cross-referencing real records (the data tests enforce this), deck strength and
  `cash` above Standard for Aces and above Boss for Elites (compare against
  existing Boss trainers with `node -e`). Resolve the `sprite` question from
  Context first.
- [x] 6. **Tests** (extend `tests/run_progression.test.js` + data tests):
  - Graph: for each level × many seeds — final node is `'boss'`-type with id
    `boss-<nodeCount>`; forced types honored; caps never exceeded;
    `includeEvents:false` → zero event nodes; L4 = strictly linear 6-step
    single-lane gauntlet (shop at 1, battles 2–4, boss at 5).
  - Transition: `advanceRunToNextLevel` — level increments; all four encounter
    maps empty; collections/cash/nextCardId/starterId preserved; area state fresh;
    new location shares ≥1 type with the old (with fixture data rich enough);
    `visitedLocationIds` grows.
  - `chooseTrainer` against real data (`loadRealGameData()`): never null, never
    Special, L3 returns only Aces, L4 only Elites.
  - Data: ≥4 Elite trainers and ≥6 Ace trainers exist, each with a
    `typeSpecialization`.
- [x] 7. **Browser verification** (verify skill; full manual 4-level run is too
  slow — use targeted checks):
  - Drive one L1 boss win with the committed battle drivers → back on area.html:
    popup + header show Level 2 and a new location sharing a type with the old
    (assert via localStorage through the driver).
  - localStorage surgery: set `run.level = 3`, `run.area.completed = true`, reload
    area.html → L4 gauntlet renders (6 linear nodes); enter the shop, then win the
    4 Elite battles via the drivers (or at minimum the final one after surgery) →
    victory overlay, area.html victory banner, Continue on index.html behaves
    sanely for a completed run.
  - Reload area.html twice mid-L2/L3 → battle encounters keep the same trainers
    (sanitizer churn check).

## Cut point (only if the session must split)
**3a:** steps 1–3 with L4 temporarily using L3's branching config and Boss-rank
final (levels loop + victory work end-to-end). **3b:** gauntlet layout + rank
mixes + step 4–5 wiring + seeding. Both halves must independently end green +
playable; tick only the steps actually done and note the split in `00-overview.md`'s
checklist.

## Out of scope / do not touch
Starter picker (createCardCollections stays hardcoded-water), events content/gating
(the `includeEvents` flag just calls the existing `hasAvailableEvents`), theming,
UI polish.
