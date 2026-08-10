# Test brittleness — batch overview

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs).
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change.
- **No production code changes in this batch.** Every phase touches `tests/`, `CLAUDE.md`
  and this directory only. If a rewritten assertion goes red against live data, that is a
  real data bug to *report to the owner* — not a licence to edit the engine or the JSON.

## What is being built (context)

A large share of the suite asserts *how much* content exists rather than *whether all
content is well-formed*: exact counts, floors and ceilings on data-file sizes, and
hardcoded lists of record names pulled from live JSON. Those tests fail when the owner
authors more cards — the normal, intended activity — and pass when content is genuinely
broken. They invert the purpose of a regression suite.

This is not hypothetical. When this batch was written, `node tests/run_all.js` was **red**
with two failures, both from exactly this:

| Failing test | Why |
|---|---|
| `tests/run_progression.test.js:246` | `assert.deepEqual(Object.keys(decks), ['water','grass','fire'])`. `starter_decks.json` now ships six decks (`water, grass, fire, dark, fighting, human`). Nothing is broken — the test hardcoded the roster. |
| `tests/editor_validation.test.js:390` | The "disconnected graph" fixture retypes `lavender-town` to `['BABY','ARTIFICIAL']` as types *no location uses*. `ARTIFICIAL` became a real location type, so the graph stays connected and the expected warning never fires. The test's own comment records this **already happening once before** (`FOSSIL`, the 2026-07-18 location expansion) — it was patched with a fresh magic pair rather than fixed. |

The batch deletes the volume assertions, replaces each with the structural invariant it was
standing in for, converts hardcoded live-record names into predicate-based selection, and
records the rule in `CLAUDE.md` so it does not regrow.

## Locked spec

Three decisions from the owner govern every phase:

1. **Scope** = volume counts **and** hardcoded live-record name anchors.
2. The three "design fence" counts (`artificial <= 6`, `elites >= 4`, `aces >= 6`) are
   replaced by the **real derived invariant**, not merely deleted.
3. **Non-emptiness guards stay legal.** `assert.ok(pool.length > 0)` before a `forEach`
   prevents a vacuous pass and is good practice. The rule bans *magnitude*, not *existence*.

### The taxonomy — what to change and what to leave

**Change (volume counts):**

| Site | Assertion | Phase |
|---|---|---|
| `run_progression.test.js:246` | `deepEqual(Object.keys(decks), [...])` | 103 |
| `editor_validation.test.js:386-390` | `['BABY','ARTIFICIAL']` magic isolating pair | 103 |
| `data_validation.test.js:112` | `artificial.length <= 6` | 104 |
| `data_validation.test.js:163-164` | `elites.length >= 4`, `aces.length >= 6` | 104 |
| `data_validation.test.js:365` | `locations.length >= 8` | 104 |
| `editor_api.test.js:373` | `body.effectTypes.length === 14` | 105 |
| `editor_api.test.js:381,383` | `statKeys.length === 8`, `statPrefixes.length === 4` | 105 |
| `editor_validation.test.js:28` | `missingBackgrounds.length >= 8` | 105 |
| `editor_validation.test.js:633,644` | `empty.length === 3`, `… === 4` | 105 |
| `encounter_uniqueness.test.js:241` | `drawn.length === 9` | 105 |
| `event_requirements.test.js:169` | `formChoices.length === 5` | 105 |

**Change (name anchors, phase 106):** `editor_validation.test.js` anchors ~15 mutation
fixtures on `'Numel'`, `'Blastoise'`, `'sitrus-berry-tree'`, `'nursery-egg'`,
`'lavender-town'`, `'Mecha Cop'` / `'rogue-mecha-cop'`; `baby_event.test.js:75` anchors on
`'nursery-egg'`.

**Leave alone — these are NOT brittle. Do not churn them:**

- Non-emptiness guards before a loop (`assert.ok(pool.length > 0)`), everywhere.
- `data_validation.test.js:563-568` — `data.pokemon.length === pokemon.length` etc. compares
  *loaded vs. raw*, proving `loadGameData()` normalization drops nothing. Volume-independent.
