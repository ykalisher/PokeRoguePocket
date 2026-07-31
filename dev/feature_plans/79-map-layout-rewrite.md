# Phase 79 — Map layout rewrite: 10-node routes, one branch, hard quotas

**Recommended agent:** Sonnet · high effort.

> **This is the risky phase of the batch** — the only one with real algorithmic content. The
> generator below was prototyped and validated during planning; **transcribe it, do not
> re-derive it.** Go stronger than Sonnet if you hit trouble.

**Prereqs:** phase 78 (the map must be able to draw an `attack` node before one is generated).
**Read first:** `76-map-and-encounter-overhaul-overview.md`.
**Goal:** Levels 1–3 generate fixed 10-node routes (9 non-boss + boss) with exactly one
one-step-wide branch and per-route type quotas that hold **by construction**; level 3's boss
is an Elite; level 4 is a 6-step gauntlet with a second shop. Attack nodes now appear on the
map (still inert — clicking one pops "You entered an Attack Encounter", which is correct until
phase 81).

## Context you need

**All generation is in `map/locations.js`.** `map/area.js` only calls
`locations.createAreaGraph(level, { includeEvents })` (~716) and `bossNodeIdForLevel` (~717).

**The output shape must not change.** `{ columns, edges, nodes }` where `nodes ===
columns.flat()` (same object identities), `columns[step]` is the array of nodes at that step,
node is `{ id, lane, step, type, x, y }`, edge is `{ from, to }`. Renderers depend on this.

**Why the algorithm is what it is.** Each route is 9 non-boss nodes: the 8 single-node steps
plus one node from the branch column. Because the branch lanes have **distinct** types and a
route may take any lane, for every category `c` there is some route that does *not* pick `c`
at the branch — so the 8 base steps must independently satisfy `base_c ≥ min_c`. Since every
level's minimums total exactly 8, **the base multiset is forced to be exactly the minimums**.
A lane then adds 1 to its category, which is legal iff `min_c < max_c`. Quotas therefore hold
by construction, and the entire old repair pass (`enforceBranchingGuarantees` and friends)
becomes dead code. The remaining randomness is: which step branches (4–9), the order of the 8
base types, which 2–3 categories the lanes offer, and 2-vs-3 lanes.

**Validation already performed** (2000 graphs × 3 levels × 2 event flags = 29 975 routes, plus
500 gauntlets): every assertion in the Verification section passed, 0 three-in-a-row runs,
branch step uniform over 4–9, 2-vs-3 lanes ~50/50, and each category sits at its minimum on
~80% of routes and `min+1` on ~20% — exactly what the proof predicts.

**Two failure modes were found and fixed during prototyping — do not reintroduce them:**
1. A naive `includeEvents: false` fallback that dumped the whole event minimum onto `battle`
   gave L2 five-to-six battles per route and 81 three-in-a-row runs. The fix is the
   scarcest-first redistribution in `resolveQuotas`.
2. A "slack" pass that also re-homed `event`'s `max − min` is provably dead: only the
   predicate `min < max` matters, never the size of the gap, and the min-bump already
   preserves `max − min`.

**A strict "never two identical types in a row" rule is not always satisfiable** (L1 with
events off forces `battle` at steps 4/6/8, which collides with the forced battle at step 3).
So adjacency is a **soft** best-of-48 penalty that hard-avoids three-in-a-row; it is
structurally incapable of violating a quota because it only reorders a fixed multiset.

**`makeNode` spacing is fine at `nodeCount: 10`** — `x = 5 + (step/nodeCount)*90` gives
5,14,23,…,95, i.e. 9% per step instead of 7.5%. The canvas is percentage-positioned, so nodes
get more room, not less. One deliberate visual change: single-step nodes now all use `lane 2`
(y = 50, a centered spine), so the map reads as a straight line with one bulge.

**`bossNodeIdForLevel` derives from `LEVEL_CONFIG[level].nodeCount`** (~251) so it updates
itself. `isAllowedTrainerRank` derives from `rankListForNode` (~168), so setting L3's
`bossRanks` to Elite is the *only* change needed for the Elite boss — the roster has 23 Elite
trainers, plenty for L3 + L4.

## Steps

