# Phase 82 — Random event grants drawn from the location's types

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none — independent of 77–81. **Read first:**
`76-map-and-encounter-overhaul-overview.md`.
**Goal:** A random-grant effect can carry `"locationTypes": true`, which restricts the draw to
cards sharing a type with the run's current location. The nursery-egg event uses it, so the
egg hatches into a baby that fits the area. Engine, data, editor, validation, and docs all
land together.

## Context you need

**The locked spec** (from the overview): new boolean effect field **`locationTypes: true`**,
honored by `gain-random-card`, `gain-random-baby`, and the `replacement` object of
`replace-*` / `trade-*`. When set it **wins over** an authored `types` list. **An empty
on-type pool falls back to the unfiltered pool and still grants** — deliberately the opposite
of the authored `types` filter, because the location is an environment accident, not authoring
intent. The names `type` and `types` were both unavailable (see
`15-typed-attack-event-rewards.md` lines 47–51 for why singular `type` was rejected: it
collides with the effect discriminator).

**The engine already has most of this.** In `map/event_effects.js`:
- `getEffectTypes(source)` (~427–431) reads and uppercases `source.types`, returning `null`
  for "no filter". Keep it — it becomes the authored-list branch of a new resolver.
- `chooseRandomRecord(gameData, cardKind, excludeName, types)` (~700–724) already applies a
  type filter, and for `cardKind === 'pokemon'` runs records through
  `PokeLocations.isObtainablePokemon`, **which excludes babies**. That is why a typed *baby*
  grant cannot be expressed as `gain-random-card` and must go through the baby-pool path.
- `gainRandomCards(run, runStore, gameData, cardKind, count, effect)` (~386–411) already
  receives `effect`.
- `gainRandomBaby(run, runStore, gameData)` (~413–425) receives **no** `effect` — the
  `applyEffect` case at ~347 passes none. That call must gain a fourth argument.
- `createReplacementCard(run, runStore, gameData, sourceKind, sourceCard, replacement)` (~531)
  already has `run` in scope and calls `getEffectTypes(replacement)` on its random branch.

**The location is reachable without touching any call site.** `applyAction`'s `context` carries
only `{ gameData, runStore }` (`map/event.js` ~184, `arena/game.js` ~423), but `run` is
argument 1 everywhere, and `map/run_state.js` `normalizeLocationSnapshot` (~417–421) **rejects
a snapshot with an empty `types`**, so `run.location.types` is non-empty whenever
`run.location` exists. Location types are already uppercase.

**Live data makes this safe.** Every location in `locations.json` has 3–4 types; the thinnest
has 5 overlapping babies and 17 overlapping attacks. Two PokeTypes have zero babies
(`GOURMET`, `FOSSIL`) but no location is made only of those, so the fallback is a safety net
rather than a routine path.

**Editor round-trip fidelity is a hard requirement** (`dev/editor/tab_events.js` header
comment): the form mutates a `structuredClone` draft in place, sets only fields the user
edits, deletes a field only when the user clears it, and never rebuilds a record. Saving an
untouched event must produce an empty diff — so do **not** write `locationTypes: false` onto
effects that do not have it.

## Steps

- [ ] 1. **`map/event_effects.js`** — add the resolver and the fallback-aware picker next to
  `getEffectTypes` (~427):

  ```js
      /**
       * Type filter for a random grant. `locationTypes: true` swaps in the run's
       * current location types and wins over an authored `types` list; anything
       * else falls through to the authored list. Returns null for "no filter".
       */
      function resolveGrantTypes(run, source) {
          if (!usesLocationTypes(source)) return getEffectTypes(source);

          const location = run && run.location ? run.location : null;
          const types = location && Array.isArray(location.types) ? location.types : [];

          return types.length > 0 ? types.map(type => String(type).toUpperCase()) : null;
      }

      function usesLocationTypes(source) {
          return Boolean(source && source.locationTypes === true);
      }

      /**
       * A location-derived filter falls back to the unfiltered pool: an area with
       * no on-type card is an environment accident, not an authoring choice, so
       * the grant still happens. An authored `types` list stays strict.
       */
      function chooseGrantRecord(run, gameData, cardKind, excludeName, source) {
          const record = chooseRandomRecord(gameData, cardKind, excludeName, resolveGrantTypes(run, source));

          if (record || !usesLocationTypes(source)) return record;

          return chooseRandomRecord(gameData, cardKind, excludeName, null);
      }
  ```

- [ ] 2. **`map/event_effects.js`** — in `gainRandomCards` (~386), change the first line to
  `const types = resolveGrantTypes(run, effect);` and the record pick to
  `const record = chooseGrantRecord(run, gameData, cardKind, effect.excludeName, effect);`.
  Leave the rest of the function, including the `No FIRE attack available.` message, exactly
  as it is.

