# Phase 105 — Remaining count assertions across the suite

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 103. **Read first:** `102-test-brittleness-overview.md`.
**Goal:** No test outside `data_validation.test.js` asserts a magic count. The closed-enum
counts become parity assertions against the source of truth, and the data-volume ones become
per-record structural checks.

## Context you need

Six sites across four files.

### A. `tests/editor_api.test.js:369-386` — closed-enum counts

```js
assert.equal(body.effectTypes.length, 14);
assert.equal(body.statKeys.length, 8);
assert.equal(body.statPrefixes.length, 4);
```

**`effectTypes`.** The event-effect vocabulary is triplicated: `dev/editor/server.js:59`
(`EFFECT_TYPES`, what the API serves), `dev/editor/validate.js:24` (`DEFAULT_EFFECT_TYPES`,
not exported) and `tests/data_validation.test.js:174` (`VALID_EFFECT_TYPES`). The real source
of truth is the `switch` inside `applyEffect` at `map/event_effects.js:423` — an effect type
the engine does not dispatch on is a dead entry in the editor's dropdown. Extract the case
labels and assert set-equality; this is **verified to work** and yields exactly the same 14
strings the server serves:

```js
function engineEffectTypes() {
    const src = fs.readFileSync(path.join(ROOT, 'map', 'event_effects.js'), 'utf8');
    const start = src.indexOf('function applyEffect(run, effect');
    assert.ok(start !== -1, 'applyEffect not found in map/event_effects.js');
    const rest = src.slice(start + 10);
    const end = rest.indexOf('\n    function ');
    const body = end === -1 ? rest : rest.slice(0, end);
    const cases = [...body.matchAll(/case '([a-z-]+)':/g)].map(match => match[1]);
    assert.ok(cases.length > 0, 'no case labels parsed out of applyEffect');
    return cases;
}
```

Assert `new Set(body.effectTypes)` deep-equals `new Set(engineEffectTypes())`, with a message
naming the symmetric difference so a failure is diagnosable.

**`statKeys` / `statPrefixes`.** These come straight from `PokeProfile.STAT_KEYS` /
`STAT_PREFIXES` (frozen arrays at `map/profile.js:13,26`). Replace both counts with
`assert.deepEqual(body.statKeys, PokeProfile.STAT_KEYS)` and the prefix equivalent — exact,
self-updating, and it actually proves the API serializes them faithfully. Get `PokeProfile`
via `require('../map/profile.js')` then `globalThis.window.PokeProfile` (the pattern used at
`data_validation.test.js:453-454`). The existing `includes('runs.completed')` /
`includes('events.seen.')` spot-checks become redundant — drop them. Update the two test
titles, which currently say "the five ranks, 14 effect types" and "the eight stat keys and
four stat prefixes".

**Leave `assert.deepEqual(body.Rank, ['Standard','Ace','Special','Boss','Elite'])` at line 372
alone** — a full-value wire-contract pin, not a count.

### B. `tests/editor_validation.test.js:22-34` — missing-background floor

```js
assert.ok(missingBackgrounds.length >= 8, …);
```

22 locations currently name a background file that does not exist — a pure authoring
artifact that moves every time the owner draws art. Delete the count; keep and extend the
well-formedness loop so every `assets.missing-background` warning is checked: `severity` is
`'warning'`, `recordKey` is set, and `recordKey` names a real id in `locations.json`. Do the
same for the `assets.orphan-portrait` warnings already looped below. Retitle the test (it
currently promises "include the missing backgrounds").

### C. `tests/editor_validation.test.js:629-648` — music category counts

```js
assert.equal(empty.length, 3, 'boss is covered, the other three are not');
…
assert.equal(issues.filter(i => i.code === 'music.empty-category').length, 4);
```

These are derived from the closed music-category vocabulary (`trainer`, `boss`, `elite`,
`legendary` — see `VALID_MUSIC_CATEGORIES` in `data_validation.test.js:23` and the same list
in `dev/editor/validate.js`). Compute the category list in the test and assert
`categories.length - 1` for the "one covered" case and `categories.length` for the
all-disabled case, so adding a fifth category does not produce a false failure.

### D. `tests/encounter_uniqueness.test.js:225-243` — draw count

```js
assert.equal(drawn.length, 9);
```

