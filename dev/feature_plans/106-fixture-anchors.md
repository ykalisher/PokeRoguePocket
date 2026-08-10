# Phase 106 — Live-record name anchors → predicate selection

**Recommended agent:** Opus · medium effort.
**Prereqs:** 103, 105 (both edit `editor_validation.test.js`). **Read first:**
`102-test-brittleness-overview.md`.
**Goal:** No test selects a live data record by hardcoded name or id. A shared
`tests/helpers/pick.js` provides predicate selection with a readable failure message, and
every mutation fixture in `editor_validation.test.js` uses it.

## Context you need

`tests/editor_validation.test.js` tests `dev/editor/validate.js` by cloning the live data
(`structuredClone(live.data)` via the `withPokemon` / `withEvents` / `withLocations` /
`withTrainers` helpers near the top), corrupting one record, and asserting a specific issue
code fires. The record to corrupt is found by hardcoded name:

| Anchor | Sites (drift-prone line hints) | What the test actually needs |
|---|---|---|
| `'Numel'` | ~143, ~152 | any BABY-typed species that has `evolvesInto` |
| `'Blastoise'` | ~152 (as a non-Mega target), ~288, ~338, ~681, ~697 | ~152: any non-Mega species (id ≤ 9000); the condition/requirement fixtures: any pokemon name; ~681: any species named by `engineRefs.defaultDeck.pokemon` |
| `'sitrus-berry-tree'` | ~212, ~239, ~276, ~329 | any `gift` event whose `effects[0]` is a `gain-card` (i.e. an effect that does **not** read `locationTypes`) |
| `'nursery-egg'` | ~221, ~230 | any event whose `effects[0]` is `gain-random-baby` or `gain-random-card` (an effect that **does** read `locationTypes`) |
| `'lavender-town'` | ~386 | already handled in phase 103 — verify, do not redo |
| `'Mecha Cop'` / `'rogue-mecha-cop'` | ~697+ (`findReferences`) | any trainer referenced by a `trainer`-type event, plus that event's id |
| `'water'` starter deck | ~691 (`findReferences`) | the starter deck that lists the chosen pokemon |

`tests/baby_event.test.js:75` similarly asserts `events.some(event => event.id === 'nursery-egg')`
against live data. The behaviour under test — a baby-gated event becomes reachable once a
baby species exists — is already covered by the fixture test right below it
(`'chooseEvent can return nursery-egg once a baby exists in the pool'`). The live test should
select the baby-gated event by predicate (an event with a `gain-random-baby` effect) and roll
for *that* id.

**Two `find()` failure modes to fix while converting:** a hardcoded name that no longer
exists yields `undefined`, so the next line throws a bare `TypeError: Cannot read properties
of undefined` with no hint about what went stale. `pick()` must throw a message that names
what was being looked for.

> **Amended during implementation — the table above is incomplete.** Grepping for
> `name === '` / `id === '` misses anchors that appear as *assertion operands* rather than
> `find()` predicates. Six more turned up only when the rename proof was run:
> - three assertions of the form `ref.recordKey === 'sitrus-berry-tree'` in the
>   `findReferences` tests (~654, ~814, ~821) — these must use the id of whatever event
>   `withCondition` / `withRequirement` actually grafted onto;
> - `'Blastoise'` / `'Charizard'` used as *condition and requirement card names* (~351, ~364,
>   ~370, ~376, ~406-407) — they have to name a pokemon that really exists or `validate.js`
>   raises `events.unknown-condition-card`.
>
> Solution: two module-level derived constants next to the pickers —
> `const HOST_EVENT_ID = pickPlainEffectEvent(live.data.events).id;` and
> `const [SAMPLE_POKEMON, OTHER_POKEMON] = live.data.pokemon.slice(0, 2).map(r => r.name);`.
> `structuredClone` preserves order and the predicate is deterministic, so `HOST_EVENT_ID`
> identifies the same record the mutators touch.
>
> **Do not trust the grep to find everything — the rename proof in Verification is what
> actually closes this phase.**

**The helper already exists in the repo** — `tests/mart_stock.test.js:40-66` has a local
`pick(collection, predicate, label)`. Promote it verbatim-in-spirit to
`tests/helpers/pick.js`:

```js
'use strict';

/**
 * Selects a record out of live data by predicate rather than by hardcoded name.
 * A test that anchors on a specific authored record ("Numel", "sitrus-berry-tree")
 * breaks the moment the owner renames or retires it, and a bare find() returning
 * undefined throws an unreadable TypeError two lines later. The label makes the
 * failure say what the test was actually looking for.
 */
function pick(collection, predicate, label) {
    const list = Array.isArray(collection) ? collection : [];
    const found = list.find(predicate);
    if (!found) throw new Error(`no record in the live data matches: ${label}`);
    return found;
}

function pickIndex(collection, predicate, label) { … }   // for the splice() site

module.exports = { pick, pickIndex };
```

