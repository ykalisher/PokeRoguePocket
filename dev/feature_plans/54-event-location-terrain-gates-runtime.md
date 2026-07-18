# Phase 54 — Event gates by location id / terrain: runtime

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 50 (green baseline; independent of 51–53). **Read first:** `49-editor-polish-overview.md` (Locked spec → "Event gates").
**Goal:** Events with `locations` / `terrains` arrays gate by location id / terrain
(overriding the `types` gate) in the real game selection path, with runtime tests and
the data-skill doc updated.

## Context you need

- The gate semantics are locked in the overview: non-empty `locations` or `terrains`
  **replaces** the `types` gate; match = `id ∈ locations` OR normalized terrain ∈
  normalized `terrains` (`norm = trim + lowercase`); neither set → old behavior;
  ungated calls (no location argument) return everything.
- `map/event_effects.js` (IIFE, `window.PokeEvents`) currently has:
  `getAvailableEvents(gameData, locationTypes)` (gates only when a non-empty types
  array is passed), `matchesLocationTypes(event, locationTypes)`,
  `chooseEvent(gameData, run)` (reads `run.location.types`), `poolSatisfied`,
  `getEventById` (calls `getAvailableEvents(gameData)` with no gate — **must stay
  ungated** so saved encounters always resolve).
- Callers in `map/area.js`:
  - `hasAvailableEvents()` (~line 1576) currently builds
    `const locationTypes = state.run && state.run.location ? state.run.location.types : undefined;`
    and passes that.
  - Two `chooseEvent(arena.GameData, state.run)` sites (~lines 1016, 1246) already pass
    the whole run — **no change needed there**.
- `run.location` is a snapshot `{ id, name, terrain, types, theme, background }`
  (`map/run_state.js normalizeLocationSnapshot`) — everything the gate needs is already
  on it.
- **Backward-compat shim is required**: `tests/run_progression.test.js` (and possibly
  other callers) invoke `getAvailableEvents(pool, ['WATER'])` with a bare types array.
  Treat an array argument as `{ types: array }` so those existing tests stay untouched
  and green.
- `tests/run_progression.test.js` facts: `makeEvent(id, type, types)` helper at the top
  (~line 18); the existing event-gating tests and the `EVENT_POOL` fixture sit together
  (~lines 634–680) — add the new tests right after them. `E` is
  `globalThis.PokeEvents`.
- `.claude/skills/data/SKILL.md` documents the events schema. It has **uncommitted
  owner edits** — append only, never restructure or reformat that file.

## Steps

- [ ] 1. **`map/event_effects.js`** — replace `getAvailableEvents` and
  `matchesLocationTypes`'s caller wiring with the location-snapshot form (keep
  `matchesLocationTypes` itself unchanged):
  ```js
  function getAvailableEvents(gameData, location) {
      const events = gameData && Array.isArray(gameData.events) ? gameData.events : [];
      // Accepts a location snapshot ({ id, terrain, types }) or, for older
      // callers/tests, a bare types array; undefined leaves the pool ungated
      // (so getEventById and any saved-encounter restore path always resolve).
      const loc = Array.isArray(location) ? { types: location } : (location || null);
      const gated = Boolean(loc && (loc.id || loc.terrain ||
          (Array.isArray(loc.types) && loc.types.length > 0)));

      return events.filter(event => (
          event &&
          event.enabled !== false &&
          event.id &&
          EVENT_TYPES.includes(event.type) &&
          (!gated || matchesLocation(event, loc))
      ));
  }

  function normTerrain(value) {
      return String(value || '').trim().toLowerCase();
  }

  // `locations` / `terrains` on an event override the `types` gate entirely:
  // when either list is non-empty the event appears only at those location
  // ids / terrains (OR of the two lists). With neither set, the PokeType
  // overlap gate applies as before.
  function matchesLocation(event, loc) {
      const ids = Array.isArray(event.locations) ? event.locations.filter(Boolean) : [];
      const terrains = Array.isArray(event.terrains) ? event.terrains.filter(Boolean) : [];

      if (ids.length > 0 || terrains.length > 0) {
          return (ids.length > 0 && typeof loc.id === 'string' && ids.includes(loc.id)) ||
              (terrains.length > 0 && normTerrain(loc.terrain) !== '' &&
                  terrains.some(label => normTerrain(label) === normTerrain(loc.terrain)));
      }

      return matchesLocationTypes(event, Array.isArray(loc.types) ? loc.types : []);
  }
  ```
- [ ] 2. **`map/event_effects.js`** — `chooseEvent` passes the whole snapshot:
  ```js
  function chooseEvent(gameData, run) {
      const location = run && run.location ? run.location : undefined;
      const events = getAvailableEvents(gameData, location).filter(event => poolSatisfied(event, gameData));

      if (events.length === 0) return null;

      return events[randomInt(0, events.length - 1)];
  }
  ```
  Leave `getEventById` exactly as is (ungated). If the IIFE's exports list names
  `matchesLocationTypes`, leave that export; do not export the new internals.
- [ ] 3. **`map/area.js`** — in `hasAvailableEvents()`, pass the snapshot instead of the
  types array:
  ```js
  const location = state.run && state.run.location ? state.run.location : undefined;
  ```
  and use `getAvailableEvents(arena.GameData, location)`. (Adjust the surrounding
  variable name/comment; nothing else in area.js changes.)
