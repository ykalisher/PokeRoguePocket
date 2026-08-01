# Phase 81 — The attack encounter page

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 80. **Read first:** `76-map-and-encounter-overhaul-overview.md`.
**Goal:** Stepping on an attack node opens `attack.html`, which offers the 1–3 attacks the
encounter stored, lets the player pick one, adds **2 copies** to the action deck, and returns
to the map. The feature is now fully playable end to end.

## Context you need

**Mirror `map/capture.js`. Do not invent a new page architecture.** The capture page is the
template in every respect: file layout, IIFE signature, boot guard, animation phases, render
structure, and CSS class naming. An attack encounter is a strictly simpler capture encounter —
one card kind, no legendary carve-out, no dragon-gem reward, no pokemon collection.

**`capture.html`** is the markup template (7 lines of `<script>`): `arena/arena_data.js`,
`arena/arena_model.js`, `arena/arena_render.js`, `map/run_state.js`, `map/locations.js`,
`map/capture.js`; stylesheets `static/styles.css` + `static/capture.css`; body class
`capture-page`; a `<main class="capture-shell" id="capture-root">` holding a
`<section class="capture-loading">` placeholder; and the shared `<a href="index.html"
class="btn btn-back">Menu</a>`.

**`map/capture.js` structure worth copying** (line hints are drift-prone):
- IIFE closing with `})(window.CardArena = window.CardArena || {}, window.PokeRun,
  window.PokeLocations);` → parameters `(arena, runStore, locations)`.
- `CARD_BACKS` (~8) and `PHASE_DURATIONS` (~12) frozen constants; a `state` object (~20) with
  `{ cardWindow, elements, encounter, phase, rewardCards, run, selectedIndex }`.
- `document.addEventListener('DOMContentLoaded', init);` then `init()` (~33–60):
  `locations.applyLocationTheme(runStore.loadRunState())` → wire root click + `keydown` →
  `await arena.Data.loadGameData()` → `runStore.loadRunState()` →
  `runStore.getActiveCaptureEncounter(run)` → **bounce to `area.html` if either is missing** →
  repair the stored options → bounce again if the option list is empty → `render()`.
- `claimPokemon` (~107–135): set the phase, apply the reward, then `await
  arena.Model.sleep(PHASE_DURATIONS.x)` between `pokemon → attacks → deck → complete`, each
  followed by `render()`, ending in `window.location.href = 'area.html'`.
- Render helpers: `render` (~170), `renderDeckCounter` (~198), the shared card-window overlay
  `renderCardWindow`/`renderCardSection`/`renderCardGrid` (~207–262), `renderPokemonOption`
  (~276), `renderRewardTray` (~294), `getPhaseTitle` (~319), `getRewardText` (~327).
- Option buttons carry `data-capture-option="${index}"` and the classes
  `capture-option is-selected|is-catching|is-dimmed`; the click handler reads
  `event.target.closest('[data-capture-option]')` and ignores clicks unless
  `state.phase === 'choosing'`.

**The claim path.** `completeCapture` (~137–168) is the model:

```js
        const rewardCards = [1, 2].map(() => runStore.createAttackCard(
            attack,
            'player',
            runStore.allocateCardId(state.run, 'attack', attack.name)
        ));
        ...
        rewardCards.forEach(card => runStore.addActionCard(state.run, card));
```

`[1, 2].map(...)` is where the **2 copies** come from — the locked spec for this encounter is
the same. `runStore.addActionCard` (~230–243) auto-benches an attack no active Pokemon can
use, which is correct and desirable here; do not bypass it.

**Phase 80 already built the state layer.** `runStore.getActiveAttackEncounter(run)`,
`run.attackEncounters`, `run.area.activeAttackNodeId`, `locations.getAttackCardPool` and
`locations.chooseAttackCardOptions` all exist. The encounter object is
`{ completed, createdAt, nodeId, options, selectedAttackName, terrain }` where `options` is an
array of attack **names**; resolve them against `arena.GameData.attacks` by exact name.

**`static/capture.css`** is the CSS template: `.capture-page` (3), `.capture-shell` (30),
`.capture-topbar` (51), `.capture-hud` (86), `.capture-deck-counter` (94), `.capture-stage`
(144), `.capture-options` (162), `.capture-option` (172) + `.is-selected` / `.is-catching` /
`.is-dimmed`, `.capture-rewards` (218–279), the shared `.area-overlay` / `.area-card-*` block
(280–403), and a responsive block (466–511). The `.area-*` overlay block is **duplicated** in
`capture.css` rather than shared — copy it the same way rather than restructuring.

## Steps

- [x] 1. **`attack.html`** — new file, a copy of `capture.html` with `capture` → `attack`
  throughout: `<title>Pokemon Rogue Pocket - Attack</title>`, `<body class="attack-page">`,
  `<main class="attack-shell" id="attack-root" aria-label="Attack encounter">`,
  `<section class="attack-loading">Loading attack encounter...</section>`, stylesheet
  `static/attack.css`, and `<script src="map/attack.js">` as the last script. The other five
  script tags and their order are **identical** to `capture.html` — `arena_data` before
  `arena_model` is required.

- [x] 2. **`map/attack.js`** — new file mirroring `map/capture.js`. Header comment
  `Pokemon Rogue Pocket - attack encounter page`; IIFE
  `(function bootAttackPage(arena, runStore, locations) { 'use strict'; … })(window.CardArena
  = window.CardArena || {}, window.PokeRun, window.PokeLocations);`. Phases: `choosing →
  claimed → deck → complete` (three animation beats instead of capture's four — there is no
  pokemon-joins beat). Reuse `PHASE_DURATIONS`-style constants and `CARD_BACKS.actions`.

