# Phase 75 — Event card conditions: validation, references, docs

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phases 72 and 74 (the shape exists and the editor can write it).
**Read first:** `70-event-card-conditions-overview.md`.
**Goal:** A malformed or typo'd condition is caught by both validators (the editor's
Issues tab and `node tests/run_all.js`), a card referenced by a condition shows up in
"where is this used?", and the `data` skill documents the feature.

## Context you need

A typo'd condition is silent and nasty: `{"mode": "has", "name": "Rotomm"}` locks a choice
forever, and the `lacks` version unlocks it forever. Nothing in phases 72–74 catches it —
the engine drops or ignores bad data by design, and the editor's inline "unknown" badge is
only advisory. That is this phase's job.

**Two validators must stay in sync** (they deliberately duplicate each other):

- `dev/editor/validate.js` — powers the editor's Issues tab. `validateEvents(events,
  trainerNames, enums, locations)` at ~line 327; issue helpers `err(file, recordKey, code,
  message, field)` and `warn(...)` at ~line 32; `collectEventEffects(event)` at ~line 50 is
  the model for a conditions collector; `validateAll` (~line 659) is the only caller of
  `validateEvents` and already builds `pokemonNames` / `attackNames` / `itemNames` sets.
- `tests/data_validation.test.js` — asserts the same rules against the live JSON with plain
  `node:assert`; its event block starts ~line 200 and has its own local
  `collectEventEffects`.

`tests/editor_validation.test.js` covers `validate.js` itself: a "live data: zero
error-severity issues" test plus synthetic fixtures built by cloning `live.data` and
mutating it (see `withPokemon` ~line 38 for the pattern), and `findReferences` tests at
~line 267.

`findReferences(data, kind, name, engineRefs)` (~line 720) answers "where is this card
used?" for the editor. Each of its `'pokemon'` / `'attack'` / `'item'` branches already
walks `collectAllEffectRefs(events)` (~line 698) and pushes
`{ file: 'events.json', recordKey: event.id, field: 'effects' }`.

The condition shape is in the overview's locked spec. Rules to enforce: `mode` ∈
`has|lacks`, `cardKind` ∈ `pokemon|attack|item`, `name` a non-empty string that **exists**
in the matching data file, optional `text` a string. `cardKind` is required (not defaulted)
in *authored* data even though the engine tolerates its absence — that default is `attack`,
which is never what an author meant.

## Steps

- [ ] 1. **`dev/editor/validate.js`** — add a collector beside `collectEventEffects`, so
  every place a condition may live is covered exactly once:

  ```js
      function collectEventConditions(event) {
          const conditions = [];

          if (Array.isArray(event.conditions)) conditions.push(...event.conditions);
          if (event.payment && Array.isArray(event.payment.conditions)) conditions.push(...event.payment.conditions);
          if (Array.isArray(event.choices)) {
              event.choices.forEach((choice) => {
                  if (choice && Array.isArray(choice.conditions)) conditions.push(...choice.conditions);
              });
          }

          return conditions;
      }
  ```

- [ ] 2. **`dev/editor/validate.js`** — give `validateEvents` a fifth parameter
  `cardNames` (an object of three `Set`s keyed `pokemon` / `attack` / `item`) and, inside
  the `events.forEach` block after the existing effects loop, validate each condition.
  Every issue is an **error** (not a warning) — a bad condition silently breaks gameplay:

  ```js
              collectEventConditions(event).forEach((condition) => {
                  if (!condition || typeof condition !== 'object') {
                      issues.push(err('events.json', key, 'events.bad-condition',
                          `${key}: condition must be an object`, 'conditions'));
                      return;
                  }
                  if (!condition.name || typeof condition.name !== 'string') {
                      issues.push(err('events.json', key, 'events.bad-condition',
                          `${key}: condition needs a non-empty name`, 'conditions'));
                      return;
                  }
                  if (condition.mode !== 'has' && condition.mode !== 'lacks') {
                      issues.push(err('events.json', key, 'events.bad-condition-mode',
                          `${key}: condition mode must be has or lacks, got ${condition.mode}`, 'conditions'));
                  }
                  const names = cardNames && cardNames[condition.cardKind];
                  if (!names) {
                      issues.push(err('events.json', key, 'events.bad-condition-kind',
                          `${key}: condition cardKind must be pokemon, attack or item, got ${condition.cardKind}`, 'conditions'));
                  } else if (!names.has(condition.name)) {
                      issues.push(err('events.json', key, 'events.unknown-condition-card',
                          `${key}: condition names unknown ${condition.cardKind} ${condition.name}`, 'conditions'));
                  }
                  if (condition.text !== undefined && typeof condition.text !== 'string') {
                      issues.push(err('events.json', key, 'events.bad-condition',
                          `${key}: condition text must be a string`, 'conditions'));
                  }
              });
  ```

- [ ] 3. **`dev/editor/validate.js`** — pass the sets from `validateAll`:
  `...validateEvents(events, trainerNames, enums, locations, { attack: attackNames, item: itemNames, pokemon: pokemonNames }),`

- [ ] 4. **`dev/editor/validate.js`** — teach `findReferences` about conditions. Add a
  `collectAllConditionRefs(events)` beside `collectAllEffectRefs` returning
  `{ event, condition }` pairs (walk the same three locations as step 1), then in each of
  the `'pokemon'` / `'attack'` / `'item'` branches push a reference when
  `condition.cardKind === <that kind> && condition.name === name`, with
  `field: 'conditions'`. This is what makes the editor warn before an author renames or
  deletes a card an event gates on.

- [ ] 5. **`tests/data_validation.test.js`** — mirror step 2 against the live data: add a
  local `collectEventConditions(event)` matching step 1 and, inside the existing
  `events.forEach`, assert each condition has a valid `mode`, a `cardKind` in
  `pokemon|attack|item`, a `name` present in the matching name set (the file already builds
  or can build those sets from `pokemon`/`attacks`/`items`), and a string `text` if
  present. Keep the message style of its neighbors (`` `${event.id}: …` ``).

- [ ] 6. **`tests/editor_validation.test.js`** — add synthetic fixtures in the style of the
  existing ones (clone `live.data`, mutate, assert `hasCode(issues, …)`). One test per
  code, each starting from a valid conditioned event and breaking one thing:
  `events.bad-condition` (missing name), `events.bad-condition-mode` (`"maybe"`),
  `events.bad-condition-kind` (`"trainer"`), `events.unknown-condition-card` (a name that
  is definitely not in `pokemon.json`). Add one **negative** test too: a well-formed
  condition on a real card name produces none of those codes. Conditions on a choice and on
  `payment` must both be reached — cover at least one of each.

- [ ] 7. **`tests/editor_validation.test.js`** — add a `findReferences` test: give a cloned
  event a condition naming a real pokemon, and assert the refs include
  `{ file: 'events.json', recordKey: <that event id>, field: 'conditions' }`.

- [ ] 8. **`.claude/skills/data/SKILL.md`** — document the feature in the
  "Event effects (`events.json`)" section (~line 48), after the location-gating paragraph.
  Cover, tersely: the condition object and its four fields; that `mode` is `has`/`lacks`;
  that it is a **gate**, not a picker and not a cost (contrast with `requires`, which shows
  the player a card grid and pairs with the `*-selected-card` effects); the three places it
  may appear (`event.conditions` filters the whole event out of `chooseEvent`'s pool and
  also gates a gift's claim button; `choices[].conditions` and `payment.conditions` gray
  one button); that `name` is matched exactly against the card's current name; and that
  `cardKind` should always be written explicitly. Mention that both validators enforce the
  card name exists.

## Verification

- [ ] `node tests/run_all.js` green — including the "live data: zero error-severity issues"
  test, which proves the new rules do not fire on the real `events.json`.
- [ ] `node --test tests/editor_validation.test.js` — the new fixture tests pass, and each
  genuinely fails when its rule is removed (spot-check one by temporarily reverting step 2's
  mode check and watching it go red, then restore).
- [ ] Sanity-check the editor end: start `node dev/editor/server.js`, add a condition with a
  nonsense card name to an event in the Events tab, and confirm the Issues tab lists
  `events.unknown-condition-card` pointing at that event. Restore `events.json`
  (`git checkout -- events.json`) afterwards.
- [ ] `git status --porcelain` shows only `dev/editor/validate.js`,
  `tests/data_validation.test.js`, `tests/editor_validation.test.js` and
  `.claude/skills/data/SKILL.md` — `events.json` unchanged.

## Out of scope / do not touch

`map/**` and `dev/editor/tab_events.js` (phases 72–74), the enum payload in
`dev/editor/server.js` (`mode` is a two-value literal, not a shared enum — do not add it to
`scripts/data_options.js`), `dev/editor/tab_issues.js` (it routes `events.*` codes to the
Events tab by file already), and every unrelated validation rule. Do not author real events;
any fixture used for the manual check must be reverted.
