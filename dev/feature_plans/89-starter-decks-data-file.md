# Phase 89 — Starter decks move into starter_decks.json

**Recommended agent:** Opus · high effort.
(High because it changes how a *run starts*. A mistake here does not throw — it silently
starts every run with the water deck, or with an empty action deck. Verify a real run in
the browser, not just the tests.)
**Prereqs:** none. **Read first:** `88-starter-decks-overview.md`.
**Goal:** The three starter decks live in `starter_decks.json`, are fetched and normalized
by `loadGameData()`, and drive `starter.html` and run creation. Editing the JSON changes
the game with no code change. Ends green, and a fresh run started from each of the three
decks is byte-identical to before.

## Context you need

Read the overview's "Locked spec" for the record shape and "Cross-phase architecture facts"
for the five consumer sites. Line numbers below are drift-prone hints.

**The source of truth you are moving:** `map/locations.js:51` — `const STARTER_DECKS =
Object.freeze({ water: …, grass: …, fire: … })`, exported at ~943. Copy its contents into
the JSON **exactly**; do not "improve" any deck while converting.

**How other data files load:** `arena/arena_data.js`
- `fallbackRecords` (~60) — a frozen object with one key per collection.
- `normalizeGameData(records)` (~533) — maps each collection through its normalizer.
- `loadGameData()` (~568) — `Promise.all` of `loadJson(path, fallback)` calls, then
  `arena.GameData = normalizeGameData({…})`.
- `arena.GameData = normalizeGameData(fallbackRecords)` at module load (~582) — so every
  collection must survive normalization *before* any fetch happens.

**The four game-side consumers**, all of which currently reach `locations.STARTER_DECKS`
directly:

```js
    // map/area.js ~770
    function getStarterType(starterId) {
        const deck = locations.STARTER_DECKS[starterId] || locations.STARTER_DECKS.water;
        return deck.type;                 // (read the real line; it may differ slightly)
    }

    // map/area.js ~776
    function normalizeStarterId(starterId) {
        return starterId && locations.STARTER_DECKS[starterId] ? starterId : 'water';
    }

    // map/area.js ~1427
    function createCardCollections(starterId) {
        const deck = locations.STARTER_DECKS[starterId] || locations.STARTER_DECKS.water;
        …
        deck.attacks.forEach(([name, count]) => { … });
        deck.items.forEach(([name, count]) => { … });
    }

    // map/starter.js ~26
        const decks = Object.values(locations.STARTER_DECKS);
```

**Why the tuple shape survives.** `createCardCollections` destructures `[name, count]`. The
normalizer converts `{ name, count }` → `[name, count]` so that loop is untouched. Do not
change `createCardCollections`'s body beyond its first line.

**Test helpers.** `tests/helpers/arena_env.js` `loadRealGameData()` stubs `fetch` with a
disk reader over the repo root, so a new root JSON file is picked up automatically once
`loadGameData()` requests it. `map/locations.js` is required directly by several tests
**without** `loadGameData()` ever running, which is why the frozen builtin must stay.

## Steps

- [ ] 1. **`starter_decks.json`** (new, repo root) — the three current decks in the locked
  shape. Water, grass, fire, in that order. Every `pokemon` / `attacks[].name` /
  `items[].name` string copied verbatim from `map/locations.js:51`. Example first record:

  ```json
  [
    {
      "id": "water",
      "name": "Water",
      "type": "WATER",
      "pokemon": ["Blastoise", "Feraligatr"],
      "attacks": [
        { "name": "Surf", "count": 2 },
        { "name": "Waterfall", "count": 2 },
        { "name": "Crunch", "count": 1 },
        { "name": "Sucker Punch", "count": 1 }
      ],
      "items": [
        { "name": "Sitrus Berry", "count": 1 },
        { "name": "Withdraw Wand", "count": 1 }
      ],
      "enabled": true
    }
  ]
  ```

  Cross-check every name against the data files before moving on:
  `node -e "const p=require('./pokemon.json'),a=require('./attacks.json'),i=require('./items.json'),s=require('./starter_decks.json');const has=(arr,n)=>arr.some(r=>r.name===n);s.forEach(d=>{d.pokemon.forEach(n=>{if(!has(p,n))console.log('BAD pokemon',n)});d.attacks.forEach(x=>{if(!has(a,x.name))console.log('BAD attack',x.name)});d.items.forEach(x=>{if(!has(i,x.name))console.log('BAD item',x.name)})});console.log('checked')"`

- [ ] 2. **`arena/arena_data.js`** — add `starterDecks` to `fallbackRecords` (~60), holding
  the same three records in the **JSON** shape (`{ name, count }` objects, not tuples).
  This is what keeps `file://` boots working.

- [ ] 3. **`arena/arena_data.js`** — add the normalizer next to the other `normalize*`
  functions (above `normalizeGameData`, ~533):

  ```js
    /**
     * Converts a starter-deck record from its authoring shape ({ name, count }
     * pairs) into the tuple shape the run builder and starter picker already
     * consume ([name, count]). Records without an id are dropped.
     */
    function normalizeStarterDeck(record) {
        if (!record || !record.id) return null;

        const pairs = list => (Array.isArray(list) ? list : [])
            .filter(entry => entry && entry.name)
            .map(entry => [entry.name, Math.max(1, Math.floor(Number(entry.count)) || 1)]);

        return {
            attacks: pairs(record.attacks),
            enabled: record.enabled !== false,
            id: record.id,
            items: pairs(record.items),
            name: record.name || record.id,
            pokemon: (Array.isArray(record.pokemon) ? record.pokemon : []).filter(Boolean),
            type: record.type || 'NONE'
        };
    }
  ```

