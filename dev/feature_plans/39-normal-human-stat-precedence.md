# Phase 39 — NORMAL overrides HUMAN: explicit stat-change precedence + regression tests

**Recommended agent:** Sonnet · low effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** A NORMAL-typed pokemon never receives the HUMAN ×2 stat-change multiplier (the
HUMAN ability is skipped entirely, not merely clamped afterwards); NORMAL stays capped at
±1 stage per attack; tests lock both behaviors.

## Context you need

- Type abilities live in `arena/arena_model.js`: constants
  `NORMAL_STAT_CHANGE_LIMIT = 1` and `HUMAN_STAT_CHANGE_MULTIPLIER = 2` (~50–51).
- `getStatChangesForPokemon(card, statChanges)` (~1307) nets deltas per stat and adjusts
  each via `getAdjustedStatChangeDelta(card, delta)` (~1329), currently:
  ```js
  const humanAdjustedDelta = pokemonHasType(card, 'HUMAN')
      ? delta * HUMAN_STAT_CHANGE_MULTIPLIER
      : delta;
  return pokemonHasType(card, 'NORMAL')
      ? clampNormalStatChangeDelta(humanAdjustedDelta)
      : humanAdjustedDelta;
  ```
  For today's integer deltas double-then-clamp happens to equal clamp-alone, so this
  change is behavior-preserving in practice — the point is explicit precedence
  (owner rule: "NORMAL overrides HUMAN") plus regression tests that lock it.
- `clampNormalStatChangeDelta` (~1339) clamps to ±`NORMAL_STAT_CHANGE_LIMIT` — the
  "±1 stage per attack" rule already exists; do not change it.
- Entry point for tests: `arena.Model.getStatChangesForPokemon(card, tokens)` takes stat
  change tokens (e.g. `['ATTACK_UP']`) and returns the adjusted token list (HUMAN
  doubling returns the token twice). Fixture pattern: imitate the card factories used in
  `tests/arena_model.test.js` / `tests/arena_controller.test.js` (types live on the
  card's pokemon record).

## Steps

- [ ] 1. **`arena/arena_model.js`** — restructure `getAdjustedStatChangeDelta`:
  ```js
  function getAdjustedStatChangeDelta(card, delta) {
      if (pokemonHasType(card, 'NORMAL')) return clampNormalStatChangeDelta(delta);
      if (pokemonHasType(card, 'HUMAN')) return delta * HUMAN_STAT_CHANGE_MULTIPLIER;
      return delta;
  }
  ```
  Update the nearby comment to state the precedence rule (NORMAL suppresses HUMAN).
- [ ] 2. **`tests/arena_model.test.js`** — add a test block near the existing stage tests
  (~135–163) exercising `Model.getStatChangesForPokemon`:
  (a) HUMAN-only card: `['ATTACK_UP']` → two `ATTACK_UP` tokens;
  (b) NORMAL+HUMAN card: `['ATTACK_UP']` → exactly one `ATTACK_UP` (no doubling);
  (c) NORMAL-only card: `['ATTACK_DOWN','ATTACK_DOWN']` (net −2) → exactly one
  `ATTACK_DOWN`;
  (d) a card with neither type: tokens pass through unchanged.

## Verification

- [ ] `node tests/run_all.js` green, including the four new assertions.
- [ ] No browser check required (pure model math); optional sanity: stat-change floats in
  a real battle still appear.

## Out of scope / do not touch
`STAT_CHANGE_DELTAS`, stage bounds (−6..+6) and multipliers, the FIGHTING status
ability, controller-side stat application (`applyStatChangesToTargets`), effect-boost
chance logic.
