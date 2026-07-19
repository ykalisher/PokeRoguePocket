# Phase 58 — Restore green baseline

**Recommended agent:** Haiku · low effort.
**Prereqs:** none. **Read first:** `57-bugfix-perf-overview.md`.
**Goal:** `node tests/run_all.js` fully green. Exactly one test is red today:
`locations: disconnected graph` in `tests/editor_validation.test.js`.

## Context you need

- The test isolates `lavender-town` from the location overlap graph by giving it types no
  other enabled location shares, then asserts `validateAll` reports
  `locations.graph-disconnected`. It was written when only 13 locations existed and used
  `['BABY', 'FOSSIL']` — but the owner's `5b83bac "Updated locations"` commit grew
  `locations.json` to 29 records, four of which use FOSSIL (snowpoint-city, mauville-desert,
  fortree-jungle, oreburg-mine). FOSSIL now connects lavender-town to the rest of the graph,
  so the assertion fails.
- Verified replacement: `['BABY', 'ARTIFICIAL']`. Neither type appears on any enabled
  location, both are valid `PokeType` members, and this exact mutation was run against
  `validateAll` during the review — it produced exactly one issue code,
  `locations.graph-disconnected`, and did not disturb the `locations.starter-coverage` check
  (lavender-town's real types GHOST/HUMAN/MONSTER contain no starter type and remain covered
  by other locations).
- The test sits at ~line 175 of `tests/editor_validation.test.js` (anchor is a hint — find it
  by the test name).

## Steps

- [ ] 1. **`tests/editor_validation.test.js`** — in the `locations: disconnected graph` test,
  replace the fixture types and refresh the comment:
  ```js
  test('locations: disconnected graph', () => {
      // Isolation types must be types NO enabled location uses. FOSSIL became a
      // real location type in the 2026-07-18 location expansion, so BABY +
      // ARTIFICIAL (card-only types) are used instead. lavender-town's real
      // types (GHOST/HUMAN/MONSTER) are all covered by other enabled locations
      // and include no starter type, so isolating it breaks only connectivity.
      const data = withLocations((locations) => {
          const isolated = locations.find((location) => location.id === 'lavender-town');
          isolated.types = ['BABY', 'ARTIFICIAL'];
      });
      const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
      assert.ok(hasCode(issues, 'locations.graph-disconnected'));
  });
  ```
  (Only the types array and the comment change; the surrounding structure is already there.)

## Verification

- [ ] `node tests/run_all.js` green — zero failing tests.
- [ ] `node --test tests/editor_validation.test.js` shows `locations: disconnected graph`
  passing.

## Out of scope / do not touch

Do not change `dev/editor/validate.js`, `locations.json`, or any game code — this phase edits
one test fixture only. Do not "fix" the test by weakening the assertion or deleting it. Do not
`git commit`.
