# Phase 71 — Restore green baseline

**Recommended agent:** Haiku · low effort.
**Prereqs:** none — this is the first phase of the batch.
**Read first:** `70-event-card-conditions-overview.md`.
**Goal:** `node tests/run_all.js` is green again. Two tests have gone stale against the
owner's latest data commit; both are fixed **in the tests**, not in the game or the data.

## Context you need

At the time this batch was planned (2026-07-31, HEAD `50947a2` "Added events for regis and
Rotom") the suite had exactly **two** failures. Neither is a game bug — both are tests that
did not keep up with the `eventOnly` pokemon flag introduced in phase 68. Every later phase
in this batch gates on a green suite, so this phase runs first.

The owner's last commit marked seven species `"eventOnly": true` in `pokemon.json`:
`Porygon2`, `Rotom`, `Rotom-Wash`, `Rotom-Heat`, `Rotom-Frost`, `Rotom-Fan`, `Rotom-Mow`.
An `eventOnly` species is excluded from the wild-encounter pool and is meant to be granted
by an event instead.

**Failure 1 — `tests/pokemon_pools.test.js`**, test *"getWildPokemonPool against real data
returns exactly the obtainable species (no legendary/baby/mega)"* (~line 139). The test
independently recomputes the obtainable set to stay robust as the owner adds pokemon, but
that recompute filters only LEGENDARY, BABY and mega (`id > 9000`) — it never learned about
`eventOnly`. `getWildPokemonPool` correctly excludes the seven, so the two lists differ.

**Failure 2 — `tests/editor_validation.test.js`**, test *"pokemon: eventOnly granted by a
gain-card event has no unreachable warning"* (~line 100). It clones the live data, marks
`data.pokemon[0]` as `eventOnly`, grants it via an event, then asserts
`!hasCode(issues, 'pokemon.event-only-unreachable')`. `hasCode` matches that code on **any**
record, so the assertion now trips over five unrelated live warnings: `Rotom-Wash`,
`Rotom-Heat`, `Rotom-Frost`, `Rotom-Fan` and `Rotom-Mow` are `eventOnly` but no event grants
them yet. Those five warnings are **correct and expected** — the owner cannot author the
events that grant them until this batch ships card conditions. Do not silence the rule and
do not touch `pokemon.json` or `events.json`; make the test assert what it actually means,
which is "no warning **about the fixture's own pokemon**".

Both fixes below were run during planning and produced a matching set / a `false` result.

## Steps

- [x] 1. **`tests/pokemon_pools.test.js`** — in the "obtainable species" recompute inside
  the `getWildPokemonPool against real data …` test, add the missing exclusion next to the
  existing mega guard, and extend the comment above the loop to mention it:

  ```js
          if (parseInt(species.id, 10) > 9000) return;
          if (species.eventOnly === true) return;
  ```

- [x] 2. **`tests/editor_validation.test.js`** — in *"pokemon: eventOnly granted by a
  gain-card event has no unreachable warning"*, replace the global `hasCode` assertion with
  a record-scoped one so unrelated live warnings cannot trip it:

  ```js
      const issues = validateAll(data, { enums: live.enums });
      const grantedName = data.pokemon[0].name;

      assert.ok(
          !issues.some((issue) => issue.code === 'pokemon.event-only-unreachable' && issue.recordKey === grantedName),
          `${grantedName} is granted by an event, so it must not be reported unreachable`
      );
  ```

  Leave the sibling test above it (*"…eventOnly with no granting event is an unreachable
  warning"*, which asserts the code **is** present) alone — it passes.

- [x] 3. **`node tests/run_all.js`** — confirm the whole suite is green.

- [x] 4. Confirm the five `Rotom-*` warnings are still reported (they are the owner's
  to-do list, not noise to be hidden). Quick check:

  ```bash
  node -e "
  const {buildLiveEditorEnv}=require('./tests/helpers/editor_env');
  const {validateAll}=require('./dev/editor/validate.js');
  const live=buildLiveEditorEnv();
  validateAll(live.data,{enums:live.enums,assetIndex:live.assetIndex,engineRefs:live.engineRefs})
    .filter(i=>i.code==='pokemon.event-only-unreachable')
    .forEach(i=>console.log(i.severity,i.recordKey));
  "
  ```

  Expect five `warning` lines (the Rotom forms). Zero would mean step 2 went too far.

## Verification

- [x] `node tests/run_all.js` green — zero failing tests.
- [x] `node --test tests/pokemon_pools.test.js` and
  `node --test tests/editor_validation.test.js` both pass on their own.
- [x] Step 4 still prints the five `pokemon.event-only-unreachable` warnings.
- [x] `git status --porcelain` shows **only** `tests/pokemon_pools.test.js` and
  `tests/editor_validation.test.js` modified. `pokemon.json`, `events.json`,
  `dev/editor/validate.js` and everything under `map/` must be untouched.

## Out of scope / do not touch

Do not "fix" the data: the five unreachable Rotom forms are the owner's pending content and
the whole point of this batch. Do not weaken, rename or delete the
`pokemon.event-only-unreachable` rule in `dev/editor/validate.js`. Do not start the
conditions feature — that is phase 72 onward. Do not refactor either test file beyond the
two edits above, and never `git commit`.