- [ ] 1. **`map/locations.js`** — replace `LEVEL_CONFIG` (~16–38) entirely. `weights` and
  `caps` are gone; `quotas` is `{ type: [min, max] }` over the **9 non-boss nodes of one
  route**.

  ```js
      const LEVEL_CONFIG = Object.freeze({
          1: {
              nodeCount: 10,
              layout: 'branching',
              forcedTypes: { 1: 'capture', 2: 'capture', 3: 'battle' },
              quotas: { battle: [2, 3], capture: [2, 4], event: [2, 3], shop: [1, 2], attack: [1, 2] },
              battleRanks: [{ rank: 'Standard', weight: 100 }],
              bossRanks: [{ rank: 'Boss', weight: 100 }]
          },
          2: {
              nodeCount: 10,
              layout: 'branching',
              forcedTypes: {},
              quotas: { battle: [3, 4], capture: [1, 3], event: [2, 3], shop: [1, 2], attack: [1, 2] },
              battleRanks: [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }],
              bossRanks: [{ rank: 'Boss', weight: 100 }]
          },
          3: {
              nodeCount: 10,
              layout: 'branching',
              forcedTypes: {},
              quotas: { battle: [2, 3], capture: [1, 2], event: [2, 3], shop: [1, 2], attack: [2, 3] },
              battleRanks: [{ rank: 'Ace', weight: 100 }],
              bossRanks: [{ rank: 'Elite', weight: 100 }]
          },
          4: {
              nodeCount: 6,
              layout: 'gauntlet',
              forcedTypes: { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'shop', 5: 'battle' },
              quotas: null,
              battleRanks: [{ rank: 'Elite', weight: 100 }],
              bossRanks: [{ rank: 'Elite', weight: 100 }]
          }
      });
  ```

- [ ] 2. **`map/locations.js`** — replace the generator constants (~247–249). Delete
  `OPENING_LINEAR_STEPS`; keep `LANE_COUNT` and `START_NODE_ID`:

  ```js
      const LANE_COUNT = 5;
      const START_NODE_ID = 'start';
      const MIN_BRANCH_STEP = 4;
      const ARRANGEMENT_ATTEMPTS = 48;
      // Order the event quota is re-homed into when a location has no events:
      // scarcest-first, so disabling events never floods the map with battles.
      const EVENT_FALLBACK_ORDER = ['capture', 'shop', 'attack', 'battle'];
  ```

