# Session 15 — Type-constrained attack rewards from events

**Standalone feature** (not part of the 08–14 mobile-polish batch). A data + engine
change to the overworld event system. Editing `events.json` is governed by the `data`
skill; validate everything with `node tests/run_all.js`.

## Context / why

Events can already grant attack cards two ways, but **neither lets you ask for a random
attack of a given type**:

- `gain-card` + `cardKind:"attack"` + `name:"<attack>"` grants one **named** attack
  (`map/event_effects.js` → `gainNamedCards`). You can hand out a specific attack — and
  thus implicitly its type — but only by naming the exact card.
- `gain-random-card` + `cardKind:"attack"` grants a **fully random** attack
  (`map/event_effects.js` → `gainRandomCards` → `chooseRandomRecord`). The chooser only
  supports an `excludeName` filter — there is **no type constraint**.

The data to support it already exists: attack records carry `type1`/`type2`
(`attacks.json`, values are uppercase type names or `"NONE"`). Several live events
already use `gain-random-card` with `cardKind:"attack"`, so today a "fire trainer"
reward can hand out a random Water attack. This feature is also a prerequisite for two
existing `TODO.md` goals: location type-specialization (Next Big Task #5) and
"Legendaries should give you a legendary attack when you get them" (#8).

**Goal:** an event effect can request a random attack restricted to one or more types
(e.g. a random `FIRE` attack), reusing the existing `gain-random-card` path.

## Design

Add an optional **`types`** field (array of uppercase type names; also accept a
singular `type` string) to the `gain-random-card` effect. When present, the random draw
is restricted to records whose type fields intersect the requested set. Works generically
for `cardKind:"attack"` (and `"pokemon"`), but attacks are the target case.

Type match: a record matches if any of its non-`"NONE"` type fields is in the requested
set. Attacks use `type1`/`type2`; pokémon use `type1`/`type2`/`type3`.

Empty-pool rule: if a `types` filter matches **no** records, do **not** silently fall
back to an off-type card — skip the grant and return a "No `<type>` attack available."
message (mirrors the existing no-op path). Every current type has attacks, so this only
guards bad data.

## Implementation (`map/event_effects.js`)

1. **Thread a type filter into the chooser.** `chooseRandomRecord` (search
   `function chooseRandomRecord`) currently takes `(gameData, cardKind, excludeName)`.
   Add an optional type filter — e.g. `(gameData, cardKind, excludeName = null,
   types = null)`. After the existing `excludeName` filter, if `types` is a non-empty
   array, further restrict:
   ```js
   const typeSet = Array.isArray(types) && types.length ? new Set(types) : null;
   const typed = typeSet ? filteredRecords.filter(r => recordMatchesTypes(r, typeSet)) : filteredRecords;
   ```
   Change the empty-pool line so a **requested but unmatched** type yields no choice
   (return `null`) rather than falling back to all records. Keep the current
   `excludeName`-only fallback behavior unchanged when no `types` are requested.

2. **Add `recordMatchesTypes(record, typeSet)`** near `chooseRandomRecord`:
   ```js
   function recordMatchesTypes(record, typeSet) {
       return ['type1', 'type2', 'type3']
           .map(k => record && record[k])
           .some(t => t && t !== 'NONE' && typeSet.has(t));
   }
   ```

3. **Pass the effect's types through.** `gainRandomCards` (search `function
   gainRandomCards`) already receives the full `effect`. Normalize `effect.types ||
   (effect.type ? [effect.type] : null)` (uppercased) and pass it to
   `chooseRandomRecord`. When the chooser returns `null` because a type filter matched
   nothing, surface a message like `No ${typeLabel} ${cardKindLabel} available.`

4. **(Optional, do only if cheap) symmetry for replacements.** `createReplacementCard`
   (search it) builds a `replacement` from `{ cardKind, name }`; it also calls
   `chooseRandomRecord`. Accept `replacement.types` and forward it, so
   `replace-random-card` / `replace-selected-card` can also constrain by type. Skip if it
   complicates the core change.

5. **(Optional stretch — ties to TODO #5) location-themed default.** Support a sentinel
   so an event can say "use this location's types" without hardcoding, e.g.
   `types: "location"` → resolve to `run.location.types` at apply time (available via
   `run.location`). Document it if implemented.

## Data & validation

- **Schema doc:** update the `data` skill's event-effect reference to describe the new
  optional `types`/`type` field on `gain-random-card` (and `replacement.types` if added).
- **Enum check:** canonical type names live in `scripts/data_options.js` (CommonJS
  canonical enums per `CLAUDE.md`). In `tests/data_validation.test.js`, add a check that
  every `types`/`type` value used in `events.json` is a valid type name — fail the suite
  on typos.
- **Authoring:** edit `events.json` **directly** (never via `scripts/manage_*`). Update
  or add a themed event that uses the new field, e.g.
  `{ "type": "gain-random-card", "cardKind": "attack", "types": ["FIRE"], "amount": 1 }`.

## Tests

- Unit test (extend `tests/run_progression.test.js` or add a small events test; the
  engine loads in Node via `tests/helpers/`): apply a `gain-random-card` with
  `types:["FIRE"]` many times and assert **every** granted attack has `type1`/`type2`
  equal to `FIRE`. Assert an unmatched type grants nothing (no off-type card).
- `node tests/run_all.js` green (syntax + suite + data validation).

## Verify
- [ ] Author a test event granting a typed random attack; trigger it in a run and confirm
      via `window.CardArena`/`verify` (or the Node harness) that the granted card is on-type.
- [ ] `node tests/run_all.js` green.

## Out of scope
Reworking the named-card or selection-based effects; a new reward UI; balancing which
attacks exist; the mobile-polish sessions (08–14).
