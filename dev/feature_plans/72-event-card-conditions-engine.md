# Phase 72 — Event card conditions: engine

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `70-event-card-conditions-overview.md`.
**Goal:** `map/event_effects.js` understands `conditions` — an action with an unmet
condition reports a reason instead of applying, and an event with unmet top-level
conditions is never picked by `chooseEvent`. Covered by a new Node test file. Ends green;
nothing visible changes in the browser yet (that is phase 73).

## Context you need

Everything happens in **`map/event_effects.js`** (804 lines, a `window`-namespace IIFE
exporting `global.PokeEvents`). Read the overview's "Locked spec" for the condition shape
before starting.

The functions you touch, with drift-prone line hints:

- `chooseEvent` (~54) — already filters by `poolSatisfied`; you add a second filter.
- `getEventActions` (~84) — builds the action objects for gift / choice; you add one
  `conditions:` field to each. Keys in these object literals are **alphabetical** — keep
  that.
- `getTrainerPaymentAction` (~120) — same, for the payment action.
- `getActionRequirements` (~133) / `getRequirementById` (~137) — the new accessors go
  between them.
- `getBlockedReason` (~153) — the single choke point `applyAction` runs before applying
  effects. Your check goes at the very top, before the requirements loop.
- `normalizeRequirements` (~740) — `normalizeConditions` goes directly above it.
- `global.PokeEvents = { … }` (~790) — alphabetically sorted export list.

Private helpers you will call (already in the file, no changes needed):
`getCardsByKind(run, cardKind)`, `getCardName(card)`, `normalizeCardKind(cardKind)`.

The whole diff below was prototyped and passed a Node exercise during planning — apply it
as written rather than re-deriving it.

## Steps

- [ ] 1. **`map/event_effects.js`** — add `normalizeConditions` immediately **above**
  `normalizeRequirements`:

  ```js
      function normalizeConditions(conditions) {
          return (Array.isArray(conditions) ? conditions : [])
              .filter(condition => condition && typeof condition.name === 'string' && condition.name.trim() !== '')
              .map(condition => ({
                  cardKind: normalizeCardKind(condition.cardKind || condition.kind),
                  mode: condition.mode === 'lacks' ? 'lacks' : 'has',
                  name: condition.name.trim(),
                  text: typeof condition.text === 'string' ? condition.text : ''
              }));
      }
  ```

- [ ] 2. **`map/event_effects.js`** — add the three accessors between
  `getActionRequirements` and `getRequirementById`:

  ```js
      // Event-level card gates. Applied in chooseEvent only (like poolSatisfied),
      // so an already-saved encounter still resolves via getEventById.
      function eventConditionsMet(run, eventRecord) {
          return getUnmetConditionReason(run, eventRecord) === '';
      }

      function getActionConditions(action) {
          return normalizeConditions(action && action.conditions);
      }

      // Card-ownership gates. Unlike a requirement (which renders a picker), a
      // condition selects nothing: it only reports why an action is unavailable.
      function getUnmetConditionReason(run, action) {
          for (const condition of getActionConditions(action)) {
              const owned = runHasCardNamed(run, condition.cardKind, condition.name);

              if (condition.mode === 'lacks' && owned) {
                  return condition.text || `You already have ${condition.name}.`;
              }

              if (condition.mode === 'has' && !owned) {
                  return condition.text || `Requires ${condition.name}.`;
              }
          }

          return '';
      }

      function runHasCardNamed(run, cardKind, name) {
          return getCardsByKind(run, cardKind).some(entry => getCardName(entry.card) === name);
      }
  ```

- [ ] 3. **`map/event_effects.js`** — in `getEventActions`, add `conditions:` to the gift
  action (right after `buttonText:`), reading the **event-level** list:
  `conditions: normalizeConditions(eventRecord.conditions),`
  Per the locked spec this is intentional: a gift event's claim button inherits the
  event-level conditions.

- [ ] 4. **`map/event_effects.js`** — in `getEventActions`, add to each mapped choice
  (right after `buttonText:`): `conditions: normalizeConditions(choice.conditions),`

- [ ] 5. **`map/event_effects.js`** — in `getTrainerPaymentAction`, add (right after
  `buttonText:`): `conditions: normalizeConditions(eventRecord.payment.conditions),`

- [ ] 6. **`map/event_effects.js`** — guard `getBlockedReason`. It must be the **first**
  thing in the function, above `const requirements = …`:

  ```js
          const unmetConditionReason = getUnmetConditionReason(run, action);

          if (unmetConditionReason) return unmetConditionReason;
  ```

- [ ] 7. **`map/event_effects.js`** — filter the event pool in `chooseEvent`, replacing the
  single-line `const events = …` with:

  ```js
          const events = getAvailableEvents(gameData, location)
              .filter(event => poolSatisfied(event, gameData))
              .filter(event => eventConditionsMet(run, event));
  ```

  Do **not** touch `getAvailableEvents` or `getEventById` — a saved encounter must still
  resolve after the run stops qualifying.

