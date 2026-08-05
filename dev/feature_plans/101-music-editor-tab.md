# Phase 101 — Music: the Music tab and MP3 uploads in the data editor

**Recommended agent:** Opus · medium effort.
(Opus because it widens the upload path — a route that writes binary files to disk. The
path-escape guard, the magic-byte check and the body cap all have to stay correct while
gaining a second file type.)
**Prereqs:** phase 99 (`music.json` must exist). Independent of phase 100.
**Read first:** `98-music-overview.md`.
**Goal:** In `node dev/editor/server.js` → 127.0.0.1:8932 the owner can add a song: create
the record, pick a category, upload the `.mp3`, and hear it in an inline preview. Validated
by the same write guard as every other file.

## Context you need

Read the overview's "Locked spec" for the record shape and category labels, and its
"Cross-phase architecture facts" for the upload machinery.

**The five plumbing points for a new data file** (same routine as every other):
`FILE_NAMES` in `dev/editor/server.js` (~85); `PLAIN_FILES`/`SMART_FILES` in
`dev/editor/format_json.js` (~64 — `formatDataFile` **throws** on unknown names);
`FILE_TO_TAB` in `dev/editor/app.js` (~30); a validator wired into `validateAll` in
`dev/editor/validate.js` (~769); a `<script>` tag in `dev/editor/index.html`.
Music records are flat objects of primitives ⇒ **`PLAIN_FILES`**.

**The upload path**, all in `dev/editor/server.js`:

```js
const MAX_BODY_BYTES = 5 * 1024 * 1024;                                  // ~87
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);                 // ~88

const UPLOAD_ROUTES = {                                                  // ~110
    portraits:   { lookup: (data, key) => data.pokemon.find(r => r.name === key),  deriveFileName: (r) => `${r.name}.png` },
    …
};

function readRawBody(req) { … MAX_BODY_BYTES … }                         // ~193
async function handleUpload(req, res, dir, rawKey, config) { … }         // ~362
```

`handleUpload` currently: drains the body (cap enforced inside `readRawBody`), resolves the
route, decodes the key, looks the record up in `readAllData(config.dataDir)`, checks
`PNG_MAGIC`, derives the filename, **resolves it against the target dir and rejects any path
that escapes**, `mkdirSync`, `writeFileSync`, and returns `201` with the repo-relative path.
Every one of those steps must survive.

Three changes are needed and they interact:

1. **The body cap is global.** Songs are megabytes; 5 MB is too small. Make the cap
   per-route rather than raising it for PNGs: give `readRawBody(req, maxBytes)` a parameter
   defaulting to `MAX_BODY_BYTES`, and have `handleUpload` pass the route's own limit
   (`route.maxBytes || MAX_BODY_BYTES`). `music` gets `25 * 1024 * 1024`.
   **Order matters:** `handleUpload` drains the body *before* resolving the route
   (deliberate — the cap applies uniformly), so resolving the route has to move above the
   drain. Do that carefully: an unknown `dir` must still return 400, and the connection
   must still be drained rather than left half-read. The simplest correct shape is to look
   the route up first, 400 on unknown, then drain with that route's cap.

2. **The magic check is hard-coded to PNG.** Move it onto the route as a
   `verifyMagic(buffer)` function, so each route declares its own. MP3:

   ```js
   const ID3_MAGIC = Buffer.from([0x49, 0x44, 0x33]);   // "ID3"

   function isMp3(buffer) {
       if (buffer.length < 4) return false;
       if (buffer.subarray(0, 3).equals(ID3_MAGIC)) return true;
       // Raw MPEG frame sync: 11 set bits.
       return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
   }
   ```

3. **The asset index has four hard-coded dirs** in three places:
   `UPLOAD_DIR_NAMES` (~86), `buildAssetIndex` (~155) and `handleGetAssets` (~336) in
   `server.js`, plus `assetIndexFrom(assets)` in `dev/editor/app.js` (~238). Miss any one
   and `validate.js` sees an undefined index and silently skips the file-exists rule.

