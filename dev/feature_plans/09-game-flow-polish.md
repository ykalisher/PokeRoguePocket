# Session 09 — Game-flow polish

**Read `08-post-launch-overview.md` first.** Three small, independent edits — no shared
state between them. None require mobile testing. Do them in any order.

**Goal:** starter cards show only the type (no invented deck name); the area screen
shows the location's Pokémon types at the top; losing/winning and choosing "Start over"
runs the *full* new-game sequence (starter picker included) instead of silently
restarting as Water.

---

## 9a. Remove the starter deck titles

Each starter card currently shows a type chip ("Water"/"Grass"/"Fire") **and** an
invented name ("Tide Caller" / "Verdant Bloom" / "Ember Heart"). Remove the name.

- File: `map/starter.js`, function `renderDeckCard()`.
- Find this line (it sits right after the `starter-card-type` line) and **delete it**:
  ```js
  <span class="starter-card-name">${escapeHtml(deck.name)}</span>
  ```
  Keep the `starter-card-type` line above it.
- Leave the `deck.name` data in `map/locations.js` (`STARTER_DECKS`) untouched — nothing
  else needs it removed.
- Optional tidy: the now-unused `.starter-card-name` rule in `static/styles.css` (search
  `.starter-card-name`) can be deleted; harmless to leave.

**Check:** serve, open `starter.html` — each deck shows only the type chip, no name line.

---

## 9b. Show location types at the top of the area screen

The area header shows a level kicker, the location name, and pills for terrain + current
node — but not the location's Pokémon **types**. Add type icons to the header.

- File: `map/area.js`, function `render()`, inside the `.area-subrow` block (search
  `class="area-subrow"`). It currently holds the terrain `stat-pill` and a
  current-location `stat-pill`.
- There is already an accessor — do **not** re-read the data yourself. Search
  `function getLocationTypes` in `map/area.js`; it returns the uppercase types array
  (e.g. `["WATER","ICE"]`) or `[]`.
- The `.type-icon` class is already styled in `static/styles.css`, and `area.html`
  already loads that stylesheet. The type SVGs are uppercase filenames matching the
  type values: `assets/types-svgs/WATER.svg`, `.../ICE.svg`, etc.
- Add the icons in the subrow (after the terrain pill is a good spot):
  ```js
  <span class="area-type-chips">
    ${getLocationTypes().map(t =>
      `<img class="type-icon" src="assets/types-svgs/${t}.svg" alt="${t}" title="${t}">`
    ).join('')}
  </span>
  ```
  The `.area-type-chips` wrapper is only for spacing; if the icons already sit well
  without it you can drop the wrapper. If you keep it and want a gap, add a small rule to
  `static/area.css` (e.g. `.area-type-chips { display:inline-flex; gap:4px; align-items:center; }`).

**Check:** serve, open `area.html` for a run — the header shows the location's type
icons (e.g. tidepool-coast → Water + Ice). No horizontal overflow at phone width.

---

## 9c. "Start over" runs the full new-game sequence

**Problem:** on the loss and victory windows, "Start over" jumps straight to
`area.html?newRun=1` with no starter chosen, so the run silently defaults to **Water**
every time — it never re-runs the starter picker.

- File: `arena/game.js`, function `startOver()` (search `function startOver`).
- The main-menu "New Game" path routes through the starter picker
  (`main.js` → `NEW_RUN_ROUTE = 'starter.html'`). Make start-over do the same. Change:
  ```js
  window.location.href = 'area.html?newRun=1';   // BEFORE — skips picker, defaults to Water
  ```
  to:
  ```js
  window.location.href = 'starter.html';          // AFTER — full new-game: player picks a deck
  ```
- **Keep** the existing `arena.Model.clearSavedBattleState()` and `runStore.clearRunState()`
  calls above it — they mirror `main.js` `handleNewGame` and clear the old run/battle
  before the fresh start.
- This one function backs the "Start over" button on **both** result windows
  (`renderLossResultWindow` and `renderVictoryResultWindow` — search
  `data-battle-flow-action="start-over"`), so the single change fixes both.

**Check:** finish a battle (win or lose), click **Start over** → you land on the starter
picker; choosing a deck starts a fresh run with *that* deck, not always Water.

---

## Verify (whole session)

- [x] `node tests/run_all.js` green.
- [x] `starter.html`: only the type chip on each deck (no name).
- [x] `area.html`: location type icons in the header, no overflow at 390px width.
- [x] Battle → Start over → starter picker → chosen deck starts the new run.

## Out of scope
Restyling the starter cards or area header beyond the above; changing `STARTER_DECKS`
data; touching the "Back to Map" or "Main menu" buttons.
