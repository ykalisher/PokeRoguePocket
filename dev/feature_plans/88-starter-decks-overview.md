# Editable starter decks — batch overview

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs). Edit JSON data
  directly and validate with the tests.
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change.
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names.
  Never rename internals to match UI.
- **Do not author game content.** This batch makes starter decks *editable*; it ships the
  same three decks that exist today and nothing else. The owner adds new ones.

## What is being built (context)

A run begins at `starter.html`, where the player picks one of three type-themed starter
decks. Each deck names two Pokemon, a handful of attacks with counts, and two items; the
choice also constrains which location level 1 can roll (`chooseLevelLocation({ requiredType })`).

Today those decks are a **frozen object literal** inside `map/locations.js`:

```js
    const STARTER_DECKS = Object.freeze({
        water: Object.freeze({
            id: 'water', name: 'Water', type: 'WATER',
            pokemon: ['Blastoise', 'Feraligatr'],
            attacks: [['Surf', 2], ['Waterfall', 2], ['Crunch', 1], ['Sucker Punch', 1]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        }),
        grass: …, fire: …
    });
```

Changing one means editing JavaScript by hand, and the data editor can only *read* them
(through `engineRefs`) to validate card references. This batch moves them into a real data
file and gives the editor a tab, so decks can be edited, added, and removed like every
other record type.

## Locked spec

**New root data file `starter_decks.json`** — an array of records, exactly like every other
data file, so the editor's list view, write guard, and formatter all work unchanged:

```json
[
  {
    "id": "water",
    "name": "Water",
    "type": "WATER",
    "pokemon": ["Blastoise", "Feraligatr"],
    "attacks": [{ "name": "Surf", "count": 2 }, { "name": "Waterfall", "count": 2 }],
    "items": [{ "name": "Sitrus Berry", "count": 1 }],
    "enabled": true
  }
]
```

- `id` — lowercase slug, unique, and the value threaded through
  `area.html?newRun=1&starter=<id>` and stored as `run.starterId`. **Changing an existing
  id breaks saved runs** — `normalizeStarterId` falls back to `'water'`, so an in-flight run
  silently reverts to the water starter's *type* for location rolls. Say so in the editor
  hint text.
- `name` — the label on the starter card.
- `type` — one `PokeType`, used as `requiredType` for the level-1 location roll.
- `pokemon` — array of pokemon names. Order is the board order.
- `attacks` / `items` — arrays of `{ name, count }`. `count` is how many copies enter the
  action deck.
- `enabled` — `false` hides the deck from `starter.html` without deleting it.

**The engine keeps its existing internal shape.** `arena/arena_data.js` normalizes each
record back into the tuple form the game already uses
(`attacks: [['Surf', 2], …]`, `items: [['Sitrus Berry', 1], …]`), so `map/area.js`'s
`createCardCollections` and `map/starter.js`'s renderer need **no logic changes** — only
their lookup source changes. This is deliberate: it keeps the risky phase small.

**Fallback.** The current three-deck literal stays in the repo as
`arena/arena_data.js`'s `fallbackRecords.starterDecks`, used when the fetch fails (opening
the game from `file://`), exactly like every other data file's fallback. `map/locations.js`
keeps a frozen `BUILTIN_STARTER_DECKS` for the same reason, since it is required directly
by Node tests that never call `loadGameData()`.

**Number of decks is not fixed at three.** `starter.html`'s grid must wrap. Zero enabled
decks is a validation **error** (the game would be unstartable).

**`locations.starter-coverage` keeps its meaning:** every enabled starter deck's `type`
must appear in at least one enabled location's `types`, or level 1 has nowhere to send that
starter. After this batch the rule reads the data file instead of `engineRefs`.

## Cross-phase architecture facts

Verified in the repo on 2026-08-05. Line numbers are drift-prone hints.

**Every consumer of `STARTER_DECKS` — there are only five:**

