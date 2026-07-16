# Phase 28 — Editor shell: page, tabs, list framework, read-only lists

**Recommended agent:** Sonnet · high effort.
**Prereqs:** phase 27 (server). **Read first:** `25-data-editor-overview.md`.
**Goal:** `http://127.0.0.1:8932/` shows the editor app: seven tabs, all six data types
browsable as searchable/filterable/sortable lists (read-only), authentic game styling, a
read-only Issues tab, and a live issue-count badge in the tab bar. No editing yet. Ends
green + browsable.

## Context you need

- The overview's **"Editor page + rendering reuse"** section fixes the script/CSS order and
  the `<body class="game-page editor-page">` requirement; its **"List views"** table fixes
  every tab's columns, search fields, filters, and default sort. Follow both exactly.
- Existing prior art to imitate (read them first): `overview.html` +
  `arena/card_overview.js` — a working standalone page that loads game data and renders
  cards via `arena.Render.renderCardPreview`; its card factories (`card_overview.js:54-90`)
  are the shapes `preview.js` must produce. `static/styles.css` theme variables (`--gold`,
  `--panel-bg`, `--card-w`, …) are what `editor.css` should build on so the tool looks like
  the game.
- Data comes from the API, not `loadGameData()`: `GET /api/data` (raw arrays — the editing
  source of truth), `GET /api/enums`, `GET /api/assets`. Load all three in parallel in
  `EditorApp.init()`; store on `EditorApp.store = { data, enums, assets }`. (The arena
  scripts still load — they provide the renderer, model helpers, and
  `window.PokeRogue.TrainerSprites` — but the editor never reads `arena.GameData`.)
- Raw records are NOT normalized: `preview.js` owns the ~10-line local normalizers
  (overview "Editor page" section) and the three card factories, plus one convenience:
  `renderCardInto(el, kind, rawRecord)` → normalize → factory → `el.innerHTML =
  arena.Render.renderCardPreview(card)`. List thumbnails can use portrait/item image paths
  directly (`assets/portraits/<encodeURIComponent(name)>.png`, item `imagePath` or
  UPPER_SNAKE default, trainer `resolveSprite(name, record.sprite).path`).
- `list_view.js`: `createListView({ root, columns, records, getKey, searchFields, filters,
  defaultSort, onSelect })` → renders toolbar (search `<input>`, one `<select>` per filter,
  record count), a table with click-to-sort headers (asc/desc indicator), and rows calling
  `onSelect(record)` — selection does nothing visible yet beyond a highlight (phase 29
  attaches editors). Column spec: `{ key, label, render?(record) -> html, sortValue?(record),
  editable? }` — implement `editable` as a no-op flag for now (phase 29 fills it in). Expose
  an `update(records)` method that re-renders keeping search/sort/filter state.
- Type icons in cells: `<img class="type-icon" src="assets/types-svgs/<TYPE>.svg" alt="<TYPE>">`
  — same markup the game's `renderTypeIcons` (`arena/arena_render.js` ~`:771`) emits, so the
  existing `.type-icon` CSS applies. BST = `baseHealth + baseAttack + baseDefense +
  baseSpeed` (Venusaur = 350 — use as the sanity value).
- Issues badge + tab: compute **client-side** with `window.EditorValidation.validateAll(
  store.data, { enums, assetIndex, engineRefs })` — `assetIndex` = Sets built from
  `/api/assets`, `engineRefs` = the `/api/enums` payload's `engineRefs` plus
  `resolveSpriteFile` wired to `window.PokeRogue.TrainerSprites`. Re-run after every store
  change (phase 29+ will trigger it after saves; for now, once at init). Badge: red pill
  with error count when errors exist, else amber with warning count, hidden at zero. The
  Issues tab renders the same list read-only, grouped by `file`, `severity` filter select.
- Tab registry: each `tab_*.js` calls `EditorApp.registerTab(name, { label, render(root),
  onShow() })` — keep app.js generic; per-type knowledge lives in the tab files.
- Mind the harness: every new `.js` file here is browser-side; it must still pass
  `node --check` (the PostToolUse hook runs it on each edit — plain script files, no ESM
  `import`/`export`).

