# Data editor (dev-only GUI) — batch overview

Batch 4 (phases `26`–`34`). A **dev-only web app** for viewing and editing the six root
data files (`pokemon.json`, `attacks.json`, `items.json`, `trainers.json`, `events.json`,
`locations.json`) with live in-game card previews, search/filter/sort, an issues panel, and
asset uploads. It is served by a tiny local Node server (built-ins only) because it must
write files; it never ships with the game and no game page may ever load anything from it.
The owner locked all major decisions during planning — see **Locked spec**.

## Ground rules (binding)

Every phase in this batch inherits these:

- **Never `git commit`** (or `git add`) unless the owner explicitly asks. Other git reads are fine.
- **Never run or extend `scripts/manage_*.js`** — those are the owner's interactive CLIs.
- **Never act on `TODO.md`.**
- **No third-party deps / frameworks / CDNs / build step — anywhere, including the editor.**
  `dev/editor/` is dev-only tooling and uses **Node built-ins only** (`http`, `fs`, `path`,
  `os`, `url`); the browser side is plain JS/HTML/CSS. Owner approved this exemption
  July 2026; phase 27 records it in `AGENTS.md`.
- **The game must stay untouched.** Do not modify `arena/`, `map/`, `scripts/`, `static/`,
  root `*.html`, or the data JSONs (except as test fixtures in temp dirs) — the only
  exceptions are the explicit doc edits named in phases 27 (`AGENTS.md`) and 34
  (`CLAUDE.md`). No game file may reference `dev/editor/`.
- **The server binds `127.0.0.1` only** and defaults to port **8932** (the game's static
  server keeps 8931).
- **Run `node tests/run_all.js` after every change** (~3s; syntax-checks all tracked *and
  untracked* JS via `git ls-files -co`, then runs `tests/**/*.test.js`). A PostToolUse hook
  also `node --check`s every JS edit and `JSON.parse`s every JSON edit.
- **Line numbers in these docs are hints captured 2026-07-16 and WILL drift.** Relocate every
  reference by the named function / quoted string, then confirm the surrounding code.

## What is being built (context)

`node dev/editor/server.js` → open `http://127.0.0.1:8932/`. Seven tabs — Pokemon,
Attacks, Items, Trainers, Events, Locations, Issues — each a searchable/filterable/sortable
list. Selecting a record opens a detail editor: **visual preview on the LEFT** (the real
in-game card render, trainer sprite + deck of mini cards, themed location panel, event
reward cards), **form on the RIGHT**. Editing a field re-renders the preview instantly.
The pokemon list additionally shows a computed **BST** column and lets the four base stats
be edited **inline** in the table. The Issues tab (with a count badge in the tab bar) lists
invalid records and missing/orphaned image assets, with upload buttons to fix missing ones.

Run it locally only; it reads and writes the repo's real JSON files through its API.

## Locked spec (owner decisions — do not relitigate)

- **Saving is hybrid.** Inline list cells commit on Enter/blur (Escape reverts) and PUT
  immediately. Detail editors edit a **deep clone** (`structuredClone`) of the record, show
  a dirty indicator, and only PUT on an explicit **Save** button; **Revert** restores;
  switching record/tab while dirty prompts.
- **Delete is allowed but blocked while referenced.** The delete dialog lists every
  referencing record (trainers, events, engine refs) with jump-links; the server enforces
  the same rule (write guard below). No force button in the UI; the API accepts `?force=1`
  as a curl-only escape hatch.
- **Event effects get fully structured editors** for all **13** effect types — no raw JSON
  editing anywhere.
