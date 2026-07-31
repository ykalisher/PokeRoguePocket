# Phase 77 — Battle stat colors: statuses win over stat stages

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `76-map-and-encounter-overhaul-overview.md`.
**Goal:** A Pokemon card's A/D/S cells are colored by whichever effect is actually moving the
number — bright blue / purple when a **status** changes the stat (winning over the stage
color), green / red for a stage alone — and hovering a modified stat explains it
(`Attack 100 → 50 (Burn ×0.5)`). Ends green with a new Node test file.

## Context you need

**The number is already correct.** `arena.Model.getPokemonEffectiveStat` folds in stage *and*
status *and* type multipliers, so a burned 100-attack Pokemon renders `A 50` today. This
phase changes **color and tooltip only** — do not touch the displayed value, and do not add
any engine code. Everything you need is already exported from `arena.Model`:
`getPokemonStatStage`, `getPokemonStatusMultiplier`, `getPokemonEffectiveStat`,
`getPokemonStatuses`, `formatStatStage`.

**Direction comes from the multiplier, never from the status name.** `getStatusStatMultiplier`
(`arena/arena_model.js` ~1248) returns `1` for a burned FIGHTING type, and
`getPokemonTypeStatusMultiplier` (~1260) then grants FIGHTING **×1.5 attack while any status
is active**. So a burned FIGHTING type must read as a *boost* (bright blue). A status with no
stat multiplier at all (POISON, CONFUSION, SLEEP, FLINCH, PROTECT) leaves the multiplier at
`1` and must produce **no** color.

**The one file that emits stat numbers** is `arena/arena_render.js` `renderStatCell`
(~590–608), called four times from `renderPokemonCardContent` (~559–564). The `H` cell at
~560 is a bare `<span>` with no class and is **out of scope** — leave it alone.

**Do not touch `.stage-up` / `.stage-down`.** In `static/styles.css` (~1398–1407) those class
names are *shared* between the card stat cells and the rules-reference table
(`arena_render.js` ~1007). Stages keep green/red, so those two rules stay exactly as they are;
you are only **adding** two new rules below them.

**`renderCardPreview` is a pure string builder** (exported at `arena_render.js` ~1079) that
touches no DOM, which is how the new test asserts markup without a browser. It is also used
outside battle (`arena/card_overview.js`, `map/area.js`, `map/capture.js`, `map/event.js`,
`map/mart.js`); those cards carry no statuses or stages so the new coloring is inert there.

**Every rule in `static/styles.css` carries a `/* … */` comment line above it.** Follow that.

The code below was prototyped against the real model during planning and produced exactly the
output in the verification table — transcribe it rather than re-deriving it.

## Steps

- [ ] 1. **`arena/arena_render.js`** — add a module-level constant next to the other
  render constants near the top of the IIFE (alongside `STATUS_REFERENCE` / `STAGE_REFERENCE`,
  ~lines 54–78). This mirrors the same map in `arena/arena_controller.js` (~2311):

  ```js
      const BASE_STAT_KEYS = Object.freeze({
          attack: 'baseAttack',
          defense: 'baseDefense',
          speed: 'baseSpeed'
      });
  ```

