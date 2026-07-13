# Feature plan: Locations, 4-Level Runs, Starter Decks, Events, Theming, UI

**How to use this directory (read this first, always):** You are an implementing agent
working on ONE phase. Read this file fully, then your assigned phase file
(`01`–`07`). Do not read the other phase files unless a dependency note points you
there. When you finish a step, tick its checkbox in the phase file; when you finish
the phase, tick it in the checklist below. Phases must be done in numeric order
except: 04 only needs 02, and 05/06 only need 02+03 (see each file's header).

## Ground rules (binding)

- Read `CLAUDE.md` and `AGENTS.md` at the repo root before starting. Non-negotiables:
  plain JS/HTML/CSS, browser-native APIs, **no third-party runtime dependencies, no
  build step**; never `git add`/`commit`/`push` (read-only git is fine); never act on
  `TODO.md`; **never RUN `scripts/manage_*.js`** (interactive owner-only CLIs).
- **Owner authorizations specific to this feature set** (explicit exceptions granted
  2026-07-13, do not generalize them):
  1. CREATE `scripts/manage_locations.js` (phase 1).
  2. EXTEND `scripts/manage_events.js` with a location-types prompt (phase 5).
  3. Seed data by directly editing `locations.json`, `trainers.json`, `events.json`.
- After **every** change: `node tests/run_all.js` (~3s; syntax-checks all tracked and
  untracked JS, then runs the suite). Each phase must end with tests green AND the
  game playable in the browser.
- Browser verification uses the `verify` skill: serve with
  `python3 -m http.server 8931 --bind 127.0.0.1` from the repo root, drive with the
  committed Playwright drivers in `dev/verify/` (do not rebuild them), inspect
  `window.CardArena.state`, screenshot. Stop with `pkill -f "http.server 8931"`.
- Token discipline: Grep before Read on files over ~800 lines (`map/area.js` 1.6k,
  `arena/arena_controller.js` 3.1k, `arena/arena_model.js` 1.8k, `static/styles.css`
  66KB); query JSON with `node -e` one-liners; NEVER read `arena/trainer_sprites.js`
  whole; never list `assets/` recursively.
- Line numbers in these files were captured at commit `f393160` (2026-07-13) and WILL
  drift, especially after earlier phases land. Treat them as hints; relocate with
  grep on the named function/constant before editing.

## What is being built (context)

The game currently has one hardcoded area (frozen `AREA_THEME` "Coastal Trail" in
`map/area.js`), a WATER-only wild-pokemon placeholder marked TODO, trainer selection
by rank only, an events framework with zero events and no gating, one fixed starter
deck, and a run that ends permanently at the first boss. The owner wants:

1. A **locations framework**: `locations.json` records with 2–4 pokemon-type
   specializations driving wild pokemon, trainers, events, and page theming; a new
   owner CLI to add locations.
2. A **fixed 4-level run**: levels 1–3 are 12-step maps ending in a boss; level 4 is
   a gauntlet (1 shop, then 4 Elite battles); difficulty scales by level; each next
   location shares ≥1 type with the previous.
3. **3 starter decks** (water/grass/fire) chosen on New Game; level 1's location must
   include the chosen starter's type.
4. **Location-gated events** with a small seeded set.
5. **Per-location theming** (palette + optional background image) and a **UI polish
   pass** (targeted fixes, not a redesign).

## Locked spec (owner-confirmed — do not deviate, do not re-litigate)

### Run structure
- Fixed **4 levels** per run. L1–3: 12-step branching maps, Boss-rank battle at the
  final step. L4: linear gauntlet — start → shop → 3 Elite battles → final Elite
  battle; winning it = run victory. Collections/cash persist across levels;
  maps/encounters regenerate.

### Difficulty table
| Level | Battle-node rank mix | Final node | Weights b/c/e/s | Caps (capture/shop) | Forced nodes |
|---|---|---|---|---|---|
| 1 | 100% Standard | Boss rank | 38/26/21/15 | 4 / 2 | steps 1–2 capture, 3 battle |
| 2 | 60% Standard / 40% Ace | Boss rank | 44/22/21/13 | 3 / 2 | none |
| 3 | 100% Ace | Boss rank | 52/16/20/12 | 2 / 1 | none |
| 4 | 100% Elite (gauntlet) | Elite rank | n/a (fixed layout) | n/a | step 1 shop, 2–4 battle, 5 final |

- Forced nodes count toward caps. Battle nodes are never capped.
- **Special rank is reserved for event trainers ONLY** — it must be impossible for a
  map battle to select a Special trainer, through every fallback rung.
- Event node weight is treated as 0 when no event matches the current location.
- Trainer picks prefer `typeSpecialization ∈ location.types`; fallback relaxes the
  rank mix first, then the type match; the pool must never be empty.

### Starter decks (deliberately small — forced L1 captures fill the team)
| Deck | Pokemon (1 each) | Attacks (2 each) | Items (1 each) |
|---|---|---|---|
| water | Blastoise, Feraligatr | Surf, Waterfall, Rain Dance | Sitrus Berry, Withdraw Wand |
| grass | Venusaur, Meganium | Sleep Powder, Leech Seed, Razor Leaf | Sitrus Berry, Withdraw Wand |
| fire | Charizard, Typhlosion | **Flame Thrower**, Fire Spin, **Will-o-wisp** | Sitrus Berry, Withdraw Wand |

⚠ **Exact-name traps:** the data files contain `"Flame Thrower"` (with a space) and
`"Will-o-wisp"` (lowercase o/w) — NOT "Flamethrower"/"Will-O-Wisp". Card lookup
(`findGameRecord` in `map/area.js`) is exact `name ===` with a **silent fallback
record** on a miss, so a typo produces dud cards with no error. A test must assert
every starter-deck name resolves to a real record.

### Location rules
- Each location: unique slug `id`, `name`, `terrain` display label, `types` (2–4
  values from the `PokeType` enum in `scripts/data_options.js`, excluding `NONE` and
  `LEGENDARY`), `theme` (5 hex colors), optional `background` path, `enabled`.
- Level 1: location must contain the chosen starter's type. Levels 2–4: location must
  share ≥1 type with the previous location, prefer unvisited this run. Fallback
  ladder in `03`; never fail.

## Cross-phase architecture facts

- Shared page modules are IIFEs exporting a `window.*` namespace
  (`window.PokeRun` = `map/run_state.js`, `window.PokeEvents` = `map/event_effects.js`).
  The new `map/locations.js` exports `window.PokeLocations` and must touch **no DOM at
  load time** so Node tests can `require` it (tests alias `window = globalThis` via
  `tests/helpers/arena_env.js`).
- All map↔battle handoff is via localStorage (`pokemon-rogue-pocket-run` for the run,
  `card-arena-current-battle` for mid-battle engine state). No query params except
  `area.html?newRun=1[&starter=…]`.
- `normalizeRunState`/`normalizeAreaState` in `map/run_state.js` **strip unknown
  fields on every load** and hard-reject version mismatches. Any new run-state field
  must be added to `createRunState` AND the normalizers in the same change, with
  lenient defaults.
- `map/area.js` and `arena/arena_render.js` re-render by assigning `innerHTML` on one
  root — state set inside those roots is wiped every render. Theming therefore lives
  on `<body>` (inline CSS custom properties + `data-location`).
- Data files load through `arena/arena_data.js` (`loadGameData` Promise.all +
  `normalizeGameData` + `fallbackRecords` used when fetch fails). New data files must
  be wired through all three.

## Progress checklist

- [x] Phase 1 — Locations data + framework module (inert)
- [x] Phase 2 — Run state v2 + location-driven level 1
- [x] Phase 3 — Multi-level progression, gauntlet, difficulty, victory
- [ ] Phase 4 — Starter picker
- [ ] Phase 5 — Events gating + seeded events
- [ ] Phase 6 — Theming (neutral restyle + per-location)
- [ ] Phase 7 — UI audit + targeted fixes

## Verification quick reference

- `node tests/run_all.js` — full check, run constantly.
- `node --test 'tests/**/*.test.js'` — tests only.
- Engine experiments without a browser:
  `node -e "const env = require('./tests/helpers/arena_env'); ..."` —
  `env.loadRealGameData()` gives normalized `arena.GameData`.
- Browser: `verify` skill + `dev/verify/` drivers on port 8931.
