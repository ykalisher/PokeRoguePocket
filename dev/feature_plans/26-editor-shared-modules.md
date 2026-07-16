# Phase 26 — Editor shared modules: byte-exact formatter + validation library

**Recommended agent:** Sonnet · high effort.
**Prereqs:** none (first phase of the batch). **Read first:** `25-data-editor-overview.md`.
**Goal:** `dev/editor/format_json.js` and `dev/editor/validate.js` exist as dual-export
modules, fully covered by `tests/editor_format.test.js` and `tests/editor_validation.test.js`.
No server, no UI yet. Ends green.

## Context you need

- The overview's **"JSON write formatting"** section contains the formatter rules AND a
  reference implementation verified byte-exact against today's `events.json` /
  `locations.json`. The **roundtrip test is the contract** — if a byte differs, adjust the
  implementation (not the test) until it reproduces the live files exactly.
- The overview's **"Validation"** section defines the entry points, the issue object shape,
  and where every rule comes from: port `tests/data_validation.test.js` **rule-for-rule**
  (pokemon ~`:51-63`, attacks ~`:65-93`, items ~`:95-113`, trainers ~`:115-150`, events
  ~`:178-235` incl. its local `collectEventEffects` helper and `VALID_EFFECT_TYPES` ~`:154`,
  locations ~`:237-296` incl. both graph rules — copy the BFS). Read that test file before
  writing `validate.js`; it is the single rule source.
- `validate.js` must be **pure**: no `require`s, no `fetch`, no `fs`. Inputs arrive as
  arguments: `validateAll(data, { enums, assetIndex, engineRefs })` and
  `findReferences(data, kind, name, engineRefs)`. `assetIndex` (Sets of filenames) and
  `engineRefs` are optional — skip the dependent checks when absent. `engineRefs` carries
  `resolveSpriteFile(name, explicitSprite) -> filename` as a **function** so sprite
  resolution stays outside the module.
- Dataset-level rules from the test suite are issues too, with `recordKey: "(dataset)"`:
  trainer roster minimums (≥6 Ace, ≥4 Elite, each with valid `typeSpecialization`,
  ~`:143-148`), ≥1 trainer event (~`:230`), ≥8 locations (~`:240`), starter-type coverage,
  connected location graph. They are `error` severity — the phase-27 write guard uses "new
  errors" to block e.g. deleting the 6th Ace trainer, keeping `run_all` green by
  construction.
- **Stable issue codes** (tests assert these exact strings; keep the list authoritative):
  - pokemon: `pokemon.duplicate-name`, `pokemon.bad-type`, `pokemon.none-primary-type`,
    `pokemon.bad-stat`, `pokemon.bad-id`
  - attacks: `attacks.duplicate-name`, `attacks.bad-type`, `attacks.none-primary-type`,
    `attacks.bad-power`, `attacks.bad-status`, `attacks.bad-target`,
    `attacks.bad-stat-change`, `attacks.bad-full-req-flag`, `attacks.artificial-rule`,
    `attacks.artificial-cap` (dataset)
  - items: `items.duplicate-name`, `items.bad-target`, `items.bad-status`,
    `items.bad-stat-change`
  - trainers: `trainers.duplicate-name`, `trainers.bad-rank`, `trainers.bad-cash`,
    `trainers.bad-specialization`, `trainers.unknown-pokemon`, `trainers.unknown-attack`,
    `trainers.unknown-item`, `trainers.roster-minimums` (dataset)
  - events: `events.missing-id`, `events.duplicate-id`, `events.bad-type`,
    `events.missing-title`, `events.missing-body`, `events.bad-gate-type`,
    `events.unknown-effect-type`, `events.bad-effect-types`, `events.no-choices`,
    `events.unknown-trainer`, `events.no-trainer-event` (dataset)
  - locations: `locations.missing-id`, `locations.duplicate-id`,
    `locations.duplicate-name`, `locations.bad-types-count`, `locations.duplicate-type`,
    `locations.bad-type`, `locations.bad-theme-color`, `locations.bad-background-path`,
    `locations.min-count` (dataset), `locations.starter-coverage` (dataset),
    `locations.graph-disconnected` (dataset)
  - engine: `engine.unknown-default-deck-ref`, `engine.unknown-starter-deck-ref`
  - assets (**always `warning`**): `assets.missing-portrait`, `assets.missing-sprite`,
    `assets.missing-item-image`, `assets.missing-background`, `assets.orphan-portrait`,
    `assets.orphan-item-image`, `assets.orphan-background`. Deliberately **no orphan-sprite
    code** (423-file sprite library vs 95 trainers — pure noise).
- `findReferences` sources are enumerated in the overview (trainers' three arrays — flatten
  `attacks` with `.flat()` — event effects via a `collectEventEffects` copy, checking
  `effect.name` and `effect.replacement.name` against the right `cardKind`,
  `events[].trainerName`, and `engineRefs.defaultDeck` / `engineRefs.starterDecks`).
- Item asset naming for `assets.missing-item-image`: a record `imagePath` wins when set;
  otherwise `UPPER_SNAKE(name) + '.png'` per `formatAssetName` (`arena/arena_data.js`
  ~`:518`): trim → uppercase → `[^A-Z0-9]+` → `_` → strip edge `_`. Reimplement locally
  (validate.js stays pure); note `Effect Amplifier` has an explicit `imagePath` ending
  `.svg` — compare against the `items` Set by exact basename either way.
