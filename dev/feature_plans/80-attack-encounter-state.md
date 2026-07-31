# Phase 80 — Attack encounters in run state (card pool, persistence, creation)

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phases 78 and 79. **Read first:** `76-map-and-encounter-overhaul-overview.md`.
**Goal:** An attack encounter is a real, persisted thing: `map/locations.js` can pick its card
options, `map/run_state.js` stores and normalizes `attackEncounters`, and `map/area.js` creates
one when the player steps on an `'attack'` node. **No page and no dispatch yet** — stepping on
the node still pops "You entered an Attack Encounter", so the repo ends green and playable.

## Context you need

**The pool spec** (from the overview, locked): unique-by-name attacks with ≥1 type overlapping
the location's `types`, **excluding** any attack carrying `LEGENDARY` or `ARTIFICIAL`. In
`attacks.json` both are encoded as PokeTypes in `type1` / `type2` — there is no boolean flag,
and attacks have **no `type3`**. If the on-type pool is empty, fall back to the full
non-legendary/non-artificial pool so the node never dead-ends. Offer `randomInt(1, 3)` cards.

**Reuse, do not reinvent.** `map/locations.js` already has the exact analogue —
`getWildPokemonPool(gameData, locationTypes)` (~692–700), including the "matched, else all"
fallback at ~698. Copy its shape. Private helpers already in that file that you should use:
`getRecordTypes(record)` (~84, handles both the `types` array and `type1/2/3`),
`uniqueByName(records)` (~90), `randomInt` (~592), `randomPick` (~80). `shuffle` was added to
this file in phase 79 — reuse it rather than adding a second shuffler.

**Put the picker in `locations.js`, not in the page.** The capture encounter's selection
helpers exist **twice**, near-identically, in `map/area.js` (~1144–1226) and `map/capture.js`
(~378–494). Do not repeat that mistake: `area.js` (this phase) and `map/attack.js` (phase 81)
must both call the same exported function.

**`map/run_state.js` normalizers are whitelists.** `normalizeRunState` (~386–411) and
`normalizeAreaState` (~454–474) rebuild the object field by field, so a field they do not list
is **silently dropped on every save**. Copy `normalizeCaptureEncounters` (~522–537) exactly.

**The five active-node ids are mutually exclusive.** Each `getOrCreate*Encounter` in
`map/area.js` nulls every *other* active id — and each has **two** such blocks, one in the
"existing, not completed" early return and one after creating the encounter. With the new type
there are five ids and eight existing blocks to extend (~896–899, ~916–919, ~928–931,
~943–946, ~971–974, ~995–998, ~1009–1012, ~1036–1039; verify by grepping
`activeCaptureNodeId = null`). Missing one leaves two encounters "active" and
`redirectToActiveEncounter` sends the player to the wrong page.

**Object literal keys in this codebase are alphabetical** inside `createRunState`,
`normalizeRunState`, `normalizeAreaState`, and the export lists. Keep that — `activeAttackNodeId`
sorts before `activeBattleNodeId`, and `attackEncounters` before `battleEncounters`.

## Steps

- [ ] 1. **`map/locations.js`** — add the pool + picker next to `getWildPokemonPool` (~692):

  ```js
      /**
       * Attack pool for a location: unique-by-name attacks that are neither
       * legendary nor artificial (both are encoded as PokeTypes in type1/type2,
       * not as flags) and share at least one type with the location. Falls back
       * to every offerable attack so an attack node is never empty.
       */
      function getAttackCardPool(gameData, locationTypes) {
          const attacks = gameData && Array.isArray(gameData.attacks) ? gameData.attacks : [];
          const offerable = uniqueByName(attacks).filter(isOfferableAttack);
          const types = Array.isArray(locationTypes) ? locationTypes : [];

          const matched = offerable.filter(record => getRecordTypes(record).some(type => types.includes(type)));

          return matched.length > 0 ? matched : offerable;
      }

      function isOfferableAttack(record) {
          if (!record) return false;

          const types = getRecordTypes(record);

          return !types.includes('LEGENDARY') && !types.includes('ARTIFICIAL');
      }

      // 1-3 distinct attacks, matching the wild-capture encounter's offer size.
      function chooseAttackCardOptions(gameData, locationTypes) {
          const pool = getAttackCardPool(gameData, locationTypes);

          if (pool.length === 0) return [];

          return shuffle(pool.slice()).slice(0, randomInt(1, Math.min(3, pool.length)));
      }
  ```

  Export `chooseAttackCardOptions` and `getAttackCardPool` from `global.PokeLocations` (~899),
  keeping the list alphabetical.

