# Phase 90 — Starter decks: editor server, formatter and validation

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 89 (`starter_decks.json` must exist). **Read first:** `88-starter-decks-overview.md`.
**Goal:** The editor server serves and writes `starter_decks.json` through the same
guarded path as every other data file, the formatter knows how to render it, and its
validation rules live on the real file instead of the synthetic `engine` pseudo-file. Ends
green. No UI yet — that is phase 91.

## Context you need

Four files, all under `dev/editor/`, plus their test mirrors.

**`dev/editor/server.js`** (491 lines, Node built-ins only):

- `FILE_NAMES` (~85) — `['pokemon', 'attacks', 'items', 'trainers', 'events', 'locations']`.
  `readAllData` loops it; `handlePutData` rejects any name not in it.
- `buildEngineRefs()` (~36) and `const ENGINE_REFS = buildEngineRefs();` (~55) — built
  **once at require time** from `window.PokeLocations.STARTER_DECKS`. After phase 89 that
  constant is the frozen builtin, not the data file, so it is now stale by construction and
  must go.
- `handleGetIssues` (~348) and `handlePutData` (~292) both pass
  `{ enums: ENUMS_PAYLOAD, assetIndex, engineRefs: ENGINE_REFS }` into `validateAll`.
- `ENUMS_PAYLOAD` (~70) embeds `engineRefs: ENGINE_REFS`, which the browser reads at boot
  via `/api/enums`.

**`dev/editor/format_json.js`** (80 lines): `PLAIN_FILES` = pokemon/attacks/items/trainers
(`JSON.stringify(data, null, 2)`), `SMART_FILES` = events/locations (the width-aware
formatter that keeps primitive-only arrays inline). `formatDataFile` **throws** on any other
name — that is why phase 89 deliberately did not add the file to `FILE_NAMES`.

Starter decks belong in `SMART_FILES`: their `pokemon` array is primitive-only (inlines
nicely) while `attacks`/`items` hold objects (expand). Verify by round-tripping, see step 3.

**`dev/editor/validate.js`** (930 lines, dual CommonJS/browser module):

- `issue`/`err`/`warn` helpers (~32–38): `err(file, recordKey, code, message, field)`.
- `validateAll(data, options)` (~769) builds name `Set`s then spreads per-file validators.
- `validateLocations(locations, enums, engineRefs)` holds the
  `locations.starter-coverage` rule (~611): for each `engineRefs.starterTypes`, at least
  one enabled location must list that type.
- `validateEngineRefs(pokemonNames, attackNames, itemNames, engineRefs)` (~650) emits
  `engine.unknown-starter-deck-ref` issues against `file: 'engine'` — a synthetic file the
  Issues tab cannot jump to.
- `addEngineDeckRefs(results, engineRefs, listKey, name)` (~844) makes a renamed/deleted
  card report `{ file: 'engine', recordKey: 'starterDecks.<id>' }` in the delete-blocking
  dialog. After this phase that must say `starter_decks.json` so the dialog's jump-link
  works.
- `engineRefs.defaultDeck` (from `CardArena.Constants.DEFAULT_BATTLE_DECK`) stays exactly
  as it is — it is a genuine engine constant with no data file. Only the **starter** half
  moves.

**The write guard** (`handlePutData`, ~292): a PUT is refused when it introduces any error
inside the written file, or any brand-new error anywhere. So a starter deck whose `type` no
enabled location covers will be **unsavable** — make the message actionable
("no enabled location contains starter type X; enable one in locations.json first").

**Attack-legality warning** (see the overview): reuse the engine's rule shape — no attack
types ⇒ usable by anything; `full_type_requirements` ⇒ the Pokemon must have *all* the
attack's types; otherwise *any* one. Read types off `record.types` when present, else
compact `[type1, type2, type3]` dropping `'NONE'`. `validate.js` must **not** require game
code, so implement the few lines inline (`validateTrainers` sets the precedent of
re-deriving rather than importing).

