# Phase 41 — Map generation guarantees for levels 1–3

**Recommended agent:** Sonnet · high effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** Every generated level-1–3 map has ≥3 capture nodes in total, and every possible
start→boss path passes through ≥1 capture node (for level 1: ≥1 *beyond* the forced
captures at steps 1–2) and ≥1 event node (when events are enabled). Level 4 is untouched.
Locked by iterated generation tests.

## Context you need

- All generation lives in `map/locations.js` (pure logic, `window.PokeLocations`,
  Node-testable — `tests/run_progression.test.js` already calls
  `P.createAreaGraph(level, { includeEvents })`).
- `LEVEL_CONFIG` (~16–38): L1 branching, 12 nodes, `forcedTypes
  {1:'capture', 2:'capture', 3:'battle'}`, caps `{capture:4, shop:2}`; L2 caps
  `capture:3`; **L3 caps `capture:2` — must rise to 3**; L4 is a gauntlet — do not touch.
- `createBranchingGraph` (~293–326): steps 1–3 are single-lane
  (`OPENING_LINEAR_STEPS = 3`), then `addBranchSegment` (~335–368) repeatedly emits a
  2–3-step segment of 2–3 parallel lanes ending in a single **join node**. Join nodes,
  opening nodes, and any tail single nodes lie on *every* path — they are the natural
  place for per-path guarantees. The final step is always the boss
  (`forcedTypeForStep` ~386). Graph shape `{columns, edges, nodes}` is a frozen API.
- `pickRandomType` (~397–424) does the weighted roll honoring `caps`;
  `forcedTypeForStep` bypasses it. `includeEvents === false` must yield **zero** event
  nodes — locked by `tests/run_progression.test.js` ~436.
- "Qualifying capture" for the per-path rule: a capture node NOT at a config-forced
  capture step, i.e. `node.type === 'capture' && !(config.forcedTypes &&
  config.forcedTypes[node.step] === 'capture')`. (L1's forced steps 1–2 are on every
  path anyway but the owner wants ≥1 more; L2/L3 have no forced captures so every
  capture qualifies.)

## Steps

- [ ] 1. **`map/locations.js`** — `LEVEL_CONFIG`: raise level-3 `caps.capture` from 2
  to 3. Leave every other level/field alone.
- [ ] 2. **`map/locations.js`** — add pure helpers: `listAllPaths(graph)` (DFS over
  `graph.edges` from the start node to the boss node returning arrays of node ids; these
  maps have ≲30 paths) and a private `everyPathHas(graph, predicate)`. Export
  `listAllPaths` (tests use it).
- [ ] 3. **`map/locations.js`** — add `enforceBranchingGuarantees(graph, config,
  includeEvents)` called at the end of `createBranchingGraph` (NOT for gauntlets):
  1. If not every path has a qualifying capture: convert one eligible **mandatory node**
     to `'capture'`. Eligible = a node in a single-node column (on every path), not the
     start node, not the boss, not a config-forced step; prefer type `'battle'`, then
     `'shop'`, then `'event'` (only if events remain elsewhere on every path — simplest:
     prefer battle/shop and only fall back to event before step 4 of the event pass).
     Fallback if no mandatory node is eligible: pick the earliest branch segment and
     convert the same-step node in **every** lane to `'capture'`.
  2. If `includeEvents` and not every path has an event: convert another eligible
     mandatory node (battle, then shop — never the node just converted) to `'event'`;
     same every-lane fallback.
  3. While the graph's total capture count is < 3: convert a random `'battle'` node
     (branch lanes eligible) to `'capture'`.
  Add a short comment: guarantee conversions run after the weighted rolls and may exceed
  `caps` by design.
- [ ] 4. **`tests/run_progression.test.js`** — add tests beside the existing graph tests
  (~394–447), ~300 iterations per level for levels 1–3: (a) total captures ≥ 3;
  (b) every path (via `listAllPaths`) contains ≥1 qualifying capture (for L1 that means a
  capture at a non-forced step) and, with `includeEvents: true`, ≥1 event; (c) with
  `includeEvents: false` there are still **zero** event nodes and the capture guarantees
  hold; (d) L1 steps 1/2 are still captures and step 3 a battle; (e) level 4 remains the
  unchanged linear gauntlet; (f) every graph still has `{columns, edges, nodes}` with the
  boss last.

## Verification

- [ ] `node tests/run_all.js` green — including the pre-existing
  `includeEvents:false produces zero event nodes` test.
- [ ] `verify` skill (light): start a new run, screenshot `area.html` — the map visibly
  contains ≥3 "Wild Pokemon Encounter" nodes and an event node reachable on the trunk.

## Out of scope / do not touch
The level-4 gauntlet (`createGauntletGraph` and its config); node id scheme and lane
geometry (x/y); `weights`; the `{columns, edges, nodes}` shape; renderer code in
`map/area.js`; trainer rank gating.
