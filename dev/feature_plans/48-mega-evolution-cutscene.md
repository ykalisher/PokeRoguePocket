# Phase 48 — Mega evolution cutscene after gym-leader wins

**Recommended agent:** Opus · medium effort.
**Prereqs:** 42 (schema + `findPokemonByNameOrId`), 37 (game.js string edits landed). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** Winning a boss-node battle that continues the run evolves every BABY pokemon in
the ACTIVE deck into its `evolvesInto` mega via a full-screen "X is evolving!" sequence
(card rotates/shines, then becomes the mega) between the win overlay's Continue and the
return to the map. Refresh-safe; silently inert when no baby data exists.

## Context you need

- **The seam** (`arena/game.js`): the win overlay's Continue button
  (`data-battle-flow-action="continue"`) is handled in `handleBattleFlowClick` (~69) →
  `completeBattleAndReturnToMap()` (~250–267) → `window.location.href = 'area.html'`.
  Gate the cutscene on `outcome === 'win' && isFinalNodeBattle() && !isRunVictory()`
  (~403/~412) — the final run victory takes a different button path and must never show
  it (Locked-spec assumption 3). Game data: `arena.GameData`; run store: the `runStore`
  param of the module IIFE; the active run object is already loaded in this module.
- **Run mutation rules**: replace cards inside `run.collections.pokemon` (active deck
  ONLY — bench babies do not evolve), then `rebuildActionDeckForActivePokemon(run)`
  (mega types differ, attack usability changes) and `saveRunState(run)`.
  **Design decision (locked): mutate-and-save FIRST, animate after** — compute pending
  evolutions on Continue, apply them all, save, then play the visuals, then redirect. A
  refresh mid-cutscene loses only the animation, never the evolution.
- Helpers from 42: `PokeLocations.isBabyPokemon(record)`,
  `PokeLocations.findPokemonByNameOrId(gameData, ref)`.
- Card factory: `runStore.createPokemonCard(megaRecord, 'player',
  runStore.allocateCardId(run, 'pokemon', megaRecord.name))`.
- Overlay conventions: imitate `renderBattleResultOverlay` / `battle-flow-overlay` /
  `battle-result-window` markup (~195–248) and `arena.Render.renderCardPreview` for the
  card art. Styles live in `static/styles.css`; grep its section-comment style and add a
  new section.
- The BABY type chip may have no dedicated color in `static/styles.css` — an unstyled
  fallback is acceptable; do not build type theming here.

## Steps

- [ ] 1. **`map/run_state.js`** — add + export pure helpers:
  `getPendingMegaEvolutions(run, gameData)` → for each card in
  `run.collections.pokemon` whose `.pokemon` record is BABY-typed AND whose
  `evolvesInto` resolves via `findPokemonByNameOrId`, return
  `{ index, babyCard, megaRecord }`; absent/unresolvable `evolvesInto` → skipped
  silently. (Guard `global.PokeLocations` access.)
  `applyMegaEvolutions(run, evolutions)` → replace each card **in place at the same
  index** with a new card from `megaRecord`, then
  `rebuildActionDeckForActivePokemon(run)`; return a summary array
  (`{ babyName, megaName }`).
- [ ] 2. **`tests/run_progression.test.js`** (or a new `tests/mega_evolution.test.js`) —
  fixture run + gameData: a baby whose `evolvesInto` is a mega *name*, another
  referencing a mega *id*, one with a bad reference, and a baby on the bench. Assert:
  pending list covers only the active-deck resolvable babies; after apply, the deck
  holds the megas at the same positions, babies gone, action deck rebuilt; a run with no
  babies yields an empty list and zero mutation.
- [ ] 3. **`arena/game.js`** — in the `'continue'` flow: when the gate above holds,
  compute `getPendingMegaEvolutions(activeRun, arena.GameData)`; if non-empty,
  `applyMegaEvolutions` + `runStore.saveRunState(activeRun)`, then
  `playEvolutionSequence(evolutions)` and only afterwards
  `completeBattleAndReturnToMap()`. Empty → existing flow untouched.
  `playEvolutionSequence` shows one full-screen overlay per evolution in order: kicker
  "Evolution", headline `<Baby> is evolving!`, the baby card with a rotate/shine
  animation, a timed (or animationend-driven) swap to the mega card + `…evolved into
  <Mega>!`, and a Continue button to advance to the next evolution / finish.
- [ ] 4. **`static/styles.css`** — new section for the evolution overlay reusing the
  battle-flow overlay look, plus a keyframe animation (e.g. `rotateY` spin with a
  brightness/glow pulse, ~1.5–2s) on the card; keep mobile sizing consistent with the
  battle result windows (check at 390×844).
- [ ] 5. **Guard sweep** — confirm by reading the diff: zero behavior change when no
  babies are in the active deck; the loss path, non-boss wins, and the final-victory
  path are untouched.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill with **injected fixture data** (no real baby cards exist yet):
  serve the game, drive to a boss-node win with the committed drivers, then before
  clicking Continue use `page.evaluate` to (a) push a fixture baby record (BABY+FIRE,
  `evolvesInto` pointing at a fixture mega record also pushed) into
  `arena.GameData.pokemon`, and (b) swap a baby card into the saved run's
  `collections.pokemon`. Click Continue: the cutscene plays; screenshot it (desktop and
  390×844). Afterwards the run in localStorage holds the mega at the same slot.
  Reload mid-sequence: lands on `area.html` with the mega persisted.
- [ ] Win a boss battle with NO baby in the deck: flow identical to before (straight to
  the map).

## Out of scope / do not touch
Bench-baby evolution; evolution items/levels; pool exclusions (42) and the grant event
(47); the final-victory window; sound; type-chip theming.
