# Phase 38 — Battle stat-pill cleanup

**Recommended agent:** Haiku · low effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** Both battle side-headers show only the KO pill; the five redundant count pills
("Pokemon left", "Pkmn deck", "Action deck", "Hand", "Discard") are gone for player and
opponent alike.

## Context you need

- `arena/arena_render.js` `renderSide()` renders a stat-pill row per side (~146–151):
  ```html
  <span class="stat-pill">Pokemon left ${player.pokemonLeft}</span>
  <span class="stat-pill">Pkmn deck ${player.pokemonDeck.length}</span>
  <span class="stat-pill">Action deck ${player.deck.length}</span>
  <span class="stat-pill">Hand ${player.hand.length}/${arena.Model.getPlayerHandSize(player)}</span>
  <span class="stat-pill">Discard ${player.discard.length}</span>
  <span class="stat-pill">KO ${player.knockoutCount}/${arena.Model.getEffectiveKnockoutLimit(player)}</span>
  ```
- The same counts remain visible elsewhere: the pile widgets rendered just below via
  `renderPile` (~155–163: Pkmn / Action / Discard / KO piles), the board slots, and the
  rendered hand. That is why the pills are redundant — owner wants them gone.
- The KO pill is NOT redundant and stays.

## Steps

- [ ] 1. **`arena/arena_render.js`** — in `renderSide()`, delete the five spans
  `Pokemon left`, `Pkmn deck`, `Action deck`, `Hand`, `Discard`. Keep the KO span, its
  `.stat-pill` class, and the surrounding wrapper element unchanged. Do not touch
  `renderPile` or the pile row.

## Verification

- [ ] `node tests/run_all.js` green (no test asserts pill text).
- [ ] `verify` skill: start a battle with the committed driver; screenshot both side
  headers — exactly one pill ("KO n/m") per side; pile widgets still show their counts.

## Out of scope / do not touch
`static/styles.css` (`.stat-pill` is still used by KO); pile widgets; hand/board
rendering; `player.pokemonLeft` and the other model fields (still used elsewhere).
