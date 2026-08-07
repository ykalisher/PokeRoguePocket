# Battle music — batch overview

> **Amended 2026-08-07 (owner request), after the batch shipped.** The `trainer`
> category is no longer per-battle music: it is the **map level's** music. One track is
> picked when a level's map loads, stored on the run as `musicTrackId`, and played across
> every page of that level — map, mart, capture, event, attack, and standard/ace battles —
> resuming its position across page loads (`localStorage['pokemon-rogue-pocket-audio-track']`).
> Only `boss` / `elite` / `legendary` battles interrupt it with their own song, and the
> level track returns when the battle ends. A level advance clears `musicTrackId`, so each
> level gets a new song. The sections below describe the original per-battle wiring;
> `arena/audio.js`, `map/run_state.js` (`ensureLevelMusic`), and `arena/game.js` are the
> current source of truth.

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either. **The browser's built-in
  `Audio` / `HTMLAudioElement` is a native API, not a dependency** — that is what this batch
  uses. No Web Audio graph, no library.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs).
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change.
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names
  (`'boss'`, `'capture'`, rank `'Boss'`). Never rename internals to match UI. **This applies
  to the music categories too**: the stored category value is `boss`, the label the owner
  sees in the editor is "Gym Leaders".
- **Do not add song files.** The owner supplies the music. This batch ships an empty
  manifest and an `assets/music/` directory; a missing category must degrade to silence, not
  an error.

## What is being built (context)

The game has no audio of any kind today — no `<audio>` element, no sound file, no volume
setting. This batch adds battle music: when a battle starts, a random track from the
matching category plays on loop until the battle ends.

The owner supplies the songs and registers them from the data editor, which uploads the
file into `assets/music/` and writes a row into `music.json`. Everything else — which song
plays, mute, volume — is engine-side.

Owner decisions locked on 2026-08-05:

- **Four categories**, matching trainer rank.
- **MP3 only.**
- **Mute toggle *and* volume slider**, both inside the existing in-battle pause menu.
- **Song files are committed** to the repo, like the 663 images already in `assets/`.

## Locked spec

### `music.json`

Root data file, array of records:

```json
[
  {
    "id": "gym-leader-theme",
    "title": "Gym Leader Theme",
    "category": "boss",
    "file": "assets/music/gym-leader-theme.mp3",
    "enabled": true
  }
]
```

- `id` — unique lowercase slug; also the uploaded file's basename.
- `title` — the label in the editor. Never shown in-game.
- `category` — one of `trainer` | `boss` | `elite` | `legendary`.
- `file` — repo-relative path, always `assets/music/<id>.mp3`. Stored as a full path (not
  just a basename) so it matches how `locations.json` stores `background`.
- `enabled` — `false` takes the track out of rotation without deleting the file.

The file ships as `[]`. **Editor labels**: "Standard/Ace Trainers", "Gym Leaders",
"Elites", "Legendary Battles".

### Category resolution

From `activeTrainer.rank` in `arena/game.js`:

| Rank | Category |
|---|---|
| `Standard`, `Ace` | `trainer` |
| `Boss` | `boss` |
| `Elite` | `elite` |
| `Special` | `legendary` |

Rank `Special` is exactly the legendary slot: `map/locations.js:206`
(`isAllowedTrainerRank`) excludes `Special` from every map node, so those trainers are only
ever reached through legendary/special trainer events. There are 16 of them today
(Regice, Articuno, Mewtwo, Lugia, …, plus Mecha Cop and Mega Gyarados).

**No trainer, no rank:** the `game.html` "Battle Prototype" path (`resetPrototype()` with
no run) falls back to `trainer`.

### Playback behavior

- One track at a time, `loop = true`, chosen uniformly at random from the enabled tracks in
  that category.
- An empty category is **silence**, not an error, not a fallback to another category.
- Music stops when the battle finishes (win or loss overlay) and when leaving the page.
- Settings persist in localStorage key **`pokemon-rogue-pocket-audio`**:
  `{ "version": 1, "muted": false, "volume": 0.6 }`. Volume is 0–1; the slider shows 0–100.
- Muting stops playback but remembers the track, so unmuting resumes.

### The autoplay hazard

This is the part most likely to be got wrong. Browsers refuse `audio.play()` until the page
has seen a user gesture, and **`game.html` is reached by navigation**, so a restored
mid-battle reload has no gesture at all. `audio.play()` returns a promise that *rejects*
with `NotAllowedError`.

Locked behavior: catch the rejection, and register a **one-shot** `pointerdown` + `keydown`
listener on `document` that retries the same track. Never spam retries, never surface an
error to the player, and never let the rejection reach the console as an unhandled promise.

(The normal path is fine: `renderTrainerIntro()` shows a button whose click calls
`startRunBattle()`, which is a genuine gesture.)

## Cross-phase architecture facts

Verified in the repo on 2026-08-05. Line numbers are drift-prone hints.