- **Missing assets are flagged AND uploadable.** Uploads land at the canonical `assets/…`
  path with a **server-derived** filename (never the client's filename).
- **Preview left, form right.**
- **Byte-clean diffs are a hard requirement.** Saving a record you didn't change must
  produce an empty `git diff` (exception: the very first save of `pokemon.json` /
  `attacks.json` adds their missing trailing newline — one byte, accepted). This is why the
  formatter below is byte-exact and why editors must mutate clones instead of rebuilding
  objects (unknown keys like `"source": "random"` in `events.json` and original key order
  must survive round-trips).

### File layout — `dev/editor/` (flat; every `.js` here is auto syntax-checked by run_all)

| File | Role |
|------|------|
| `server.js` | Node http server: static repo serving + JSON API + uploads |
| `format_json.js` | canonical per-file JSON formatter (dual-export) |
| `validate.js` | all validation rules + reference graph (dual-export, **pure** — no `require`s; every input passed as an argument) |
| `index.html` | the app page (served at `/`) |
| `editor.css` | editor chrome, loaded after `/static/styles.css` |
| `app.js` | `window.EditorApp`: store, API client, tab registry, save/dirty/delete framework, issues badge, toasts |
| `list_view.js` | generic list component: search, filters, sortable columns, editable cells |
| `preview.js` | local normalizers + card factories + `renderCardPreview` wrappers |
| `tab_pokemon.js` `tab_attacks.js` `tab_items.js` `tab_trainers.js` `tab_events.js` `tab_locations.js` `tab_issues.js` | one tab module each, registered into `app.js` |

### Dual-export module pattern (for `format_json.js` / `validate.js`)

```js
(function () {
    'use strict';
    function formatDataFile(fileName, data) { /* ... */ }
    const api = { formatDataFile };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.EditorFormat = api;   // window.EditorValidation for validate.js
}());
```

### Server + HTTP API

`node dev/editor/server.js [--port N] [--data-dir <path>]`. `--data-dir` redirects where the
six JSONs **and the four upload asset dirs** are read/written (tests use a temp dir); code,
CSS, and read-only assets are always served from the repo root. `server.js` exports
`{ createServer, start }` and only auto-starts under `require.main === module`, so tests can
boot it on port 0. All non-static responses are JSON; errors are `{ "error": "<message>" }`
with 400 (bad input), 404, 405, 409 (blocked write, adds `blocked: true, issues: […]`),
413 (body > 5 MB), 500.

| Method & path | Behavior |
|---|---|
| `GET /` | serves the **content** of `dev/editor/index.html` (`text/html`). The page must sit at the URL root so the relative `assets/…` URLs inside rendered card HTML resolve against the statically served repo root. `index.html` references its own resources absolutely (`/static/styles.css`, `/dev/editor/editor.css`, `/arena/…`, `/dev/editor/…`). |
| `GET /<repo path>` | static file from repo root. MIME map for `.html .js .css .json .png .svg .ico`; `decodeURIComponent` → `path.resolve` → reject unless result starts with the repo root; GET/HEAD only. |
| `GET /api/data` | `{ pokemon:[…], attacks:[…], items:[…], trainers:[…], events:[…], locations:[…] }` — the **raw parsed** file contents (NOT the game's normalized shapes). |
| `PUT /api/data/:file` | `:file` ∈ the six names. Body = the full replacement array. Runs the **write guard**; on pass, writes via `format_json.js` and replies `{ ok:true, count:N }`. `?force=1` skips the guard. |
| `GET /api/enums` | `{ PokeType, Status, StatChange, AttackTarget, ItemTarget, Rank, extensions, effectTypes, eventTypes, engineRefs }` — see "Enums & engine refs" below. |
| `GET /api/assets` | `{ portraits:[…], sprites:[…], items:[…], backgrounds:[…], typesSvgs:[…], statusIcons:[…] }` — filename listings (`fs.readdirSync`) of the six asset dirs. |
| `GET /api/issues` | `{ issues:[…], counts:{ error:N, warning:N } }` — server-side `validateAll` over current disk state + asset listings. |
| `POST /api/assets/:dir/:key` | asset upload — see table below. Raw binary body (client: `fetch(url, { method:'POST', body: file })`; **no multipart**), must start with PNG magic bytes `89 50 4E 47`, ≤ 5 MB. Replies 201 `{ ok:true, path:"assets/…" }`. |

**Write guard** (server-side; the delete-blocking mechanism): build the merged dataset
(disk state with `:file` replaced by the incoming array), run the shared `validateAll`
**before and after**, and reject 409 when (a) any record **in the written file** has an
`error`-severity issue, or (b) the write **introduces new** `error` issues anywhere
(set-difference on `code + recordKey`). Rule (b) is what blocks deleting a still-referenced
record — the deletion creates a fresh dangling-reference error in `trainers.json` /
`events.json` / engine refs — while pre-existing problems never wedge the editor. Asset
issues are always `warning` severity and never block.

**Upload routes** (allow-list — any other `:dir` is 400; `:key` must name an existing
record; derived paths are `path.resolve`d and prefix-checked against their asset dir):

| Route | Canonical target | Guard |
|---|---|---|
| `POST /api/assets/portraits/:pokemonName` | `assets/portraits/<name>.png` (raw name on disk; URLs encode it) | name exists in `pokemon.json` |
| `POST /api/assets/sprites/:trainerName` | `assets/sprites/<resolveSprite(name, record.sprite).file>` | trainer exists in `trainers.json` |
| `POST /api/assets/items/:itemName` | `assets/items/<UPPER_SNAKE(name)>.png` — reimplement `formatAssetName` (`arena/arena_data.js` ~`:518`): trim → uppercase → `[^A-Z0-9]+` → `_` → strip edge `_` | item exists |
| `POST /api/assets/backgrounds/:locationId` | `assets/backgrounds/<id>.png` | location exists |

### JSON write formatting (byte-exact — the roundtrip TEST is the contract)

- `pokemon.json`, `attacks.json`, `items.json`, `trainers.json`:
  `JSON.stringify(data, null, 2) + '\n'`.
- `events.json`, `locations.json`: the custom formatter below — verified during planning to
  reproduce **both current files byte-for-byte**. If any byte differs when the test runs,
  adjust the implementation until it passes; the rule set is: 2-space indent; arrays inline
  only when **all elements are primitive** and `indent + flat ≤ 110` chars, else one element
  per line (arrays containing objects never inline); objects **below the record level**
  inline as `{ "k": v, … }` (inner padding, may nest inline arrays/objects) when
  `indent + flat ≤ 110`, else expand; empty `[]` / `{}`; key order preserved as stored.

```js
const WIDTH = 110;
const isPrimitive = (v) => v === null || typeof v !== 'object';

function inline(value) {                       // returns null when not inlineable
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (!value.every(isPrimitive)) return null;
        return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        const parts = keys.map((k) => {
            const v = inline(value[k]);
            return v === null ? null : JSON.stringify(k) + ': ' + v;
        });
        return parts.includes(null) ? null : '{ ' + parts.join(', ') + ' }';
    }
    return JSON.stringify(value);
}

function format(value, indent, depth) {        // depth 0 = root array, 1 = record objects
    const pad = ' '.repeat(indent + 2);
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const flat = inline(value);
        if (flat !== null && indent + flat.length <= WIDTH) return flat;
        return '[\n' + value.map((v) => pad + format(v, indent + 2, depth + 1)).join(',\n') +
            '\n' + ' '.repeat(indent) + ']';
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        if (depth > 1) {                       // record-level objects always expand
            const flat = inline(value);
            if (flat !== null && indent + flat.length <= WIDTH) return flat;
        }
        return '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' +
            format(value[k], indent + 2, depth + 1)).join(',\n') +
            '\n' + ' '.repeat(indent) + '}';
    }
    return JSON.stringify(value);
}
// file text = format(rootArray, 0, 0) + '\n'
```

### Enums & engine refs (`GET /api/enums` payload; also used directly by Node tests)

- From `scripts/data_options.js` (CommonJS): `PokeType`, `Status`, `StatChange`,
  `AttackTarget`, `ItemTarget` as plain `{KEY: value}` maps. **`Rank` is a class** —
  `Object.values()` yields nothing; serialize its five statics explicitly:
  `["Standard", "Ace", "Special", "Boss", "Elite"]` (Title-case values are what the data
  stores).
- `extensions`: `{ attackTargets: ["TRAINER"], attackStatuses: ["EXTRA_ATTACK",
  "EXTRA_ITEM", "INCREASE_CAPACITY", "REFRESH_DECK"], artificialAttackCap: 6 }`.
- `effectTypes` (exactly 13, from the `applyEffect` switch in `map/event_effects.js` and
  `VALID_EFFECT_TYPES` in `tests/data_validation.test.js` ~`:154`): `gain-cash`,
  `lose-cash`, `gain-card`, `gain-random-card`, `lose-random-cards`, `lose-random-pokemon`,
  `remove-selected-card`, `duplicate-selected-card`, `duplicate-random-card`,
  `replace-selected-card`, `replace-random-card`, `trade-selected-pokemon`,
  `trade-random-pokemon`. `eventTypes`: `["gift", "choice", "trainer"]`.
- `engineRefs` — names the JSON graph doesn't show but deletes can break (verified shapes):
  - `defaultDeck`: from `arena.Constants.DEFAULT_BATTLE_DECK` — shape
    `{ pokemon: [{ name, attacks: [names] }], items: [names] }` → serialize as
    `{ pokemon: [names], attacks: [flattened attack names], items: [names] }`.
  - `starterDecks`: from `window.PokeLocations.STARTER_DECKS` (`{ water|grass|fire:
    { type, pokemon: [names], attacks: [[name, count]…], items: [[name, count]…] } }`) →
    same `{ pokemon, attacks, items }` name-list serialization.
  - `starterTypes`: the three starter `type` values (for the location coverage rule).
- **Loading engine code in Node** (server startup and tests) uses the proven
  `tests/helpers/arena_env.js` trick: set `globalThis.window = globalThis`, then `require`
  `arena/trainer_sprites.js` → `arena/arena_data.js` → `map/locations.js` (that order).
  Never read `arena/trainer_sprites.js`'s contents — it is a 2.2k-line embedded manifest;
  use its API `window.PokeRogue.TrainerSprites.resolveSprite(name, explicitSprite)` →
  `{ file, name, path, source }` (always returns something; a missing file = the warning
  signal) and `.sprites` (the raw `{name, source, file}` array).

### Validation (`validate.js`) — rules and issue shape

Every issue: `{ severity: "error"|"warning", file: "<name>.json"|"engine", recordKey:
"<record name or id>", field?: "<field>", code: "<stable-code>", message: "<human text>" }`.
Codes are stable kebab-case, namespaced by file, e.g. `pokemon.duplicate-name`,
`pokemon.bad-type`, `attacks.bad-target`, `trainers.unknown-pokemon`, `events.unknown-effect-type`,
`locations.graph-disconnected`, `assets.missing-portrait`, `assets.orphan-portrait`.
Entry points (pure — all inputs are arguments):

```js
validateAll(data, { enums, assetIndex, engineRefs })  // -> issues[]
findReferences(data, kind, name, engineRefs)          // -> [{ file, recordKey, field }]
```

`data` = the six raw arrays; `assetIndex` = `{ portraits:Set, sprites:Set, items:Set,
backgrounds:Set }` of filenames (optional — asset warnings skipped when absent);
`engineRefs` as above plus `resolveSpriteFile(name, explicitSprite) -> filename` (a function
argument so `validate.js` itself stays dependency-free).

Schema rules mirror `tests/data_validation.test.js` **rule-for-rule** (anchors are hints):
pokemon ~`:51-63`, attacks ~`:65-93` (incl. the ARTIFICIAL cap/target/status rules),
items ~`:95-113` (legacy: `statChanges` entries may be `Status` values), trainers
~`:115-150` (cross-refs; flatten `attacks` with `.flat()` before checking), events
~`:178-235` (use a copy of `collectEventEffects` — effects live in `effects`,
`rewardEffects`, `payment.effects`, and `choices[].effects`), locations ~`:237-296` incl.
both graph rules (starter-type coverage, connected shared-type graph over enabled
locations — copy the BFS). Plus: engine-ref resolution errors (a delete stranding
`defaultDeck`/`starterDecks` names), and asset **warnings**: missing portrait / sprite file /
item image / background, orphan portraits & item images & backgrounds (deliberately **no
orphan-sprite warnings** — `assets/sprites/` is a 423-file library for 95 trainers).

`findReferences` sources: pokemon ← `trainers[].pokemon`, event effects with
`cardKind:"pokemon"` (`name` / `replacement.name`), `defaultDeck.pokemon`,
`starterDecks.pokemon`; attack ← `trainers[].attacks` (flattened), effects
(`cardKind:"attack"`), `defaultDeck.attacks`, `starterDecks.attacks`; item ←
`trainers[].items`, effects (`cardKind:"item"`), `defaultDeck.items`, `starterDecks.items`;
trainer ← `events[].trainerName`. Events and locations are never referenced.

### Editor page + rendering reuse

`index.html`: `<body class="game-page editor-page">` (the bare `body` CSS in
`static/styles.css` ~`:7-18` centers and clips; `.game-page` ~`:126` restores scrolling).
Stylesheet order: `/static/styles.css` then `/dev/editor/editor.css`. Script order (mirrors
`game.html`; trainer_sprites first so trainer normalization can resolve sprites):

```
/arena/trainer_sprites.js  /arena/arena_data.js  /arena/arena_model.js  /arena/arena_render.js
/dev/editor/validate.js    /dev/editor/format_json.js (not needed in-browser; omit)
/dev/editor/preview.js     /dev/editor/list_view.js   /dev/editor/app.js
/dev/editor/tab_pokemon.js … tab_issues.js            (then an inline EditorApp.init() call)
```

- **The one renderer:** `window.CardArena.Render.renderCardPreview(card, { className,
  attributes })` (`arena/arena_render.js` ~`:784`, exported ~`:1074`) returns an HTML
  string; pure function of the card object. Card factories to copy **exactly**:
  `arena/card_overview.js:54-90` — pokemon card = `{ kind:'pokemon', pokemon:<species>,
  currentHealth:<baseHealth>, currentStatus:[], statChanges:[], statStages:{attack:0,
  defense:0,speed:0}, faceUp:true, id, owner:'editor' }`; attack = `{ kind:'attack',
  attack:<rec>, faceUp:true, id, owner }`; item = `{ kind:'item', item:<rec>, faceUp:true,
  id, owner }`.
- The nested record must be in **normalized** shape. The game's normalizers are not
  exported, so `preview.js` carries ~10-line local equivalents (game code is NOT modified),
  mirroring `arena/arena_data.js`: `normalizePokemon` ~`:358` (adds `types` = NONE-stripped
  `[type1,type2,type3]`, `portraitPath` = `assets/portraits/<encodeURIComponent(name)>.png`),
  `normalizeAttack` ~`:381` (adds `types`), `normalizeItem` ~`:402` (moves `Status` values
  out of `statChanges` into `status`, fills `imagePath` = `assets/items/<UPPER_SNAKE>.png`).
  Feed them the **draft** record so unsaved form state previews live (re-render on every
  `input` event; no debounce needed at this scale).
- **Card size** is the `--card-w` CSS variable on any wrapper (`--card-h` derives):
  `style="--card-w: 140px"` for the focused preview, `--card-w: 48px` for deck/reward mini
  cards. No transforms.
- Type icons: `assets/types-svgs/<TYPE>.svg` (`.type-icon` class). Status icons:
  `assets/status-icons/<STATUS>.svg`. Trainer sprites: plain `<img>` with
  `resolveSprite(...).path`; the file may not exist (404) — show a "missing" badge by
  checking the `/api/assets` sprite listing instead of relying on img errors.

### Canonical new-record key orders (add-new templates)

- pokemon: `name, type1, type2, type3, id, baseHealth, baseAttack, baseDefense, baseSpeed`
  (`type2`/`type3` default `"NONE"`; suggested `id` = `String(max numeric id + 1)
  .padStart(4,'0')`, smallest unused if that exceeds 9999; currently → `"1001"`).
- attack: `name, type1, type2, basePower, status, statChanges, target,
  full_type_requirements` (defaults: `type2:"NONE"`, `basePower:0`, `status:"NONE"`,
  `statChanges:[]`, `target:"OPPONENT"`, `full_type_requirements:false`).
- item: `name, target, status, statChanges` (arrays empty; `imagePath` only when set).
- trainer: `name, sprite, cash, rank, typeSpecialization, pokemon, attacks, items`
  (defaults `cash:200`, `rank:"Standard"`; `attacks` always written **flat**).
- location: `id, name, terrain, types, theme, background, enabled` (theme keys `accent,
  glow, surface, bgDeep, bgMid`, lowercase 6-digit hex; `background:
  "assets/backgrounds/<id>.png"`; `enabled:true`).
- events: per-type templates in phase 32.

### Event vocabulary (phase 32's contract; verified against `map/event_effects.js`)

Field maps the engine/page reads (`getEventActions` ~`:46`, `getTrainerBattleRewardEffects`
~`:76`, `getTrainerPaymentAction` ~`:82` in `map/event_effects.js`):

- common: `type` (`gift|choice|trainer`), `id` (unique slug), `title`, `kicker`,
  `subtitle`, `body`, `resultTitle`, `enabled`, `types[]` (location gate; no
  NONE/LEGENDARY).
- gift: `buttonText`, `actionTitle`, `rewardText`, `effects[]`, `requires[]`.
- choice: `choices[]`, each `{ id, title, description, buttonText, requires[], effects[] }`
  (engine aliases `text`→description, `requirements`→requires; the editor writes the
  canonical names).
- trainer: `trainerName` (must exist in `trainers.json`), `battleTitle`, `battleText`,
  `battleButtonText`, `rewardCash` (number), `rewardEffects[]`, optional `payment`
  `{ title, description, buttonText, requires[], effects[] }`.
- requirement: `{ id, cardKind, prompt?, label?, emptyText? }` (the event page shows
  `label || prompt` and `emptyText`).
- effect aliases: amount = `effect.amount || effect.count` (`getEffectAmount` ~`:685`);
  kind = `effect.cardKind || effect.kind` (`normalizeCardKind` ~`:667` silently defaults to
  `'attack'` — so the editor must always write an explicit, valid `cardKind`). **Write**
  `amount` for cash effects and `count` for card effects (matches live data), always
  explicit and ≥ 1 (0 is a silent no-op).

| effect `type` | fields the editor shows |
|---|---|
| `gain-cash` / `lose-cash` | `amount` (number ≥ 1) |
| `gain-card` | `cardKind` (pokemon/attack/item), `name` (searchable picker from that file), `count` |
| `gain-random-card` | `cardKind`, `count`, optional `types[]` filter, optional `excludeName` picker |
| `lose-random-cards` | `cardKind`, `count`, `strict` (bool: block if the run has fewer) |
| `lose-random-pokemon` | `count`, `strict` |
| `remove-selected-card` / `duplicate-selected-card` | `selectionId` (select among this action's `requires[].id`) |
| `duplicate-random-card` | `cardKind`, `count`, `strict` |
| `replace-selected-card` | `selectionId`, `replacement { cardKind?, name? (picker), types[]? }` |
| `replace-random-card` | `cardKind`, `count`, `replacement { … }` |
| `trade-selected-pokemon` | `selectionId`, `replacement { name?, types[]? }` (kind locked to pokemon) |
| `trade-random-pokemon` | `replacement { name?, types[]? }` (kind locked, count locked 1) |

### List views (columns / search / filters / default sort)

| Tab | Columns | Search | Filters | Default sort |
|---|---|---|---|---|
| Pokemon | portrait thumb, name, id, type icons, HP / ATK / DEF / SPD (**inline-editable**), **BST** (computed sum, sortable) | name | type (any slot), legendary yes/no | id asc |
| Attacks | name, type icons, power, status, target, stat changes, full-req flag | name | type, target, status | name |
| Items | image thumb, name, target, statuses, stat changes | name | target | name |
| Trainers | sprite thumb, name, rank, spec type icon, cash, deck sizes P/A/I | name | rank, typeSpecialization | rank, then name |
| Events | type badge, id, title, gate type icons, enabled dot | title + id | event type, gate type, enabled | id |
| Locations | 5-color theme swatch strip, name, id, terrain, type icons, enabled dot | name + id | type, enabled | name |

## Cross-phase architecture facts

Anchors captured 2026-07-16 — **hints, not addresses**; relocate by name.

- **Data counts today:** pokemon 188, attacks 116, items 14, trainers 95, events 6,
  locations 12. All six are flat JSON arrays at the repo root, loaded at runtime by
  `arena/arena_data.js` `loadGameData` (~`:561`) and validated by
  `tests/data_validation.test.js` (357 lines) — the rule source the editor mirrors.
- **Formatting today:** `items/trainers.json` are exactly `JSON.stringify(…, null, 2)+'\n'`;
  `pokemon/attacks.json` the same minus the trailing newline; `events/locations.json` match
  the custom formatter above byte-for-byte.
- **Assets:** `assets/portraits/` 189 PNGs keyed by pokemon **name** (orphan today:
  `Linoone.png`); `assets/sprites/` 423 trainer PNGs (name + game-source, resolved via the
  manifest); `assets/items/` 14 (UPPER_SNAKE); `assets/backgrounds/` **empty today** — all
  12 locations reference missing files (the issues panel's seed content);
  `assets/types-svgs/` 25; `assets/status-icons/` 21. Never list `assets/` recursively.
- **Test harness:** Node v26 (global `fetch` available in tests). `tests/run_all.js`
  syntax-checks tracked+untracked JS then runs `node --test 'tests/**/*.test.js'`
  (built-ins only, flat `tests/<name>.test.js` naming). `tests/helpers/arena_env.js` is the
  window-shim loader (`ROOT`, `arena`, `loadRealGameData()`); extend the same pattern, don't
  fork it.
- **Reference plans:** phase-file template = `dev/feature_plans/README.md`; structural
  exemplar = `24-trainer-roster-new-generic-tiers.md`.
- **verify skill / Playwright:** `dev/verify/` has an approved Python+Playwright venv
  (`setup.sh`, `lib.py`, `.cache/venv/bin/python`) used to drive the game on 8931. Phase 34
  adds a small editor smoke driver alongside it (the editor lives on 8932 and is served by
  the Node server, not python http.server).
- The game's own pages and engine behavior are entirely out of scope for this batch — the
  editor only reads game code (renderer, sprites, enums) and reads/writes the six JSONs.

## Phases

| File | What it does | Order / deps |
|------|--------------|--------------|
| `26-editor-shared-modules.md` | `format_json.js` + `validate.js` + their test files | first |
| `27-editor-server.md` | `server.js`: static + API + write guard + uploads; AGENTS.md exemption note | after 26 |
| `28-editor-shell-and-lists.md` | `index.html`, `editor.css`, `app.js`, `list_view.js`, `preview.js`, read-only lists for all six types + Issues tab + badge | after 27 |
| `29-editor-framework-and-pokemon.md` | detail-editor framework (dirty/save/revert/delete/add-new) + complete Pokemon tab (live preview, inline stats, BST) | after 28 |
| `30-editor-attacks-items.md` | Attacks + Items editors | after 29 |
| `31-editor-trainers.md` | Trainers editor + deck builder (mini cards, counts, pickers) | after 29 |
| `32-editor-events.md` | structured Event editors (13 effects, choices, requirements, payment) | after 29 |
| `33-editor-locations.md` | Locations editor + live graph warnings | after 29 |
| `34-editor-issues-uploads-docs.md` | Issues tab v2 + uploads + smoke driver + docs | last |

Phases 30–33 are independent of each other (all build on 29); do them in numeric order
anyway so `status.sh --current` stays honest.
