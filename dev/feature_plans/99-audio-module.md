# Phase 99 — Music: the audio module and music.json

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `98-music-overview.md`.
**Goal:** `music.json` exists and loads with the rest of the game data, and a new
`arena/audio.js` exposes `window.PokeAudio` — category playback, mute, volume, persisted
settings, and the autoplay-retry fallback. Ends green with `tests/music.test.js`. Nothing
plays yet because nothing calls it; that is phase 100.

## Context you need

Read the overview's "Locked spec" for the `music.json` record shape, the settings key, and
the autoplay rule.

**Two new files:** `music.json` (root) and `arena/audio.js`. Plus a small edit to
`arena/arena_data.js`.

**Data loading pattern** in `arena/arena_data.js`: `fallbackRecords` (~60),
a `normalize*` function per collection, `normalizeGameData` (~533), `loadGameData` (~568)
`Promise.all` of `loadJson(path, fallback)` calls, and the module-load
`arena.GameData = normalizeGameData(fallbackRecords)` (~582). Every collection must survive
normalization before any fetch happens.

**Module style.** `arena/audio.js` is a `window`-namespace IIFE like every other file in
`arena/`:

```js
/**
 * Pokemon Rogue Pocket - battle music
 */

(function attachAudio(global) {
    'use strict';
    …
    global.PokeAudio = { … };   // alphabetical export list
})(window);
```

**Binding constraints:**

- **Node-safe and load-inert.** `tests/run_all.js` syntax-checks every tracked JS file, and
  a test may `require` this module. It must not construct an `Audio` at load time, must not
  touch `document` at load time, and must guard `localStorage` with
  `typeof localStorage !== 'undefined'` the way `map/run_state.js` does (~743).
- **One element, reused.** Create a single `HTMLAudioElement` lazily on first play and keep
  it. Creating a new one per battle leaks and makes mute/volume state fiddly.
- **Silence is a valid outcome.** No enabled track in the requested category ⇒ stop
  whatever is playing and return `null`. Never fall back to another category, never throw,
  never log an error.
- **The autoplay rejection must never surface.** `play()` returns a promise; attach a
  `.catch`. On `NotAllowedError`, arm a single retry (see step 5) — do not retry in a loop
  and do not re-arm if one is already armed.

**Separate the pure part.** `pickTrack(tracks, category, randomFn)` takes the array and
returns a record (or `null`) with no DOM involved. That is the only part Node can test, and
it is where the selection rules live. `randomFn` defaults to `Math.random` so tests can
inject a deterministic one.

## Steps

- [ ] 1. **`music.json`** (new, repo root) — exactly `[]` plus a trailing newline. The owner
  adds tracks through the editor (phase 101).

- [ ] 2. **`assets/music/`** — create the directory. Git does not track empty directories,
  so add a short `assets/music/README.md` explaining that `.mp3` files here are registered
  in `music.json` and uploaded through the data editor's Music tab. (Do **not** add a
  `.gitkeep`; a README is more useful and the owner confirmed the files themselves are
  committed.)

- [ ] 3. **`arena/arena_data.js`** — add `music: []` to `fallbackRecords` (~60), a
  `normalizeMusicTrack(record)` next to the other normalizers, wire it into
  `normalizeGameData` (~533) keeping the alphabetical key order, and add
  `loadJson('music.json', fallbackRecords.music)` to `loadGameData` (~568) with the
  destructure and argument order kept aligned.

  ```js
    const MUSIC_CATEGORIES = ['trainer', 'boss', 'elite', 'legendary'];

    /**
     * Normalizes one music track. Records without an id, or with an unknown
     * category, are dropped — a bad row must never crash boot or leak into a
     * category's rotation.
     */
    function normalizeMusicTrack(record) {
        if (!record || !record.id) return null;
        if (!MUSIC_CATEGORIES.includes(record.category)) return null;

        return {
            category: record.category,
            enabled: record.enabled !== false,
            file: record.file || `assets/music/${record.id}.mp3`,
            id: record.id,
            title: record.title || record.id
        };
    }
  ```

  Export `MUSIC_CATEGORIES` on `arena.Constants` if that object is where such lists already
  live — grep `arena.Constants` in `arena/arena_data.js` first and follow whatever it
  actually does rather than inventing a new home.

- [ ] 4. **`arena/audio.js`** — settings persistence:

  ```js
    const STORAGE_KEY = 'pokemon-rogue-pocket-audio';
    const STORAGE_VERSION = 1;
    const DEFAULT_VOLUME = 0.6;

    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' && raw.version === STORAGE_VERSION ? raw : {};
        const volume = Number(source.volume);

        return {
            muted: Boolean(source.muted),
            version: STORAGE_VERSION,
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME
        };
    }
  ```

  plus `loadSettings()` / `saveSettings()` wrapped in `try/catch` like
  `map/run_state.js`'s, and a module-level cache so reads are cheap.

- [ ] 5. **`arena/audio.js`** — the pure selector:

  ```js
    /**
     * Picks one enabled track from a category, uniformly at random. Returns null
     * when the category is empty — the caller treats that as silence.
     */
    function pickTrack(tracks, category, randomFn) {
        const pool = (Array.isArray(tracks) ? tracks : [])
            .filter(track => track && track.enabled !== false && track.category === category);

        if (pool.length === 0) return null;

        const roll = typeof randomFn === 'function' ? randomFn() : Math.random();

        return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
    }
  ```

  The `Math.min` clamp guards a `randomFn` that returns exactly 1.