## Steps

- [ ] 1. **`dev/editor/index.html`** — the app page per the overview's stack: `<body
  class="game-page editor-page">`, absolute-path CSS (`/static/styles.css`,
  `/dev/editor/editor.css`) and scripts in the fixed order (4 arena files, `validate.js`,
  `preview.js`, `list_view.js`, `app.js`, the 7 tab files, inline `EditorApp.init()`).
  Static chrome: `<header>` with title + tab bar `<nav id="editor-tabs">`, `<main
  id="editor-view">`.
- [ ] 2. **`dev/editor/editor.css`** — editor chrome on top of the game theme: tab bar
  (active state, badge pill), toolbar, data table (sticky header, row hover/selected,
  right-aligned numeric cells), thumbnail sizing (`--card-w` NOT used for `<img>` thumbs —
  plain 32-40px), two-pane grid scaffold (`.editor-split { display:grid;
  grid-template-columns: minmax(260px, 1fr) 2fr; }`) for phase 29, `prefers-reduced-motion`
  irrelevant — keep it simple and theme-variable-driven.
- [ ] 3. **`dev/editor/preview.js`** — local normalizers (pokemon/attack/item), the three
  card factories copied from `card_overview.js:54-90`, `renderCardInto`, and small helpers:
  `typeIconHtml(type)`, `spritePathFor(trainerRecord)`, `itemImagePathFor(itemRecord)`
  (UPPER_SNAKE default per the overview). Expose as `window.EditorPreview`.
- [ ] 4. **`dev/editor/list_view.js`** — the generic component per the context spec.
  Expose as `window.EditorListView`.
- [ ] 5. **`dev/editor/app.js`** — `window.EditorApp`: `init()` (parallel fetch of
  `/api/data`, `/api/enums`, `/api/assets`; error banner on failure), `store`,
  `registerTab`, tab switching (re-render on show), `computeIssues()` + badge painting,
  and an `api` helper object (`getData`, later `putData`/`upload` — stub the write methods
  with TODO throws for phase 29).
- [ ] 6. **`dev/editor/tab_pokemon.js` … `tab_locations.js`** (6 files) — each registers its
  tab and builds its list view exactly per the overview's List-views table (columns, search,
  filters, default sort). Pokemon includes the computed BST column (sortable) and portrait
  thumbs; trainers show sprite thumbs + P/A/I deck sizes; events show gate-type icons +
  enabled dot; locations show the 5-color swatch strip. `onSelect` = highlight only.
- [ ] 7. **`dev/editor/tab_issues.js`** — read-only issues list per the context (grouped by
  file, severity filter), sourced from `EditorApp.computeIssues()`.

## Verification

- [ ] `node tests/run_all.js` green (all new files syntax-check; no behavior tests yet —
  the UI phases verify in-browser).
- [ ] With `node dev/editor/server.js` running, `http://127.0.0.1:8932/` in a browser (or
  the `verify` skill's Playwright venv pointed at that URL): seven tabs render; Pokemon tab
  shows 188 rows, Venusaur's BST reads 350, clicking the BST header sorts descending
  (Legendaries on top); typing `char` in search narrows to the Char-line; the type filter
  set to FIRE shows only FIRE-typed rows.
- [ ] Trainers tab: 95 rows, sprite thumbnails render (Gamer shows a sprite image);
  Locations tab: 12 rows with theme swatches and type icons.
- [ ] Issues badge is visible with a warning count ≥ 13 (12 missing backgrounds + Linoone
  orphan) and 0 errors; the Issues tab lists them grouped by file.
- [ ] Visual check: a rendered element with class `playing-card` appears nowhere yet (lists
  are tables) BUT the page uses the game font/colors (compare `overview.html` side by side).
  Kill the server when done.

## Out of scope / do not touch

No editing, saving, deleting, or uploads (phases 29–34). No changes to `server.js`,
`format_json.js`, `validate.js` (report gaps instead), no game code, no data JSON edits.
Inherit all batch ground rules from `25-data-editor-overview.md` (no `git commit`, no
`scripts/manage_*`, no `TODO.md`, no third-party deps, run `node tests/run_all.js` after
every change).