- [ ] 3. **`map/event_effects.js`** — make the baby grant typed:
  - `applyEffect` (~347): `return gainRandomBaby(run, runStore, gameData, effect);`
  - `gainRandomBaby(run, runStore, gameData, effect)` (~413): first line becomes
    `const pool = getBabyPool(gameData, resolveGrantTypes(run, effect));`
  - `getBabyPool(gameData, types)` (~74–78): pass the second argument through to
    `global.PokeLocations.getBabyPokemonPool(gameData, types)`.
  - `poolSatisfied` (~70) keeps calling `getBabyPool(gameData)` with **one** argument — it is
    an availability gate for the whole event and must not narrow by location.

- [ ] 4. **`map/event_effects.js`** — in `createReplacementCard` (~531), change the random
  branch from `chooseRandomRecord(gameData, cardKind, getCardName(sourceCard),
  getEffectTypes(replacement))` to
  `chooseGrantRecord(run, gameData, cardKind, getCardName(sourceCard), replacement)`.

- [ ] 5. **`map/locations.js`** — give `getBabyPokemonPool` an optional types argument,
  mirroring `getWildPokemonPool`'s matched-else-all fallback (~692–700):

  ```js
      /**
       * Baby pool, optionally narrowed to a location's types. Falls back to every
       * baby when nothing matches, so a typed grant never comes up empty.
       */
      function getBabyPokemonPool(gameData, locationTypes) {
          const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
          const babies = uniqueByName(pokemon).filter(isBabyPokemon);
          const types = Array.isArray(locationTypes) ? locationTypes : [];

          if (types.length === 0) return babies;

          const matched = babies.filter(record => getRecordTypes(record).some(type => types.includes(type)));

          return matched.length > 0 ? matched : babies;
      }
  ```

  The existing single-argument callers keep working unchanged.

- [ ] 6. **`map/event.js`** — `describeEffect` (~583–604) is the player-facing preview label.
  Append " from this area" when `effect.locationTypes === true`, for both the
  `gain-random-card` and `gain-random-baby` lines. Keep it a pure string function.

- [ ] 7. **`events.json`** — add `"locationTypes": true` to the single effect of the
  `nursery-egg` event (~96–110), so it reads
  `{ "type": "gain-random-baby", "locationTypes": true }`. This is the **only** data edit in
  this phase — do not author anything else.

