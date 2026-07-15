# Phase 21 — Sleep guarantees a missed turn

**Recommended agent:** Sonnet · medium effort
**Prereqs:** none. **Read first:** `18-mechanics-symbols-roster-overview.md`.
**Goal:** A Pokémon put to sleep always fails its first wake attempt on its own next turn, so
it reliably misses at least one turn of attacking. The wake ladder otherwise stays as designed
(first attempt fails; attempts 2–3 can wake at `SLEEP_WAKE_CHANCE=0.5`; attempt 4 guarantees a
wake). Ends green.

## Context you need

- Anchors are hints captured 2026-07-14; find by function name. All logic is in
  `arena/arena_controller.js` + the SLEEP status shape in `arena/arena_model.js`.
- **The bug.** `resolveSleepAttempt(attacker)` (~`:1693`) is correct: it increments
  `wakeAttempts`, stamps `lastWakeAttemptTurn = state.turnNumber`, and only allows waking when
  `wakeAttempts > 1` (`mustWake` at `wakeAttempts >= SLEEP_GUARANTEED_WAKE_ATTEMPT=4`). So the
  **first** attempt after falling asleep always blocks.
  The problem is `tickSleepTimersWithoutAttack()` (~`:1724`), which runs in
  `resolveEndOfTurnStatuses` (~`:2199`) for every board Pokémon that "did not try to wake this
  turn" (guard: `sleepStatus.lastWakeAttemptTurn === state.turnNumber` → skip). A Pokémon put
  to sleep **this turn** still has `lastWakeAttemptTurn === null` (SLEEP inits as
  `{ lastWakeAttemptTurn: null, wakeAttempts: 0 }`, `arena/arena_model.js` ~`:80`), so the guard
  does NOT skip it, and the tick advances `wakeAttempts` to 1 on the same turn it was slept.
  On its own next turn `resolveSleepAttempt` then sees `wakeAttempts` go 1→2, `canWake` is
  already true, and it can wake+attack immediately — never reliably missing a turn.
  This bites hardest when the opponent sleeps your active *after* your attacks already resolved
  (the turn model is: `startPlayerTurn` [increments `turnNumber`, ~`:162`] → player attacks →
  `runOpponentTurn` → `resolveEndOfTurnStatuses` → next `startPlayerTurn`).
- **The fix (recommended).** Stamp the SLEEP entry with the current turn *when it is applied*,
  so the end-of-turn tick's existing `=== state.turnNumber` guard skips it on the application
  turn. Then the Pokémon's first real wake attempt (its own next turn) is `wakeAttempts` 0→1 →
  blocked. Do this in `applyStatus` (`arena/arena_model.js` ~`:980`) for the SLEEP case — e.g.
  set `statusEntry.lastWakeAttemptTurn = state.turnNumber` after creating a SLEEP entry (the
  model owns `arena.state`, so `state.turnNumber` is available). Confirm the change does not
  break the intended cadence: a Pokémon that sleeps itself is unaffected; a Pokémon still
  asleep on later turns still ticks normally (the guard only suppresses the application turn).

## Steps

- [x] 1. **`arena/arena_model.js`** — when SLEEP is applied via `applyStatus`, stamp the new
  status entry's `lastWakeAttemptTurn` with the current `state.turnNumber` (only for SLEEP;
  leave other statuses untouched). This makes `tickSleepTimersWithoutAttack` skip the freshly
  slept Pokémon on its application turn.
- [x] 2. **`arena/arena_controller.js`** — verify `resolveSleepAttempt` (~`:1693`) and
  `tickSleepTimersWithoutAttack` (~`:1724`) need no further change with the stamp in place
  (they already key off `lastWakeAttemptTurn === state.turnNumber`). Do not weaken the
  `wakeAttempts > 1` first-fail rule.
- [x] 3. **`tests/`** — add a Node regression test (`require('./tests/helpers/arena_env')`):
  put a Pokémon to sleep on a turn where it has already acted (or is on the defending side),
  advance to its next turn, and assert its queued attack is **blocked** by sleep (does not
  fire). Add a second assertion that after the guaranteed-wake threshold it does wake.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `verify` skill (serve on 8931): apply Sleep to the rival's active Pokémon; confirm it
  cannot attack on its immediate next turn (log shows "fast asleep", no damage dealt), and can
  eventually wake on a later turn.

## Out of scope / do not touch

Do not change `SLEEP_WAKE_CHANCE` / `SLEEP_GUARANTEED_WAKE_ATTEMPT`, other status effects
(Poison/Burn/Paralysis/Confusion/Flinch), or the turn-flow order. Inherit all batch ground
rules from `18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`,
no `TODO.md`, run `node tests/run_all.js` after every change).