- [ ] 4. **`tests/run_progression.test.js`** — extend `makeEvent` with an optional
  4th parameter, keeping existing call sites valid:
  ```js
  function makeEvent(id, type, types, extra) {
      const event = { id, type, title: id, body: 'text', enabled: true };
      if (types) event.types = types;
      if (type === 'choice') event.choices = [{ title: 'a', id: 'a', effects: [] }];
      if (type === 'trainer') { event.trainerName = 'x'; event.rewardEffects = []; }
      return Object.assign(event, extra || {});
  }
  ```
- [ ] 5. **`tests/run_progression.test.js`** — add these tests directly after the
  existing `chooseEvent only returns events matching the run location types` test:
  ```js
  // --- Location / terrain gate overrides (phase 54) --------------------------

  const OVERRIDE_POOL = {
      events: [
          makeEvent('universal-gift', 'gift'),
          makeEvent('seafoam-only', 'gift', ['FIRE'], { locations: ['seafoam-islands'] }),
          makeEvent('island-only', 'gift', null, { terrains: ['Island'] }),
          makeEvent('either-place', 'gift', null, { locations: ['new-mauville'], terrains: ['Lake'] })
      ]
  };

  function atLocation(id, terrain, types) {
      return { id, terrain, types };
  }

  test('event locations override beats the type gate both ways', () => {
      const atSeafoam = E.getAvailableEvents(OVERRIDE_POOL, atLocation('seafoam-islands', 'Island', ['WATER', 'ICE']))
          .map(event => event.id);
      // id matches even though the event's types (FIRE) do not overlap WATER/ICE
      assert.ok(atSeafoam.includes('seafoam-only'));

      const atVolcano = E.getAvailableEvents(OVERRIDE_POOL, atLocation('cinnabar-island-volcano', 'Volcanic', ['FIRE', 'ROCK']))
          .map(event => event.id);
      // types overlap (FIRE) but the locations override is set and does not match
      assert.ok(!atVolcano.includes('seafoam-only'));
  });

  test('event terrains override matches trimmed and case-insensitive', () => {
      const island = E.getAvailableEvents(OVERRIDE_POOL, atLocation('sevii-islands', '  island ', ['WATER']))
          .map(event => event.id);
      assert.ok(island.includes('island-only'));

      const cave = E.getAvailableEvents(OVERRIDE_POOL, atLocation('cerulean-cave', 'Cave', ['MONSTER']))
          .map(event => event.id);
      assert.ok(!cave.includes('island-only'));
  });

  test('locations and terrains overrides OR together', () => {
      const byId = E.getAvailableEvents(OVERRIDE_POOL, atLocation('new-mauville', 'Factory', ['ELECTRIC'])).map(event => event.id);
      const byTerrain = E.getAvailableEvents(OVERRIDE_POOL, atLocation('lake-of-rage', 'Lake', ['DRAGON'])).map(event => event.id);
      const neither = E.getAvailableEvents(OVERRIDE_POOL, atLocation('safari-zone', 'Safari', ['NORMAL'])).map(event => event.id);

      assert.ok(byId.includes('either-place'));
      assert.ok(byTerrain.includes('either-place'));
      assert.ok(!neither.includes('either-place'));
  });

  test('ungated calls still include override-gated events', () => {
      const all = E.getAvailableEvents(OVERRIDE_POOL).map(event => event.id);
      ['seafoam-only', 'island-only', 'either-place'].forEach(id => assert.ok(all.includes(id), id));
  });

  test('chooseEvent respects overrides via run.location', () => {
      const run = { location: atLocation('seafoam-islands', 'Island', ['WATER', 'ICE']) };
      const allowed = new Set(['universal-gift', 'seafoam-only', 'island-only']);

      for (let index = 0; index < 100; index += 1) {
          const event = E.chooseEvent(OVERRIDE_POOL, run);
          assert.ok(event && allowed.has(event.id), `chooseEvent leaked ${event && event.id}`);
      }
  });
  ```
- [ ] 6. **`.claude/skills/data/SKILL.md`** — append a short note to the events section
  (append-only; the file has uncommitted owner edits):
  ```
  Events gate by location via optional top-level `types` (PokeType overlap with the
  location's types). Two optional override lists: `locations` (location ids) and
  `terrains` (terrain labels, matched trimmed/case-insensitive). If either is
  non-empty it replaces the type gate — the event appears only where the location id
  is in `locations` OR the terrain is in `terrains`. Both are validated against
  locations.json.
  ```

## Verification

- [ ] `node tests/run_all.js` green — including the four **pre-existing**
  `getAvailableEvents` tests, untouched (proves the bare-array shim works).
- [ ] The existing `getEventById` behavior is unchanged: `grep -n "getAvailableEvents(gameData)"
  map/event_effects.js` still shows the ungated call inside `getEventById`.
- [ ] Quick engine check without a browser:
  ```bash
  node -e "
  require('./tests/helpers/arena_env');
  require('./map/event_effects');
  const E = globalThis.PokeEvents;
  const pool = { events: [ { id: 'x', type: 'gift', title: 'x', body: 'b', enabled: true, types: ['FIRE'], locations: ['seafoam-islands'] } ] };
  console.log('id match :', E.getAvailableEvents(pool, { id: 'seafoam-islands', terrain: 'Island', types: ['WATER'] }).length === 1);
  console.log('override :', E.getAvailableEvents(pool, { id: 'other', terrain: 'Volcanic', types: ['FIRE'] }).length === 0);
  console.log('ungated  :', E.getAvailableEvents(pool).length === 1);
  "
  ```
  must print `true` three times.

## Out of scope / do not touch

No editor changes (phase 55). Do not touch `scripts/manage_events.js`, `map/event.js`
(page renderer), `getEventById`, or `events.json` itself — no live event gets the new
fields in this phase. Do not restructure SKILL.md. Do not `git commit`.
