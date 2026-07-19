# Phase 61 — Small verified fixes: health-% floor, dragon-gem log, two micro-optimizations

**Recommended agent:** Haiku · low effort.
**Prereqs:** 58 (green baseline; independent of 59–60). **Read first:**
`57-bugfix-perf-overview.md` (Locked spec → "Phase 61 fixes").
**Goal:** four independent one-file edits land, each behavior-identical except where the fix
is the point; suite stays green.

## Context you need

- Each step below is self-contained; do them in order and run `node tests/run_all.js` after
  each. Locate code by the quoted snippets — line numbers are 2026-07-19 hints.
- Step 3 safety argument: both score functions used with the pickers
  (`model.getPokemonSpeed`, `model.getPokemonEffectiveStat`, and `computeAttackDamage` with a
  **fixed** variance argument) are deterministic, so calling them once per candidate instead
  of once per comparison cannot change which candidate wins. Ties must keep the **earliest**
  candidate (that is what the current strict `>` / `<` reduce does). The existing phase-40
  rival-AI targeting tests pin this behavior.
- Step 4 pitfall: `renderNode` is currently used as a bare `map` callback
  (`state.area.nodes.map(renderNode)`), so adding a parameter requires switching to an arrow
  callback — otherwise `map` would pass the array index as the second argument.

## Steps

- [ ] 1. **`arena/arena_model.js`** — `getHealthPercent` (~line 829): a living Pokemon must
  never display 0% (a species with `baseHealth > 200` at 1 HP would round to 0 today; the
  current data max is exactly 200, one owner edit away). Replace the function body:
  ```js
  function getHealthPercent(card) {
      if (!isPokemonCard(card)) return 0;
      if (card.currentHealth <= 0) return 0;

      // Floor at 1: a living Pokemon never shows 0%, even when baseHealth is
      // large enough for Math.round to drop 1 HP below half a percent.
      return Math.max(1, Math.round((card.currentHealth / card.pokemon.baseHealth) * 100));
  }
  ```
- [ ] 2. **`arena/arena_controller.js`** — `useDragonGemItemFromHand` (~line 632): it is the
  only single-use item path that never logs the removal. Directly after its
  `model.removeCardFromPlay(owner, removedCard);` line, add:
  ```js
  logEvent(`${model.getCardName(removedCard)} was removed from play for the rest of the battle.`);
  ```
  (Exact same wording as `usePendingItem` / `useEffectBoostItemFromHand` / `useOpponentItem`.)
- [ ] 3. **`arena/arena_controller.js`** — score each rival-AI candidate once (~line 1665).
  Replace the two pickers with:
  ```js
  function pickHighestScoringCandidate(candidates, scoreFn) {
      return pickCandidateByScore(candidates, scoreFn, (score, bestScore) => score > bestScore);
  }

  function pickLowestScoringCandidate(candidates, scoreFn) {
      return pickCandidateByScore(candidates, scoreFn, (score, bestScore) => score < bestScore);
  }

  // Scores each candidate exactly once; strict comparison keeps the earliest
  // candidate on ties, matching the old reduce-over-scoreFn behavior.
  function pickCandidateByScore(candidates, scoreFn, isBetter) {
      const scored = candidates.map(candidate => ({ candidate, score: scoreFn(candidate) }));

      return scored.reduce((best, entry) => (isBetter(entry.score, best.score) ? entry : best)).candidate;
  }
  ```
- [ ] 4. **`map/area.js`** — compute the selectable-node set once per render pass instead of
  re-deriving `getAvailableNextNodes()` for every node:
  - In `render()` (~line 277), add as the second local, after `const currentNode = ...`:
    ```js
    const selectableNodeIds = new Set(getAvailableNextNodes().map(node => node.id));
    ```
    and change the node-rendering line inside the template from
    `${state.area.nodes.map(renderNode).join('')}` to
    `${state.area.nodes.map(node => renderNode(node, selectableNodeIds)).join('')}`.
  - In `renderNode` (~line 392), change the signature to
    `function renderNode(node, selectableNodeIds)` and replace
    `const selectable = isNodeSelectable(node);` with
    `const selectable = selectableNodeIds.has(node.id);`.
  - Leave `isNodeSelectable` itself and its use in `moveToNode` completely unchanged.

## Verification

- [ ] `node tests/run_all.js` green after every step (the phase-40 rival-targeting tests
  guard step 3).
- [ ] Health-floor spot-check:
  ```bash
  node -e "
  const { arena } = require('./tests/helpers/arena_env');
  const card = { kind: 'pokemon', currentHealth: 1, pokemon: { baseHealth: 300, name: 'X' } };
  const dead = { kind: 'pokemon', currentHealth: 0, pokemon: { baseHealth: 300, name: 'X' } };
  console.log(arena.Model.getHealthPercent(card) === 1 && arena.Model.getHealthPercent(dead) === 0 ? 'OK' : 'FAIL');
  "
  ```
  must print `OK`.
- [ ] Area map still renders and moves correctly in the browser (`verify` skill,
  `dev/verify/` drivers): load `area.html` on a run, confirm next-step nodes are highlighted
  and clickable, visited/unreachable nodes are not.

## Out of scope / do not touch

No other render/controller/model changes — in particular do not touch `saveBattleState`,
`arena_render.js`, or deduplicate helpers between `area.js`/`capture.js`. Do not change
`moveToNode` or `isNodeSelectable` semantics. Do not `git commit`.
