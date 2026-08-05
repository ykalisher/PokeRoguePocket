# Phase 94 — Achievements: achievements.json and the stat bump sites

**Recommended agent:** Opus · high effort.
(High because it touches six page controllers plus `arena/game.js`, and the failure mode is
silent: a missing guard double-counts on a reload, a missing script tag makes
`PokeProfile` undefined and throws mid-run. Play a real run end to end.)
**Prereqs:** phase 93. **Read first:** `92-achievements-overview.md`.
**Goal:** `achievements.json` exists and loads with the rest of the game data, every
counter in the locked stat namespace is bumped at the right moment exactly once, and
achievements actually unlock during play. Ends green.

## Context you need

Read the overview's "Locked spec" (stat namespace, `achievements.json` shape) and its bump
site table. Line numbers below are drift-prone hints — grep for the function name.

**The API from phase 93** (call these; do not reimplement):
`PokeProfile.record(bumps, achievements)` → newly unlocked records,
`PokeProfile.bumpStats(bumps)`, `PokeProfile.getStat(key)`.

**Data loading.** `arena/arena_data.js`: `fallbackRecords` (~60), `normalizeGameData` (~533),
`loadGameData` (~568) `Promise.all` of `loadJson(path, fallback)`, and
`arena.GameData = normalizeGameData(fallbackRecords)` at module load (~582). Follow the same
pattern as every other collection. (Phase 89 of the previous batch added `starterDecks` the
same way — read that diff in `git log` if it has landed.)

**Idempotency is the main hazard.** Three of the seven sites can run twice:

- `arena/game.js` `handleBattleFinished` (~156) re-runs when a reload re-renders the saved
  result overlay. It already guards rewards with
  `if (activeBattleEncounter.outcome === 'win' && !activeBattleEncounter.rewardCollected)`.
  Add a parallel `activeBattleEncounter.statsRecorded` flag, set it, and let the existing
  `runStore.saveRunState(activeRun)` at the end persist it.
- `map/event.js` `completeEvent` (~197), `map/capture.js` `completeCapture` (~136),
  `map/attack.js` `completeAttackClaim` (~126), `map/mart.js` `completeMartAndReturnToMap`
  (~331) each set `state.encounter.completed = true` and save. Guard each with its own
  `state.encounter.statsRecorded` check before bumping.
- `map/area.js` `createFreshRunState` (~722) runs exactly once per run by construction —
  no flag needed, but confirm by reading its callers.

**Mono-type derivation** for `runs.completed.mono.<TYPE>`:

```js
    function monoTypeBumps(run) {
        const records = window.PokeLocations.getRunPokemonRecords(run);

        if (records.length === 0) return {};

        const typesOf = record => (Array.isArray(record.types)
            ? record.types
            : [record.type1, record.type2, record.type3]).filter(type => type && type !== 'NONE');

        const shared = records
            .map(typesOf)
            .reduce((common, types) => common.filter(type => types.includes(type)));

        return Object.fromEntries(shared.map(type => [`runs.completed.mono.${type}`, 1]));
    }
```

`getRunPokemonRecords` lives at `map/locations.js` ~844 and returns species records for
active + bench. The `reduce` without an initial value is intentional: it seeds with the
first Pokemon's types and intersects from there.

**Where the run's Pokemon still exist at victory:** `finalizeRunVictory` (~182) runs before
any teardown, and `activeRun.collections` is intact. Bump there, not in
`completeBattleAndReturnToMap`.

**Script tags.** `map/profile.js` must load **before** any file that calls it and before
`map/event_effects.js` (phase 96 makes that file read the profile). Pages and their current
tag lists are in the overview's table.

## Steps