- How tests obtain the argument bundles (put this in a small local helper inside each test
  file, or a shared `tests/helpers/editor_env.js` if you prefer — your call):

```js
const path = require('node:path');
const { ROOT } = require('./helpers/arena_env');          // sets globalThis.window, loads arena Data+Model
require(path.join(ROOT, 'arena', 'trainer_sprites.js'));  // window.PokeRogue.TrainerSprites
require(path.join(ROOT, 'map', 'locations.js'));          // window.PokeLocations
const enums = require('../scripts/data_options');          // PokeType, Status, …, Rank (class!)
const dd = window.CardArena.Constants.DEFAULT_BATTLE_DECK; // { pokemon:[{name, attacks:[]}], items:[] }
const SD = window.PokeLocations.STARTER_DECKS;             // { water|grass|fire: {type, pokemon:[], attacks:[[n,c]], items:[[n,c]]} }
```

  Rank values = the five statics (`Rank.STANDARD` … `Rank.ELITE`), i.e.
  `["Standard","Ace","Special","Boss","Elite"]` — `Object.values(Rank)` is empty.
- Node is v26: `structuredClone`, `fetch`, `node:test`, `node:assert/strict` all available.

## Steps

- [x] 1. **`dev/editor/format_json.js`** — implement `formatDataFile(fileName, data) ->
  string` using the overview's reference implementation: `pokemon|attacks|items|trainers`
  → `JSON.stringify(data, null, 2) + '\n'`; `events|locations` → the smart formatter
  (WIDTH 110, primitive-only arrays inline, record-level objects always expanded, deeper
  objects inline when they fit); unknown file name → throw. Accept both `"events"` and
  `"events.json"` spellings. Export via the overview's dual-export snippet as
  `window.EditorFormat` / `module.exports`.
- [x] 2. **`tests/editor_format.test.js`** — (a) byte-exact roundtrip: for `events.json` and
  `locations.json`, `formatDataFile(name, JSON.parse(fs.readFileSync(file,'utf8')))` strictly
  equals the raw file text; (b) for the other four files, output equals
  `JSON.stringify(parsed, null, 2) + '\n'` AND equals the raw text once the raw text is
  normalized to end with exactly one `\n`; (c) unit cases: a >110-char primitive array
  wraps one-per-line; a short array containing an object still wraps; `[]`/`{}` stay
  inline; a record object (depth 1) with two keys expands even though it would fit; key
  order is preserved.
- [x] 3. **`dev/editor/validate.js`** — implement `validateAll` and `findReferences` per the
  overview and the code list above, porting every rule from `tests/data_validation.test.js`.
  Every issue: `{ severity, file, recordKey, field?, code, message }` with `file` one of the
  six `<name>.json` strings, `"engine"`, or `"assets"`. Keep each per-file check in its own
  small function (`validatePokemon(data, enums)` etc.) so phase sessions can navigate it.
  Dual-export as `window.EditorValidation`.
- [x] 4. **`tests/editor_validation.test.js`** — (a) **live-data parity**: run `validateAll`
  over the six real files with real enums/assetIndex/engineRefs → **zero `error` issues**;
  warnings include `assets.missing-background` for every enabled location id (12 today —
  assert ≥ 8, not an exact count) and `assets.orphan-portrait` with `recordKey`
  `Linoone.png`; (b) **synthetic fixtures**: for each rule family, mutate a minimal copy of
  the live data (or hand-built fixtures) and assert the exact `code` appears — cover at
  least: bad pokemon type, dup name, bad id, negative stat; attack with unknown status, an
  ARTIFICIAL attack targeting OPPONENT; item with bad target; trainer with unknown pokemon
  name, bad rank; event with unknown effect type, trainer event naming a missing trainer;
  location with 1 type, bad hex, disconnected graph (flip types so one enabled location
  shares no type); deleting a `defaultDeck` pokemon → `engine.unknown-default-deck-ref`;
  (c) **findReferences known answers**: `findReferences(data,'pokemon','Blastoise',
  engineRefs)` includes the default deck AND the water starter deck; `findReferences(data,
  'trainer','Mecha Cop', …)` includes `events.json`/`rogue-mecha-cop`; a freshly invented
  name returns `[]`.
- [x] 5. **Dual-export smoke** — `node -e "globalThis.window = globalThis;
  require('./dev/editor/format_json.js'); require('./dev/editor/validate.js');
  console.log(!!window.EditorFormat.formatDataFile, !!window.EditorValidation.validateAll)"`
  prints `true true`. (This also proves no stray top-level `require` snuck into
  validate.js.)

## Verification

- [x] `node tests/run_all.js` green — including the two new test files.
- [x] The byte-exact roundtrip assertions pass against the **live** `events.json` and
  `locations.json` (not fixtures).
- [x] Live-data `validateAll` reports 0 errors; warning set includes the 12 missing
  backgrounds and the Linoone orphan.
- [x] Step-5 smoke prints `true true`.

## Out of scope / do not touch

No `dev/editor/server.js`, no HTML/CSS/client files, no game code (`arena/`, `map/`,
`static/`, root `*.html`), no data JSON edits (tests mutate **in-memory copies** only), no
changes to `tests/data_validation.test.js` or `tests/helpers/arena_env.js` (a new
`tests/helpers/editor_env.js` is allowed). Inherit all batch ground rules from
`25-data-editor-overview.md` (no `git commit`, no `scripts/manage_*`, no `TODO.md`, Node
built-ins only, run `node tests/run_all.js` after every change).
