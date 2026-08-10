# Phase 103 — The rule, and the two red tests

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `102-test-brittleness-overview.md`.
**Goal:** `CLAUDE.md` carries the "never assert how many records exist" rule, and
`node tests/run_all.js` is **green** — both current failures fixed by deriving the expected
value from the data instead of hardcoding it.

## Context you need

The suite is red on two tests. Both hardcode something the owner has since changed.

**Failure 1 — `tests/run_progression.test.js:240-256`**, test
`'getStarterDecks reads starter_decks.json in the tuple shape'`:

```js
assert.deepEqual(Object.keys(decks), ['water', 'grass', 'fire']);
```

`starter_decks.json` now has six decks (`water, grass, fire, dark, fighting, human`).
`PokeLocations.getStarterDecks(gameData)` (`map/locations.js:127`) returns
`Object.fromEntries(enabled.map(deck => [deck.id, deck]))` where `enabled` filters
`deck.enabled !== false` — so the correct expectation is *derived from the file*, in file
order. The rest of the test (the `[name, count]` tuple loop) is good and stays.

**Failure 2 — `tests/editor_validation.test.js:378-391`**, test
`'locations: disconnected graph'`. It clones live locations, retypes `lavender-town` to
`['BABY','ARTIFICIAL']` on the theory that no location uses those types, and expects
`validateAll` to raise `locations.graph-disconnected`. `ARTIFICIAL` is now a real location
type, so `lavender-town` still shares a type with the rest of the graph and no warning
fires. The stale comment above it even documents the previous round of this (`FOSSIL`,
July 2026).

> **Amended during implementation.** The first idea was to *compute* an unused type at
> runtime and retype one location to it. That turns out to be impossible: enabled locations
> already use 23 of the 25 usable `PokeType` values, and `NONE`/`LEGENDARY` are rejected by
> `dev/editor/validate.js:730`, leaving exactly **one** free type — while `locations.json`
> requires 2–4 distinct ones. Any "unused type" fixture is one authoring session from
> breaking again, which is the whole failure mode being fixed.

The durable fix builds the **smallest disconnected graph out of whatever the data holds**:
keep exactly two enabled locations that share no type, disable the rest. Every record stays
otherwise valid, so the only thing provoked is the connectivity check, and it derives
entirely from the data — nothing to rot.

```js
const data = withLocations((locations) => {
    const enabled = locations.filter((location) => location.enabled !== false);
    assert.ok(enabled.length >= 2, 'need two enabled locations to disconnect');

    const first = enabled[0];
    const partner = enabled.find((location) => (
        location !== first && !location.types.some((type) => first.types.includes(type))
    ));
    assert.ok(partner, 'expected two enabled locations sharing no type');

    locations.forEach((location) => {
        if (location !== first && location !== partner) location.enabled = false;
    });
});
```

`validateAll`'s connectivity check (`dev/editor/validate.js:747-775`) runs over
`locations.filter(record => record.enabled !== false)` unconditionally, so disabling the rest
is enough. `locations.starter-coverage` errors also fire on this fixture — harmless, since
the test asserts only on `locations.graph-disconnected`.

## Steps

- [x] 1. **`CLAUDE.md`** — add a `## Test conventions` section between `## Commands` and
  `## Token discipline`, stating: never assert an exact count/floor/ceiling on a data file or
  a pool derived from it, and never hardcode a list of live record names/ids; iterate every
  record and assert its shape, or derive the expected value from the source the runtime
  reads. Spell out the allowed cases (anti-vacuity `length > 0` guards; counts over
  test-built fixtures; `loaded.length === raw.length`; per-record shape bounds), the banned
  ones (`assert.equal(pokemon.length, 271)`, `elites.length >= 4`, `artificial.length <= 6`,
  `deepEqual(Object.keys(decks), ['water','grass','fire'])`), the `pick()` rule for choosing a
  fixture out of live data, and `tests/location_theme.test.js` as the model.
- [x] 2. **`tests/run_progression.test.js`** — in
  `'getStarterDecks reads starter_decks.json in the tuple shape'`, replace the hardcoded
  `deepEqual` with a derived one: read `starter_decks.json` from disk (the file already has
  `fs`/`path` available via `helpers/arena_env`'s `ROOT`, or reuse `arena.GameData.starterDecks`),
  compute the enabled ids in file order, and assert `Object.keys(decks)` equals that. Add a
  per-entry assertion that each map key equals its own `deck.id` — that is the real contract
  `createCardCollections` depends on. Keep the tuple-shape loop untouched.
- [x] 3. **`tests/run_progression.test.js`** — add a non-emptiness guard so the rewritten test
  cannot pass vacuously if `getStarterDecks` ever returns `{}` (it falls back to
  `BUILTIN_STARTER_DECKS` when nothing is enabled, so assert the key list is non-empty).
- [x] 4. **`tests/editor_validation.test.js`** — add the `unusedLocationType`-style helper
  above the location tests and rewrite `'locations: disconnected graph'` to use it. Replace
  the stale `FOSSIL`/`BABY`/`ARTIFICIAL` comment with one explaining that the isolating types
  are computed, and why (two prior rots).
- [x] 5. **`tests/editor_validation.test.js`** — the isolated location is currently chosen by
  id (`lavender-town`). Choose it by predicate instead: the first enabled location whose every
  type is also carried by another enabled location, and whose types include no starter-deck
  type. Fail with a clear message if none qualifies.

## Verification

- [x] `node tests/run_all.js` — **green**, zero failures.
- [x] The starter-deck test still catches a real break — **done by patching
  `getStarterDecks` in `map/locations.js` to `.slice(1)` the enabled list**, i.e. silently
  dropping a deck, which is the bug class the hardcoded list was guarding. Test failed with
  `actual: ['grass','fire',…] / expected: ['water','grass','fire',…]`.
  `git checkout -- map/locations.js`.
  (Note: corrupting an `attacks` entry to `{"name":"X"}` does *not* fail, and correctly so —
  `arena/arena_data.js:606` normalizes a missing count via
  `Math.max(1, Math.floor(Number(entry.count)) || 1)`. Defensive by design, not a gap.)
- [x] The disconnected-graph test still catches a real break — **done by neutering
  `dev/editor/validate.js`'s `if (visited.size !== enabled.length)` to `if (false)`**; the
  test failed as required. `git checkout -- dev/editor/validate.js`.
- [x] Re-run `node tests/run_all.js` after reverting every temporary fixture — green, and
  `git status` clean apart from the intended edits.

## Out of scope / do not touch

- No production code. `map/locations.js`, `dev/editor/validate.js` and the JSON data files
  are **read-only** in this phase (temporary fixtures must be reverted with `git checkout --`).
- Do not touch the other count assertions listed in the overview — phases 104 and 105 own
  them. This phase fixes only the two red tests plus the `CLAUDE.md` rule.
- Do not convert the other hardcoded record names in `editor_validation.test.js` — phase 106
  owns those. Only the location picked by the disconnected-graph test changes here.
