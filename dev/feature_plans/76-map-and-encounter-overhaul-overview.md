# Map & encounter overhaul (stat colors, attack encounters, typed grants) — batch overview

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs). Edit JSON data
  directly and validate with the tests.
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change. A phase is complete only when it is green
  **and** its verification boxes are ticked. The suite was **green at 230 tests** when this
  batch was written, so a red suite means *you* broke something.
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names
  (node types `'boss'` / `'capture'`, rank `'Boss'`, `bossNodeId`, CSS classes). **Never
  rename internals to match the UI.** The new node type follows the same rule: its internal
  type string is `'attack'`, its player-facing label is "Attack Encounter".
- **Do not author game content.** The only data edit in this batch is one flag on one
  existing event (phase 82). The owner writes everything else.

## What is being built (context)

Five owner asks, landed as seven phases.

**1 — Battle stat colors.** `renderStatCell` (`arena/arena_render.js` ~590) already prints
`arena.Model.getPokemonEffectiveStat`, which folds in stat stages *and* status multipliers:
a burned 100-attack Pokemon **already renders `A 50` today**. The defect is that the *color*
comes from the stat stage alone, so burn and paralysis produce no color at all, and a burned
`+2 attack` Pokemon shows `A 100` in **green** even though the number equals its base. Phase
77 makes statuses color the stat and win over stages, and adds a tooltip breakdown.

**2 + 4 — Attack encounters and the new map shape.** A sixth node type, `'attack'`, offers
1–3 attack cards filtered to the location's types (no LEGENDARY, no ARTIFICIAL); the player
picks one and gets 2 copies. It slots into a rebuilt map: levels 1–3 become fixed 10-node
routes with a single one-step-wide branch and hard per-route quotas, and level 4 gains a
second shop.

**3 — Location-typed random event grants.** A new `locationTypes: true` flag on a
random-grant effect draws the card from the current location's types, so the nursery-egg
event hands you a baby whose type fits the area.

**5 — Battles end on a full-team knockout.** Today a side loses after
`min(teamSize, KNOCKOUT_LIMIT)` knockouts, and `KNOCKOUT_LIMIT` is 4 — so the 51 trainers
holding 5–6 Pokemon go down with Pokemon still unused. Phase 83 makes the limit the team's
own size.

## Locked spec

Owner-confirmed 2026-07-31. No phase may re-derive or renegotiate any of this.

### Stat colors — "blue family = status only"

| situation | color |
|---|---|
| a status **raises** the stat (e.g. FIGHTING + any status → attack ×1.5) | **bright blue** `#1668cc` |
| a status **lowers** the stat (burn → attack, paralysis → speed, fatigue → def/speed) | **purple** `#7b2fa8` |
| stat stage up, no status touching that stat | green `#237b45` — **unchanged** |
| stat stage down, no status touching that stat | red `#b04332` — **unchanged** |
| both a status and a stage apply | the **status** color wins |

Direction is decided by the *multiplier*, never by the status name — a burned FIGHTING-type
gets `×1.5` attack and must read bright blue. The displayed number does not change (it is
already the true post-everything stat); a hover tooltip explains it. Explicitly **not** in
scope: showing the base number inline, and changing the `H` cell (it keeps showing max HP).

### Attack encounter

