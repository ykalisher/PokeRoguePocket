# Phase 47 — Baby-grant event

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 42 (baby pool helpers). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** A new map event grants one random BABY pokemon — and it is only ever *offered*
when the baby pool is non-empty. Since no baby data exists yet, the event is provably
inert today and lights up automatically once the owner authors baby cards.

## Context you need

- Event data: `events.json` records with `type` ∈ `trainer|gift|choice`. A gift event
  looks like (see `berry-cache`):
  `{ type:'gift', title, id, kicker, subtitle, body, resultTitle, buttonText,
  effects:[...], enabled:true }`. An optional top-level `types` array restricts it to
  location types — omit it so the event can appear anywhere.
- Event engine `map/event_effects.js`: `getAvailableEvents` (~11) →
  `chooseEvent(gameData, run)` (~31) picks the event for a node; `getEventById` (~43)
  re-resolves *saved* encounters — **gate availability in `chooseEvent`, NOT in
  `getAvailableEvents`/`getEventById`**, so an already-saved encounter still resolves
  even if the pool empties later. Effects dispatch in `applyEffect` (~231); blocked
  reasons in `getEffectBlockedReason` (~181); random grants use `chooseRandomRecord` +
  `createCardsFromRecord` + the add-to-run path (~292).
- Effect labels shown in the event UI: `describeEffect` in `map/event.js` (~583–601) —
  new effect types need a label line there.
- Effect-type whitelists to extend: `VALID_EFFECT_TYPES` in
  `tests/data_validation.test.js` (~154) and `DEFAULT_EFFECT_TYPES` in
  `dev/editor/validate.js` (~24).
- Baby pool: `PokeLocations.getBabyPokemonPool(gameData)` (phase 42); access it guarded
  (`global.PokeLocations && ...`) inside `event_effects.js`.

## Steps

- [ ] 1. **`events.json`** — add a gift event: id `nursery-egg`, title
  `"Nursery Surprise"`, flavor about a day-care worker entrusting you with a mysterious
  egg that hatches on the spot; a new optional top-level field `requiresPool: "baby"`;
  `effects: [{ "type": "gain-random-baby" }]`; `enabled: true`; no `types` field.
- [ ] 2. **`map/event_effects.js`** — in `chooseEvent`, after collecting available
  events, filter out any event whose `requiresPool === 'baby'` when the baby pool is
  empty (write it as a small `poolSatisfied(event, gameData)` helper so future pools
  slot in). Add an `applyEffect` case `'gain-random-baby'`: uniform pick from
  `getBabyPokemonPool(gameData)`, create and add exactly one pokemon card via the
  existing record→card path, summary `Gained <name>.`. Add a
  `getEffectBlockedReason` branch: empty pool → `'No baby Pokemon are available.'`.
- [ ] 3. **`map/event.js`** — `describeEffect`: add
  `if (effect.type === 'gain-random-baby') return 'Gain a random baby Pokemon';`.
- [ ] 4. **`tests/data_validation.test.js`** and **`dev/editor/validate.js`** — add
  `'gain-random-baby'` to the effect-type whitelists (and, if an event-schema field
  allowlist exists, permit `requiresPool` — grep first).
- [ ] 5. **`tests/baby_event.test.js`** (new, via `tests/helpers/arena_env.js`; require
  `map/locations.js` then `map/event_effects.js`) — with real data (zero babies):
  `chooseEvent` over many rolls never returns `nursery-egg`; with fixture gameData
  containing a baby: it can be chosen, `applyEffect('gain-random-baby')` adds exactly
  one BABY-typed pokemon card to the run and returns a summary; the blocked reason
  fires on an empty pool; `getEventById('nursery-egg', ...)` still resolves regardless
  of pool state.

## Verification

- [ ] `node tests/run_all.js` green — this is the proof the event is inert against live
  data with zero babies.
- [ ] Browser check deferred by design: there is no baby data to trigger it live.
  Phase 48's verify covers the injected-fixture pattern; note that here and move on.

## Out of scope / do not touch
Authoring real baby/mega species; evolution mechanics (48); other events' availability;
event art/theming; the wandering-trader pools (42 already filters them).
