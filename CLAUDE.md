# Pocket Nuzlocke

Bespoke plain-JS/HTML/CSS browser card game ("Pocket Nuzlocke" — the repo
directory is still `PokeRoguePocket`, as are the `window.PokeRogue` global and
the `pokemon-rogue-pocket-*` localStorage keys) — a card-battle reimagining, NOT
upstream PokeRogue's codebase. No package.json, no build step, no third-party
runtime dependencies.

Binding rules for all agents (imported):

@AGENTS.md

## Repo map

| Path | Purpose |
|------|---------|
| `arena/arena_model.js` (1.8k lines) | battle state/decks/stats/statuses; exports `arena.Model`, owns `arena.state` |
| `arena/arena_controller.js` (3.1k lines) | turn flow, attack/item resolution, rival AI |
| `arena/arena_render.js` (1.1k lines) | DOM rendering of the battle |
| `arena/arena_data.js` | JSON load/normalize, `arena.Constants`, fallback data |
| `arena/game.js` | battle page boot |
| `arena/arena_drag.js` | drag-and-drop input |
| `arena/trainer_sprites.js` (2.2k lines) | embedded sprite data — never read whole |
| `map/` | overworld run: `area.js` (1.6k), `capture.js`, `mart.js`, `event.js`, `event_effects.js`, `run_state.js` |
| root `*.html` (8 files) | entry points; `game.html` = battle, `index.html` = start |
| `pokemon.json` (188) `attacks.json` (116) `trainers.json` (95) `items.json` `events.json` | card data — see `data` skill |
| `scripts/` | HUMAN-ONLY interactive CLIs; `data_options.js` = canonical enums (CommonJS) |
| `tests/` | Node test harness, zero deps (`helpers/arena_env.js` loads the engine in Node) |
| `dev/` | agent tooling: `verify/` browser drivers, `hooks/` edit-check hook, `editor/` local data-editor GUI (`node dev/editor/server.js` → 127.0.0.1:8932) |
| `static/styles.css` (66KB) | all styling — Grep, don't read whole |
| `assets/` (663 images) | never list recursively |

## Commands

- `node tests/run_all.js` — syntax-checks all tracked JS + runs the test suite (~3s). Run after any change.
- `node --test 'tests/**/*.test.js'` — tests only; `node --check <file>` — one file (a PostToolUse hook also runs this on every edit).
- Serve: `python3 -m http.server 8931 --bind 127.0.0.1` (repo root); stop: `pkill -f "http.server 8931"`.

## Test conventions

**Never assert how many records exist.** No test may pin an exact count, floor, or ceiling
on the size of a JSON data file or any pool derived from it, and none may hardcode a list of
record names/ids drawn from live data. The owner authors content continuously, so such a
test fails when authoring succeeds and passes when the data is genuinely broken — the exact
inverse of what a regression suite is for. Instead **iterate every record and assert each one
fits the schema**, or derive the expected value from the same source the runtime code reads.

- **Allowed:** `assert.ok(pool.length > 0)` as an anti-vacuity guard before a `forEach`;
  counts over fixtures the test itself constructs; comparing two derived collections
  (`loaded.length === raw.length`); per-record shape bounds (`record.types.length` is 2–4).
- **Banned:** `assert.equal(pokemon.length, 271)`, `assert.ok(elites.length >= 4)`,
  `assert.ok(artificial.length <= 6)`,
  `assert.deepEqual(Object.keys(decks), ['water', 'grass', 'fire'])`.
- **Picking a fixture out of live data:** use a predicate plus a clear failure message —
  `pick(collection, predicate, label)` in `tests/helpers/pick.js` — never a hardcoded name.
  `pick(gameData.pokemon, p => types(p).includes('BABY'), 'a baby species')`, not
  `find(p => p.name === 'Numel')`.
- **Vocabularies duplicated between engine and tooling** (effect types, stat keys, statuses)
  get a parity assertion against the real source, not a count of them.
- Model to imitate: `tests/location_theme.test.js` — walks every live location, validates
  format, pins no values.

## Token discipline

- Grep before Read on any file over ~800 lines; then Read with offset/limit.
- Query the JSON data with `node -e` one-liners instead of reading files whole.
- For quick engine experiments, `require('./tests/helpers/arena_env')` in Node
  instead of booting a browser.

## Task pointers

- Verifying behavior in the real game (GUI): `verify` skill — committed drivers
  in `dev/verify/`, do not rebuild them from scratch.
- Editing card-data JSON: `data` skill.
- Phased feature plans live in `dev/feature_plans/`; the structure, writing mindset, and
  canonical phase template are documented in `dev/feature_plans/README.md`. **To do or
  continue the next step of a plan** (e.g. "do the next step in the dev plan"): run
  `bash dev/feature_plans/status.sh --current` to find the active phase, then implement
  exactly that one phase per the README, ticking each checkbox as you go.
- **To write a NEW development plan** ("make a development plan", "plan this feature"):
  `devplan` skill (user-level) — investigate first, then emit a numbered batch
  (overview + one-session phases) per `dev/feature_plans/README.md`, each phase sized
  for the weakest capable model.
- `TODO.md` is the owner's planning file — never act on it unless explicitly asked.
- The owner's task board is `dev/owner_tasks/` (view: `bash dev/owner_tasks/tasks.sh`;
  conventions: `dev/owner_tasks/README.md`). These are features **only the owner
  implements and marks complete.** You may run `tasks.sh add "…" [--area X] [--needs NNN]`
  **only when the owner explicitly asks** to add a task; never run `done`/`reopen` and
  never act on the board's contents otherwise (same rule as `TODO.md`).
- UI text says "Gym Leader" and "Wild Pokemon Encounter", but internals keep the old
  names (node types `'boss'`/`'capture'`, rank `'Boss'`, `bossNodeId`, CSS classes) —
  never rename internals to match the UI.