**Test mirrors to update:** `tests/editor_api.test.js` (HTTP round-trips),
`tests/editor_format.test.js` (asserts the formatter is byte-exact against the live files),
`tests/editor_validation.test.js` (rule-by-rule), and `tests/data_validation.test.js`
(mirrors validate.js's rules against real data). Read each before editing — they use
`tests/helpers/editor_env.js`.

## Steps

- [ ] 1. **`dev/editor/server.js`** — add `'starter_decks'` to `FILE_NAMES` (~85), last in
  the list.

- [ ] 2. **`dev/editor/format_json.js`** — add `'starter_decks'` to `SMART_FILES` (~64).

- [ ] 3. **`dev/editor/format_json.js`** — prove byte-exactness before going further:
  `node -e "const {formatDataFile}=require('./dev/editor/format_json.js');const fs=require('fs');const cur=fs.readFileSync('starter_decks.json','utf8');const out=formatDataFile('starter_decks',JSON.parse(cur));console.log(out===cur?'BYTE-EXACT':'DIFFERS');process.stdout.write(out)"`
  If it differs, rewrite `starter_decks.json` **to the formatter's output** (the formatter
  is canonical for smart files — this is how `events.json` and `locations.json` are
  stored), then re-run until it reports `BYTE-EXACT`. Do not change the formatter to match
  a hand-written file.

- [ ] 4. **`dev/editor/server.js`** — kill the stale require-time `ENGINE_REFS`. Change
  `buildEngineRefs()` to take the loaded data and return only what is still engine-owned,
  and call it per request:

  ```js
  function buildEngineRefs(data) {
      const defaultDeck = window.CardArena.Constants.DEFAULT_BATTLE_DECK;

      return {
          defaultDeck: {
              pokemon: defaultDeck.pokemon.map((entry) => entry.name),
              attacks: defaultDeck.pokemon.flatMap((entry) => entry.attacks),
              items: defaultDeck.items
          },
          resolveSpriteFile
      };
  }
  ```

  Every call site that had `engineRefs: ENGINE_REFS` now passes
  `engineRefs: buildEngineRefs(data)` where `data` is the `readAllData()` result it already
  has (`handleGetIssues` ~348, `handlePutData` ~292 — twice, for `before` and `after`).
  `ENUMS_PAYLOAD.engineRefs` (~70) becomes `buildEngineRefs()` evaluated once at require
  time, which is still correct because it no longer depends on any data file.

  Remove `starterDecks` and `starterTypes` from `engineRefs` entirely; the rules that used
  them now read `data.starter_decks` directly.

- [ ] 5. **`dev/editor/app.js`** — the browser mirrors the server's refs. In `init()` (~275)
  it does `EditorApp.store.engineRefs = Object.assign({}, enums.engineRefs, { resolveSpriteFile })`;
  that still works unchanged once `enums.engineRefs` no longer carries starter data. Add
  `'starter_decks.json': 'starters'` to `FILE_TO_TAB` (~30) so Issues-tab jump-links resolve
  (the tab itself arrives in phase 91; an unknown tab name simply no-ops until then).

- [ ] 6. **`dev/editor/validate.js`** — new `validateStarterDecks(starterDecks, pokemon,
  attacks, items, pokemonNames, attackNames, itemNames, enums)`, placed next to
  `validateLocations`. Rules, all on `file: 'starter_decks.json'` with `recordKey` = the
  deck id (or `'(unnamed deck)'`):

  | Code | Severity | Condition |
  |---|---|---|
  | `starterDecks.missing-id` | error | no non-empty `id` |
  | `starterDecks.duplicate-id` | error | `id` seen twice |
  | `starterDecks.bad-id` | error | `id` is not `^[a-z0-9-]+$` (it goes in a URL query string) |
  | `starterDecks.bad-type` | error | `type` absent or not in `enums.PokeType` |
  | `starterDecks.no-pokemon` | error | `pokemon` empty |
  | `starterDecks.unknown-pokemon` / `-attack` / `-item` | error | a name absent from that data file |
  | `starterDecks.bad-count` | error | an `attacks`/`items` entry's `count` is not an integer ≥ 1 |
  | `starterDecks.none-enabled` | error | dataset-level (`recordKey: '(dataset)'`), zero records with `enabled !== false` |
  | `starterDecks.unusable-attack` | **warning** | no Pokemon in the deck can legally use that attack (rule in "Context you need") |