- [ ] 2. **`arena/arena_render.js`** — replace `renderStatCell` (~590–608) **and its doc
  comment** with the version below. Keep it in the same position in the file.

  ```js
      /**
       * Renders one effective stat cell. The number is the true stat after every
       * multiplier; the color says what moved it. A status touching this stat wins
       * over the stage color, and its direction comes from the multiplier — a
       * burned FIGHTING type gets x1.5 attack, so it reads as a boost. Labels stay
       * single letters (A/D/S) so a 3-digit value fits the tiny mobile card column
       * without clipping; the full breakdown is exposed via title for hover and
       * assistive tech.
       */
      function renderStatCell(card, stat) {
          const labels = {
              attack: 'A',
              defense: 'D',
              speed: 'S'
          };
          const titles = {
              attack: 'Attack',
              defense: 'Defense',
              speed: 'Speed'
          };
          const stage = arena.Model.getPokemonStatStage(card, stat);
          const statusMultiplier = arena.Model.getPokemonStatusMultiplier(card, stat);
          const modifierClass = getStatCellModifierClass(stage, statusMultiplier);
          const title = getStatCellTitle(card, stat, titles[stat], stage, statusMultiplier);

          return `<span class="stat-cell${modifierClass}" title="${title}">${labels[stat]} ${arena.Model.getPokemonEffectiveStat(card, stat)}</span>`;
      }

      // Status color beats stage color, per the owner's spec. Direction is read
      // from the multiplier so FIGHTING's status-triggered attack bonus reads up.
      function getStatCellModifierClass(stage, statusMultiplier) {
          if (statusMultiplier > 1) return ' stat-cell--status-up';
          if (statusMultiplier < 1) return ' stat-cell--status-down';
          if (stage > 0) return ' stat-cell--up';
          if (stage < 0) return ' stat-cell--down';

          return '';
      }

      // "Attack 100 -> 50 (Burn x0.5)". Falls back to the bare stat name when
      // nothing is modifying it, so unmodified cards keep their plain tooltip.
      function getStatCellTitle(card, stat, label, stage, statusMultiplier) {
          const parts = [];

          if (stage !== 0) parts.push(`${arena.Model.formatStatStage(stage)} stage`);

          if (statusMultiplier !== 1) {
              const statusLabels = arena.Model.getPokemonStatuses(card)
                  .map(status => status.label)
                  .join(', ');

              parts.push(`${statusLabels || 'Status'} ×${Math.round(statusMultiplier * 100) / 100}`);
          }

          if (parts.length === 0) return label;

          const baseStat = Number(card.pokemon[BASE_STAT_KEYS[stat]]) || 0;

          return `${label} ${baseStat} → ${arena.Model.getPokemonEffectiveStat(card, stat)} (${parts.join(', ')})`;
      }
  ```

  The `→` and `×` are literal UTF-8; non-ASCII in UI strings is established precedent
  (`map/area.js` ~364 uses an em dash). No escaping is needed — every string here comes from
  hardcoded tables, never from card data.

- [ ] 3. **`static/styles.css`** — add these two rules **immediately after** the existing
  `.stat-grid .stat-cell--down, .stage-down { color: #b04332; }` block (~1405–1407). They must
  come after, and be scoped at the same `.stat-grid .stat-cell--X` depth, so they win over the
  stage rules by source order:

  ```css
  /* A status is raising this stat (e.g. FIGHTING's bonus while any status is up). */
  .stat-grid .stat-cell--status-up {
      color: #1668cc;
  }

  /* A status is lowering this stat (burn, paralysis, fatigue). */
  .stat-grid .stat-cell--status-down {
      color: #7b2fa8;
  }
  ```

  Do **not** add these to `.stage-up` / `.stage-down`, and do not change those two rules.

- [ ] 4. **`arena/arena_render.js`** — in `renderStageReferenceSection` (~991–1014), add one
  `<p>` to the `.rules-reference-copy` block, after the existing "Effective stats are rounded
  …" paragraph, so the color language is documented in-game:

  ```html
                      <p>Stat colors: green or red means a stat stage moved the number. Blue or purple means a status is changing it — a status always wins the color, and purple means the status is lowering the stat.</p>
  ```

