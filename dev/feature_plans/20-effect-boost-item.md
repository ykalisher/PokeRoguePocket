# Phase 20 — Standalone effect-boost item

**Recommended agent:** Opus · medium effort
**Prereqs:** none (independent of 19). **Read first:** `18-mechanics-symbols-roster-overview.md`.
**Goal:** A new **standalone** item (NOT a dragon gem) applies a persistent side-wide "effect
boost." While a side has it, that side's attacks (a) double the trigger chance of their
secondary status effects, (b) double the trigger chance of their stat changes, and (c) bias
multi-hit toward more hits. Ends green + playable.

## Context you need

- Anchors are hints captured 2026-07-14; find by function name. Constants live in
  `arena/arena_data.js` `arena.Constants` (~`:48-57`): `STATUS_TRIGGER_CHANCE=1/3`,
  `STAT_CHANGE_TRIGGER_CHANCE=1/3`, `MULTI_ATTACK_MIN_HITS=2`, `MULTI_ATTACK_MAX_HITS=6`.
- **The three roll sites to modify** (all in `arena/arena_controller.js`, all reached from
  `resolveAttackAction` ~`:1855`, which has `action.owner` = the attacking side's id):
  - `maybeApplyAttackStatuses(actionCard, targets, isDamaging, extraStatuses)` (~`:2287`):
    `if (isDamaging && Math.random() >= STATUS_TRIGGER_CHANCE)`.
  - `maybeApplyAttackStatChanges(actionCard, targets, isDamaging, triggerChance)` (~`:2465`):
    `if (isDamaging && Math.random() >= triggerChance)`.
  - `getRandomMultiAttackHitCount()` (~`:2188`), called by `resolveMultiAttackDamage(actionCard,
    targets, attacker)` (~`:2165`). Today it is **uniform over 2–6** —
    `MIN + Math.floor(Math.random() * (MAX-MIN+1))` — NOT weighted toward 2–3 as the owner
    assumed. The boost biases it high; you may also make the *unboosted* baseline lean 2–3 (it
    matches the owner's mental model and real multi-hit moves), but keep MIN/MAX at 2–6.
- **Item plumbing (mirror the Dragon Gem, which is the existing SIDE / no-target item):**
  `applyItemCard(itemCard, selection, actorId)` (~`:1980`) routes gems specially at ~`:1981`
  (`if (isDragonGemItemCard) return applyDragonGemItemEffect(...)`). The gem stores a per-side
  effect on `player.dragonGems` via `model.addDragonGemEffect` (`arena/arena_model.js` ~`:900`),
  read with `model.getDragonGemEffects(playerId)` (~`:920`). Opponent AI picks items in
  `chooseOpponentItem` (~`:1293`). Item cards are `{ name, target, status[], statChanges[] }`
  (`items.json` + the `arena_data.js` fallback list ~`:273` where the 6 gems live).
- **Icon rendering:** `STATUS_DEFINITIONS` (`arena/arena_model.js` ~`:58-82`) maps a status →
  icon; `getStatusIconPath` returns `''` (→ text badge) when a status has no entry. Existing
  side-marker UI to imitate for showing the active boost: the dragon-gem tray
  (`renderDragonGemTray`, `arena/arena_render.js` ~`:149`).

## Steps

- [ ] 1. **`items.json` + `arena/arena_data.js`** — add the item to both (mirror the gems at
  arena_data ~`:273`). Shape: `{ "name": "<pick a unique name, e.g. Effect Amplifier>",
  "target": "SIDE", "status": ["EFFECT_BOOST"], "statChanges": [] }`. Register `EFFECT_BOOST`
  as a battle status (so `isBattleStatus` accepts it) but keep it OUT of the
  `DRAGON_GEM_EFFECTS_BY_STATUS` gem map — it is not a gem.
- [ ] 2. **`arena/arena_model.js`** — add a per-side boost store analogous to `dragonGems`
  (e.g. `player.effectBoost = true`) plus helpers: an application call (set the flag) and
  `hasEffectBoost(playerId)` (read it). Include the field in player init/normalize (~`:129`,
  `:368`) so it round-trips. The boost persists for the rest of the battle.
- [ ] 3. **`arena/arena_controller.js`** — route the new item. In `applyItemCard` add a branch
  (mirror the gem branch at ~`:1981`) that detects the effect-boost item (by its `EFFECT_BOOST`
  status + `SIDE` target) and sets the side flag instead of resolving per-target. Ensure it
  plays **without target selection** the way the gem does (a SIDE item has no per-Pokémon
  target — mirror the gem's no-target handling in the targeting/`usePendingItem` path). The
  physical card **discards normally** (only gems are no-discard — that's phase 19).
- [ ] 4. **`arena/arena_controller.js`** — apply the boost at the three roll sites. Compute
  `const boosted = model.hasEffectBoost(action.owner);` in `resolveAttackAction` and thread it
  in:
  - `maybeApplyAttackStatuses`: use `boosted ? Math.min(1, STATUS_TRIGGER_CHANCE * 2) : STATUS_TRIGGER_CHANCE`.
  - `maybeApplyAttackStatChanges`: pass a doubled `triggerChance` (`Math.min(1, base * 2)`) when boosted.
  - `getRandomMultiAttackHitCount(boosted)` — replace with a weighted roll, e.g. weights
    index-aligned to hits `[2,3,4,5,6]`: unboosted `[4,4,2,1,1]`, boosted `[1,2,4,4,3]`
    (tune to taste; boosted must clearly favor 4–5). Pass `boosted` from `resolveMultiAttackDamage`
    (it has `attacker`; get the owner from `action.owner` at the call site).
- [ ] 5. **`arena/arena_controller.js`** — let the opponent AI play it in `chooseOpponentItem`
  (~`:1293`): return the effect-boost item as a no-target side play (like the gem branch) when
  the opponent's side isn't already boosted.
- [ ] 6. **Icon + indicator** — hand-author `assets/status-icons/EFFECT_BOOST.svg` (simple
  monochrome glyph matching `assets/status-icons/BURN.svg`'s viewBox/weight) and add a
  `STATUS_DEFINITIONS` entry (`showsToken:false`, mirror `MULTI_ATTACK` at ~`:74`). Show the
  active boost on the owning side (mirror the dragon-gem tray marker) so players can see it's up.
- [ ] 7. **`tests/`** — add Node tests (`require('./tests/helpers/arena_env')`): stub
  `Math.random` to prove a low-chance status/stat-change triggers under boost where it wouldn't
  unboosted; and assert the weighted multi-hit distribution trends higher when boosted than
  when not (sample many rolls with a seeded/stubbed RNG).

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill (serve on 8931): play the item, then attack with a move that has a
  secondary effect (e.g. a burn-chance attack) → the effect lands far more often; the side
  shows a boost indicator; a multi-hit attack trends toward 4–5+ hits.
- [ ] The opponent AI can play the item and gets the same boost on its side.

## Out of scope / do not touch

Not a dragon gem — do not touch `DRAGON_GEM_EFFECTS_BY_STATUS`, `addDragonGemEffect`, or phase
19's gem no-discard change. Do not alter the base constant values in `arena_data.js` (double at
the read site, not the source). Do not change other items' behavior. Inherit all batch ground
rules from `18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`,
no `TODO.md`, no third-party deps, run `node tests/run_all.js` after every change).