- [ ] 6. **`arena/audio.js`** — the element and the autoplay retry:

  ```js
    let element = null;
    let currentTrack = null;
    let retryArmed = false;

    function getElement() {
        if (element || typeof Audio === 'undefined') return element;

        element = new Audio();
        element.loop = true;
        element.preload = 'auto';
        applySettingsToElement();

        return element;
    }

    function applySettingsToElement() {
        if (!element) return;

        const settings = getSettings();

        element.volume = settings.volume;
        element.muted = settings.muted;
    }

    /**
     * Browsers refuse playback until the page has seen a user gesture, and
     * game.html is reached by navigation. On refusal, arm ONE retry from the
     * next pointerdown/keydown and stay quiet until then.
     */
    function attemptPlay() {
        const audio = getElement();

        if (!audio || !currentTrack) return;

        const attempt = audio.play();

        if (!attempt || typeof attempt.catch !== 'function') return;

        attempt.catch(() => armAutoplayRetry());
    }

    function armAutoplayRetry() {
        if (retryArmed || typeof document === 'undefined') return;

        retryArmed = true;

        const retry = () => {
            document.removeEventListener('pointerdown', retry);
            document.removeEventListener('keydown', retry);
            retryArmed = false;
            attemptPlay();
        };

        document.addEventListener('pointerdown', retry);
        document.addEventListener('keydown', retry);
    }
  ```

- [ ] 7. **`arena/audio.js`** — the public API:

  ```js
    function configure(tracks) { … }              // stores the manifest; does not play
    function playCategory(category) { … }         // pick + load + attemptPlay; returns the track or null
    function stop() { … }                         // pause, reset currentTime, clear currentTrack
    function isMuted() / setMuted(muted) { … }    // persists; unmuting resumes the held track
    function getVolume() / setVolume(volume) { … }// clamps 0..1, persists, applies live
    function getCurrentTrack() { … }              // for tests and the verify driver
  ```

  `playCategory` must be idempotent for the same category: if the current track already
  belongs to that category and is playing, leave it alone rather than restarting it (a
  re-render must not restart the song). `setMuted(false)` calls `attemptPlay()` so unmuting
  resumes; `setMuted(true)` pauses but keeps `currentTrack`.

  Export alphabetically on `global.PokeAudio`: `configure`, `getCurrentTrack`, `getVolume`,
  `isMuted`, `pickTrack`, `playCategory`, `setMuted`, `setVolume`, `stop`, plus
  `STORAGE_KEY`.

- [ ] 8. **`tests/music.test.js`** — new file, `node:test` + `node:assert/strict`, requiring
  `./helpers/arena_env` first (localStorage shim + `window` alias) then `../arena/audio.js`.
  There is no `Audio` in Node, so every case here exercises the pure and settings paths:
  - `pickTrack` returns only enabled tracks of the requested category;
  - `pickTrack` returns `null` for an empty or all-disabled category;
  - `pickTrack` with an injected `randomFn` of `0`, `0.5` and `0.999` selects the expected
    index, and `randomFn` returning `1` does not go out of bounds;
  - `setVolume` clamps below 0 and above 1, and persists (assert the raw localStorage JSON,
    including `version`);
  - `setMuted` round-trips through storage;
  - corrupt storage (`'not json'`, then `{"version":99}`) yields the defaults without
    throwing;
  - `playCategory('boss')` with no `Audio` constructor returns the picked track (or `null`)
    and does not throw — proof the module is Node-safe;
  - `configure(null)` and `playCategory('nope')` are both safe no-ops.

- [ ] 9. **`tests/data_validation.test.js`** — add a case that `music.json` parses to an
  array and every record (currently none) has a unique id, a category in the locked list,
  and a `file` under `assets/music/`. It must pass on the empty file too.

- [ ] 10. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green with every case from step 8 passing.
- [ ] `node -e "globalThis.window=globalThis;require('./arena/audio.js');console.log(Object.keys(window.PokeAudio).sort().join(' '))"`
  prints the export list without throwing — proof of load-inertness with no `Audio`, no
  `document`, and no `localStorage`.
- [ ] `grep -rn "PokeAudio" --include=*.js --include=*.html . | grep -v tests/` shows only
  `arena/audio.js` — nothing is wired up yet, which is this phase's contract.
- [ ] `git status` shows the new `music.json`, `arena/audio.js`, `assets/music/README.md`,
  `tests/music.test.js`, and the `arena/arena_data.js` edit — and no stray `.mp3`.

## Out of scope / do not touch

`arena/game.js`, `game.html`, `arena/arena_render.js`, `arena/arena_controller.js` and
`static/styles.css` (phase 100 — nothing calls the module yet). The data editor (phase 101 —
`music` is deliberately **not** in `FILE_NAMES` yet; adding it without the formatter entry
makes `formatDataFile` throw). Do not add any song file. Do not build a Web Audio graph,
crossfades, sound effects, or per-page music — battles only, one element, one track.
