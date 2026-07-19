# Phase 60 — Validation rule: no markup-breaking characters in data names

**Recommended agent:** Sonnet · low effort.
**Prereqs:** 58 (green baseline; independent of 59). **Read first:**
`57-bugfix-perf-overview.md` (Locked spec → "Phase 60 rule").
**Goal:** `validateAll` reports error `data.unsafe-name-chars` when a pokemon/attack/item/
trainer `name` — or a location `name`/`terrain` — contains `"`, `<`, or `>`; covered by tests
and documented in the data skill.

## Context you need

- Why: `arena/arena_render.js` interpolates these exact strings into double-quoted HTML
  attributes (e.g. `aria-label="Select ${name}"`, `title="${player.name}"`) with no escaping.
  A `"`/`<`/`>` in a name would silently corrupt the battle DOM. Apostrophes are safe and
  **must stay legal** — live data contains "Nature's Blessing", "Nature's Gift", "Dragon's
  Breath". Event `title`/`body` are exempt: `map/event.js` escapes them with its own
  `escapeHtml` (verified — the live `rogue-mecha-cop` body legitimately contains `"`).
- `dev/editor/validate.js` is an IIFE with helpers
  `err(file, recordKey, code, message, field)` / `warn(...)`. Per-file validators
  (`validatePokemon` etc.) are composed in `validateAll` (~line 608) via a spread array:
  ```js
  return [
      ...validatePokemon(pokemon, enums),
      ...validateAttacks(attacks, enums),
      ...
      ...validateAssets(data, assetIndex, engineRefs)
  ];
  ```
- Tests: `tests/editor_validation.test.js` builds a live env once
  (`buildLiveEditorEnv()` from `tests/helpers/editor_env.js`) and mutates structured clones
  via `withPokemon/withAttacks/withItems/withTrainers/withLocations`; assertions use
  `hasCode(issues, code)`. The very first test asserts **live data has zero error-severity
  issues** — the new rule must not fire on current data (verified during the review: no live
  name contains `"` `<` `>`).
- `.claude/skills/data/SKILL.md` has uncommitted owner edits — **append only**, never
  restructure that file.

## Steps

- [ ] 1. **`dev/editor/validate.js`** — add this function directly above the
  `// -------------------------------------------------------------- validateAll` banner:
  ```js
  // ---------------------------------------------------- name character safety

  // The battle renderer (arena/arena_render.js) interpolates these strings
  // into double-quoted HTML attributes without escaping, so a quote or angle
  // bracket in a name would silently corrupt the DOM. Apostrophes are legal.
  const UNSAFE_NAME_PATTERN = /["<>]/;

  function validateNameCharacters(data) {
      const issues = [];
      const check = (file, recordKey, value, field) => {
          if (typeof value === 'string' && UNSAFE_NAME_PATTERN.test(value)) {
              issues.push(err(file, recordKey, 'data.unsafe-name-chars',
                  `${recordKey}: ${field} must not contain " < or > (breaks battle markup), got ${value}`, field));
          }
      };

      (data.pokemon || []).forEach((record) => check('pokemon.json', record.name, record.name, 'name'));
      (data.attacks || []).forEach((record) => check('attacks.json', record.name, record.name, 'name'));
      (data.items || []).forEach((record) => check('items.json', record.name, record.name, 'name'));
      (data.trainers || []).forEach((record) => check('trainers.json', record.name, record.name, 'name'));
      (data.locations || []).forEach((record) => {
          check('locations.json', record.id, record.name, 'name');
          check('locations.json', record.id, record.terrain, 'terrain');
      });

      return issues;
  }
  ```
- [ ] 2. **`dev/editor/validate.js`** — splice it into `validateAll`'s returned array, after
  the `validateLocations` line:
  ```js
          ...validateLocations(locations, enums, engineRefs),
          ...validateNameCharacters(data),
  ```
- [ ] 3. **`tests/editor_validation.test.js`** — add these tests next to the other
  mutation-fixture tests (after the locations tests is fine):
  ```js
  test('names: double quote in an attack name is an error', () => {
      const data = withAttacks((attacks) => { attacks[0].name = 'Slash "Deluxe"'; });
      const issues = validateAll(data, { enums: live.enums });
      assert.ok(hasCode(issues, 'data.unsafe-name-chars'));
  });

  test('names: angle bracket in a location terrain is an error', () => {
      const data = withLocations((locations) => { locations[0].terrain = '<Volcanic>'; });
      const issues = validateAll(data, { enums: live.enums });
      assert.ok(hasCode(issues, 'data.unsafe-name-chars'));
  });

  test('names: apostrophes stay legal', () => {
      // Live data already contains "Nature's Blessing" etc.; the zero-errors
      // live-parity test above is the real guard — this pins the intent.
      const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
      assert.ok(!hasCode(issues, 'data.unsafe-name-chars'));
  });
  ```
- [ ] 4. **`.claude/skills/data/SKILL.md`** — append this note at the end of the file
  (append-only):
  ```
  Record names (pokemon/attacks/items/trainers) and location name/terrain must not
  contain `"`, `<`, or `>` — the battle renderer interpolates them into double-quoted
  HTML attributes unescaped (validated as `data.unsafe-name-chars`). Apostrophes are fine.
  ```

## Verification

- [ ] `node tests/run_all.js` green — including the pre-existing
  `live data: zero error-severity issues` test (proves the rule fires on nothing live).
- [ ] `node --test tests/editor_validation.test.js` shows the three new tests passing.
- [ ] Quick spot-check without the editor GUI:
  ```bash
  node -e "
  const { validateAll } = require('./dev/editor/validate.js');
  const data = { pokemon: [{ name: 'Bad<Name>' }], attacks: [], items: [], trainers: [], events: [], locations: [] };
  const hit = validateAll(data, { enums: {} }).filter(i => i.code === 'data.unsafe-name-chars');
  console.log(hit.length === 1 && hit[0].severity === 'error' ? 'OK' : 'FAIL', JSON.stringify(hit));
  "
  ```
  must print `OK ...`.

## Out of scope / do not touch

Do not add escaping to `arena/arena_render.js` (the data-layer rule is the chosen guard). Do
not validate event `title`/`body` (escaped at render). Do not restructure
`.claude/skills/data/SKILL.md` or touch `scripts/manage_*.js`. Do not `git commit`.