- [ ] 8. **`dev/editor/tab_events.js`** — make the flag authorable:
  - `EFFECT_FIELDS` (~43–58): `'gain-random-card': ['cardKind', 'count', 'types',
    'locationTypes', 'excludeName']` and `'gain-random-baby': ['locationTypes']`.
  - `effectFieldHtml` (~665–696): add a case copying the `'strict'` checkbox pattern (~683):

    ```js
              case 'locationTypes':
                  return `<label class="editor-form-checkbox"><input type="checkbox" data-scope="eff-location-types" ${base}${effect.locationTypes ? ' checked' : ''}> Match this location's types</label>`;
    ```

  - the change handler (~1129–1164): add a case copying `'eff-strict'` (~1141):

    ```js
                  case 'eff-location-types':
                      effectAt(owner, index).locationTypes = target.checked;
                      repaint = true;
                      break;
    ```

    Use `repaint = true` (not `false`) so the summary text and the now-inert `types` chips
    re-render.
  - `replacementEditorHtml` (~633–661): add the same checkbox under the existing
    `<label>Type filter…</label>` row, bound to `data-scope="eff-repl-location-types"`, with a
    matching handler case writing `effect.replacement.locationTypes`. Follow how
    `eff-repl-cardkind` / `eff-repl` handle the nested `replacement` object.
  - `effectSummaryText` (~344–370): surface it, e.g. append ` (this area's types)` when set,
    on the `gain-random-card` and `gain-random-baby` lines.
  - **Do not** add `locationTypes` to `newEffect` (~217–236) or `backfillEffectDefaults`
    (~241–247). An unchecked box must mean "field absent", not `false`, or every existing
    event picks up a spurious diff.

- [ ] 9. **`dev/editor/validate.js`** — extend `validateEvents` (~356–449), next to the
  existing `types` checks (~435–448). Three rules, using the file's `err(...)` /
  issue-code pattern:
  - `locationTypes` present and not a boolean → error `events.effect-location-types-type`.
  - `locationTypes === true` **and** a non-empty `types` on the same object → issue
    `events.effect-location-types-conflict` ("`locationTypes` wins; the `types` list is
    ignored").
  - `locationTypes` on an effect type that does not read it (anything other than
    `gain-random-card`, `gain-random-baby`, or a `replacement` object) → issue
    `events.effect-location-types-unused`.
  No change to `dev/editor/server.js` or its `EFFECT_TYPES` list — this adds a **field**, not a
  new effect type, so `tests/editor_api.test.js:183` (`effectTypes.length === 14`) still holds.

- [ ] 10. **`tests/data_validation.test.js`** — mirror the three rules in the event schema
  block (~228–340), next to the existing effect `types` validation (~280–292), so live data is
  checked by `node tests/run_all.js` and not only by the editor.

- [ ] 11. **`tests/editor_validation.test.js`** — add fixtures for the three new issue codes,
  following the `events: unknown effect type` pattern (~188–217).

- [ ] 12. **`tests/baby_event.test.js`** — extend the existing suite (fixture builders at
  ~20–43, `applyEffects` assertion at ~96–108). Add:
  - a typed baby grant: a run whose `location.types` is `['FIRE']`, a fixture baby pool with
    one FIRE baby and several off-type babies, and `{ type: 'gain-random-baby',
    locationTypes: true }` — loop ≥100 rolls and assert **every** grant is the FIRE baby.
  - the fallback: same effect, but a location whose types match no baby — assert a baby is
    still granted (this is the rule that differs from the authored `types` filter).
  - no regression: `{ type: 'gain-random-baby' }` without the flag still draws from the whole
    pool (loop and assert more than one distinct name appears).
  - a live-data check: `await loadRealGameData()`, then for a run at each of a few real
    locations, `gain-random-baby` with `locationTypes: true` always yields a baby sharing a
    type with that location.

- [ ] 13. **`tests/event_effects`-side coverage** — add to whichever existing file covers
  `gain-random-card` typed grants (grep for
  `gain-random-card with types only grants on-type attacks`): a `locationTypes: true` variant
  proving it draws on-type from `run.location.types`, and that it **wins** when `types` is also
  present and disjoint.

- [ ] 14. **`.claude/skills/data/SKILL.md`** — document the field in the "Event effects
  (`events.json`)" section (~48–64): where it is honored, that it overrides `types`, and the
  fallback-vs-strict difference from the authored `types` filter. Note it is inert on a
  `replacement` that has a `name` (same caveat already recorded for `replacement.types` at
  ~124–125).

## Verification

- [ ] `node --check map/event_effects.js`, `map/locations.js`, `map/event.js`,
  `dev/editor/tab_events.js`, `dev/editor/validate.js` all pass.
- [ ] `node tests/run_all.js` green — including `tests/editor_format.test.js`, which asserts
  `events.json` is **byte-exact** against `dev/editor/format_json.js`. If it fails, the
  nursery-egg effect object no longer round-trips; fix the formatting, not the test.
- [ ] `node dev/editor/validate.js` (or whatever entry point the editor exposes) reports no
  new issues against live data.
- [ ] Behavioral one-liner — a FIRE/ROCK/FLYING location must produce only on-type babies:
  ```
  node -e "require('./tests/helpers/arena_env.js'); require('./map/locations.js');
  require('./map/run_state.js'); require('./map/event_effects.js');
  const {loadRealGameData, arena}=require('./tests/helpers/arena_env.js');
  const R=globalThis.PokeRun, E=globalThis.PokeEvents;
  loadRealGameData().then(()=>{
    const run=R.createRunState({area:{nodes:[{id:'start'}],edges:[]},collections:{},
      location:{id:'mt-ember',name:'Mt. Ember',terrain:'Volcanic',types:['FIRE','ROCK','FLYING'],theme:{},background:null}});
    const names=new Set();
    for(let i=0;i<60;i++){
      const r=R.createRunState({area:{nodes:[{id:'start'}],edges:[]},collections:{},location:run.location});
      E.applyEffects(r,[{type:'gain-random-baby',locationTypes:true}],{},{gameData:arena.GameData,runStore:R});
      r.collections.pokemon.forEach(c=>names.add(c.pokemon.name));
    }
    console.log([...names].join(', '));});"
  ```
  Every name printed must be a baby whose non-BABY types intersect FIRE/ROCK/FLYING.
- [ ] Browser check with the `verify` skill: reach an event node until the Nursery Surprise
  event appears (or force it via the console), claim the egg, and confirm the hatched baby's
  types overlap the current location. Screenshot as `dev/verify/phase82_typed_baby_grant.png`.
- [ ] Editor check with the `verify` skill, driver modeled on `dev/verify/drive_editor.py`
  (it spawns `node dev/editor/server.js --port 8933` itself): open the Events tab, select
  `nursery-egg`, confirm the "Match this location's types" checkbox renders **checked**, and
  confirm that toggling it off and back on leaves `git diff events.json` empty. Screenshot as
  `dev/verify/phase82_editor_location_types.png`.
- [ ] `git status` shows `events.json` changed by exactly the one added field.

## Out of scope / do not touch

Do **not** author new events or edit any event other than `nursery-egg`. Do not add a new
effect **type** (that would break `tests/editor_api.test.js`'s `effectTypes.length === 14` and
require a `dev/editor/server.js` change). Do not change the semantics of the authored `types`
filter — it stays strict with no fallback. Do not touch `map/area.js`, `map/locations.js`
beyond `getBabyPokemonPool`, `map/capture.js`, `map/attack.js`, `map/mart.js`, `arena/**`, or
anything the map batch (phases 78–81) owns. Do not add `locationTypes: false` defaults
anywhere — absence is the off state.
