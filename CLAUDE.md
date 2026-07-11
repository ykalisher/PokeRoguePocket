# PokeRoguePocket

Bespoke plain-JS/HTML/CSS browser card game ("Pokemon Rogue Pocket") — a
card-battle reimagining, NOT upstream PokeRogue's codebase. No package.json,
no build step, no third-party runtime dependencies.

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
| `pokemon.json` (188) `attacks.json` (115) `trainers.json` (31) `items.json` `events.json` | card data — see `data` skill |
| `scripts/` | HUMAN-ONLY interactive CLIs; `data_options.js` = canonical enums (CommonJS) |
| `tests/` | Node test harness, zero deps (`helpers/arena_env.js` loads the engine in Node) |
| `dev/` | agent tooling: `verify/` browser drivers, `hooks/` edit-check hook |
| `static/styles.css` (66KB) | all styling — Grep, don't read whole |
| `assets/` (663 images) | never list recursively |

## Commands

- `node tests/run_all.js` — syntax-checks all tracked JS + runs the test suite (~3s). Run after any change.
- `node --test 'tests/**/*.test.js'` — tests only; `node --check <file>` — one file (a PostToolUse hook also runs this on every edit).
- Serve: `python3 -m http.server 8931 --bind 127.0.0.1` (repo root); stop: `pkill -f "http.server 8931"`.

## Token discipline

- Grep before Read on any file over ~800 lines; then Read with offset/limit.
- Query the JSON data with `node -e` one-liners instead of reading files whole.
- For quick engine experiments, `require('./tests/helpers/arena_env')` in Node
  instead of booting a browser.

## Task pointers

- Verifying behavior in the real game (GUI): `verify` skill — committed drivers
  in `dev/verify/`, do not rebuild them from scratch.
- Editing card-data JSON: `data` skill.
- `TODO.md` is the owner's planning file — never act on it unless explicitly asked.
