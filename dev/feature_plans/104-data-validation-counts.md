# Phase 104 — `data_validation.test.js`: volume counts → derived invariants

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 103. **Read first:** `102-test-brittleness-overview.md`.
**Goal:** `tests/data_validation.test.js` contains no assertion about how many records a JSON
file holds, and the two "design fence" counts are replaced by tests that check the invariant
those counts were standing in for.

## Context you need

Four volume assertions live in this file. Live values as of 2026-08-10, for orientation only
— **never write these numbers into a test**: pokemon 271, attacks 140, items 15, trainers
128, events 68, locations 45, starter_decks 6, achievements 3, music 23. Trainer ranks:
Standard 19, Ace 22, Boss 28, Elite 23, Special 36. Artificial attacks: 4.

**1. `data_validation.test.js:103-113`, `'artificial attacks stay a small, TRAINER-targeted set'`**

```js
assert.ok(artificial.length <= 6, `artificial attack count ${artificial.length} exceeds expected small set`);
```

The `forEach` directly above it already carries the real invariant: every ARTIFICIAL attack
targets `TRAINER` and its status is one of `ARTIFICIAL_ATTACK_STATUSES`. The count adds
nothing. But `ARTIFICIAL_ATTACK_STATUSES` (line 14) is a hand-maintained mirror of what
`arena/arena_controller.js` actually implements — that is the part worth strengthening.
The controller handles exactly four, via `statuses.includes('…')` (grep for
`INCREASE_CAPACITY`, `EXTRA_ITEM`, `EXTRA_ATTACK`, `REFRESH_DECK`; they sit around lines
860-882, a drift-prone hint). A status authored in `attacks.json` but never handled there is
a silently dead card.

Cross-check it by reading the controller source and asserting each listed status appears in
it — a plain substring test, not a regex parse:

```js
const controllerSource = fs.readFileSync(path.join(ROOT, 'arena', 'arena_controller.js'), 'utf8');
ARTIFICIAL_ATTACK_STATUSES.forEach(status => {
    assert.ok(
        controllerSource.includes(`'${status}'`),
        `${status} is listed as an artificial status but arena_controller.js never handles it`
    );
});
```

**2. `data_validation.test.js:159-170`, `'the roster has enough seeded Elite and Ace trainers…'`**

```js
assert.ok(elites.length >= 4, …);
assert.ok(aces.length >= 6, …);
```

What these were proxying for: the run generator rolls a rank from the level's mix and then
looks for a trainer of that rank. A rank that can be rolled but has no trainer makes
`chooseTrainer` (`map/locations.js`) silently relax down a tier — a real, invisible bug.
`PokeLocations.LEVEL_CONFIG` is frozen, keyed `1..4`, and each level carries `battleRanks`
and `bossRanks` as `[{ rank, weight }]`. `isAllowedTrainerRank()` excludes `'Special'` at
every rung. So the derived invariant is:

> for every level in `LEVEL_CONFIG`, and every rank in that level's `battleRanks` /
> `bossRanks`, at least one non-`Special` trainer of that rank exists in `trainers.json`.

Verified to hold today: L1 battle Standard→19, L1 boss Boss→28, L2 battle Standard→19 /
Ace→22, L2 boss Boss→28, L3 battle Ace→22, L3 boss Elite→23, L4 battle Elite→23, L4 boss
Elite→23. It self-updates when `LEVEL_CONFIG` changes and is strictly stronger than the two
counts. Load `map/locations.js` the way the other tests do (`require('./helpers/arena_env')`
first, then `require('../map/locations')`, reading `globalThis.PokeLocations`).

The existing `forEach` asserting every seeded Elite/Ace has a valid `typeSpecialization`
stays — add a non-emptiness guard so it cannot pass vacuously.

**3. `data_validation.test.js:365`, `'locations.json entries are well-formed'`**

```js
assert.ok(locations.length >= 8, `locations.json should have >=8 records, has ${locations.length}`);
```

