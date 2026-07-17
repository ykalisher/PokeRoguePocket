# Phase 40 — Rival AI: KO-aware attack targeting and status-attack targeting

**Recommended agent:** Sonnet · high effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** The rival still uses the first legal attack per attacker (unchanged), but aims
it intelligently: damaging attacks prefer a guaranteed-KO target, else the fewest-hits-to-
KO target; pure status attacks target the non-statused pokemon with the highest effective
Attack — except paralysis, which targets the highest Speed. All covered by unit tests.

## Context you need

- **Current behavior** — `arena/arena_controller.js`:
  - `chooseOpponentAttacks` (~1225) picks the FIRST usable attack card in hand
    (`opponent.hand.find(...)`) per board pokemon. **Do not change attack selection.**
  - `chooseOpponentTarget(attackCard, userCard)` (~1604) picks the target:
    ```js
    const preferredGroup  = options.find(o => o.kind === 'group'  && o.owner === 'player');
    const preferredSingle = options.find(o => o.kind === 'single' && o.owner === 'player');
    const fallback = options[0];
    return preferredGroup || preferredSingle || fallback || null;
    ```
    `options` come from `model.getTargetOptionsForAction(attackCard, 'opponent',
    userCard.id)` in board order, so single-target attacks always hit the leftmost player
    pokemon. **The function returns an option object (`{kind, owner, cardId}`), not a
    card** — your new logic must resolve cards for scoring but return the matching
    option. Resolve via `model.getBoardCardById(option.owner, option.cardId)` (precedent:
    `chooseStatusItemTarget` ~1461, `chooseDamagedAllyTarget` ~1481).
- **Damage math** — `damagePokemon(ownerId, pokemonCard, attackerCard, actionCard)`
  (~2178): early-returns if `isProtectedFromDamage(pokemonCard)` (~2255); damage stat is
  `defense` when `attackUsesDefenseAsDamageStat(actionCard)` (STEEL, ~2251) else
  `attack`; `attackUsesBaseStatsOnly(actionCard)` (ICE, ~2247) switches to base stats;
  `damage = Math.max(1, Math.ceil(statRatio * basePower * getDamageVarianceMultiplier()))`
  where variance is 0.35–0.45 (~2243).
- **Status primitives**: `getBattleStatuses(actionCard)` returns the persistent battle
  statuses an action inflicts (used for items at ~1448); a pokemon's own statuses via
  `model.getPokemonStatuses(card)` / `model.hasPokemonStatus(card, 'PROTECT')`; stats via
  `model.getPokemonEffectiveStat(card, 'attack')` and `model.getPokemonSpeed(card)`;
  remaining HP is `card.currentHealth`. Base power: `attackCard.attack.basePower`.
- **Test hooks**: append exports to the `// Exposed for tests:` block (~3347) with a
  phase-40 comment, mirroring the phase-20/21 entries.

## Steps

- [x] 1. **`arena/arena_controller.js`** — extract the deterministic core of
  `damagePokemon` into a pure `computeAttackDamage(attackerCard, targetCard, actionCard,
  varianceMultiplier)`: same stat selection and formula, parameterized variance, **no**
  mutation, no Protect check, no clamping to remaining HP. Rewire `damagePokemon` to call
  it with `getDamageVarianceMultiplier()` — resulting battle behavior must be identical.
- [x] 2. **`arena/arena_controller.js`** — rewrite only the single-target branch of
  `chooseOpponentTarget`, keeping the group preference and the `options[0]`/`null`
  fallbacks exactly as they are. Build `candidates` = single options with
  `owner === 'player'` resolved to their cards (skip unresolvable). Then:
  - **Status rule** — if `getBattleStatuses(attackCard).length > 0` and
    `(Number(attackCard.attack.basePower) || 0) === 0`: among candidates whose
    `model.getPokemonStatuses(card).length === 0`, pick the highest
    `getPokemonEffectiveStat(card, 'attack')` — unless the inflicted statuses include
    `'PARALYSIS'`, then pick the highest `getPokemonSpeed(card)`. If every candidate
    already has a status, fall through to the damage rule.
  - **Damage rule** — guaranteed-KO set = candidates where
    `!model.hasPokemonStatus(card, 'PROTECT')` and
    `computeAttackDamage(userCard, card, attackCard, 0.35) >= card.currentHealth`
    (0.35 = minimum variance, so the KO is certain). If non-empty, pick the KO-able
    candidate with the highest effective Attack (kill the biggest threat; tie → board
    order). Otherwise pick the candidate minimizing
    `card.currentHealth / computeAttackDamage(userCard, card, attackCard, 0.40)`,
    treating PROTECT-ed candidates as `Infinity` (tie → board order; if all are
    `Infinity` just keep board order).
  Return the *option* corresponding to the chosen card. Update the module header comment
  (~28) that describes the AI.
- [x] 3. **`arena/arena_controller.js`** — export `chooseOpponentTarget` and
  `computeAttackDamage` in the `// Exposed for tests:` block.
- [x] 4. **`tests/arena_controller.test.js`** — add targeting tests with the existing
  fixture helpers (`makePokemonCard`/`makeAttackCard`, seeded boards): (a) a 5-HP target
  is chosen over a healthy one (guaranteed KO); (b) with no KO available, a frail
  low-defense target beats a high-defense tank; (c) a basePower-0 sleep attack targets
  the non-statused pokemon with the higher Attack and skips an already-statused one;
  (d) a basePower-0 paralysis attack targets the highest Speed; (e) a PROTECT-ed target
  is avoided when an alternative exists; (f) with every enemy statused, a status attack
  still returns a target (damage-rule fallback); (g) empty candidate list still returns
  `null` safely.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `verify` skill: run a battle with the committed autoplay driver
  (`dev/verify/`); via the battle log / `window.CardArena.state`, confirm an opponent
  attack lands on a weakened (non-leftmost) pokemon at least once.

## Out of scope / do not touch
Attack *selection* (`hand.find` in `chooseOpponentAttacks`); the item-AI family
(`chooseOpponentItemTarget` and friends); group-target handling; the damage formula's
numbers; player-side logic; artificial attacks.