`mart_stock.test.js` should then import from the helper rather than keep its own copy — same
behaviour, one definition.

## Steps

- [x] 1. **`tests/helpers/pick.js`** — new file exporting `pick(collection, predicate, label)`
  and `pickIndex(collection, predicate, label)` as above.
- [x] 2. **`tests/mart_stock.test.js`** — delete the local `pick()` and import the helper.
  Behaviour must not change; the suite stays green.
- [x] 3. **`tests/editor_validation.test.js`** — convert the two `'Numel'` sites: select any
  BABY-typed species (`[type1,type2,type3].includes('BABY')`) that carries `evolvesInto`,
  labelled `'a BABY species with evolvesInto'`.
- [x] 4. **`tests/editor_validation.test.js`** — convert the `'Blastoise'` sites. For the
  "evolvesInto naming a non-Mega" fixture pick any species with `parseInt(id, 10) <= 9000`;
  for the condition/requirement fixtures pick any pokemon and use `record.name`; for the
  `findIndex(...).splice()` engine-ref test use `pickIndex` over
  `live.engineRefs.defaultDeck.pokemon`.
- [x] 5. **`tests/editor_validation.test.js`** — convert the `'sitrus-berry-tree'` sites to a
  predicate for a `gift` event whose first effect is a `gain-card` (needed because two of
  those tests assert `locationTypes` is *unused* by that effect type). Convert the
  `'nursery-egg'` sites to a predicate for an event whose first effect **does** read
  `locationTypes` (`gain-random-card` or `gain-random-baby`).
- [x] 6. **`tests/editor_validation.test.js`** — convert the `findReferences` tests: pick a
  `trainer`-type event, use its `trainerName` and its own `id` in the assertion; pick a
  pokemon that appears in `engineRefs.defaultDeck.pokemon` **and** in some starter deck, and
  assert against that deck's id rather than the literal `'water'`.
- [x] 7. **`tests/baby_event.test.js`** — replace the `event.id === 'nursery-egg'` live
  assertion with a predicate for a baby-granting event, and roll for that event's id in the
  200-roll loop below. Keep the fixture-based test underneath exactly as-is.
- [x] 8. **`tests/editor_validation.test.js`** — confirm phase 103 already de-anchored the
  `'lavender-town'` disconnected-graph test; if any hardcoded id remains, convert it.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `grep -n "name === '\|id === '" tests/editor_validation.test.js tests/baby_event.test.js`
  returns no hits against live-data record names (matches on issue `code` / `severity` /
  `type` strings are fine).
- [x] **Prove each converted test still catches its bug.** Spot-check at least three: remove
  `evolvesInto` from a BABY species in `pokemon.json` → `pokemon.baby-missing-mega` fires;
  set an event effect type to nonsense → `events.unknown-effect-type` fires; delete a
  defaultDeck pokemon → `engine.unknown-default-deck-ref` fires. `git checkout --` after each.
- [x] **Prove `pick()` fails readably.** Temporarily narrow one predicate so nothing matches
  → the error message must name the label, not throw `TypeError`. Revert.
- [x] **Prove the brittleness is gone — this is the real acceptance test for the phase.**
  Rename *all* the former anchor records at once: `Numel` → `Numelle` in `pokemon.json`,
  `sitrus-berry-tree` → `sitrus-berry-grove` and `nursery-egg` → `nursery-hatchery` in
  `events.json` (write back through `formatDataFile` from `dev/editor/format_json.js`).
  `node tests/run_all.js` must stay green. `git checkout -- pokemon.json events.json`,
  re-run, still green. **Run this before ticking anything** — it caught six anchors the
  grep did not.

## Out of scope / do not touch

- No production code. `dev/editor/validate.js` and the JSON data files are read-only
  (temporary fixtures must be reverted with `git checkout --`).
- **Do not convert name literals over records the test itself constructs** —
  `starter_unlock.test.js`, `event_requirements.test.js:64-139`,
  `mega_evolution.test.js:86-105`, `event_only_pokemon.test.js` and the
  `encounter_uniqueness.test.js` fixtures all build their own data. Leave them.
- **Do not convert `effect_boost.test.js:99`** (`find(item => item.name === 'Effect Amplifier')`).
  That test exists to check that this specific authored item is wired to the engine's
  `EFFECT_BOOST` path — naming it is the point.
- Do not touch the count assertions; phases 104 and 105 own those.
