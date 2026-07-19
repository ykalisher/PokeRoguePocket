# Bug fixes, performance, and the devplan skill — batch overview

Owner request (2026-07-19): a full engine review produced a short list of verified bugs and
performance items; fix them, and add a `devplan` skill so future "write a development plan"
requests always use this directory's framework. Every finding below was confirmed empirically
during the review session — the fix snippets in the phase files were actually run.

## Ground rules (binding)

- Never `git add` / `git commit` / `git push` unless the owner explicitly asks.
- Never **run** `scripts/manage_*.js` (interactive, owner-only). No phase in this batch edits
  them either.
- Never act on `TODO.md`.
- No third-party libraries, build tools, or runtime dependencies. The game ships plain
  JS/HTML/CSS; dev-only tooling uses Node built-ins (plus the approved Python/Playwright in
  `dev/verify/`).
- Run `node tests/run_all.js` after every change (a PostToolUse hook also runs `node --check`
  on each edited JS file).
- Never rename game internals to match UI wording (`'boss'`/`'capture'` node types etc.).
- Line numbers in phase files are **hints from 2026-07-19 and may drift** — locate code by the
  quoted snippets/function names, not by line number alone.

## What is being built (context)

Six findings from the 2026-07-19 review, split across phases 58–62:

1. **The suite is RED.** `tests/editor_validation.test.js` "locations: disconnected graph"
   isolates `lavender-town` with `['BABY','FOSSIL']`, but the owner's `5b83bac "Updated
   locations"` commit (13 → 29 locations) added four FOSSIL locations (snowpoint-city,
   mauville-desert, fortree-jungle, oreburg-mine), so the overlap graph stays connected and the
   assertion fails. Stale fixture, not an engine bug. (Phase 58)
2. **O(n²) mega-key recomputation.** `map/locations.js getMegaTargetKeys()` rescans all 188
   pokemon on every `isMegaPokemon()` call; `isObtainablePokemon` calls it per record, so
   `getObtainablePokemonPool` costs ≈1.8 ms/call and `getWildPokemonPool` ≈1.4 ms/call
   (measured: 100 calls = 184 ms / 142 ms). These run several times per area/mart/capture page
   load and hundreds of times in tests. (Phase 59)
3. **No guard against markup-breaking data names.** `arena/arena_render.js` interpolates record
   names into double-quoted HTML attributes without escaping. Current data is safe (only
   apostrophes, e.g. "Nature's Blessing"), but a saved name containing `"` `<` `>` would
   silently corrupt the battle DOM. Guard at the data layer with a validation rule. (Phase 60)
4. **Health pill can show 0% on a living Pokemon** once any species has `baseHealth > 200`
   (current max is exactly 200 — one owner data edit away). (Phase 61)
5. **Missing battle-log line**: the dragon-gem item path never logs "removed from play", unlike
   every other single-use item path. Plus two verified micro-optimizations (rival-AI score
   precompute, area-map selectable-set). (Phase 61)