- [ ] 7. **`dev/editor/validate.js`** — wire it into `validateAll` (~769): read
  `const starterDecks = data.starter_decks || [];` beside the other collections and spread
  `...validateStarterDecks(...)` into the returned array, before `validateLocations`.

- [ ] 8. **`dev/editor/validate.js`** — repoint `locations.starter-coverage` (~611). It
  currently loops `engineRefs.starterTypes`; give `validateLocations` the starter records
  instead and loop the **enabled** decks' types:

  ```js
        const starterTypes = [...new Set((starterDecks || [])
            .filter((deck) => deck && deck.enabled !== false && deck.type)
            .map((deck) => deck.type))];

        starterTypes.forEach((type) => {
            const covered = enabled.some((record) => Array.isArray(record.types) && record.types.includes(type));
            if (!covered) {
                issues.push(err('locations.json', '(dataset)', 'locations.starter-coverage',
                    `no enabled location contains starter type ${type} — enable a location with that type, or disable that starter deck`));
            }
        });
  ```

- [ ] 9. **`dev/editor/validate.js`** — `validateEngineRefs` (~650): delete the
  `engineRefs.starterDecks` branch and the `engine.unknown-starter-deck-ref` code entirely
  (step 6 now covers it, on the real file). Keep the `defaultDeck` branch and
  `engine.unknown-default-deck-ref` untouched.

- [ ] 10. **`dev/editor/validate.js`** — `addEngineDeckRefs` (~844): drop its
  `engineRefs.starterDecks` branch, and instead report starter references from the real
  data in `findReferences` (~858). Each of the `pokemon` / `attack` / `item` branches gains:

  ```js
            (data.starter_decks || []).forEach((deck) => {
                const names = listKey === 'pokemon'
                    ? (deck.pokemon || [])
                    : (deck[listKey] || []).map((entry) => entry && entry.name);
                if (names.includes(name)) {
                    results.push({ file: 'starter_decks.json', recordKey: deck.id, field: listKey });
                }
            });
  ```

  (adapt `listKey` to each branch: `'pokemon'`, `'attacks'`, `'items'`). This is what makes
  "cannot delete Blastoise — referenced by starter_decks.json / water" clickable.

- [ ] 11. **`tests/editor_format.test.js`** — add `starter_decks` to whatever list drives
  its byte-exactness cases, so the live file is checked on every run.

- [ ] 12. **`tests/editor_validation.test.js`** — one case per rule from step 6, plus a case
  that `locations.starter-coverage` fires when a deck's type has no enabled location, and a
  case that `findReferences(data, 'pokemon', 'Blastoise', …)` includes a
  `starter_decks.json` row.

- [ ] 13. **`tests/editor_api.test.js`** — `GET /api/data` includes a `starter_decks` array;
  `PUT /api/data/starter_decks` with a valid array writes the file (through the temp data
  dir the file already uses); a PUT introducing an unknown pokemon name gets a **409** with
  the blocking issue.

- [ ] 14. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `grep -rn "starterDecks\|starterTypes" dev/editor/` returns no `engineRefs.` hits —
  only the new data-driven code.
- [ ] Start the editor (`node dev/editor/server.js`, 127.0.0.1:8932) and check
  `curl -s 127.0.0.1:8932/api/data | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s))))"`
  lists `starter_decks`, and `curl -s 127.0.0.1:8932/api/issues` reports the same
  error/warning counts as before this phase (the starter rules moved files but should not
  change the *count* for the current, valid data).
- [ ] Write guard proof: `curl -X PUT -H 'Content-Type: application/json' -d '[{"id":"x","name":"X","type":"WATER","pokemon":["NotAPokemon"],"attacks":[],"items":[],"enabled":true}]' 127.0.0.1:8932/api/data/starter_decks`
  returns **409** with `starterDecks.unknown-pokemon`, and `git status` shows
  `starter_decks.json` unchanged.
- [ ] `git diff starter_decks.json` is empty after a no-op save through the API (round-trip
  fidelity).

## Out of scope / do not touch

`dev/editor/tab_*.js` and `dev/editor/index.html` (phase 91). Do not touch
`engineRefs.defaultDeck` or `engine.unknown-default-deck-ref`. Do not change any other
validator's rules, severities, or codes. Do not touch `map/**` or `arena/**` — phase 89
finished the game side. Do not author or edit deck contents.