- Engine/fixture counts over synthetic input: `plannedActions.length === 1`,
  `undoStack.length === 3`, `graph.columns.length === 7`, `bosses.length === 1`,
  `pending.length === 2`.
- Per-record schema bounds such as `record.types.length >= 2 && <= 4` — a shape rule.
- `editor_api.test.js:372` `deepEqual(body.Rank, ['Standard','Ace','Special','Boss','Elite'])`
  — a full-value wire-contract pin, not a count.
- `effect_boost.test.js:99` `find(item => item.name === 'Effect Amplifier')` — that test is
  *about* whether that specific authored item is wired to the engine's `EFFECT_BOOST` path,
  so naming it is the point.
- Name literals over records the test itself constructs: `starter_unlock.test.js`,
  `event_requirements.test.js:64-139`, `mega_evolution.test.js:86-105`,
  `event_only_pokemon.test.js`, `encounter_uniqueness.test.js` fixtures.
- `location_theme.test.js` — already the model to imitate.

## Cross-phase architecture facts

- **Test env helpers.** `tests/helpers/arena_env.js` aliases `window` → `globalThis`, gives
  an in-memory `localStorage`, and exports `{ ROOT, arena, loadRealGameData, storageMap }`.
  `loadRealGameData()` stubs `fetch` with a disk reader and runs the game's own
  `arena.Data.loadGameData()`, so `arena.GameData` holds real *normalized* data (note:
  normalized records expose `record.types` as an array; raw JSON records use
  `type1`/`type2`/`type3`).
  `tests/helpers/editor_env.js` exports `buildLiveEditorEnv()` → `{ data, enums, assetIndex,
  engineRefs }` for `dev/editor/validate.js`.
- **The `pick()` pattern already exists** at `tests/mart_stock.test.js:40-66`: select a
  record by predicate, throw a readable error when nothing matches. Phase 106 promotes it to
  `tests/helpers/pick.js`; earlier phases may inline the same idea.
- **`PokeLocations.LEVEL_CONFIG`** (`map/locations.js`) is frozen and keyed `1..4`; each level
  carries `battleRanks` and `bossRanks` as `[{ rank, weight }]`. `isAllowedTrainerRank()`
  excludes rank `'Special'` at every rung. This is the source phase 104 derives from.
- **The event-effect vocabulary is triplicated**: `dev/editor/server.js:59` (`EFFECT_TYPES`),
  `dev/editor/validate.js:24` (`DEFAULT_EFFECT_TYPES`, not exported), and
  `tests/data_validation.test.js:174` (`VALID_EFFECT_TYPES`). The real source of truth is the
  `switch` in `applyEffect` (`map/event_effects.js:423`), 14 `case` labels. Phase 105 makes
  the API test assert parity against it.
- **Artificial attack statuses**: `arena/arena_controller.js` handles exactly four via
  `statuses.includes(...)` at lines 860 / 866 / 871 / 882 (`INCREASE_CAPACITY`, `EXTRA_ITEM`,
  `EXTRA_ATTACK`, `REFRESH_DECK`). Line anchors are drift-prone hints — grep for the names.
- **`PokeProfile.STAT_KEYS` / `STAT_PREFIXES`** are frozen arrays at `map/profile.js:13,26`.

## Phases

| File | What it does | Order |
|---|---|---|
| `103-test-rule-and-red-tests.md` | `CLAUDE.md` rule + the two currently-failing tests. **Ends green.** | first |
| `104-data-validation-counts.md` | `data_validation.test.js` volume counts → derived invariants | after 103 |
| `105-remaining-counts.md` | `editor_api` / `editor_validation` / `encounter_uniqueness` / `event_requirements` counts | after 103 |
| `106-fixture-anchors.md` | `tests/helpers/pick.js` + convert the ~15 live-name anchors | last (touches files 103 and 105 also edit) |