- [ ] 3. **`map/locations.js`** — replace `createBranchingGraph` (~293–328) and everything the
  old weighted path used, with the block below. Paste it verbatim; it is the validated source.
  `createAreaGraph` (~256) and `createGauntletGraph` (~275) stay exactly as they are.

  ```js
      /**
       * Levels 1-3: every start->boss route is exactly 10 nodes (9 + boss), with
       * exactly one one-step-wide branch of 2-3 lanes. Because a route may take
       * any lane, the 8 non-branch steps must independently satisfy every quota
       * minimum; the minimums total exactly 8, so the base multiset IS the
       * minimums, and each lane adds 1 to a category that still has headroom.
       * Quotas therefore hold by construction - there is no repair pass.
       */
      function createBranchingGraph(config, includeEvents) {
          const quotas = resolveQuotas(config, includeEvents);
          const branchStep = chooseBranchStep(config);
          const laneTypes = chooseLaneTypes(quotas, randomInt(2, 3));
          const stepTypes = buildStepTypes(config, quotas, branchStep, laneTypes);

          return assembleBranchingGraph(config, stepTypes, branchStep, laneTypes);
      }

      // With events disabled the event minimum is re-homed onto the categories
      // that are currently scarcest, keeping the minimum total at 8 and every
      // surviving category's headroom intact.
      function resolveQuotas(config, includeEvents) {
          const quotas = {};

          Object.keys(config.quotas).forEach(type => { quotas[type] = config.quotas[type].slice(); });
          if (includeEvents !== false || !quotas.event) return quotas;

          const eventMinimum = quotas.event[0];

          quotas.event = [0, 0];
          for (let i = 0; i < eventMinimum; i += 1) {
              const target = EVENT_FALLBACK_ORDER
                  .filter(type => quotas[type])
                  .reduce((best, type) => (quotas[type][0] < quotas[best][0] ? type : best));

              quotas[target] = [quotas[target][0] + 1, quotas[target][1] + 1];
          }

          return quotas;
      }

      // The branch may not collide with a forced step and may not be the boss.
      function chooseBranchStep(config) {
          const forcedSteps = Object.keys(config.forcedTypes || {}).map(Number);
          const first = Math.max(MIN_BRANCH_STEP,
              forcedSteps.length > 0 ? Math.max.apply(null, forcedSteps) + 1 : 1);

          return randomInt(first, config.nodeCount - 1);
      }

      // A lane is legal only where the base count (== the minimum) is below the
      // maximum. Lanes are distinct types so the branch is a real choice.
      function chooseLaneTypes(quotas, laneCount) {
          const candidates = Object.keys(quotas).filter(type => quotas[type][0] < quotas[type][1]);

          return shuffle(candidates).slice(0, Math.min(laneCount, candidates.length));
      }

      /**
       * Types for every single-node step, keyed by step. The multiset is fixed
       * (one token per quota minimum); only the ORDER is random. Forced steps
       * claim their token first. Ordering is best-of-K on a cosmetic penalty, so
       * it can never break a quota - the worst case is a repetitive-looking map.
       */
      function buildStepTypes(config, quotas, branchStep, laneTypes) {
          const baseSteps = [];

          for (let step = 1; step < config.nodeCount; step += 1) {
              if (step !== branchStep) baseSteps.push(step);
          }

          const pool = [];

          Object.keys(quotas).forEach(type => {
              for (let i = 0; i < quotas[type][0]; i += 1) pool.push(type);
          });
          if (pool.length !== baseSteps.length) {
              throw new Error(`quota minimums total ${pool.length}, expected ${baseSteps.length}`);
          }

          const forced = config.forcedTypes || {};
          const fixed = {};
          const freeSteps = [];

          baseSteps.forEach(step => {
              const type = forced[step];

              if (!type) {
                  freeSteps.push(step);
                  return;
              }

              const index = pool.indexOf(type);

              if (index === -1) throw new Error(`forced ${type}@${step} exceeds its quota minimum`);
              pool.splice(index, 1);
              fixed[step] = type;
          });

          let best = null;
          let bestPenalty = Infinity;

          for (let attempt = 0; attempt < ARRANGEMENT_ATTEMPTS; attempt += 1) {
              const shuffled = shuffle(pool.slice());
              const candidate = Object.assign({}, fixed);

              freeSteps.forEach((step, index) => { candidate[step] = shuffled[index]; });

              const penalty = layoutPenalty(candidate, config, branchStep, laneTypes);

              if (penalty < bestPenalty) {
                  best = candidate;
                  bestPenalty = penalty;
              }
              if (bestPenalty === 0) break;
          }

          return best;
      }

      // Three of a type in a row is heavily penalized; a single adjacent repeat
      // is mildly penalized. A forced pair (L1's capture,capture opening) is
      // exempt, since the owner locked that opening.
      function layoutPenalty(stepTypes, config, branchStep, laneTypes) {
          const forced = config.forcedTypes || {};
          let penalty = 0;

          laneTypes.forEach(laneType => {
              const sequence = [];

              for (let step = 1; step < config.nodeCount; step += 1) {
                  sequence.push({ step, type: step === branchStep ? laneType : stepTypes[step] });
              }

              for (let i = 1; i < sequence.length; i += 1) {
                  if (sequence[i].type !== sequence[i - 1].type) continue;
                  if (!(forced[sequence[i].step] && forced[sequence[i - 1].step])) penalty += 1;
                  if (i >= 2 && sequence[i - 2].type === sequence[i].type) penalty += 100;
              }
          });

          return penalty;
      }

      function assembleBranchingGraph(config, stepTypes, branchStep, laneTypes) {
          const nodeCount = config.nodeCount;
          const lanes = getBranchLanes(laneTypes.length);
          const edges = [];
          const columns = [[makeNode(START_NODE_ID, 2, 0, 'start', nodeCount)]];

          for (let step = 1; step <= nodeCount; step += 1) {
              columns[step] = step === branchStep
                  ? laneTypes.map((type, index) =>
                      makeNode(`node-${step}-${index + 1}`, lanes[index], step, type, nodeCount))
                  : [makeNode(singleNodeId(step, nodeCount), 2, step,
                      forcedTypeForStep(step, config, nodeCount) || stepTypes[step], nodeCount)];

              columns[step - 1].forEach(from =>
                  columns[step].forEach(to => addEdge(edges, from.id, to.id)));
          }

          return graphFromColumns(columns, edges);
      }

      function shuffle(list) {
          for (let i = list.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              const swap = list[i];

              list[i] = list[j];
              list[j] = swap;
          }

          return list;
      }
  ```