- [ ] 2. **`map/run_state.js`** — in `createRunState` (~27–61), add `activeAttackNodeId: null`
  as the first key of the `area` object and `attackEncounters: {}` as the first key after
  `area`.

- [ ] 3. **`map/run_state.js`** — in `normalizeAreaState` (~454–474), add
  `activeAttackNodeId: area.activeAttackNodeId || null,` as the first field of the returned
  object.

- [ ] 4. **`map/run_state.js`** — in `normalizeRunState` (~386–411), add
  `attackEncounters: normalizeAttackEncounters(run.attackEncounters),` immediately after
  `area,`.

- [ ] 5. **`map/run_state.js`** — add `normalizeAttackEncounters` next to
  `normalizeCaptureEncounters` (~522). Same shape, minus the capture-only reward fields:

  ```js
      function normalizeAttackEncounters(attackEncounters) {
          if (!attackEncounters || typeof attackEncounters !== 'object') return {};

          return Object.fromEntries(Object.entries(attackEncounters)
              .filter(([, encounter]) => encounter && typeof encounter === 'object')
              .map(([nodeId, encounter]) => [nodeId, {
                  completed: Boolean(encounter.completed),
                  createdAt: encounter.createdAt || null,
                  nodeId: encounter.nodeId || nodeId,
                  options: Array.isArray(encounter.options) ? encounter.options.filter(Boolean) : [],
                  selectedAttackName: encounter.selectedAttackName || null,
                  terrain: encounter.terrain || null
              }]));
      }
  ```

- [ ] 6. **`map/run_state.js`** — add `getActiveAttackEncounter`, a copy of
  `getActiveCaptureEncounter` (~129–137) against `activeAttackNodeId` / `attackEncounters`.
  Export it from `global.PokeRun` (~679–704), alphabetically.

- [ ] 7. **`map/locations.js`** — in `advanceRunToNextLevel` (~610–649), add
  `activeAttackNodeId: null,` to the fresh `run.area` literal and `run.attackEncounters = {};`
  to the encounter-map wipe (~643–646). **Do not skip this** — without it a stale
  `activeAttackNodeId` survives a level change and `redirectToActiveEncounter` traps the
  player on a node that no longer exists.

- [ ] 8. **`map/area.js`** — add `state.run.area.activeAttackNodeId = null;` to **every**
  existing active-id reset block in `getOrCreateTrainerEncounter`,
  `getOrCreateCaptureEncounter`, `getOrCreateMartEncounter`, and `getOrCreateEventEncounter`
  (both the early-return block and the post-create block in each). Grep
  `activeCaptureNodeId = null` to find them all; there are eight.

- [ ] 9. **`map/area.js`** — add `getOrCreateAttackEncounter`, modeled exactly on
  `getOrCreateCaptureEncounter` (~892–922), placed next to it:

  ```js
      function getOrCreateAttackEncounter(node) {
          const existingEncounter = state.run.attackEncounters[node.id];

          if (existingEncounter && !existingEncounter.completed) {
              setActiveEncounterNode('attack', node.id);
              sanitizeAttackEncounter(existingEncounter);
              return existingEncounter;
          }

          const attackOptions = locations.chooseAttackCardOptions(arena.GameData, getLocationTypes());
          const encounter = {
              completed: false,
              createdAt: new Date().toISOString(),
              nodeId: node.id,
              options: attackOptions.map(attack => attack.name),
              selectedAttackName: null,
              terrain: getLocationTerrain()
          };

          state.run.attackEncounters[node.id] = encounter;
          setActiveEncounterNode('attack', node.id);

          return encounter;
      }
  ```

  If you prefer not to introduce a `setActiveEncounterNode` helper, write the five explicit
  assignments the way the existing four functions do — but then step 8's eight blocks must be
  updated by hand and double-checked. Introducing the helper and routing all five
  `getOrCreate*` functions through it is the cleaner option and is **allowed** in this phase;
  if you do, it replaces step 8 and every one of the five functions must use it.

- [ ] 10. **`map/area.js`** — add `sanitizeAttackEncounter` + `sanitizeAttackEncounters`,
  modeled on `sanitizeCaptureEncounter(s)` (~1186–1226) but simpler (no legendary carve-out):
  drop option names that are no longer in `locations.getAttackCardPool(arena.GameData,
  getLocationTypes())` or that duplicate an earlier entry; if nothing survives, re-roll with
  `locations.chooseAttackCardOptions(...)`; return whether anything changed. Call
  `sanitizeAttackEncounters()` from the restore path alongside `sanitizeCaptureEncounters()`
  (~693).