- [x] 1. **`achievements.json`** (new, repo root) — a small starter set that exercises each
  shape. Keep it to about six records; the owner writes the rest.

  ```json
  [
    { "id": "first-steps", "name": "First Steps", "description": "Start your first run.", "stat": "runs.started", "atLeast": 1, "hidden": false, "enabled": true },
    { "id": "first-blood", "name": "First Blood", "description": "Win your first battle.", "stat": "battles.won", "atLeast": 1, "hidden": false, "enabled": true },
    { "id": "gym-challenger", "name": "Gym Challenger", "description": "Beat 5 Gym Leaders.", "stat": "battles.won.rank.Boss", "atLeast": 5, "hidden": false, "enabled": true },
    { "id": "champion", "name": "Champion", "description": "Finish a full run.", "stat": "runs.completed", "atLeast": 1, "hidden": false, "enabled": true },
    { "id": "blaze-purist", "name": "Blaze Purist", "description": "Finish a run with only Fire Pokemon.", "stat": "runs.completed.mono.FIRE", "atLeast": 1, "hidden": true, "enabled": true },
    { "id": "wanderer", "name": "Wanderer", "description": "Experience 25 events.", "stat": "events.seen", "atLeast": 25, "hidden": false, "enabled": true }
  ]
  ```

  Note the UI wording rule: the *description* says "Gym Leaders" while the *stat* keeps the
  internal rank string `Boss`.

- [x] 2. **`arena/arena_data.js`** — add `achievements` to `fallbackRecords` (~60) with the
  same six records, add a `normalizeAchievement(record)` next to the other normalizers
  (drop records without an `id`; coerce `atLeast` to an integer ≥ 1; default `hidden` to
  `false` and `enabled` to `true`; default `name` to the id and `description` to `''`), wire
  it into `normalizeGameData` (~533), and add
  `loadJson('achievements.json', fallbackRecords.achievements)` to `loadGameData` (~568)
  keeping the destructure/argument order aligned.

- [x] 3. **HTML pages** — add `<script src="map/profile.js"></script>` immediately after the
  `run_state.js` tag on: `area.html`, `game.html`, `event.html`, `capture.html`,
  `attack.html`, `mart.html`. (`starter.html` does not bump anything;
  `index.html` gets its tag in phase 95 if the menu needs it — leave it alone here.)
  Verify each page still boots with no console errors before moving on.

- [x] 4. **`map/area.js`** `createFreshRunState` (~722) — after `saveRunState();`:

  ```js
        window.PokeProfile.record({ 'runs.started': 1 }, arena.GameData.achievements);
  ```

  Confirm `arena.GameData` is loaded at that point (area.js's init awaits
  `arena.Data.loadGameData()` — read it, do not assume).

- [x] 5. **`arena/game.js`** `handleBattleFinished` (~156) — add the battle counters,
  guarded, after the existing outcome/reward block and **before**
  `runStore.saveRunState(activeRun)`:

  ```js
        if (!activeBattleEncounter.statsRecorded) {
            const won = activeBattleEncounter.outcome === 'win';
            const bumps = won
                ? { 'battles.won': 1, [`battles.won.rank.${activeTrainer.rank}`]: 1 }
                : { 'battles.lost': 1, 'runs.lost': 1 };

            activeBattleEncounter.statsRecorded = true;
            window.PokeProfile.record(bumps, arena.GameData.achievements);
        }
  ```

  `runs.lost` rides with `battles.lost` because a lost battle ends the run — see
  `renderLossResultWindow` (~240), whose only exits are "Start over" and "Main menu".

- [x] 6. **`arena/game.js`** `finalizeRunVictory` (~182) — add the run-completion counters
  at the end of the function, after `activeRun.runCompletedAt = now;`:

  ```js
        window.PokeProfile.record(Object.assign(
            { 'runs.completed': 1, [`runs.completed.starter.${activeRun.starterId}`]: 1 },
            monoTypeBumps(activeRun)
        ), arena.GameData.achievements);
  ```

  Add `monoTypeBumps` (the snippet in "Context you need") as a private helper near the
  bottom of `arena/game.js`, beside the other small helpers like `getRunLevel` (~509).
  `finalizeRunVictory` is already guarded — it only runs from the
  `outcome === 'win' && isRunVictory()` branch and `activeRun.runCompleted` is set inside
  it. Confirm a reload cannot re-enter it; if it can, add a `statsRecorded`-style guard.