- [ ] 8. **`map/event_effects.js`** — export `eventConditionsMet`, `getActionConditions`
  and `getUnmetConditionReason` from `global.PokeEvents`, keeping the list alphabetical
  (the first two go just after `chooseEvent`; `getUnmetConditionReason` goes last, after
  `getTrainerPaymentAction`).

- [ ] 9. **`tests/event_conditions.test.js`** — new file. Copy the loading preamble from
  `tests/baby_event.test.js` (it aliases `window` to `globalThis` via
  `helpers/arena_env`, then requires `map/locations`, `map/run_state`,
  `map/event_effects`; `const R = globalThis.PokeRun; const E = globalThis.PokeEvents;`).
  Build fixtures locally — do not depend on live JSON. Helpers to reuse:

  ```js
  function mon(name, id, types) {
      return {
          name, id,
          type1: types[0] || 'NONE', type2: types[1] || 'NONE', type3: types[2] || 'NONE',
          baseHealth: 10, baseAttack: 10, baseDefense: 10, baseSpeed: 10
      };
  }

  function newRun() {
      return R.createRunState({ area: { nodes: [{ id: 'start' }], edges: [] }, collections: {} });
  }
  ```

  Give a run a specific card with
  `E.applyEffects(run, [{ type: 'gain-card', cardKind: 'pokemon', name: 'Rotom', count: 1 }], {}, { gameData, runStore: R })`
  where `gameData = { pokemon: [...], attacks: [], items: [...] }`.

- [ ] 10. **`tests/event_conditions.test.js`** — cover all of these (each was confirmed to
  pass against the prototype, so a red one means the edit above drifted):
  - `has` unmet → `getUnmetConditionReason` returns `'Requires Rotom.'`; met → `''`.
  - `lacks` blocks only once the card is owned → `'You already have Rotom Wash.'`.
  - `getBlockedReason` returns the same reason, and `applyAction(...).ok === false` with
    no mutation of the run.
  - once the condition is met, `applyAction(...).ok === true`.
  - a custom `text` overrides the generated message.
  - `cardKind: 'item'` ownership is found after `gain-card` of an item (items live in
    `collections.actions`).
  - malformed entries (`null`, `{}`, `{ name: '   ' }`) are dropped; a bare `{ name: 'X' }`
    normalizes to `mode: 'has'` and `cardKind: 'attack'`.
  - an action with no `conditions` is unaffected (`getBlockedReason` → `''`).
  - `chooseEvent` never returns an event whose top-level `conditions` are unmet (loop 300
    rolls against a two-event pool) and does return it once they are met.
  - `getEventById` still resolves that gated event (saved-encounter restore path).
  - `E.chooseEvent(gameData, {})` — a bare `{}` run, as older callers pass — does not throw.

- [ ] 11. **`tests/event_conditions.test.js`** — add one **live-data** guard against
  over-gating, in the style of `tests/baby_event.test.js`'s real-data test
  (`await loadRealGameData()`, then use `arena.GameData`). Assert that a run holding **no
  cards at all** — the harshest case — can still be offered at least one event:

  ```js
  test('live events.json is never fully gated: a card-less run can still be offered an event', async () => {
      await loadRealGameData();
      const run = newRun();

      const offered = new Set();
      for (let i = 0; i < 200; i += 1) {
          const chosen = E.chooseEvent(arena.GameData, run);
          if (chosen) offered.add(chosen.id);
      }

      assert.ok(offered.size > 0, 'every authored event is condition-gated: event nodes would show "No events are available."');
  });
  ```

  This is the tripwire for the owner gating every event on owning something. It passes
  today (no authored event carries `conditions` yet) and stays meaningful as they add them.

## Verification

- [ ] `node --check map/event_effects.js` passes.
- [ ] `node --test tests/event_conditions.test.js` — all new tests pass.
- [ ] `node tests/run_all.js` green (syntax check of every tracked JS + the full suite).
  In particular `tests/baby_event.test.js` must still pass: it calls
  `chooseEvent(gameData, {})` and `chooseEvent(gameData, run)` and proves the new filter
  did not change behavior for events without conditions.
- [ ] `git diff --stat` shows exactly two paths touched: `map/event_effects.js` and the new
  `tests/event_conditions.test.js`.

## Out of scope / do not touch

`map/event.js` (phase 73), `dev/editor/**` (phases 74–75), `dev/editor/validate.js` and the
data-validation tests (phase 75), `events.json` (the owner authors content — this phase adds
**no** real event), `static/styles.css`. Do not add a "consume the named card" effect; the
owner ruled it out. Do not change `getAvailableEvents`, `getEventById`, `poolSatisfied`,
`normalizeRequirements`, or any existing effect type.