- [ ] 4. **`map/locations.js`** — delete these now-dead functions and confirm with
  `grep -rn "<name>" map/ arena/ tests/ dev/ scripts/ *.js *.html` that nothing references
  them (this was checked during planning: the only external reference in the whole file group
  is `tests/run_progression.test.js` → `listAllPaths`):
  `enforceBranchingGuarantees`, `convertMandatoryNodeType`, `mandatoryNodes`, `findBranchStep`,
  `countGraphType`, `convertRandomBattleNode`, `everyPathHas`, `addBranchSegment`,
  `chooseBranchLength`, `makeStepNode`, `joinNodeId`, `pickRandomType`, `tallyType`.
  **Keep unchanged:** `listAllPaths` (exported, used by tests), `createGauntletGraph`,
  `makeNode`, `forcedTypeForStep`, `getBranchLanes`, `singleNodeId`, `addEdge`,
  `graphFromColumns`, `bossNodeIdForLevel`, `randomInt`, `randomPick`.

- [ ] 5. **`map/area.js`** — `DEFAULT_BOSS_NODE_ID` (~9) `'boss-12'` → `'boss-10'`, and
  `getMaxStep` (~772–776) fallback `12` → `10`. Both are only used when a graph is missing or
  empty, but they must match the new shape.

- [ ] 6. **`map/run_state.js`** — `DEFAULT_BOSS_NODE_ID` (~10) `'boss-12'` → `'boss-10'`, and
  `STORAGE_VERSION` (~9) `2` → `3`.

- [ ] 7. **`main.js`** — `RUN_STORAGE_VERSION` (~10) `2` → `3`. **This must land in the same
  change as step 6.** `main.js` loads no shared modules and compares the raw JSON's `version`
  itself; if the two constants disagree, `getSavedRunRoute()` returns `null` while
  `PokeRun.loadRunState()` still succeeds, and the Continue button silently disables on a
  perfectly good save. The bump intentionally discards in-flight runs: an old save's graph is
  persisted inside it, so it would otherwise keep playing a 12-step level with no attack nodes
  and none of the new pacing.

- [ ] 8. **`tests/run_progression.test.js`** — replace the config tests (~63–90):
  - `LEVEL_CONFIG matches the spec table verbatim` → assert each of L1/L2/L3 has
    `nodeCount === 10`, `layout === 'branching'`, and the exact `quotas` object from step 1;
    assert `LEVEL_CONFIG[1].forcedTypes` deep-equals `{ 1: 'capture', 2: 'capture', 3: 'battle' }`
    and `LEVEL_CONFIG[3].bossRanks` deep-equals `[{ rank: 'Elite', weight: 100 }]`.
  - Add a **structural invariant test**: for every branching level and both event flags,
    `resolveQuotas`'s effective minimums total exactly 8 and at least 2 categories satisfy
    `min < max`. Since `resolveQuotas` is private, assert the public consequence instead —
    generate graphs and check the route length and quota bounds (covered by step 9). Also
    assert directly that each level's **configured** minimums total 8:
    `Object.values(P.LEVEL_CONFIG[level].quotas).reduce((sum, [min]) => sum + min, 0) === 8`.
  - `L4 is a fixed 5-node gauntlet` → rename to 6-step: `nodeCount === 6`, `quotas === null`,
    `forcedTypes` deep-equals `{ 1: 'shop', 2: 'battle', 3: 'battle', 4: 'shop', 5: 'battle' }`,
    both rank lists Elite.

