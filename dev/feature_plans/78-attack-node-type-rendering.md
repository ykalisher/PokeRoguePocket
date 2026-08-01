# Phase 78 — The `attack` node type: label, icon, legend

**Recommended agent:** Sonnet · low effort.
**Prereqs:** none (independent of 77). **Read first:** `76-map-and-encounter-overhaul-overview.md`.
**Goal:** `map/area.js` and `static/area.css` fully render a node of type `'attack'` — icon on
the map, entry in the legend, correct hover/aria label. **Nothing generates one yet**, so the
game is byte-for-byte unchanged in play; this is the landing strip for phase 79.

## Context you need

This phase is deliberately additive and small. Phase 79 flips on the generator that produces
`'attack'` nodes, and phase 81 makes them clickable; doing the rendering first means the map
never renders an unstyled node in between.

Everything lives in **`map/area.js`** (a `window`-namespace IIFE) and **`static/area.css`**.
The five touch points, with drift-prone line hints:

- `LOCATION_LABELS` (~10–17) — the frozen `type → player-facing string` map. Keys are
  alphabetical; keep that.
- `renderLocationIcon` (~417–437) — per-type icon markup. `'event'` returns a `!` glyph,
  `'shop'` returns a `C` glyph, everything else falls through to a bare
  `<span class="area-node-icon area-icon--${type}">` that CSS draws.
- `renderLegend` (~439–452) — iterates a **hardcoded array**
  `['capture', 'battle', 'shop', 'event', 'boss']`.
- `renderLegendIcon` (~455–462) — the same glyph switch as `renderLocationIcon`, for the
  legend's smaller icon.
- `getEnteredLocationText` (~1563) — returns `a ${LOCATION_LABELS[node.type]}` with special
  cases for `'boss'` and `'event'`. "Attack Encounter" needs **"an"**, so it needs a case too.

`getNodeAriaLabel` (~1545) already reads `LOCATION_LABELS[node.type]` and needs no change.
`isTrainerNodeType` (~1355) must stay `battle || boss` — an attack node is not a battle.

**Naming rule from the overview:** the internal type string is `'attack'`; the player-facing
label is **"Attack Encounter"**. Do not rename internals to match UI text anywhere.

**CSS convention:** every rule in `static/area.css` sits in the `.area-icon--*` block
(~394–507). Follow the shape of `.area-icon--shop` (~483–491) — it is the closest analogue
(a glyph on a colored pill).

## Steps

- [x] 1. **`map/area.js`** — add the label to `LOCATION_LABELS`, keeping the keys
  alphabetical (so `attack` goes first, before `battle`):

  ```js
      const LOCATION_LABELS = Object.freeze({
          attack: 'Attack Encounter',
          battle: 'Trainer Battle',
          boss: 'Gym Leader',
          capture: 'Wild Pokemon Encounter',
          event: 'Event',
          shop: 'Shop',
          start: 'Entrance'
      });
  ```

- [x] 2. **`map/area.js`** — in `renderLocationIcon`, add an `'attack'` branch beside the
  existing `'event'` and `'shop'` branches (order does not matter; put it above `'event'`):

  ```js
          if (type === 'attack') {
              return '<span class="area-node-icon area-icon--attack" aria-hidden="true">A</span>';
          }
  ```

- [x] 3. **`map/area.js`** — in `renderLegendIcon`, add the matching branch:

  ```js
          if (type === 'attack') {
              return '<span class="area-legend-icon area-icon--attack" aria-hidden="true">A</span>';
          }
  ```

- [x] 4. **`map/area.js`** — add `'attack'` to the hardcoded legend array in `renderLegend`
  (~442), after `'capture'` so the two card-reward nodes sit together:

  ```js
                  ${['capture', 'attack', 'battle', 'shop', 'event', 'boss'].map(type => `
  ```

- [x] 5. **`map/area.js`** — in `getEnteredLocationText` (~1563), add the article fix above
  the `return`:

  ```js
          if (node.type === 'attack') return 'an Attack Encounter';
  ```

- [x] 6. **`static/area.css`** — add an `.area-icon--attack` block immediately after
  `.area-icon--shop` (~491). Use a crimson pill so it is unmistakable against the shop's gold
  and the event's indigo:

  ```css
  .area-icon--attack {
      border: 2px solid rgba(37, 27, 24, 0.48);
      border-radius: 999px;
      background: linear-gradient(180deg, #ff9b7a, #b8402a);
      color: #fbf6e8;
      font-size: 1rem;
      box-shadow: inset 0 2px rgba(255, 255, 255, 0.26);
  }
  ```

  Check the surrounding rules for a comment convention before adding — `static/area.css` does
  not comment every rule the way `static/styles.css` does, so match the neighbors.

## Verification

- [x] `node --check map/area.js` passes.
- [x] `node tests/run_all.js` green. **No test should change** — nothing generates an attack
  node yet, so this phase must not move a single assertion.
- [x] `git diff --stat` shows exactly two paths: `map/area.js` and `static/area.css`.
- [x] Browser proof with the `verify` skill. Serve on 8931 (`dev/verify/lib.py` `serving()`),
  start a run to reach `area.html`, then from the page context **temporarily** rewrite one
  saved node's type and reload — this is the only way to see the icon before phase 79:

  ```js
  const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
  const target = run.area.graph.nodes.find(node => node.type === 'battle');
  target.type = 'attack';
  run.area.graph.columns.forEach(col => col.forEach(n => { if (n.id === target.id) n.type = 'attack'; }));
  localStorage.setItem('pokemon-rogue-pocket-run', JSON.stringify(run));
  location.reload();
  ```

  Confirm: the crimson `A` pill draws on the map, the legend shows a sixth entry reading
  "Attack Encounter", and hovering/focusing the node announces "Attack Encounter, location N".
  Save the screenshot as `dev/verify/phase78_attack_node_icon.png` and add the driver as
  `dev/verify/phase78_attack_node_icon.py` (model it on
  `dev/verify/phase61_area_selectable.py`).
- [x] Clear the injected run afterwards (`localStorage.clear()` in the driver's teardown) so
  no doctored save is left behind.

## Out of scope / do not touch

Do **not** touch `map/locations.js` — the generator is phase 79 and no attack node may be
generated in this phase. Do **not** add a `moveToNode` dispatch branch, `attack.html`,
`map/attack.js`, or anything in `map/run_state.js` / `main.js` — clicking an injected attack
node must keep falling through to the generic "You entered …" popup, which is the correct
behavior for this phase. Do not change `isTrainerNodeType`, `DEFAULT_BOSS_NODE_ID`,
`STORAGE_VERSION`, or any JSON data file.