**Nothing audio-related exists.** `grep -rni "audio\|\.mp3\|playSound" --include=*.js
--include=*.css --include=*.html .` matches only a coincidental string in
`arena/trainer_sprites.js`. There is no `assets/music/` directory yet.

**`arena/game.js`** (524 lines) holds the battle lifecycle:

| Function | Line | Relevance |
|---|---|---|
| `initGame` | ~23 | awaits `arena.Data.loadGameData()`, then branches: restore saved battle / show saved result / `renderTrainerIntro()` / `renderBattleUnavailable()` / `resetPrototype()` |
| `activeTrainer` | ~10 | module-level; `.rank` is the category input |
| `startRunBattle` | ~146 | fired by the intro screen's Start button — a real user gesture |
| `handleBattleFinished` | ~156 | both outcomes land here |
| `completeBattleAndReturnToMap` | ~343 | navigates away to `area.html` |
| `startOver` | ~362 | navigates away to `starter.html` |

**`game.html`** loads, in order: `trainer_sprites`, `arena_data`, `arena_model`,
`arena_render`, `arena_controller`, `arena_drag`, `run_state`, `locations`,
`event_effects`, `game`. The audio module goes before `game.js`.

**The pause menu** is `renderMenuWindow()` in `arena/arena_render.js` (~993) — a
`.battle-flow-overlay` + `.battle-result-window` with a `.battle-flow-actions` row of
buttons. It is opened by `toggle-menu` and closed by `close-menu`, both routed through
`handleArenaClick` in `arena/arena_controller.js` (~193). Adding controls means: markup in
`renderMenuWindow`, a `data-action` case in `handleArenaClick` for the mute toggle, and an
`input` listener for the slider (a `range` input does not emit `click`, so it needs its own
listener — wire it on `state.elements.board` next to the existing click listener in
`arena/game.js`'s `initGame` (~33), or inside the controller; either is fine, but say which
and do it once).

**Data loading** is `arena/arena_data.js`: `fallbackRecords` (~60), `normalizeGameData`
(~533), `loadGameData` (~568), plus `arena.GameData = normalizeGameData(fallbackRecords)` at
module load (~582).

**Editor upload machinery** in `dev/editor/server.js`:

- `UPLOAD_ROUTES` (~110) — one entry per asset dir, each `{ lookup(data, key),
  deriveFileName(record) }`. Current dirs: `portraits`, `sprites`, `items`, `backgrounds`.
- `handleUpload` (~362) — drains the body, looks the record up, checks `PNG_MAGIC`
  (`0x89 P N G`), derives the filename, guards against path escape, writes.
- `MAX_BODY_BYTES` (~87) — a single global `5 * 1024 * 1024`, enforced inside
  `readRawBody` (~193).
- `MIME_TYPES` (~89) — `.html/.js/.css/.json/.png/.svg/.ico`. No audio type.
- `handleGetAssets` (~336) lists the four asset dirs plus `types-svgs` and `status-icons`.
- The browser side is `EditorApp.uploadAsset(dir, key, file)` in `dev/editor/app.js` (~247),
  which POSTs, re-fetches `/api/assets`, recomputes issues, and toasts.

`assetIndexFrom(assets)` in `dev/editor/app.js` (~238) builds `Set`s for exactly the four
existing dirs — a fifth must be added there **and** in `buildAssetIndex` in `server.js`
(~155), or `validate.js` will see an undefined index and silently skip the file-exists rule.

**MP3 magic bytes:** an ID3v2 tag (`0x49 0x44 0x33`, "ID3") or a raw MPEG frame sync
(`0xFF` followed by a byte whose top three bits are set, i.e. `byte & 0xE0 === 0xE0`).
Accept either. This is a local-only dev tool, so a cheap check is the right amount.

**Test helpers:** `tests/helpers/arena_env.js` (engine in Node, in-memory `localStorage`,
`loadRealGameData()`), `tests/helpers/editor_env.js` (editor modules). Neither has an
`Audio` constructor, so the audio module's playback path must be **unreachable** in Node —
put the track-choosing logic in a pure function and test that.

**Browser verification:** `dev/verify/lib.py` `serving()` on 127.0.0.1:8931, venv at
`dev/verify/.cache/venv/bin/python`, battle drivers `drive_arena.py` / `autoplay_arena.py`,
editor driver `drive_editor.py`. Chromium in this setup can be launched with
`--autoplay-policy=no-user-gesture-required` when a driver needs to assert playback without
faking a click — check `lib.py`'s launch args and add the flag there only if a driver
genuinely needs it.

## Phases

| File | What it does | Order |
|---|---|---|
| `99-audio-module.md` | `music.json`, its loader, and `arena/audio.js` (`window.PokeAudio`) with settings + the autoplay retry. Node tests for the pure parts. | **first** |
| `100-battle-music-wiring.md` | Start/stop music around the battle lifecycle in `arena/game.js`; mute toggle + volume slider in the pause menu. Browser-verified. | after 99 |
| `101-music-editor-tab.md` | MP3 upload route, the Music tab, and validation. | after 99; independent of 100 |
