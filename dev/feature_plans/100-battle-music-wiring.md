# Phase 100 — Music: play it in battle, control it from the pause menu

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 99 (`window.PokeAudio` must exist). **Read first:** `98-music-overview.md`.
**Goal:** Starting a battle plays a random track from the category matching the trainer's
rank; finishing or leaving the battle stops it; the in-battle pause menu has a working mute
toggle and volume slider whose settings survive a reload. Browser-verified.

## Context you need

Read the overview's "Locked spec" (category table, playback behavior) and its "autoplay
hazard" section.

**The API from phase 99:** `PokeAudio.configure(tracks)`, `PokeAudio.playCategory(category)`,
`PokeAudio.stop()`, `PokeAudio.isMuted()` / `setMuted(muted)`,
`PokeAudio.getVolume()` / `setVolume(volume)`, `PokeAudio.getCurrentTrack()`.

**`arena/game.js`** (524 lines) — the four touch points, with drift-prone line hints:

| Function | Line | What to do |
|---|---|---|
| `initGame` | ~23 | after `await arena.Data.loadGameData()`, call `PokeAudio.configure(arena.GameData.music)`. The **restore** branch (~44, `arena.Model.restoreSavedBattleState()`) must also start music — a reload mid-battle should still have a soundtrack. This is the branch with no user gesture, so it is what exercises phase 99's autoplay retry. |
| `startRunBattle` | ~146 | start music. This is the normal path and is a genuine click (the intro screen's Start button). |
| `handleBattleFinished` | ~156 | `PokeAudio.stop()` — both outcomes land here |
| `resetPrototype` fallback | ~59 | the no-run "Battle Prototype" path: start music with the `trainer` category |

**Category resolution** — add one private helper near the other small helpers such as
`getRunLevel` (~509):

```js
    const MUSIC_CATEGORY_BY_RANK = {
        Standard: 'trainer',
        Ace: 'trainer',
        Boss: 'boss',
        Elite: 'elite',
        Special: 'legendary'
    };

    // Rank 'Special' is the legendary slot: map/locations.js excludes it from
    // every map node, so those trainers are only reached through legendary
    // trainer events.
    function battleMusicCategory() {
        return (activeTrainer && MUSIC_CATEGORY_BY_RANK[activeTrainer.rank]) || 'trainer';
    }
```

Then a single `startBattleMusic()` wrapper calling
`window.PokeAudio.playCategory(battleMusicCategory())`, used by all three start sites, so
the rank lookup exists once.

**Stopping on navigation.** `completeBattleAndReturnToMap` (~343) and `startOver` (~362)
both set `window.location.href`. A page unload stops audio anyway, but call
`PokeAudio.stop()` explicitly in both so the intent is in the code and a future
single-page navigation cannot regress it.

**The pause menu** is `renderMenuWindow()` in `arena/arena_render.js` (~993):

```js
            <div class="battle-flow-overlay" role="presentation">
                <section class="battle-result-window" role="dialog" aria-modal="true" aria-labelledby="battle-menu-title">
                    <span class="battle-flow-kicker">Paused</span>
                    <h1 id="battle-menu-title">Menu</h1>
                    <div class="battle-flow-actions"> … three buttons … </div>
                </section>
            </div>
```

Add an audio block **between** the `<h1>` and `.battle-flow-actions`. The render layer
already reaches the controller for predicates (`arena.Controller.canPlayerEndTurn()` in
`renderStatus`, ~857), so reading `window.PokeAudio.isMuted()` / `getVolume()` here is
consistent with how this file works.

**Input routing.** `handleArenaClick` in `arena/arena_controller.js` (~193) handles
`[data-action]` clicks — the mute toggle goes there as `'toggle-mute'`. A `range` input
emits `input`, **not** `click`, so it needs its own listener. Wire it once, next to the
existing board listeners in `arena/game.js`'s `initGame` (~33):

```js
        state.elements.board.addEventListener('input', handleAudioSliderInput);
```

with a handler that ignores anything without `[data-audio-volume]`. Do not add a listener
inside `renderMenuWindow` — the whole board is re-rendered on every `render()` and
listeners would stack.

**Re-render hazard.** `render()` rebuilds the board's `innerHTML`, so the slider is
destroyed and recreated on every repaint. Two consequences to handle:
- the slider must render its **current** value from `PokeAudio.getVolume()` each time, and
- dragging it must not trigger a full `render()` on every `input` event, or the element the
  user is dragging is ripped out mid-gesture. So the volume handler updates
  `PokeAudio.setVolume(...)` and the adjacent value label **directly**, without calling
  `render()`. The mute toggle *does* call `render()` (a click, one repaint, no gesture in
  flight).

**Styling** goes in `static/styles.css` (66 KB — Grep, never read whole). Grep
`.battle-result-window` and `.battle-flow-actions` for the existing menu treatment, and
`:root` for the colour tokens. Reuse `.arena-button` / `.arena-button--reference` for the
mute button rather than inventing a new button family.

## Steps

- [x] 1. **`game.html`** — add `<script src="arena/audio.js"></script>` before
  `<script src="arena/game.js"></script>`.

- [x] 2. **`arena/game.js`** — add `MUSIC_CATEGORY_BY_RANK`, `battleMusicCategory()` and
  `startBattleMusic()` (the snippet in "Context you need"), placed with the other small
  private helpers near the bottom of the IIFE.

- [x] 3. **`arena/game.js`** `initGame` (~23) — after `await arena.Data.loadGameData()`:

  ```js
        window.PokeAudio.configure(arena.GameData.music);
  ```

  then start music in the two branches that begin or resume an actual battle: the
  `arena.Model.restoreSavedBattleState()` branch (~44) and the final
  `arena.Controller.resetPrototype()` else-branch (~59). Do **not** start it in the
  `activeBattleEncounter.outcome` branch (that renders a finished result) or in
  `renderBattleUnavailable()`.

- [x] 4. **`arena/game.js`** `startRunBattle` (~146) — call `startBattleMusic();` after
  `arena.Controller.resetPrototype();`.

- [x] 5. **`arena/game.js`** `handleBattleFinished` (~156) — `window.PokeAudio.stop();` as
  the first statement after its existing early-return guard.

- [x] 6. **`arena/game.js`** — `window.PokeAudio.stop();` in `completeBattleAndReturnToMap`
  (~343) and `startOver` (~362), before the `window.location.href` assignment.

- [x] 7. **`arena/arena_render.js`** `renderMenuWindow` (~993) — add the audio block between
  the `<h1>` and `.battle-flow-actions`:

  ```js
                    <div class="battle-audio-controls">
                        <button class="arena-button arena-button--reference" type="button" data-action="toggle-mute" aria-pressed="${muted ? 'true' : 'false'}">
                            <span aria-hidden="true">${muted ? '&#128263;' : '&#128266;'}</span>
                            <span>${muted ? 'Unmute' : 'Mute'}</span>
                        </button>
                        <label class="battle-audio-volume">
                            <span>Volume</span>
                            <input type="range" min="0" max="100" step="5" value="${volumePercent}" data-audio-volume aria-label="Music volume">
                            <span class="battle-audio-volume-value" data-audio-volume-label>${volumePercent}</span>
                        </label>
                    </div>
  ```

  reading `const muted = window.PokeAudio.isMuted();` and
  `const volumePercent = Math.round(window.PokeAudio.getVolume() * 100);` at the top of the
  function. Guard for `window.PokeAudio` being absent (the editor loads
  `arena_render.js` without `audio.js` — see `dev/editor/index.html`), e.g. via a small
  local `audioApi()` helper returning safe defaults.

- [x] 8. **`arena/arena_controller.js`** `handleArenaClick` (~193) — add to the
  `[data-action]` chain:

  ```js
        } else if (action === 'toggle-mute') {
            window.PokeAudio.setMuted(!window.PokeAudio.isMuted());
            render();
  ```

- [x] 9. **`arena/game.js`** `initGame` (~33) — register the slider listener beside the
  existing board listeners, and add the handler:

  ```js
    function handleAudioSliderInput(event) {
        const slider = event.target.closest('[data-audio-volume]');

        if (!slider) return;

        const percent = Number(slider.value);

        window.PokeAudio.setVolume(percent / 100);

        // Update the label in place: a full render() would destroy the slider
        // the user is currently dragging.
        const label = slider.parentElement.querySelector('[data-audio-volume-label]');

        if (label) label.textContent = String(percent);
    }
  ```

- [x] 10. **`static/styles.css`** — add `.battle-audio-controls` (a row that wraps),
  `.battle-audio-volume` (label + slider + value, aligned), and
  `.battle-audio-volume-value` (fixed min-width so the row does not jump as the number
  changes). Use existing colour tokens; style the `input[type="range"]` minimally
  (`width: 100%` inside its label, `accent-color: var(--gold)` or whichever token the
  theme uses). Check the two responsive `.arena-button` blocks (~2626, ~2875) so the
  control row still fits at 390px.

- [x] 11. **`node tests/run_all.js`** — green.

- [x] 12. **`dev/verify/phase100_battle_music.py`** — new Playwright driver, modeled on
  `dev/verify/drive_arena.py`. Because the repo ships **no** song files, the driver must
  seed a fixture first: write a temporary `music.json` with one track per category and
  generate four tiny silent `.mp3` files under `assets/music/`, run the assertions, then
  **restore both** (delete the fixtures, `git checkout -- music.json`) in a `finally` block
  so a failure never leaves the repo dirty. Generating a valid minimal MP3 in Python
  without a library is fiddly — a short base64-embedded silent MP3 constant in the driver is
  the pragmatic answer; if the browser refuses to load it, fall back to asserting the
  `<audio>` element's `src` and `loop` without asserting `paused === false`, and say so in
  the driver's docstring.

  Assertions: after starting a battle, an `HTMLAudioElement` exists whose `src` ends in the
  expected category's file; `loop` is `true`; `volume` matches the stored setting; opening
  the pause menu and clicking Mute sets `muted === true` and persists it to
  `localStorage['pokemon-rogue-pocket-audio']`; moving the slider updates both `volume` and
  the label. Screenshot the open pause menu to
  `dev/verify/phase100_battle_music.png`.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `dev/verify/phase100_battle_music.py` runs clean, and afterwards
  `git status --porcelain` shows **no** stray `.mp3` and `music.json` unchanged.
- [x] `dev/verify/phase100_battle_music.png` shows the pause menu with the Mute button and
  the volume slider.
- [x] Manual pass with real files: drop one MP3 per category into `assets/music/`, register
  them in `music.json` by hand, serve on 8931, and confirm — a Standard/Ace trainer battle
  plays a `trainer` track, a Gym Leader battle a `boss` track, an Elite an `elite` track,
  and a legendary trainer event battle a `legendary` track. **Remove the fixtures
  afterwards.**
- [x] Silence, not errors: with `music.json` back to `[]`, a battle starts with no console
  error and no audio.
- [x] Autoplay retry: start a battle, reload `game.html` mid-battle (no gesture), confirm no
  unhandled rejection in the console and that the music starts on the first click anywhere.
- [x] Music stops on the win overlay, on the loss overlay, and when returning to the map.
- [x] Mute and volume survive a reload, and the slider does not stutter or lose focus while
  dragging.
- [x] The editor still boots (`node dev/editor/server.js`) — it loads `arena_render.js`
  **without** `audio.js`, so the step 7 guard is load-bearing.
- [x] Stop any servers: `pkill -f "http.server 8931"`.

## Out of scope / do not touch

`arena/audio.js` (phase 99 owns it — if the API is insufficient, extend it minimally and
say so) and the data editor (phase 101). Do not add music to non-battle pages, sound
effects, per-move audio, crossfades, or a track-name display. Do not restyle the pause
menu's existing buttons or the result overlays. Do not commit song files.