6. **Portable `devplan` skill** (owner request 2026-07-19: "I'd like to continue using it
   elsewhere"): a **user-level** skill at `~/.claude/skills/devplan/` that works in every
   repo — it bootstraps new repos with this structure (vendoring a genericized README +
   status.sh into `dev/feature_plans/` and wiring a CLAUDE.md pointer), authors plans with
   the weakest-model-possible doctrine, and executes them ("do the next development
   phase"). (Phase 62)

Reviewed and deliberately NOT in this batch: incremental-render rewrite of `arena_render.js`,
debouncing `saveBattleState()`, deduplicating helpers copied between `area.js`/`capture.js`.
Do not do any of these.

## Locked spec

- **Phase 58 fixture types:** `['BABY', 'ARTIFICIAL']`. Verified: no enabled location uses
  either type, both are valid `PokeType` enum members, and mutating lavender-town to them
  yields exactly one issue code — `locations.graph-disconnected` — from `validateAll`.
- **Phase 59 memoization contract:** cache the key `Set` in a module-level
  `WeakMap<gameData, Set>` inside `map/locations.js`. `arena_data.js loadGameData()` replaces
  `arena.GameData` with a fresh object on every load, so object identity is the invalidation.
  Behavior must be bit-identical: same Set contents, `getObtainablePokemonPool` on real data
  still returns exactly **160** species (existing assertion in `tests/pokemon_pools.test.js`).
  No exported API changes.
- **Phase 60 rule:** error code `data.unsafe-name-chars`, severity **error**, fired when the
  `name` of a pokemon/attack/item/trainer record — or a location's `name` or `terrain` —
  matches `/["<>]/`. Apostrophes stay legal (the battle renderer quotes attributes with `"`).
  Event `title`/`body` are exempt: `map/event.js` already escapes via `escapeHtml`.
- **Phase 61 fixes:** health percent floors at 1 while `currentHealth > 0`;
  the dragon-gem log line uses the exact existing wording
  `` `${model.getCardName(removedCard)} was removed from play for the rest of the battle.` ``;
  the two micro-optimizations must not change which candidate/node is chosen.
- **Phase 62 skill:** **user-level**, `~/.claude/skills/devplan/` (SKILL.md +
  `assets/status.sh` + `assets/plan-README.template.md`), with three modes: bootstrap,
  author, execute/review. Architecture is **vendoring**: on bootstrap the skill COPIES its
  assets into the target repo's `dev/feature_plans/` and wires a CLAUDE.md pointer, so
  every repo stays self-sufficient (agents without the skill still execute plans via the
  repo's own README + status.sh). The vendored per-repo README is always that repo's
  source of truth; the skill adds only workflow + the weakest-model sizing doctrine and
  never forks the template. This repo's own `dev/feature_plans/README.md` and `status.sh`
  are NOT modified; the only in-repo edit is one CLAUDE.md authoring-pointer bullet. The
  portable status.sh differs from this repo's by exactly one line (repo name derived from
  the git root instead of hardcoded "PokeRoguePocket").

## Cross-phase architecture facts

- Tests: `node tests/run_all.js` (syntax-check + full suite, ~7s). One file:
  `node --test tests/pokemon_pools.test.js`.
- Engine experiments without a browser: `require('./tests/helpers/arena_env')` in `node -e`
  (aliases `window` → `globalThis`; `loadRealGameData()` + `arena` are exported).
- `map/locations.js` is a plain IIFE on `window.PokeLocations`; Node tests load it after
  `arena_env`. `tests/pokemon_pools.test.js` already has `fixtureGameData()` (a baby whose
  `evolvesInto` names a fixture mega) — reuse it for phase 59 tests.
- Editor validation: `dev/editor/validate.js` (UMD-ish IIFE, exports `validateAll` +
  `findReferences` via `module.exports`; helpers `err(file, recordKey, code, message, field)` /
  `warn(...)` build issues). Live-data tests: `tests/editor_validation.test.js`, env from
  `tests/helpers/editor_env.js`, with `withPokemon/withAttacks/.../withLocations` structured-
  clone mutation helpers and a `hasCode(issues, code)` assert helper. The first test asserts
  live data has **zero error-severity issues** — any new error rule must pass on live data.
- Browser verification when needed: `verify` skill (committed drivers in `dev/verify/`).
- `.claude/skills/` (project-level) holds `data/` and `verify/`, each a single `SKILL.md`
  with `name:` + `description:` frontmatter — the frontmatter model for phase 62. Phase 62
  itself writes to the **user-level** `~/.claude/skills/` (available in all repos on this
  machine), not to the project.
- `dev/feature_plans/status.sh` self-locates via `BASH_SOURCE`, discovers `NN-*.md` by
  glob, and parses checkboxes + the `**Recommended agent:**` line — fully generic except
  its hardcoded title line.

## Phases

| File | What it does | Order notes |
|------|--------------|-------------|
| `58-restore-green-baseline.md` | Fix the stale disconnected-graph test fixture | First — later phases require green |
| `59-memoize-mega-target-keys.md` | WeakMap cache for `getMegaTargetKeys` + tests | Needs 58 |
| `60-name-character-validation.md` | `data.unsafe-name-chars` validation rule + tests | Needs 58; independent of 59 |
| `61-small-verified-fixes.md` | Health-% floor, dragon-gem log line, 2 micro-optimizations | Needs 58; independent of 59–60 |
| `62-devplan-skill.md` | Portable user-level `~/.claude/skills/devplan/` (bootstrap/author/execute) + CLAUDE.md pointer | Independent (docs/tooling only) |