- [ ] 4. **`arena/arena_data.js`** — wire it into `normalizeGameData` (~533), keeping the
  existing alphabetical key order:

  ```js
            starterDecks: (records.starterDecks || []).map(normalizeStarterDeck).filter(Boolean),
  ```

- [ ] 5. **`arena/arena_data.js`** — add the fetch to `loadGameData` (~568). Extend both the
  destructuring array and the `Promise.all` list, and pass it into `normalizeGameData`:

  ```js
        const [pokemon, attacks, items, trainers, events, locations, starterDecks] = await Promise.all([
            …,
            loadJson('locations.json', fallbackRecords.locations),
            loadJson('starter_decks.json', fallbackRecords.starterDecks)
        ]);

        arena.GameData = normalizeGameData({ pokemon, attacks, items, trainers, events, locations, starterDecks });
  ```

- [ ] 6. **`map/locations.js`** — rename the existing frozen literal `STARTER_DECKS` →
  `BUILTIN_STARTER_DECKS` (~51) and convert its `attacks`/`items` to keep the **tuple**
  shape they already have (no change to the values). Add the accessor next to the other
  getters:

  ```js
    /**
     * The starter decks the game should offer, keyed by id. Reads the loaded
     * data file when available and falls back to the frozen builtins, so
     * modules required in Node without loadGameData() still work.
     */
    function getStarterDecks(gameData) {
        const records = gameData && Array.isArray(gameData.starterDecks) ? gameData.starterDecks : [];
        const enabled = records.filter(deck => deck && deck.id && deck.enabled !== false);

        if (enabled.length === 0) return BUILTIN_STARTER_DECKS;

        return Object.fromEntries(enabled.map(deck => [deck.id, deck]));
    }
  ```

  Export `getStarterDecks` in the alphabetical export list (~943) and keep exporting
  `STARTER_DECKS` as an alias for `BUILTIN_STARTER_DECKS` so nothing external breaks
  mid-phase.

- [ ] 7. **`map/area.js`** — repoint the three sites. Add one small helper near
  `getStarterType` (~770) and use it in all three:

  ```js
    function starterDecks() {
        return locations.getStarterDecks(arena.GameData);
    }
  ```

  - `getStarterType` (~770): `const decks = starterDecks(); const deck = decks[starterId] || Object.values(decks)[0];`
  - `normalizeStarterId` (~776): membership test against `starterDecks()`; the fallback
    becomes the **first** deck's id rather than the hard-coded `'water'`, so a repo whose
    water deck was renamed still starts.
  - `createCardCollections` (~1427): same `decks[starterId] || Object.values(decks)[0]`
    lookup. **Leave the three `forEach` loops exactly as they are.**

  Confirm `arena.GameData` is loaded before any of these run — `map/area.js`'s init awaits
  `arena.Data.loadGameData()`; read the init function and verify rather than assuming.

- [ ] 8. **`map/starter.js`** — `render()` (~26):
  `const decks = Object.values(locations.getStarterDecks(arena.GameData));`

- [ ] 9. **`static/styles.css`** — grep `.starter-card` / the starter grid container and make
  it wrap for any number of decks (`flex-wrap: wrap` or `grid-template-columns:
  repeat(auto-fit, minmax(…, 1fr))`). Do not restyle the cards themselves.

- [ ] 10. **`tests/data_validation.test.js`** — add cases over the real
  `starter_decks.json`: every record has a unique non-empty `id`, a `type` in `PokeType`,
  a non-empty `pokemon` list, and every `pokemon`/`attacks[].name`/`items[].name` resolves
  in the corresponding data file. Follow the file's existing style (it already reads the
  real JSON files from `ROOT`).

- [ ] 11. **`tests/run_progression.test.js`** — add a case that `loadRealGameData()` then
  `PokeLocations.getStarterDecks(arena.GameData)` returns three decks whose ids are
  `water`, `grass`, `fire`, and that each deck's `attacks` entries are `[name, count]`
  tuples (guards the normalizer contract `createCardCollections` depends on).

- [ ] 12. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] Byte-identical run start: serve with `python3 -m http.server 8931 --bind 127.0.0.1`,
  open `http://127.0.0.1:8931/starter.html`, and start a run from **each** of the three
  decks. For each, check in the devtools console that
  `JSON.parse(localStorage['pokemon-rogue-pocket-run']).collections` holds the same pokemon
  and the same action-card names and counts as before the change. (Capture the "before"
  numbers first with `git stash`, or read them off `map/locations.js` in git history.)
- [ ] `starter.html` renders all three cards, and still renders sanely when a fourth record
  is temporarily added to `starter_decks.json` — then **remove the fixture** and confirm
  `git status` shows `starter_decks.json` back to the three real decks.
- [ ] `enabled: false` on one deck hides it from the picker without breaking the page.
- [ ] File-protocol fallback: open `starter.html` directly from disk (`file://`) and confirm
  the three fallback decks still render (fetch fails, `fallbackRecords.starterDecks` takes
  over) — a console warning `Using built-in starter_decks.json fallback.` is expected.
- [ ] Stop the server: `pkill -f "http.server 8931"`.

## Out of scope / do not touch

`dev/editor/**` (phases 90–91 — the editor still reads the old `engineRefs` path in this
phase and that is fine). Do not change any other data file, do not change deck *contents*,
do not touch `map/run_state.js`, `map/capture.js`, `map/mart.js`, or the arena engine. Do
not add the file to `dev/editor/server.js`'s `FILE_NAMES` yet — `formatDataFile` would
throw on an unknown name, and phase 90 handles both together.