| Site | Line | Use |
|---|---|---|
| `map/area.js` `getStarterType` | ~771 | `locations.STARTER_DECKS[starterId] \|\| …water` → `.type` |
| `map/area.js` `normalizeStarterId` | ~777 | membership test, falls back to `'water'` |
| `map/area.js` `createCardCollections` | ~1428 | iterates `deck.pokemon` / `deck.attacks` / `deck.items` to build the run's starting cards |
| `map/starter.js` `render` | ~26 | `Object.values(locations.STARTER_DECKS)` → the three cards |
| `dev/editor/server.js` `buildEngineRefs` | ~38 | flattens them into `engineRefs.starterDecks` + `engineRefs.starterTypes` |

**How data loads.** `arena/arena_data.js` (~568):

```js
    async function loadGameData() {
        const [pokemon, attacks, items, trainers, events, locations] = await Promise.all([
            loadJson('pokemon.json', fallbackRecords.pokemon), …
        ]);
        arena.GameData = normalizeGameData({ pokemon, attacks, items, trainers, events, locations });
        return arena.GameData;
    }
```

`normalizeGameData` (~533) maps each collection through a per-type normalizer.
`arena.GameData = normalizeGameData(fallbackRecords)` also runs at module load (~582), so
`arena.GameData.starterDecks` must exist even before any fetch.

**Editor plumbing a new data file must touch:**

| File | What |
|---|---|
| `dev/editor/server.js` | `FILE_NAMES` (~85), `buildEngineRefs`/`ENGINE_REFS` (~36–54), `readAllData` |
| `dev/editor/format_json.js` | `PLAIN_FILES` / `SMART_FILES` (~64) — `formatDataFile` **throws** on an unknown name |
| `dev/editor/validate.js` | `validateAll` (~769) composes per-file validators; `err`/`warn` helpers (~37); `findReferences` (~858) + `addEngineDeckRefs` (~844) |
| `dev/editor/app.js` | `FILE_TO_TAB` (~30) — powers the Issues tab's jump-links |
| `dev/editor/index.html` | one `<script>` tag per tab module |

**The editor's write guard** (`handlePutData`, `dev/editor/server.js` ~292) refuses any
write that introduces an error inside the written file, or a brand-new error anywhere. So
`locations.starter-coverage` failing will *block* saving a starter deck whose type no
location covers — that is intended, and the error message must say what to do.

**Round-trip fidelity is a hard requirement** across the whole editor (see
`dev/editor/tab_events.js`'s header): a form mutates a `structuredClone` draft in place and
saving an untouched record must produce an empty `git diff`.

**Existing tab to copy:** `dev/editor/tab_locations.js` (400 lines) is the closest model —
a list view plus a full detail editor with chip-style array fields and a template for new
records. `dev/editor/tab_trainers.js` (489 lines) is the model for **name + count row**
editing, which starter decks need for attacks and items; read it before inventing a UI.

**Attack legality.** The engine only lets a Pokemon use an attack whose types it shares
(`speciesCanUseAttack`, `arena/arena_model.js` ~660; `pokemonCanUseAttack`,
`map/run_state.js` ~687): with no types the attack is universal, with
`full_type_requirements` the Pokemon needs *all* the attack's types, otherwise *any* one of
them. A starter deck listing an attack none of its Pokemon can use starts the run with that
card benched — a real authoring hazard, so phase 90 flags it as a **warning** (not an
error; `validate.js` has no such rule for trainers either, and the owner may want it).

## Phases

| File | What it does | Order |
|---|---|---|
| `89-starter-decks-data-file.md` | Creates `starter_decks.json`, loads + normalizes it, repoints all four game-side consumers, makes the picker grid wrap. | **first** — everything else reads the new file |
| `90-starter-decks-editor-plumbing.md` | Server `FILE_NAMES`, formatter, and the validation rules (moved off the synthetic `engine` file onto `starter_decks.json`). | after 89 |
| `91-starter-decks-editor-tab.md` | The Starters tab itself: list + detail form + browser proof. | after 90 |
