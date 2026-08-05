# Phase 95 — Achievements: the page and the unlock toast

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 94 (counters must actually be moving). **Read first:** `92-achievements-overview.md`.
**Goal:** A new `achievements.html` lists every enabled achievement with its lock state and
progress, reachable from the main menu, and unlocking one shows a toast on the next page
the player lands on. Ends green and browser-verified.

## Context you need

**The page to imitate is `overview.html` + `arena/card_overview.js`** — the existing "Card
Overview" screen. `overview.html` is 25 lines:

```html
<body class="game-page card-overview-page">
    <a href="index.html" class="btn btn-back">Back</a>
    <main class="card-overview" aria-labelledby="card-overview-title">
        <header class="overview-header"> … </header>
        <div id="card-overview" class="overview-content">
            <section class="arena-status arena-status--loading">Loading cards...</section>
        </div>
    </main>
    <script src="arena/arena_data.js"></script>
    …
</body>
```

Copy that skeleton (back link, `<main>`, a loading placeholder that the controller
replaces). The controller is a `DOMContentLoaded` IIFE that awaits
`arena.Data.loadGameData()` and then renders — read `arena/card_overview.js`'s `init()` for
the exact shape.

**The main menu** is `index.html` + `main.js`. The buttons live in
`<div class="button-container">`; "Card Overview" is a plain `<a href="overview.html" class="btn">`.
Add "Achievements" the same way — no `main.js` change needed.

**The API from phase 93:** `PokeProfile.getProgress(achievement)` →
`{ current, threshold, unlocked }`, `PokeProfile.isUnlocked(id)`,
`PokeProfile.takePendingUnlocks()` → ids, drained.

**Achievement data** is `arena.GameData.achievements` after `loadGameData()`. Records:
`{ id, name, description, stat, atLeast, hidden, enabled }`.

**Rendering rules:**

- Skip `enabled === false` records entirely.
- A locked `hidden` achievement shows `???` for both name and description, and shows **no**
  progress numbers (they would leak the goal). It still occupies a row.
- A locked non-hidden achievement shows name, description, and `current / threshold`, plus a
  progress bar.
- An unlocked achievement shows name, description, and its unlock date
  (`PokeProfile.getProfile().unlocked[id]`, an ISO string — render with
  `new Date(iso).toLocaleDateString()`).
- A header count: `<unlocked> / <enabled total>`.
- Empty state: "No achievements yet." when the list is empty.

**The toast.** `PokeProfile.takePendingUnlocks()` returns ids queued by phase 94, possibly
earned on a *different* page (a run completes on `game.html`, the player lands on
`area.html`). So the drain-and-show call belongs on every page that a player can arrive at
after an unlock: `area.html`, `game.html`, `event.html`, `capture.html`, `attack.html`,
`mart.html`, and `achievements.html`. To keep that to one line per page, put the renderer
in `map/profile.js` itself, guarded so Node never touches the DOM:

```js
    /**
     * Drains pendingUnlocks and shows one toast per newly unlocked achievement.
     * DOM-only: a no-op without a document, so Node tests can require this file.
     */
    function showPendingUnlocks(achievements) { … }
```

That keeps it a single call — `window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);`
— in each page's init, after `loadGameData()`.

**Styling** goes in `static/styles.css` (66 KB — Grep, never read whole). Reuse existing
tokens: grep `:root` for the accent/glow/surface custom properties, and look at
`.arena-popup` (the in-battle status popup) for an existing floating-notice treatment and
`.card-overview` / `.overview-content` for the page grid. Do not introduce a new colour
system.

## Steps

- [ ] 1. **`achievements.html`** (new, repo root) — the `overview.html` skeleton with
  `<title>Pokemon Rogue Pocket - Achievements</title>`, `<body class="game-page achievements-page">`,
  a back link to `index.html`, a header with an `id="achievement-count"` pill, and
  `<div id="achievements-root" class="achievements-list">` holding the loading placeholder.
  Scripts: `arena/arena_data.js`, `arena/arena_model.js`, `map/profile.js`,
  `map/achievements.js`.

- [ ] 2. **`map/achievements.js`** (new) — the page controller, following
  `arena/card_overview.js`'s structure:

  ```js
  (function bootAchievementsPage(arena) {
      'use strict';

      const state = { root: null };

      document.addEventListener('DOMContentLoaded', init);

      async function init() {
          state.root = document.getElementById('achievements-root');
          await arena.Data.loadGameData();
          render();
          window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);
      }
      …
  })(window.CardArena = window.CardArena || {});
  ```

  `render()` filters to enabled records, maps each through a row renderer per the rules in
  "Context you need", paints the header count, and handles the empty state. Include a local
  `escapeHtml` helper — `map/starter.js` (~80) has the exact one this codebase uses; copy
  it rather than inventing another.

