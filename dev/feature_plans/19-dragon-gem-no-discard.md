# Phase 19 — Dragon Gems are one-time-use (no discard)

**Recommended agent:** Sonnet · low effort
**Prereqs:** none. **Read first:** `18-mechanics-symbols-roster-overview.md`.
**Goal:** Playing a Dragon Gem removes its card from play for the rest of the battle (like an
artificial attack) instead of moving it to the discard pile. The gem's side-marker effect and
one-gem-per-status rule are unchanged. Ends green + playable.

## Context you need

- Anchors are hints captured 2026-07-14; find by function name.
- `useDragonGemItemFromHand(ownerId, cardId)` in `arena/arena_controller.js` (~`:615`) handles
  a player *or* opponent playing a gem (both sides use this one function). Today it ends by
  animating the card into the discard pile and unshifting it there:
  ```js
  applyDragonGemItemEffect(removedCard, ownerId);   // <- the side marker; KEEP this
  render();
  await model.sleep(180);

  await animateDiscardCard(ownerId, removedCard, impactCenter || sourceCenter);  // remove
  owner.discard.unshift(removedCard);                                            // remove
  ```
- The pattern to copy is the artificial attack: `useArtificialAttackFromHand` (~`:671`) ends
  with `model.removeCardFromPlay(owner, removedCard)` (`arena/arena_model.js` ~`:1739`, pushes
  to `player.removed[]`) after `animateArtificialAttackCard(removedCard, ...)` (~`:751`).
- `applyDragonGemItemEffect` registers the persistent side marker independently of where the
  physical card goes, so removing-from-play does not affect the gem's effect. The
  one-gem-per-status guard `canUseDragonGemItem` (~`:658`) already prevents re-adding an active
  gem status; with removal-from-play the spent card can no longer be recycled back into the
  deck, which is exactly the intended "one-time-use per battle."

## Steps

- [ ] 1. **`arena/arena_controller.js`** — in `useDragonGemItemFromHand`, replace the discard
  tail (the `animateDiscardCard(...)` call **and** `owner.discard.unshift(removedCard)`) with a
  remove-from-play: `model.removeCardFromPlay(owner, removedCard);`. Keep the preceding
  `applyDragonGemItemEffect(...)`, `render()`, and `sleep` calls. For the fly-out animation,
  reuse `animateArtificialAttackCard(removedCard, impactCenter || sourceCenter, ownerId)` so the
  spent gem visibly leaves play (mirror the artificial-attack flow); confirm that helper's
  signature before wiring it.
- [ ] 2. **`arena/arena_controller.js`** — audit for anything that assumed gems live in the
  discard pile: grep for `discard` around gem handling and check the discard-count/pile UI and
  `shuffleDiscardIntoDeck` (deck-recycling). A one-time-use gem must NOT reappear via a discard
  reshuffle. Fix or note any interaction.
- [ ] 3. **`tests/`** — add (or extend an existing arena test) a Node test that plays a gem via
  the engine and asserts the card lands in `owner.removed` and is absent from `owner.discard`,
  while the gem's side effect is still registered (`model.getDragonGemEffects(ownerId)` still
  reflects it). Use `require('./tests/helpers/arena_env')` to boot the engine in Node.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill (serve on 8931): play a Dragon Gem in a battle → the card flies out and
  does **not** appear in the discard pile; the gem's tray marker shows and a matching DRAGON
  attack still applies the paired status. Playing the same gem type again is still blocked.
- [ ] The opponent AI playing a gem behaves the same (no discard), since both paths share
  `useDragonGemItemFromHand`.

## Out of scope / do not touch

Do not change `applyDragonGemItemEffect`, the gem side-marker tray rendering, `canUseDragonGemItem`,
or any non-gem item's discard behavior (regular items still discard). Do not touch the effect
symbols, sleep, or trainer work (other phases). Inherit all batch ground rules from
`18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`, no `TODO.md`,
run `node tests/run_all.js` after every change).