- [ ] 5. **`tests/arena_render.test.js`** — new file. Preamble: require
  `./helpers/arena_env` for `{ arena }`, then `require('../arena/arena_render.js')` (it is a
  `window`-namespace IIFE and the helper already aliases `window` to `globalThis`). Build
  fixtures locally — do **not** load real JSON:

  ```js
  'use strict';

  const assert = require('node:assert');
  const test = require('node:test');
  const { arena } = require('./helpers/arena_env.js');

  require('../arena/arena_render.js');

  const SPECIES = {
      name: 'Testmon', id: '0001',
      type1: 'FIRE', type2: 'NONE', type3: 'NONE', types: ['FIRE'],
      baseHealth: 100, baseAttack: 100, baseDefense: 80, baseSpeed: 60
  };

  function makeCard(overrides) {
      return Object.assign({
          id: 'p1', kind: 'pokemon', owner: 'player', pokemon: SPECIES,
          currentHealth: 42, currentStatus: [], faceUp: true,
          statStages: { attack: 0, defense: 0, speed: 0 }
      }, overrides || {});
  }

  // renderCardPreview is a pure string builder, so the stat grid is assertable
  // without a DOM. Returns the one <span> for the requested stat letter.
  function statCell(card, letter) {
      const html = arena.Render.renderCardPreview(card);
      const match = html.match(new RegExp(`<span class="stat-cell[^"]*"[^>]*>${letter} \\d+</span>`));

      assert.ok(match, `no ${letter} stat cell in rendered card`);
      return match[0];
  }
  ```

- [ ] 6. **`tests/arena_render.test.js`** — cover every row of the table below. Each was
  confirmed against the prototype, so a failure means step 2 drifted.

  | card state | stat | expected class | expected title |
  |---|---|---|---|
  | clean | attack | *(none)* | `Attack` |
  | `currentStatus: [{ status: 'BURN' }]` | attack | `stat-cell--status-down` | `Attack 100 → 50 (Burn ×0.5)` |
  | `currentStatus: [{ status: 'PARALYSIS' }]` | speed | `stat-cell--status-down` | `Speed 60 → 30 (Paralysis ×0.5)` |
  | `statStages: { attack: 2, defense: -1, speed: 0 }` | attack / defense | `stat-cell--up` / `stat-cell--down` | `Attack 100 → 200 (+2 stage)` / `Defense 80 → 64 (-1 stage)` |
  | BURN **and** `statStages.attack = 2` | attack | `stat-cell--status-down` (**not** `--up`) | `Attack 100 → 100 (+2 stage, Burn ×0.5)` |
  | FIGHTING-type species + BURN | attack | `stat-cell--status-up` | `Attack 100 → 150 (Burn ×1.5)` |
  | `currentStatus: [{ status: 'FATIGUE' }]` | defense | `stat-cell--status-down` | `Defense 80 → 60 (Fatigue ×0.75)` |
  | `currentStatus: [{ status: 'POISON' }]` | attack | *(none)* | `Attack` |

  The burn+stage row is the regression this whole phase exists for — it renders `A 100`, and
  before this change it was **green**. Assert explicitly that the class is not `--up`.
  For the FIGHTING row, clone `SPECIES` with `type1: 'FIGHTING', types: ['FIGHTING']`.

- [ ] 7. **`tests/arena_render.test.js`** — add one guard that the *number* is untouched by
  this phase: a burned card's attack cell still reads `A 50` and a clean card's reads `A 100`.

## Verification

- [ ] `node --check arena/arena_render.js` passes.
- [ ] `node --test tests/arena_render.test.js` — all new tests pass.
- [ ] `node tests/run_all.js` green (230 existing tests plus the new file).
- [ ] `git diff --stat` shows exactly three paths: `arena/arena_render.js`,
  `static/styles.css`, and the new `tests/arena_render.test.js`.
- [ ] Browser check with the `verify` skill (`dev/verify/lib.py` `serving()` on 8931, and
  `dev/verify/drive_arena.py` or `autoplay_arena.py` as the driver): play until a Pokemon is
  burned or paralyzed, screenshot the board, and confirm the affected stat is **purple** while
  an unaffected stat on the same card is not. Save the screenshot as
  `dev/verify/phase77_stat_status_colors.png`.
- [ ] In the same browser session, confirm hovering the purple stat shows the
  `Attack 100 → 50 (Burn ×0.5)` tooltip, and that the Stat Stages rules panel shows the new
  color paragraph.

## Out of scope / do not touch

The `H` cell (`arena_render.js` ~560) keeps showing `species.baseHealth` — the owner
explicitly declined changing it. No inline base number on the card. No engine changes in
`arena/arena_model.js` or `arena/arena_controller.js` — in particular do **not** try to
de-duplicate `model.getPokemonEffectiveStat` against `controller.getBattleStat`. Do not touch
`.stage-up` / `.stage-down`, `.status-token--*` tints, or `.stat-change-float--*`. Do not add
`.status-token--fatigue` / `--protect` rules (a real gap, but a separate task). Nothing in
`map/`, `main.js`, or any JSON data file.