This silently requires ≥9 eligible events in live `events.json`; a shrinking pool would make
`drawEvent` return `null` and the assertion would report a confusing count mismatch. Push
each draw and assert **per draw** that a record came back, naming the level and index in the
message, then keep `new Set(drawn).size === drawn.length`. The literal 9 disappears and the
failure mode becomes readable.

### E. `tests/event_requirements.test.js:157-176` — appliance choice count

```js
assert.equal(formChoices.length, 5, 'expected the five appliance choices');
```

Delete the magic 5. Replace with a non-emptiness guard (`formChoices.length > 0`, message
saying the live `rotom-appliances` event must have at least one effect-bearing choice) and
keep the `forEach` asserting each choice's picker offers only Rotom — that is the real
invariant.

## Steps

- [x] 1. **`tests/editor_api.test.js`** — add the `engineEffectTypes()` helper above the
  `/api/enums` tests (`fs`/`path` and a `ROOT` are needed; mirror how the file already
  resolves repo paths, or import `ROOT` from `./helpers/arena_env`). Replace
  `assert.equal(body.effectTypes.length, 14)` with the set-equality assertion.
- [x] 2. **`tests/editor_api.test.js`** — replace the `statKeys` / `statPrefixes` counts with
  `deepEqual` against `PokeProfile.STAT_KEYS` / `STAT_PREFIXES`; drop the now-redundant
  `includes()` spot-checks; retitle both tests so they no longer name numbers.
- [x] 3. **`tests/editor_validation.test.js`** — delete the `missingBackgrounds.length >= 8`
  assertion; extend the warning loop to check `severity`, `recordKey`, and that `recordKey`
  resolves to a real `locations.json` id; retitle the test.
- [x] 4. **`tests/editor_validation.test.js`** — derive both music-category counts from the
  category list instead of the literals `3` and `4`.
- [x] 5. **`tests/encounter_uniqueness.test.js`** — replace `assert.equal(drawn.length, 9)`
  with a per-draw non-null assertion inside the loop (message naming level + index), keeping
  the set-size uniqueness check.
- [x] 6. **`tests/event_requirements.test.js`** — replace `formChoices.length === 5` with a
  non-emptiness guard; keep the per-choice picker loop.

## Verification

- [x] `node tests/run_all.js` green.
- [x] **Prove the effect-type parity test is not vacuous.** Temporarily add
  `case 'not-a-real-effect':` inside `applyEffect` in `map/event_effects.js` → the API test
  must fail naming that string. `git checkout -- map/event_effects.js`.
- [x] **Prove the stat-key parity test is not vacuous.** Note: appending to `STAT_KEYS` in
  `map/profile.js` does **not** fail it, and correctly so — both sides read that same array,
  which *is* the source of truth. What the test guards is the API's *serialization*, so break
  that instead: `dev/editor/server.js:84` → `window.PokeProfile.STAT_KEYS.slice(1)`. Test
  failed as required. `git checkout -- dev/editor/server.js`.
- [x] **Prove the music-category derivation is not vacuous.** Added a 5th category to
  `MUSIC_CATEGORIES` in `arena/arena_data.js` → both empty-category tests failed, because
  `dev/editor/validate.js`'s unexported `DEFAULT_MUSIC_CATEGORIES` mirror had not moved with
  it. That drift guard is a bonus the hardcoded `3`/`4` never provided.
  `git checkout -- arena/arena_data.js`.
- [x] **Prove the brittleness is gone.** Append a throwaway track to `music.json` and a
  throwaway event to `events.json` (valid shape, unique ids) → suite stays green.
  `git checkout -- music.json events.json`, re-run, still green.
- [x] Confirm `assert.deepEqual(body.Rank, …)` at `editor_api.test.js:372` is untouched.

## Out of scope / do not touch

- No production code. `map/event_effects.js`, `map/profile.js`, `dev/editor/**` and the JSON
  data files are read-only (temporary fixtures above must be reverted with `git checkout --`).
- Do not touch `data_validation.test.js` — phase 104 owns it.
- Do not convert hardcoded record names (`'Numel'`, `'sitrus-berry-tree'`, …) — phase 106
  owns those, including in the same two editor test files this phase edits.
- Do not "fix" the triplicated effect-type vocabulary by refactoring `dev/editor/` to share
  one list. Tempting, but it is production tooling and out of scope for a test batch; the new
  parity assertion is what catches drift. Mention it to the owner instead.