- [ ] 3. **`index.html`** — add
  `<a href="achievements.html" class="btn">Achievements</a>` inside
  `<div class="button-container">`, after the Card Overview link.

- [ ] 4. **`map/profile.js`** — add `showPendingUnlocks(achievements)`:

  ```js
    function showPendingUnlocks(achievements) {
        if (typeof document === 'undefined' || !document.body) return [];

        const pending = takePendingUnlocks();

        if (pending.length === 0) return [];

        const byId = new Map((Array.isArray(achievements) ? achievements : [])
            .filter(entry => entry && entry.id)
            .map(entry => [entry.id, entry]));

        pending.forEach((id, index) => {
            const achievement = byId.get(id);

            showUnlockToast(achievement ? achievement.name : id,
                achievement ? achievement.description : '', index);
        });

        return pending;
    }
  ```

  plus a private `showUnlockToast(name, description, index)` that builds the element,
  appends it to `document.body`, staggers its entrance by `index * 220`ms, and removes it
  after ~4s. The editor's `showToast` in `dev/editor/app.js` (~305) is the pattern for the
  add / `requestAnimationFrame` / class-toggle / remove dance — copy its structure, not its
  classes. Export `showPendingUnlocks` in the alphabetical export list; keep
  `showUnlockToast` private.

  **Guard it:** `takePendingUnlocks()` must only be called after the `document` check, so a
  Node require never drains the queue.

- [ ] 5. **`static/styles.css`** — add an `.achievements-page` block:
  - `.achievements-list` — a responsive grid (`repeat(auto-fill, minmax(280px, 1fr))`) that
    collapses to one column on narrow screens;
  - `.achievement-row` with `--locked` / `--unlocked` modifiers (locked reads dimmer);
  - `.achievement-progress` + `.achievement-progress-bar` (a simple filled div, width set
    inline as a percentage — no animation library);
  - `.achievement-toast` + `.achievement-toast.is-visible`, fixed-position, stacking
    downward, `pointer-events: none`, above everything (check what `z-index` the existing
    overlays use and stay consistent).
  All colours from existing custom properties.

- [ ] 6. **Six page controllers** — add the one-line drain to each page's init, right after
  its `await arena.Data.loadGameData()`:
  `window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);`
  Pages: `map/area.js`, `arena/game.js`, `map/event.js`, `map/capture.js`, `map/attack.js`,
  `map/mart.js`. Read each init before editing — `arena/game.js`'s (~23) does more than the
  others.

- [ ] 7. **`tests/achievements.test.js`** — add a case that `showPendingUnlocks` returns
  `[]` and does **not** drain the queue when `document` is undefined (the Node case), so a
  future refactor cannot silently swallow a player's toasts.

- [ ] 8. **`node tests/run_all.js`** — green.

- [ ] 9. **`dev/verify/phase95_achievements.py`** — new Playwright driver modeled on the
  existing page drivers (`dev/verify/drive_starter.py` is the simplest one). It should:
  seed a profile in localStorage via `page.add_init_script` or an `evaluate` before
  navigation (some unlocked, some partial, one hidden), open `achievements.html`, and
  screenshot to `dev/verify/phase95_achievements.png` showing all three row states.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `dev/verify/phase95_achievements.py` runs clean and its screenshot shows an unlocked
  row, a locked row with a progress bar, and a hidden `???` row.
- [ ] Served manually (`python3 -m http.server 8931 --bind 127.0.0.1`): the main menu shows
  the Achievements link; the page lists the six seeded achievements with a correct
  `n / total` header count; the back link returns to the menu.
- [ ] Toast end to end: clear the profile
  (`localStorage.removeItem('pokemon-rogue-pocket-profile')`), start a run, win the first
  battle, click Continue back to the map, and confirm **First Blood** toasts on
  `area.html`, then does **not** toast again on the next page load.
- [ ] A hidden achievement reveals its real name and description once unlocked.
- [ ] Responsive check at 390px: rows stack one per line and the toast does not overflow
  the viewport.
- [ ] No console errors on any page.
- [ ] Stop the server: `pkill -f "http.server 8931"`.

## Out of scope / do not touch

Event conditions (phase 96) and the editor (phase 97). Do not change what
`map/profile.js` *counts* or when — phase 94 owns that. Do not restyle `index.html`'s menu
beyond adding the one link. Do not add achievements to `achievements.json` beyond the six
phase 94 seeded. Do not touch battle, run, or map logic.