**MIME.** `MIME_TYPES` (~89) needs `'.mp3': 'audio/mpeg'`, or the `<audio>` preview served
from the editor gets `application/octet-stream` and will not play.

**The tab.** `dev/editor/tab_locations.js` (400 lines) is the model, and its background
upload block (~120–145) is the closest existing pattern for "record names a file, show
whether it exists, offer an Upload… button":

```js
        return `
            <div class="editor-location-bg-placeholder">
                <code>${escapeHtml(path)}</code><br>
                <span class="editor-badge editor-badge--warning">missing file</span>
                <button type="button" class="editor-btn editor-btn--small" data-role="upload-background-btn" ${draft.id ? '' : 'disabled'}>Upload…</button>
                <input type="file" accept="image/png" data-role="upload-background-input" hidden>
```

The shared upload helper is `EditorApp.uploadAsset(dir, key, file)` (`dev/editor/app.js`
~247): it POSTs, re-fetches `/api/assets`, recomputes issues, and toasts either way.
**It uploads against a record that already exists on disk** (`handleUpload` looks the key up
in `readAllData`), so the form must make clear that a new track has to be **saved before its
file can be uploaded** — disable the Upload button while `draft.id` is empty or the record
is unsaved, exactly as `tab_locations.js` disables it without an `id`.

**Round-trip fidelity is binding:** mutate the `structuredClone` draft in place; saving an
untouched record must produce an empty `git diff music.json`.

## Steps

- [x] 1. **`dev/editor/server.js`** — `FILE_NAMES` (~85) gains `'music'`;
  `UPLOAD_DIR_NAMES` (~86) gains `'music'`; `MIME_TYPES` (~89) gains
  `'.mp3': 'audio/mpeg'`.

- [x] 2. **`dev/editor/format_json.js`** — add `'music'` to `PLAIN_FILES` (~64), then prove
  byte-exactness:
  `node -e "const {formatDataFile}=require('./dev/editor/format_json.js');const fs=require('fs');const cur=fs.readFileSync('music.json','utf8');console.log(formatDataFile('music',JSON.parse(cur))===cur?'BYTE-EXACT':'DIFFERS')"`
  If it differs, rewrite `music.json` to the formatter's output.

- [x] 3. **`dev/editor/app.js`** — `FILE_TO_TAB` (~30) gains `'music.json': 'music'`;
  `assetIndexFrom` (~238) gains `music: new Set(assets.music)`.

- [x] 4. **`dev/editor/server.js`** — `buildAssetIndex` (~155) and `handleGetAssets` (~336)
  both gain the `music` directory (`path.join(config.dataDir, 'assets', 'music')`).

- [x] 5. **`dev/editor/server.js`** — per-route magic + cap. Add `isMp3` (the snippet in
  "Context you need") and a `isPng` wrapping the existing `PNG_MAGIC` comparison, then give
  every `UPLOAD_ROUTES` entry a `verifyMagic` and let `music` set `maxBytes`:

  ```js
      music: {
          lookup: (data, key) => data.music.find((record) => record.id === key),
          deriveFileName: (record) => `${record.id}.mp3`,
          verifyMagic: isMp3,
          magicError: 'body is not an MP3 (expected an ID3 tag or an MPEG frame sync)',
          maxBytes: 25 * 1024 * 1024
      }
  ```

  Give the four existing routes `verifyMagic: isPng` and the current PNG error message so
  behavior is byte-identical for them.

- [x] 6. **`dev/editor/server.js`** — `readRawBody(req, maxBytes = MAX_BODY_BYTES)`: use the
  parameter in the size check and in the 413 message. Its only other caller is
  `readJsonBody` (~228), which keeps the default.

- [x] 7. **`dev/editor/server.js`** — `handleUpload` (~362): resolve the route **first**
  (400 on unknown `dir`), then drain with `route.maxBytes || MAX_BODY_BYTES`, then run
  `route.verifyMagic(buffer)` instead of the inline PNG check, reporting
  `route.magicError`. Leave the key decoding, the record lookup, the
  `targetPath.startsWith(targetDir + path.sep)` escape guard, the `mkdirSync`, and the
  `201` response shape exactly as they are.

- [x] 8. **`dev/editor/validate.js`** — `validateMusic(music, assetIndex)`, wired into
  `validateAll` (~769) with `const music = data.music || [];`. Issues on
  `file: 'music.json'`, `recordKey` = the id:

  | Code | Severity | Condition |
  |---|---|---|
  | `music.missing-id` | error | no non-empty `id` |
  | `music.duplicate-id` | error | `id` seen twice |
  | `music.bad-id` | error | `id` is not `^[a-z0-9-]+$` (it becomes a filename) |
  | `music.bad-category` | error | `category` not in `trainer`/`boss`/`elite`/`legendary` |
  | `music.bad-file-path` | error | `file` is not `assets/music/<id>.mp3` |
  | `music.missing-file` | error | `assetIndex.music` does not contain `<id>.mp3` |
  | `music.empty-category` | warning | dataset-level (`recordKey: '(dataset)'`), a category with no enabled track |

  Mirror the category list as a `DEFAULT_MUSIC_CATEGORIES` constant beside
  `DEFAULT_EFFECT_TYPES` (~21) with a comment naming `arena/arena_data.js` as the source,
  the same way the other duplicated vocabularies are handled.

  `music.missing-file` is an **error**, which means the write guard blocks saving a record
  whose file is not uploaded yet. That is a trap for the "save first, then upload" flow, so
  make it a **warning** instead if that ordering proves unworkable during step 12 — decide
  from the actual behavior and record the decision in the phase notes.

- [x] 9. **`dev/editor/validate.js`** — `validateAssets` (~672) already reports orphaned
  files for other dirs if that pattern exists there; if it does, add the matching
  `music.orphan-file` **warning** for an `.mp3` in `assets/music/` that no record names.
  If it does not, skip this step rather than inventing a new convention.

- [x] 10. **`dev/editor/tab_music.js`** (new) — the tab module, standard IIFE header,
  `EditorApp.registerTab('music', { label: 'Music', render });` last.
  - `columns()`: `title` (sortable), `id` (sortable), `category` rendered with its **UI
    label** ("Gym Leaders", not `boss`), a file-present `editor-dot`, and an enabled dot.
  - `template()`: `{ id: '', title: '', category: 'trainer', file: '', enabled: true }`.
  - `renderPreview(el, draft)`: the title, the category label, and an
    `<audio controls preload="none" src="/assets/music/<id>.mp3">` when the file exists —
    otherwise a "no file uploaded yet" placeholder. The editor server serves the repo
    statically, so the path just works once `MIME_TYPES` knows `.mp3`.
  - `renderForm(el, draft, api)`: `id` + `title` on one row; `category` select using the UI
    labels with the stored values; `enabled` checkbox; then a file block copied from
    `tab_locations.js`'s background block — a `Set canonical path` button that writes
    `assets/music/<id>.mp3`, an `Upload…` button + hidden
    `<input type="file" accept="audio/mpeg,.mp3">` calling
    `EditorApp.uploadAsset('music', draft.id, file)`, both disabled while `draft.id` is
    empty. Add a hint: **"Save the track first, then upload its file — the upload is matched
    to the saved record's id."**
  - `render(root)`: `+ Add track` toolbar button and
    `EditorListView.createListView({ … records: EditorApp.store.data.music, getKey: (r) => r.id,
    searchFields: ['title', 'id'], filters: [category, enabled], defaultSort: { key: 'title',
    direction: 'asc' }, onSelect: openMusicEditor })`.

- [x] 11. **`dev/editor/index.html`** — add `<script src="/dev/editor/tab_music.js"></script>`
  in the tab-module block, before `tab_issues.js`.

- [x] 12. **`tests/editor_api.test.js`** — extend, using the temp data dir the file already
  sets up:
  - `GET /api/data` includes a `music` array and `GET /api/assets` includes a `music` list;
  - `POST /api/assets/music/<id>` with an `ID3`-prefixed buffer writes
    `assets/music/<id>.mp3` and returns `201`;
  - the same POST with a PNG buffer returns `400` with the MP3 magic error;
  - a POST for an id **not** in `music.json` returns `404`;
  - a PNG upload to `portraits` still works and still rejects a non-PNG (regression guard
    for the per-route refactor);
  - a `PUT /api/data/music` with a bad `category` returns `409`.

- [x] 13. **`tests/editor_format.test.js`** and **`tests/editor_validation.test.js`** — add
  `music` to the byte-exactness coverage and one case per rule from step 8.

- [x] 14. **`node tests/run_all.js`** — green.

- [x] 15. Drive the editor. Adapt `dev/verify/drive_editor.py` into
  `dev/verify/phase101_editor_music.py`, screenshotting to
  `dev/verify/phase101_editor_music.png`. Exercise: `+ Add track` → fill id/title/category
  → Save → the Upload button enables → upload a small MP3 → the preview shows an `<audio>`
  player and the file dot turns on. Clean up in a `finally`: delete the uploaded file and
  `git checkout -- music.json`.

## Verification

- [x] `node tests/run_all.js` green, with the PNG regression cases from step 12 passing.
- [x] `dev/verify/phase101_editor_music.py` runs clean and afterwards
  `git status --porcelain` shows **no** stray `.mp3` and `music.json` unchanged.
- [x] Upload cap: a >25 MB body to `/api/assets/music/<id>` returns **413**, and a >5 MB
  body to `/api/assets/portraits/<name>` still returns 413 (the per-route cap did not leak).
- [x] Path-escape guard intact: a record whose id somehow contains `../` is already
  impossible via `music.bad-id`, but confirm `handleUpload`'s
  `targetPath.startsWith(targetDir + path.sep)` check is still present and reachable.
- [x] `curl -s 127.0.0.1:8932/api/issues` reports the `music.empty-category` warnings (four
  of them, since the shipped manifest is empty) and no new errors.
- [x] End to end with the game: register one track per category through the editor, upload
  real MP3s, then serve on 8931 and confirm a battle plays the right category (this is the
  phase-100 behavior, verified here against editor-authored data). **Remove the fixtures
  afterwards.**

## Out of scope / do not touch

`arena/audio.js` and `arena/game.js` (phases 99–100 own playback). Do not change the PNG
upload behavior, the write guard's logic, the static-file cache headers, or any other
validator's codes. Do not add non-battle music, sound effects, or a second audio format —
MP3 only was the owner's decision. Do not commit song files.

## Phase notes

- **`music.missing-file` shipped as a warning, not an error** (step 8's escape hatch).
  With it as an error the write guard's `inWrittenFile` filter blocks the very first save
  of a new track — and `handleUpload` looks the id up in `music.json`, so the file cannot
  exist before that save. Error severity would make registering a song impossible. Pinned
  by `tests/editor_validation.test.js` ("missing file warns…") and by the 200-status
  `PUT /api/data/music` test in `tests/editor_api.test.js`.
- Step 9's orphan pattern did exist in `validateAssets`, so `music.orphan-file` was added
  there beside the other orphan rules. It ignores non-`.mp3` entries because
  `assets/music/` also holds a `README.md`.
- Unknown upload dirs now 400 *before* the body is drained-with-a-cap (the connection is
  still drained to completion). Previously an oversized body to an unknown dir returned
  413; it now returns 400, which is the more accurate answer.
- `dev/verify/drive_editor.py`'s tab-count assertion went 9 → 10 for the new Music tab.
- End-to-end (last verification bullet) was run with a throwaway script that authored one
  track per category through the editor's own write path (`PUT /api/data/music` +
  `POST /api/assets/music/<id>`) and then drove `game.html` on 8931: the battle picked
  `assets/music/e2e-trainer.mp3`, `loop === true`, `paused === false`. Fixtures removed;
  `git status` clean afterwards.
