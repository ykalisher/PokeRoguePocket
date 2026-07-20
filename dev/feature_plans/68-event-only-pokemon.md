# Phase 68 — Event-only pokemon

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none (independent of Phase 69). **Read first:** `67-event-only-pokemon-overview.md`.
**Goal:** A pokemon can carry `"eventOnly": true` in `pokemon.json`; such pokemon never
appear in any wild/capture or random-reward pool (including the legendary opt-in path) but
stay grantable by events that name them; the data editor has an "Event-only" checkbox on the
Pokemon form; and the Issues tab warns when a flagged pokemon is granted by no event. Ends
green. **No real pokemon is flagged — mechanism only.**

## Context you need

- **Schema.** `pokemon.json` is a flat array; records have no boolean fields today
  (`legendary`/`baby` are pseudo-types in `type1/2/3`; a Mega is `id>9000`). `eventOnly` is
  the first real boolean. Keep the file minimal: store the key **only when true**; delete it
  when false (mirrors the existing "(none) deletes `evolvesInto`" idiom). Do **not** backfill
  existing records or add a default in `template()`.
- **Normalization drops unknown keys.** `arena/arena_data.js` `normalizePokemon(record)`
  (~L358) copies an explicit field list into `species`, so `arena.GameData.pokemon` won't
  carry `eventOnly` unless you add it there. The `map/` pool code runs on the normalized
  `arena.GameData`, so this is mandatory.
- **Single wild/random choke point.** `map/locations.js`
  `isObtainablePokemon(record, gameData)` (~L782) already excludes LEGENDARY/BABY/MEGA and
  funnels every wild pool and random pokemon reward. Add the event-only guard here. Helpers
  `isBabyPokemon`/`isMegaPokemon`/`isMegaByConvention` sit just above (~L720-775); the module
  export object is at the bottom of the file.
- **Legendary opt-in bypass.** `getAvailableLegendaryPokemon` in `map/capture.js` (~L449-457)
  and `map/area.js` (~L1180-1184) re-adds legendaries and filters mega/baby via
  `locations.isMegaPokemon` / `locations.isBabyPokemon` — but not event-only. Add the
  exclusion in both so an event-only LEGENDARY still can't spawn.
- **Reachability.** Named grants bypass the filter: `map/event_effects.js` `gainNamedCards`
  → `findRecord` (~L636) is a plain exact-name match, no obtainability check. Random rewards
  (`gain-random-card` → `chooseRandomRecord`, ~L645-651) DO filter via `isObtainablePokemon`,
  so event-only pokemon are correctly excluded from random gains too.
- **Editor form.** `dev/editor/tab_pokemon.js` `renderForm(el, draft, api)` (~L181-244) sets
  `el.innerHTML` once and binds ONE delegated `input` listener to `el` (~L212-243). Copy the
  checkbox pattern from `dev/editor/tab_locations.js` (`enabled` checkbox: render ~L253,
  generic checkbox read ~L297-302). Do **not** re-invoke `renderForm`. Read the checkbox from
  `target.checked` **before** the generic `draft[field] = STAT_FIELDS.includes(field) ?
  Number(value) : value` write (~L220), which would otherwise coerce the checkbox's string
  value. `.editor-form-checkbox` is already styled (`dev/editor/editor.css` ~L485).
- **Save/write is generic.** Setting `draft.eventOnly` serializes via the standard
  `PUT /api/data/pokemon`; `pokemon.json` is plain-`JSON.stringify`'d preserving key order,
  so the new key appends at each record's end. No `dev/editor/server.js` or
  `dev/editor/format_json.js` change is needed.
- **Validator.** `dev/editor/validate.js` `validatePokemon(pokemon, enums)` (~L82-129) holds
  the per-pokemon checks. `validateAll(data, options)` (~L636-665) has `events` in scope and
  the helper `collectAllEffectRefs(events)` (~L669-675) that yields `{event, effect}` for
  every effect across all events (handles the rewardEffects/effects/rewards shapes). `warn()`
  helper at ~L38.

## Steps

- [x] 1. **`arena/arena_data.js`** — in `normalizePokemon` (~L358), add to the `species`
  object literal: `eventOnly: record.eventOnly === true,` (only `true` survives; anything
  else normalizes to `false`). This exposes the flag to the pool code.

- [x] 2. **`map/locations.js`** — add a helper next to the baby/mega helpers (~L720):
  ```js
  function isEventOnlyPokemon(record) {
      return Boolean(record && record.eventOnly === true);
  }
  ```
  In `isObtainablePokemon` (~L782), add a guard right after the mega check (after ~L786):
  ```js
  if (isEventOnlyPokemon(record)) return false;
  ```
  Add `isEventOnlyPokemon` to the module's export object at the bottom of the file (alongside
  `isObtainablePokemon`, `isMegaPokemon`, `isBabyPokemon`).