Delete. Everything real is already asserted in the same file: unique ids and names, 2–4
distinct valid types, hex themes, background path prefix, plus
`'enabled locations form a connected shared-type graph'` and `'every starter type appears in
an enabled location'` below.

## Steps

- [x] 1. **`tests/data_validation.test.js`** — delete the `artificial.length <= 6` assertion
  and the two-line comment above it justifying the bound. Keep the `forEach`.
- [x] 2. **`tests/data_validation.test.js`** — in the same test, add the controller-source
  cross-check shown above (`fs`/`path`/`ROOT` are already imported at the top of the file).
  Add a non-emptiness guard (`artificial.length > 0`) so the `forEach` cannot pass vacuously.
- [x] 3. **`tests/data_validation.test.js`** — delete `elites.length >= 4` and
  `aces.length >= 6`. Rename the test to something like
  `'seeded Elite and Ace trainers all carry a valid typeSpecialization'` and add
  non-emptiness guards for both lists.
- [x] 4. **`tests/data_validation.test.js`** — add a new test,
  `'every rollable trainer rank has at least one trainer to fill it'`: require
  `./helpers/arena_env` then `../map/locations`, walk
  `Object.entries(globalThis.PokeLocations.LEVEL_CONFIG)`, and for each level assert every
  rank named in `battleRanks` and in `bossRanks` matches ≥1 trainer in `trainers.json` with
  that `rank` and `rank !== 'Special'`. Message must name the level, the node type and the
  rank. Guard that `LEVEL_CONFIG` itself is non-empty.
- [x] 5. **`tests/data_validation.test.js`** — delete the `locations.length >= 8` assertion.
  No replacement needed; note in a one-line comment that per-record and graph coverage below
  is the guard.

## Verification

- [x] `node tests/run_all.js` green.
- [x] **Prove the trainer test is not vacuous.** Temporarily add a fifth level to
  `LEVEL_CONFIG` in `map/locations.js` whose `bossRanks` names a rank no trainer has (e.g.
  `[{ rank: 'Mythic', weight: 100 }]`) → the new test must fail naming L5/boss/Mythic.
  `git checkout -- map/locations.js`.
- [x] **Prove the artificial cross-check is not vacuous.** Temporarily add a bogus status to
  `ARTIFICIAL_ATTACK_STATUSES` in the test → the controller-source check must fail. Revert
  **by hand-editing the line back, never `git checkout -- tests/data_validation.test.js`** —
  that discards the whole phase's work along with the fixture. (Learned the hard way during
  implementation; the edits had to be redone.)
- [x] **Prove the brittleness is gone.** Append a throwaway entry to `attacks.json`,
  `locations.json` and `trainers.json` (valid shape, unique name/id) → suite stays green.
  `git checkout -- attacks.json locations.json trainers.json`, re-run, still green.
  **Write the file back with `formatDataFile(name, data)` from `dev/editor/format_json.js`**,
  not a raw `JSON.stringify` — `tests/editor_format.test.js` asserts each data file is
  byte-exact against the canonical formatter, so a hand-rolled dump fails for the wrong reason.
- [x] **Bonus proof** — appended a 7th starter deck, the exact change that was red before
  this batch: suite stayed green.

## Out of scope / do not touch

- No production code. `map/locations.js` and `arena/arena_controller.js` are read-only
  (the LEVEL_CONFIG fixture above is temporary and must be reverted).
- Do **not** touch `data_validation.test.js:563-568` (`data.pokemon.length === pokemon.length`
  etc.) — that compares loaded vs. raw and proves normalization drops nothing.
- Do not touch the per-record bound `record.types.length >= 2 && <= 4` — a shape rule.
- Leave `editor_api.test.js`, `editor_validation.test.js`, `encounter_uniqueness.test.js` and
  `event_requirements.test.js` to phase 105, and all hardcoded record names to phase 106.