- [x] 3. **`map/attack.js`** — `init()`: same shape as capture's, but calling
  `runStore.getActiveAttackEncounter(state.run)`. Bounce to `area.html` when the run or the
  encounter is missing. Repair the stored options against
  `locations.getAttackCardPool(arena.GameData, getLocationTypes())` — drop unknown or
  duplicate names, re-roll with `locations.chooseAttackCardOptions(...)` if nothing survives,
  and `runStore.saveRunState(state.run)` if anything changed. Bounce again if the list is
  still empty. Add a local `getLocationTypes()` reading `state.run.location.types` (copy
  `map/capture.js` ~400–404).

- [x] 4. **`map/attack.js`** — `claimAttack(optionIndex)`: resolve the option to an attack
  record, then

  ```js
          const rewardCards = [1, 2].map(() => runStore.createAttackCard(
              attack,
              'player',
              runStore.allocateCardId(state.run, 'attack', attack.name)
          ));

          rewardCards.forEach(card => runStore.addActionCard(state.run, card));
          state.encounter.completed = true;
          state.encounter.selectedAttackName = attack.name;
          state.run.area.activeAttackNodeId = null;
          runStore.saveRunState(state.run);
  ```

  then run the phase/`sleep`/`render` chain and finish with
  `window.location.href = 'area.html'`. Ignore clicks unless `state.phase === 'choosing'`.

- [x] 5. **`map/attack.js`** — render: topbar with the terrain kicker, a phase title
  (`Choose one attack` → `Added <name> x2` → `Returning to map`), the action-deck counter
  (capture's `renderDeckCounter('actions', …)`; there is no pokemon counter to show, but keep
  it if it renders cleanly), an options row of buttons carrying
  `data-attack-option="${index}"` with classes `attack-option is-selected|is-dimmed`, each
  wrapping `arena.Render.renderCardPreview(card, { className: 'attack-option-card' })` where
  `card = runStore.createAttackCard(record, 'player', 'attack-option-' + formatId(record.name))`,
  and a reward tray flying the two copies into the action-deck target. Copy capture's
  card-window overlay (`data-card-window` / `[data-close-card-window]` / Escape key) verbatim
  so the player can inspect their deck.

- [x] 6. **`static/attack.css`** — new file, `static/capture.css` with `capture` → `attack` in
  the class names, including the duplicated `.area-overlay` / `.area-card-*` block and the
  responsive block at the end. Do not add new visual language; this page should look like a
  sibling of the capture page.

- [x] 7. **`map/area.js`** — **only now** add the dispatch branch in `moveToNode` (~210–275),
  next to the capture branch:

  ```js
          if (node.type === 'attack') {
              getOrCreateAttackEncounter(node);
              saveRunState();
              window.location.href = 'attack.html';
              return;
          }
  ```

  Attack encounters can never be empty (`getAttackCardPool` falls back to the full offerable
  pool), so unlike the battle and event branches this one needs no failure path.

- [x] 8. **`map/area.js`** — sanity-check the aria/entered strings added in phase 78:
  `getNodeAriaLabel` (~1545) reads `LOCATION_LABELS['attack']` → "Attack Encounter" and
  `getEnteredLocationText` (~1563) has the "an Attack Encounter" case. With step 7 in place
  the latter is no longer reachable for attack nodes; leave it, it is harmless and correct.

- [x] 9. **`tests/attack_encounter.test.js`** — extend the file phase 80 created with a
  reward-shape test that does not need a DOM: build a run with `R.createRunState`, take an
  attack record from live data, create two cards with
  `R.createAttackCard` + `R.allocateCardId`, `R.addActionCard` each, and assert the run now
  holds exactly 2 cards named that attack across `collections.actions` +
  `collections.bench.actions`. This pins the "2 copies" spec without booting a browser.

## Verification

- [x] `node --check map/attack.js` and `node --check map/area.js` pass.
- [x] `node tests/run_all.js` green. `tests/run_all.js` syntax-checks **untracked** files too
  (`git ls-files -co`), so the new `map/attack.js` is covered before it is ever committed.
- [x] Browser playthrough with the `verify` skill — this is the real proof, and it must be
  done, not skipped:
  - serve on 8931, start a fresh run, and walk to an attack node (level 1 guarantees 1–2 per
    route; if the first route's attack node is behind the branch, take that lane);
  - the page loads with the location theme applied, shows 1–3 attack cards, and every offered
    attack shares a type with the location and is neither legendary nor artificial;
  - clicking one plays the animation and returns to `area.html`;
  - the action deck now contains **two** more copies of that attack — check via the deck
    counter and via
    `JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run')).collections.actions`;
  - the node renders as visited and cannot be replayed;
  - reloading `attack.html` directly after completing it bounces back to `area.html`.
  - Save screenshots as `dev/verify/phase81_attack_encounter_offer.png` and
    `dev/verify/phase81_attack_encounter_claimed.png`, and commit the driver as
    `dev/verify/phase81_attack_encounter.py` (model it on `dev/verify/phase61_area_selectable.py`).
- [x] Mid-encounter reload: open the attack page, reload before choosing, and confirm the same
  options come back (they are persisted in `run.attackEncounters[nodeId].options`) rather than
  being re-rolled.
- [x] From `index.html` with an in-progress attack encounter saved, Continue routes to
  `attack.html` (this exercises the `main.js` branch added in phase 80).

## Out of scope / do not touch

Do not restructure the capture page, extract a shared page base class, or de-duplicate
`static/capture.css`'s `.area-*` overlay block — mirroring is the instruction. Do not add a
cost, a reroll, a skip button, or any reward beyond the 2 attack copies. Do not touch
`map/locations.js` (phase 80 finished the pool work), the generator, `arena/**`, or any JSON
data file. Do not change `STORAGE_VERSION`.