- [x] 3. **`map/capture.js`** and **`map/area.js`** — in each `getAvailableLegendaryPokemon`
  (capture.js ~L454-456, area.js ~L1181-1183), extend the existing
  `.filter(record => !locations.isMegaPokemon(...) && !locations.isBabyPokemon(record))` with
  `&& !locations.isEventOnlyPokemon(record)`.

- [x] 4. **`dev/editor/tab_pokemon.js`** — in `renderForm`, add an "Event-only" checkbox row
  (place it after the stat inputs, before/after the evolves-into row):
  ```js
  <div class="editor-form-row">
      <label class="editor-form-checkbox"><input type="checkbox" name="eventOnly"${draft.eventOnly === true ? ' checked' : ''}> Event-only (never appears in wild areas)</label>
  </div>
  ```

- [x] 5. **`dev/editor/tab_pokemon.js`** — in the delegated `input` listener, add a checkbox
  branch **before** the generic field write (~L220):
  ```js
  if (event.target.type === 'checkbox') {
      if (event.target.checked) draft[field] = true;
      else delete draft[field];       // keep pokemon.json minimal — omit when false
      api.markDirty();
      api.refreshPreview();
      return;
  }
  ```

- [x] 6. **`dev/editor/validate.js`** — add the orphan warning. In `validateAll` (~L636),
  after `events` is in scope, compute the set of pokemon granted by name across all events
  and thread it into the pokemon validator:
  ```js
  const eventGrantedPokemon = new Set(
      collectAllEffectRefs(events)
          .map((ref) => ref.effect)
          .filter((effect) => effect && effect.type === 'gain-card' && effect.cardKind === 'pokemon' && effect.name)
          .map((effect) => effect.name)
  );
  ```
  Change the call to `...validatePokemon(pokemon, enums, eventGrantedPokemon)`, add the
  third parameter to `validatePokemon`, and inside its per-record loop (after the existing
  checks, ~L125) add:
  ```js
  if (record.eventOnly === true && !(eventGrantedPokemon && eventGrantedPokemon.has(record.name))) {
      issues.push(warn('pokemon.json', key, 'pokemon.event-only-unreachable',
          `${key}: event-only pokemon is granted by no event (gain-card) — it is unobtainable`, 'eventOnly'));
  }
  ```
  Keep it a **warning** so it never blocks saving a pokemon flagged before its event exists.

- [x] 7. **Tests — engine.** Add a test (new `tests/event_only_pokemon.test.js`, using
  `tests/helpers/arena_env.js`) that builds a synthetic `gameData` whose `pokemon` array
  includes a plain record with `eventOnly:true` (give it ordinary non-legendary/non-baby
  types). Assert `locations.isObtainablePokemon(rec, gameData) === false`, that the record is
  **absent** from `locations.getWildPokemonPool(gameData, ...)`, and that a by-name lookup
  still finds it (documents that events can still grant it). Keep it data-proof — use a
  synthetic record, not a real species.

- [x] 8. **Tests — editor validation.** Add to `tests/editor_validation.test.js`: a fixture
  with an `eventOnly:true` pokemon and NO event granting it by name → expect a
  `pokemon.event-only-unreachable` warning; then add an event whose `gain-card` names it →
  expect the warning gone.

## Verification

- [x] `node tests/run_all.js` green.
- [x] Editor browser check via the `verify` skill (`node dev/editor/server.js` →
  `127.0.0.1:8932`): open any pokemon, tick **Event-only**, Save → `pokemon.json` shows
  `"eventOnly": true` on that record; untick + Save → the key is **removed** (not set to
  `false`). While flagged-but-unnamed, the Issues tab shows the
  `pokemon.event-only-unreachable` warning; saving is **not** blocked.
- [x] (Optional runtime) `verify` skill: temporarily flag a common pokemon and confirm it
  never appears in a Wild Pokemon Encounter across several terrains; then unflag it.

## Out of scope / do not touch

- **Ground rules** (see `67-event-only-pokemon-overview.md`).
- Do **not** flag any real pokemon as event-only, add a default to `template()`, or write
  `"eventOnly": false` anywhere — the owner flags pokemon via the checkbox.
- Do **not** change `dev/editor/server.js` or `dev/editor/format_json.js` (field-agnostic).
- Do **not** touch the baby→mega check (Phase 69), the legendary spawn *chance*
  (`LEGENDARY_CAPTURE_CHANCE`), or the Phase-66 evolves-into row logic.