- Offers `randomInt(1, 3)` attack cards; the player picks exactly one and receives **2
  copies** (the wild-capture encounter's reward shape).
- Pool: unique-by-name attacks with ≥1 type overlapping the location's `types`, **excluding**
  any attack carrying `LEGENDARY` or `ARTIFICIAL`. `attacks.json` encodes both as PokeTypes in
  `type1`/`type2` — there is no boolean flag. Attacks have **no `type3`**.
- If the on-type pool is empty, fall back to the full non-legendary/non-artificial pool
  (`getWildPokemonPool`'s convention) so the node never dead-ends.
- Internal node type `'attack'`; player-facing label **"Attack Encounter"**; page
  `attack.html`; run-state map `attackEncounters`; active id `area.activeAttackNodeId`.

### Map layout

Levels 1–3 (`layout: 'branching'`): every start→boss route is **exactly 10 nodes** — 9
non-boss plus the boss. `start` is step 0 and is not counted. There is **exactly one branch
spot and it is exactly one step wide**: at one step the path splits into 2–3 lanes which all
rejoin at the next step. Per-route quotas over the 9 non-boss nodes:

| level | battle | capture | event | shop | attack | Σ min | boss rank |
|---|---|---|---|---|---|---|---|
| L1 | 2–3 | 2–4 | 2–3 | 1–2 | 1–2 | 8 | `Boss` |
| L2 | 3–4 | 1–3 | 2–3 | 1–2 | 1–2 | 8 | `Boss` |
| L3 | 2–3 | 1–2 | 2–3 | 1–2 | 2–3 | 8 | **`Elite`** |

L1 keeps its forced opening: step 1 `capture`, step 2 `capture`, step 3 `battle`.

Level 4 (`layout: 'gauntlet'`) becomes a 6-step chain: `shop, battle, battle, shop, battle,
boss` — all `Elite`. (Today it is 5 steps with no second shop.)

### Typed random event grants

New boolean effect field **`locationTypes: true`**, honored by `gain-random-card`,
`gain-random-baby`, and the `replacement` object of `replace-*` / `trade-*`. The names `type`
and `types` are both taken — see `15-typed-attack-event-rewards.md` lines 47–51 for why
singular `type` was rejected. When set, the random draw is restricted to records overlapping
`run.location.types`. **An empty on-type pool falls back to the unfiltered pool and still
grants** — deliberately the opposite of the authored `types` filter, because the location is
an environment accident rather than authoring intent. When both `types` and `locationTypes`
are set, `locationTypes` wins at runtime and validation flags the combination.

### Battle end condition

A side is defeated once **every Pokemon it brought** has been knocked out —
`getEffectiveKnockoutLimit(player)` becomes `getInitialPokemonCount(player)`, dropping the
flat `KNOCKOUT_LIMIT` cap of 4. The separate "team larger than 4 and could not draw a
replacement" loss also goes away, so a side with an empty Pokemon deck but a healthy Pokemon
on the board fights on. Fossil revival deferral is unchanged.

## Cross-phase architecture facts

Verified in the repo on 2026-07-31. Line numbers are drift-prone hints, not gospel.

**Map generation lives in `map/locations.js`, not `map/area.js`.** `area.js` only calls
`locations.createAreaGraph(level, { includeEvents })` (~line 716) and
`locations.bossNodeIdForLevel(level)` (~717).

**The graph shape must not change** — every renderer depends on it:

```js
graph  = { columns, edges, nodes }   // nodes === columns.flat(), same object identities
columns[step] = [node, ...]          // indexed by step; step 0 is [start]
node   = { id, lane, step, type, x, y }   // NO links/next — adjacency lives only in edges
edge   = { from, to }                // string node ids
```

Ids: `node-<step>-1` for single steps, `node-<step>-<laneIndex+1>` for branch lanes,
`boss-<nodeCount>` for the boss, `'start'` for step 0.

**Node types** are `start`, `battle`, `capture`, `event`, `shop`, `boss` — this batch adds
`attack`. Every place a type is referenced: `map/area.js` `LOCATION_LABELS` (~10),
`moveToNode` dispatch (~210–275), `renderLocationIcon` (~417), the hardcoded legend array
(~442), `renderLegendIcon` (~455), `isTrainerNodeType` (~1355), `getNodeAriaLabel` /
`getEnteredLocationText` (~1545–1567), `redirectToActiveEncounter` (~870); plus
`static/area.css` `.area-icon--*` (~394–514) and `main.js` `getSavedRunRoute` (~58).

**The four `getOrCreate*Encounter` functions in `map/area.js` each null the other three
active node ids** (~896, 916, 928, 943, 971, 995, 1009, 1036 — there are early-return copies
too). Adding a fifth encounter type means every one of them must also null
`activeAttackNodeId`, and the new one must null the other four. Missing one leaves two
encounters "active" and `redirectToActiveEncounter` sends the player to the wrong page.

**`map/run_state.js` normalizers are whitelists.** `normalizeRunState` (~386) and
`normalizeAreaState` (~454) rebuild the object field by field; **any field not listed is
silently dropped on every save**. A new `attackEncounters` map and `activeAttackNodeId` will
vanish on the first save unless both are added.

**`main.js` loads no shared modules.** It re-implements run loading and routing against the
raw JSON (`RUN_STORAGE_VERSION` at line 10, `getSavedRunRoute` ~58). Anything that changes
the storage version or adds a route must be mirrored there in the same change, or the
Continue button silently disagrees with the rest of the game.

**Navigation is full page load + localStorage, not query params.** A node click →
`moveToNode` → create/attach the encounter → `saveRunState()` → `window.location.href =
'<page>.html'`. The destination page reads the run from localStorage, calls
`runStore.getActiveXEncounter(run)`, and bounces back to `area.html` if it is null.

**The capture encounter is the template for the attack encounter**, and it has a wart worth
not repeating: its selection helpers exist **twice**, near-identically, in
`map/area.js` (~1144–1226) and `map/capture.js` (~378–494). Put the attack-encounter pool and
option picker in `map/locations.js` once, and call it from both sides.

**Effective-stat accessors are already exported** from `arena.Model` — phase 77 adds no
engine code: `getPokemonEffectiveStat` (~1402), `getPokemonStatMultiplier` (~1394),
`getPokemonStatStage` (~1388), `getPokemonStatusMultiplier` (~1237), `getPokemonStatuses`,
`formatStatStage` (~1454).

**`renderCardPreview` is a pure string builder** (`arena/arena_render.js` ~794, exported at
~1079) that touches no DOM, so render output is testable in Node via
`tests/helpers/arena_env.js`. It is also used **outside battle** (`arena/card_overview.js`,
`map/area.js`, `map/capture.js`, `map/event.js`, `map/mart.js`) where cards carry no statuses
or stages, so the new coloring is inert there.

**Browser verification tooling.** `dev/verify/lib.py` has `serving()` (python http.server on
127.0.0.1:8931); the Playwright venv is at `dev/verify/.cache/venv/bin/python`. Existing
drivers to copy: `drive_arena.py`, `phase61_area_selectable.py`, `drive_starter.py`. Use the
`verify` skill; do not rebuild drivers from scratch.

**The phase-79 generator was prototyped and validated during planning** — 12 000 graphs, 29
975 routes, every assertion passing, 0 three-in-a-row. Its source is inlined verbatim in that
phase file. Transcribe it; do not re-derive it.

## Phases

| File | What it does | Order |
|---|---|---|
| `77-battle-stat-status-colors.md` | `arena/arena_render.js` + `static/styles.css` + a new render test: status-driven stat colors and a tooltip breakdown. | independent — do first, it is the warm-up |
| `78-attack-node-type-rendering.md` | `map/area.js` + `static/area.css` learn the `'attack'` node type (label, icon, legend). Purely additive; nothing generates one yet. | before 79 |
| `79-map-layout-rewrite.md` | `map/locations.js` generator + `LEVEL_CONFIG` rewrite, the `boss-10` / storage-version constant sweep, and the `tests/run_progression.test.js` rewrite. **The risky one.** | after 78 |
| `80-attack-encounter-state.md` | `map/locations.js` pool helper + `map/run_state.js` + `map/area.js` + `main.js`: attack encounters exist in run state. The node is still inert. | after 79 |
| `81-attack-encounter-page.md` | New `attack.html` + `map/attack.js` + `static/attack.css`, then the `moveToNode` dispatch that makes the node playable. | after 80 |
| `82-location-typed-random-grants.md` | `locationTypes` flag: engine, `events.json`, editor, validation, docs. | independent of 77–81; late, so it does not collide with the map work |
| `83-battle-ends-on-full-team-knockout.md` | `arena/arena_model.js`: a side loses only once its whole team is knocked out, replacing the flat 4-KO limit. | independent of everything; do any time |