- [ ] 11. **`map/area.js`** — extend `redirectToActiveEncounter` (~870–890) with an attack
  branch pointing at `'attack.html'`. Order it after capture and before mart. The page does
  not exist until phase 81, but nothing can set `activeAttackNodeId` until then either
  (`moveToNode` has no attack branch yet), so this is unreachable and safe.

- [ ] 12. **`main.js`** — add `hasActiveAttackEncounter(run)` copying
  `hasActiveCaptureEncounter` (~85–92), and a
  `if (hasActiveAttackEncounter(run)) return 'attack.html';` branch in `getSavedRunRoute`
  (~58–69), in the same position as step 11. Remember `main.js` shares no code with the rest of
  the game — it must re-implement this against the raw JSON.

- [ ] 13. **`tests/attack_encounter.test.js`** — new file. Preamble like
  `tests/pokemon_pools.test.js` (require `./helpers/arena_env`, then `../map/locations`;
  `const P = globalThis.PokeLocations`). Cover, against **fixture** data first:
  - `getAttackCardPool` excludes every attack with `LEGENDARY` or `ARTIFICIAL` in `type1` or
    `type2`, and includes on-type ones.
  - it falls back to the full offerable pool when no attack matches the location types.
  - it is unique by name.
  - `chooseAttackCardOptions` returns 1–3 records, never duplicates, always drawn from the
    pool (loop ≥200 rolls).
  Then one **live-data** test (`await loadRealGameData()`, `arena.GameData`): for every
  location in `locations.json`, `getAttackCardPool` is non-empty and contains no legendary or
  artificial attack. Live data has 25 legendary and 4 artificial attacks and ≥17 on-type
  attacks at the thinnest location, so this passes today and is a real tripwire.

- [ ] 14. **`tests/run_progression.test.js`** — extend the
  `advanceRunToNextLevel bumps the level…` test (~550) to assert
  `result.attackEncounters` deep-equals `{}` and `result.area.activeAttackNodeId === null`.

## Verification

- [ ] `node --check` passes on `map/locations.js`, `map/run_state.js`, `map/area.js`, `main.js`.
- [ ] `node --test tests/attack_encounter.test.js` passes.
- [ ] `node tests/run_all.js` green.
- [ ] Persistence round-trip proves the whitelist edits landed — this is the single most
  common way this phase goes wrong:
  ```
  node -e "require('./tests/helpers/arena_env.js'); require('./map/run_state.js');
  const R=globalThis.PokeRun;
  const run=R.createRunState({area:{nodes:[{id:'start'}],edges:[]},collections:{}});
  run.attackEncounters['node-4-1']={completed:false,createdAt:'x',nodeId:'node-4-1',options:['Ember'],selectedAttackName:null,terrain:'Volcanic'};
  run.area.activeAttackNodeId='node-4-1';
  R.saveRunState(run);
  const back=R.loadRunState();
  console.log(JSON.stringify(back.attackEncounters), back.area.activeAttackNodeId);
  console.log('active:', JSON.stringify(R.getActiveAttackEncounter(back)));"
  ```
  Both the encounter and the active id must survive, and `getActiveAttackEncounter` must
  return the encounter.
- [ ] Browser check with the `verify` skill: start a fresh run, step onto an attack node, and
  confirm it still pops "You entered an Attack Encounter" and does **not** navigate anywhere
  (the page arrives in phase 81). Then confirm via the console that
  `JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run')).attackEncounters` is still
  `{}` — `moveToNode` has no attack branch yet, so no encounter should have been created.
- [ ] `grep -n "activeAttackNodeId" map/area.js` shows it reset in **all five**
  `getOrCreate*Encounter` functions (or in the shared helper all five now call).

## Out of scope / do not touch

Do **not** create `attack.html`, `map/attack.js`, or `static/attack.css`, and do **not** add
the `'attack'` branch to `moveToNode` — that is phase 81 and it is what makes the node
playable. Do not touch `map/capture.js`, `map/mart.js`, `map/event.js`, or `arena/**`. Do not
refactor the duplicated capture-selection helpers in `area.js`/`capture.js` — noted as a wart,
but out of scope here. Do not change `STORAGE_VERSION` again (phase 79 set it to 3), the
generator, or any JSON data file.