- [x] 7. **`map/event.js`** `completeEvent` (~197) — before `render();`:

  ```js
        if (!state.encounter.statsRecorded) {
            state.encounter.statsRecorded = true;
            window.PokeProfile.record({
                'events.seen': 1,
                [`events.seen.${state.eventRecord.id}`]: 1
            }, arena.GameData.achievements);
        }
  ```

  Place it **before** `runStore.saveRunState(state.run)` so the flag is persisted by the
  existing save.

- [x] 8. **`map/capture.js`** `completeCapture` (~136) — same guarded shape with
  `{ 'captures.completed': 1 }`, before the existing `runStore.saveRunState(state.run)`.

- [x] 9. **`map/attack.js`** `completeAttackClaim` (~126) — same, with
  `{ 'attacks.claimed': 1 }`.

- [x] 10. **`map/mart.js`** `completeMartAndReturnToMap` (~331) — same, with
  `{ 'marts.visited': 1 }`.

- [x] 11. **`tests/data_validation.test.js`** — add cases over the real `achievements.json`:
  unique non-empty ids, `atLeast` an integer ≥ 1, and every `stat` accepted by
  `PokeProfile.isKnownStat`. Require `../map/profile.js` the same way the file already
  reaches game modules.

- [x] 12. **`tests/achievements.test.js`** — extend with a `monoTypeBumps`-style case: build
  a fake run whose collections hold two FIRE/FLYING species and assert both
  `runs.completed.mono.FIRE` and `runs.completed.mono.FLYING` would be bumped; then one
  FIRE and one WATER species and assert neither is. If `monoTypeBumps` lives inside
  `arena/game.js`'s IIFE and is unreachable from Node, replicate the three-line reduce in
  the test rather than exporting it — but say so in a comment.

- [x] 13. **`node tests/run_all.js`** — green.

## Verification

- [x] `node tests/run_all.js` green.
- [x] Full playthrough on a served copy (`python3 -m http.server 8931 --bind 127.0.0.1`).
  With `localStorage.removeItem('pokemon-rogue-pocket-profile')` first, start a run and
  check in the console after each step that
  `JSON.parse(localStorage['pokemon-rogue-pocket-profile']).stats` gained exactly the
  expected key:
  - starter picked → `runs.started: 1`;
  - first battle won → `battles.won: 1` and `battles.won.rank.<Rank>: 1`;
  - a wild Pokemon encounter → `captures.completed: 1`;
  - an event → `events.seen: 1` **and** `events.seen.<that event's id>: 1`;
  - an attack encounter → `attacks.claimed: 1`;
  - leaving a mart → `marts.visited: 1`.
- [x] Double-count guard: after winning a battle, **reload `game.html`** on the result
  screen and confirm `battles.won` did **not** go to 2. Repeat the reload test on the event
  page after completing an event.
- [x] `first-steps` and `first-blood` appear in
  `JSON.parse(localStorage['pokemon-rogue-pocket-profile']).unlocked` after the first
  battle win, and both ids sit in `pendingUnlocks` (phase 95 drains them).
- [x] Losing a battle bumps `battles.lost` and `runs.lost` and does **not** bump
  `runs.completed`.
- [x] `localStorage['pokemon-rogue-pocket-profile']` survives New Game and survives a loss —
  start over and confirm the counters are still there.
- [x] No console errors on any of the six pages.
- [x] Stop the server: `pkill -f "http.server 8931"`.

## Out of scope / do not touch

The achievements page and any toast/DOM rendering (phase 95 — `pendingUnlocks` just piles
up until then, which is fine). Event conditions (phase 96). The data editor (phase 97 —
`achievements.json` is intentionally not in `FILE_NAMES` yet; adding it without the
formatter entry makes `formatDataFile` throw). Do not add stats outside the locked
namespace, do not clear the profile from anywhere, and do not change run state, battle
logic, or any other data file.