- [ ] 9. **`tests/run_progression.test.js`** — replace the graph tests (~411–548). Delete
  `branching graphs honor forced node types and the shop cap`,
  `levels 1-3 always generate at least 3 total capture nodes`,
  `every start->boss path has a qualifying capture and (with events on) an event`, and
  `includeEvents:false keeps zero events while every path still has a qualifying capture`.
  Replace them with **one route-level test** that runs **≥500 iterations per level per event
  flag** and asserts, for every path returned by `P.listAllPaths(graph)`:

  | assertion | value |
  |---|---|
  | route length (excluding `start`) | exactly `10` |
  | last node | `type === 'boss'`, `id === 'boss-10'` |
  | steps along the route | contiguous `1..10` |
  | per-type counts over the **first 9** nodes | inside `[min, max]` for every quota key |
  | no node carries a type outside the quota keys (plus `boss`) | true |
  | columns with more than one node | exactly 1, holding 2–3 nodes with **distinct** types |
  | `graph.columns.length` | `11` |
  | `graph.nodes.length` | `10 + laneCount` |
  | `graph.edges.length` | `8 + 2 * laneCount` |
  | `graph.nodes` | deep-equals `graph.columns.flat()` |
  | branch step | in `4..9` |
  | every non-`start` node | has ≥1 inbound edge |
  | every non-`boss` node | has ≥1 outbound edge |
  | `listAllPaths(graph).length` | equals the lane count |
  | no three consecutive nodes of the same type on any route | true |

  With `includeEvents: false`, additionally assert zero `event` nodes **and** that the route
  still has exactly 10 nodes with every surviving quota satisfied (this is what catches a
  broken `resolveQuotas`). Keep the existing `countTypes` helper (~381) and reuse it.

- [ ] 10. **`tests/run_progression.test.js`** — keep `L1 forced steps 1-2 stay captures and
  step 3 a battle` (~512–521) but note the branch can no longer land on steps 1–3, so those
  columns are always single-node. Rewrite `level 4 is a strictly linear 6-node single-lane
  gauntlet` (~523–548) for the new chain: `columns.length === 7`, `nodes.length === 7`, every
  column length 1, types by step `start, shop, battle, battle, shop, battle, boss`, and the
  exact edge list over ids
  `['start','node-1-1','node-2-1','node-3-1','node-4-1','node-5-1','boss-6']`.

- [ ] 11. **`tests/run_progression.test.js`** — update the four hardcoded boss ids:
  `'boss-12'` → `'boss-10'` at ~309, ~345, ~561, ~589.

## Verification

- [ ] `node --check map/locations.js`, `node --check map/area.js`, `node --check
  map/run_state.js`, `node --check main.js` all pass.
- [ ] `node --test tests/run_progression.test.js` passes, including the ≥500-iteration route
  test. A quota violation shows up on roughly 1 seed in 200 if the generator drifted, so do
  **not** lower the iteration count.
- [ ] `node tests/run_all.js` green.
- [ ] `grep -rn "boss-12\|OPENING_LINEAR_STEPS\|pickRandomType\|enforceBranchingGuarantees" .
  --include=*.js` returns nothing outside `dev/feature_plans/`.
- [ ] Sanity one-liner prints a plausible map and one route per lane:
  ```
  node -e "require('./tests/helpers/arena_env.js'); require('./map/locations.js');
  const P=globalThis.PokeLocations, g=P.createAreaGraph(1,{includeEvents:true});
  g.columns.forEach((c,s)=>console.log(s, c.map(n=>n.type+':'+n.id).join(' | ')));
  console.log(P.listAllPaths(g).map(p=>p.length));"
  ```
- [ ] Browser proof with the `verify` skill: serve on 8931, start a fresh run, screenshot
  `area.html`. Confirm by eye — 10 steps from Entrance to Gym Leader, exactly one place where
  the path splits and it is one column wide, and at least one crimson `A` attack node visible.
  Save as `dev/verify/phase79_map_layout.png`.
- [ ] In the same session, walk the run to level 3 (or hand-edit `run.level` and call
  `PokeLocations.advanceRunToNextLevel`) and confirm the level-3 boss node shows an **Elite**
  trainer, and that level 4 shows `shop, battle, battle, shop, battle, boss`.
- [ ] Confirm the version bump behaves: with a pre-existing v2 save in localStorage, the main
  menu's Continue button is disabled / absent and starting a new run works cleanly.

## Out of scope / do not touch

Do **not** add the `moveToNode` dispatch for `'attack'`, `attack.html`, `map/attack.js`, or
anything in `map/run_state.js` beyond the two constants in step 6 — attack encounters are
phases 80–81, and an attack node must stay inert through this phase. Do not touch
`chooseTrainer`, `rollRank`, `isAllowedTrainerRank`, `chooseNextLocation`, `getWildPokemonPool`,
`isMartOfferAllowed`, or `advanceRunToNextLevel` (phase 80 adds the attack-encounter reset
there). Do not change `makeNode`'s x/y formula, `LANE_COUNT`, or `getBranchLanes`. Do not
touch `arena/**`, `static/**`, or any JSON data file. Do not "improve" the generator beyond
the transcribed source — its correctness argument depends on the exact structure above.
