# Phase 37 — User-facing renames: Gym Leader & Wild Pokemon Encounter

**Recommended agent:** Haiku · low effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** All player-visible text says "Gym Leader" instead of "Boss" and
"Wild Pokemon Encounter" instead of "Capture Spot"; internal identifiers are unchanged;
the naming split is documented in `CLAUDE.md`.

## Context you need

- The rename is **display text only** (Locked spec). Internal names that must NOT
  change: node types `'boss'`/`'capture'`, trainer rank string `'Boss'`,
  `bossNodeId`/`completedBossNodeId`/`DEFAULT_BOSS_NODE_ID`, `bossRanks` config,
  CSS classes (`.area-node--boss` etc.), and all test assertions.
- Known user-facing occurrences (anchors are hints — re-grep for drift):
  - `map/area.js` ~12–13: `LOCATION_LABELS` — `boss: 'Boss'`, `capture: 'Capture Spot'`.
    This one object drives the map legend (~444), the route status line (~356), node
    aria-labels (~1511), and entered-location popups.
  - `map/area.js` ~230: `'No Boss trainers are available.'`
  - `map/area.js` ~365: `return 'Area boss reached'`.
  - `map/area.js` ~1510: aria template `… ? 'boss battle' : 'battle'`.
  - `map/area.js` ~1525: `if (node.type === 'boss') return 'the Boss';` — change only
    the returned string, not the `'boss'` comparison.
  - `arena/game.js` ~368: `'<p>The area boss stepped aside.</p>'`.
  - `arena/game.js` ~399: `return isFinal ? 'Boss Battle' : 'Trainer Battle';` — change
    only `'Boss Battle'`. Line ~396's `'Final Battle'`/`'Elite Battle'` (level-4 kicker)
    stays as-is.

## Steps

- [x] 1. **`map/area.js`** — apply the string changes listed above:
  `'Boss'`→`'Gym Leader'` (label), `'Capture Spot'`→`'Wild Pokemon Encounter'`,
  `'No Boss trainers are available.'`→`'No Gym Leader trainers are available.'`,
  `'Area boss reached'`→`'Gym Leader reached'`, aria `'boss battle'`→`'gym leader
  battle'`, `'the Boss'`→`'the Gym Leader'`.
- [x] 2. **`arena/game.js`** — `'The area boss stepped aside.'`→`'The Gym Leader stepped
  aside.'`; kicker `'Boss Battle'`→`'Gym Leader Battle'`.
- [x] 3. **Drift sweep** — `grep -rn "Boss\|Capture Spot" map/ arena/ *.html` and fix any
  *user-facing string* not listed above (there should be none); leave every internal
  identifier and `trainers.json`/test occurrence alone.
- [x] 4. **`CLAUDE.md`** — add one short bullet under "Task pointers": UI text says
  "Gym Leader" and "Wild Pokemon Encounter", but internals keep the old names (node
  types `'boss'`/`'capture'`, rank `'Boss'`, `bossNodeId`, CSS classes) — never rename
  internals to match the UI.

## Verification

- [x] `node tests/run_all.js` green (tests assert internal names only; if one fails you
  renamed an internal — revert it).
- [x] `verify` skill: load `area.html` on a fresh run — legend shows "Gym Leader" and
  "Wild Pokemon Encounter"; screenshot. Optionally check the battle kicker via the
  boss-battle driver.

## Out of scope / do not touch
`trainers.json` rank values; node `type` strings; `bossRanks`; CSS selectors;
`dev/editor` (its rank enum test asserts `'Boss'`); anything in `tests/`.
