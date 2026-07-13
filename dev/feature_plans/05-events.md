# Phase 5 — Events: location gating + seeded events

**Prereqs:** phases 2–3. **Read first:** `00-overview.md`.
**Goal:** events declare pokemon types; the event pool is filtered by the current
location's types; ~6 seeded events make event nodes actually spawn; events.json
gets real schema validation. Ends green + playable.

## Context you need

- `events.json` is currently `[]` — the framework is fully built but event nodes
  never spawn (`getRandomLocationTypes`/`includeEvents` drops the event weight when
  no events exist).
- `map/event_effects.js` (`window.PokeEvents`): `getAvailableEvents(gameData)`
  (~11–20) filters enabled/id/type ∈ {gift, choice, trainer};
  `chooseEvent(gameData)` (~22–28) is a uniform pick that **ignores a second
  argument its callers already pass** (`chooseEvent(arena.GameData, state.run)` in
  `map/area.js` `getOrCreateEventEncounter` ~904 and `sanitizeEventEncounter`
  ~1109) — that's your seam. `getEventById` (~30) resolves saved encounters and
  must stay ungated. Effect dispatch switch ~221–261; requirement/effect blocking
  ~105–219.
- Event schema (authoring reference is `scripts/manage_events.js`, the effect
  builders ~181–321 — read them for EXACT field names; do not guess): common
  `{type, title, id, kicker?, subtitle?, body, resultTitle?, enabled}`; gift
  `{buttonText?, effects[]}`; choice `{choices[{title, id, description?,
  buttonText?, requires[], effects[]}]}`; trainer `{trainerName, battleTitle?,
  battleText?, battleButtonText?, rewardCash?, rewardEffects[], payment?}`.
- `arena/arena_data.js` `normalizeEvent` (~418) is a passthrough.
- `hasAvailableEvents` in `map/area.js` (~1608) feeds `includeEvents` into graph
  generation (phase 3).
- Special-rank trainers exist for trainer events: **Giovanni** (GROUND), **Mecha
  Cop** (STEEL).
- `tests/data_validation.test.js` currently only asserts events.json is an array.

## Steps

- [ ] 1. **Gating (`map/event_effects.js`):** `getAvailableEvents(gameData,
  locationTypes)` — when `locationTypes` is a non-empty array, additionally require
  `!event.types || event.types.length === 0 || event.types.some(t =>
  locationTypes.includes(t))`; `undefined` keeps today's behavior (so
  `getEventById` and any restore path stay ungated). `chooseEvent(gameData, run)`
  uses its existing second arg: `run?.location?.types` → pass through. Keep the
  public `window.PokeEvents` surface otherwise identical.
- [ ] 2. **`map/area.js`:** `hasAvailableEvents` passes `state.run.location.types`
  so event-node generation goes per-location (the phase-3 `includeEvents` flag now
  varies by location).
- [ ] 3. **`arena/arena_data.js`:** `normalizeEvent` normalizes `types` to
  uppercase strings when present (reuse the same type helper as locations),
  otherwise passthrough.
- [ ] 4. **Seed `events.json`** (direct edit — owner-authorized) with 6 events.
  Semantics below; build the exact effect objects by mirroring
  `manage_events.js`'s builders and validating against the dispatch switch:
  1. gift `berry-cache` "Berry Cache" — no `types` (universal): gain 1 Sitrus
     Berry.
  2. gift `message-in-a-bottle` — types [WATER, ICE]: gain cash.
  3. choice `wandering-trader` — universal: option A trade a random pokemon,
     option B lose cash + gain a random attack card.
  4. choice `volcanic-vent` — types [FIRE, ROCK, GROUND]: risky option loses
     random cards but gains a random card; safe option small cash.
  5. trainer `team-rocket-ambush` — types [GROUND, DARK, POISON]:
     `trainerName: "Giovanni"`, reward cash + a reward effect.
  6. trainer `rogue-mecha-cop` — types [STEEL, ELECTRIC, HUMAN]:
     `trainerName: "Mecha Cop"`, include a `payment` alternative.
  Keep copy short and in the game's existing voice (look at trainer/mart strings).
- [ ] 5. **Extend `scripts/manage_events.js`** (owner-authorized exception to
  AGENTS.md — this one field only): in the Add flow, an optional "location types"
  multi-prompt (repeated enum pick over `PokeType` minus NONE/LEGENDARY, blank to
  finish, empty = universal) stored as `types`; show types in the List view.
  Match the file's existing helper style. **Never run it** (`node --check` only).
- [ ] 6. **Tests:**
  - `tests/data_validation.test.js` — replace the is-array placeholder with full
    schema validation: unique non-empty ids; `type` ∈ {gift, choice, trainer};
    title/body non-empty strings; `types`, when present, valid PokeTypes (no
    NONE/LEGENDARY); every effect `type` (including nested in choices, rewards,
    payment) ∈ the event_effects vocabulary (hardcode the list in the test —
    grep the dispatch switch for it); choice events have ≥1 choice; trainer
    events reference an existing trainers.json name; ≥1 trainer event exists.
  - `tests/run_progression.test.js` — gating: typed vs universal events against
    various locationTypes; `getAvailableEvents` with `undefined` = ungated;
    `chooseEvent(gameData, run)` only returns events matching
    `run.location.types`; a location whose types match no event + no universal
    events → `hasAvailableEvents` false.

## Verification

1. `node tests/run_all.js` green.
2. Browser (verify skill): new runs on a WATER location eventually generate event
   nodes (weights make this common; check the generated graph via localStorage
   instead of walking the map); enter an event node → event page renders one of
   the seeds appropriate to the location; complete the Giovanni trainer event
   end-to-end (battle launches with Giovanni, rewards apply, return to map). A
   FIRE-location run never rolls the water-only gift (assert by inspecting
   several generated graphs'/encounters' event ids via the driver).

## Out of scope / do not touch
Event effect engine (`applyEffects` and below), new effect types, event UI
(event.html/event.js rendering), theming.
