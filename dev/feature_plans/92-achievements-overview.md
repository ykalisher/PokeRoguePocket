# Achievements — batch overview

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs). Edit JSON data
  directly and validate with the tests.
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change.
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names
  (`'boss'`, `'capture'`, `bossNodeId`, rank `'Boss'`). Never rename internals to match UI.
- **Do not author game content.** Phase 94 seeds a small starter set of achievements so the
  system is demonstrably alive; beyond that the owner writes them. The same rule as the
  event-conditions batch: any fixture added for verification must be removed before the
  phase ends.

## What is being built (context)

Everything the game remembers today dies with the run: `pokemon-rogue-pocket-run` is
cleared on a loss and on New Game, and `card-arena-current-battle` is per-battle. There is
no notion of *lifetime* progress.

This batch adds a **profile** — a second, permanent localStorage record holding named
counters and the set of unlocked achievements — plus:

- `achievements.json`, a normal data file the owner authors like every other one;
- an achievements page listing progress;
- **achievements as event conditions**, so an event can be gated on "has finished a run"
  the same way it can already be gated on "owns a Rotom".

The owner-confirmed model (2026-08-05) is deliberately **one uniform rule shape**: a
counter and a threshold. Everything expressive lives in *which counters the game keeps*,
not in per-achievement logic. "Finish a run with only Fire Pokemon" is not a special
trigger type — it is the counter `runs.completed.mono.FIRE` reaching 1, because the engine
derives that counter at run completion. This keeps the editor form to two inputs and means
new achievements never need engine code.

## Locked spec

### The profile

localStorage key **`pokemon-rogue-pocket-profile`**, separate from the run key and
**never cleared** — not by New Game, not by a loss, not by `clearRunState()`.

```json
{
  "version": 1,
  "stats": { "runs.completed": 3, "events.seen.sitrus-berry-tree": 2 },
  "unlocked": { "champion": "2026-08-05T12:00:00.000Z" },
  "pendingUnlocks": ["champion"]
}
```

- `stats` — a **flat** map of dotted key → non-negative integer. Absent means 0.
- `unlocked` — achievement id → ISO timestamp of the unlock. Unlocking is permanent; an
  achievement never re-locks even if its counter could somehow fall.
- `pendingUnlocks` — ids unlocked but not yet shown to the player. Drained by whichever
  page loads next, so an unlock earned on `game.html` still gets its toast after the
  navigation back to `area.html`.

### The stat namespace

This is the closed list. Anything else is a validation error, and the editor's dropdown
offers exactly these.

**Exact keys**

| Key | Bumped when |
|---|---|
| `runs.started` | a fresh run is created on the starter picker |
| `runs.completed` | the final gym leader of the last level is beaten |
| `runs.lost` | a battle is lost (the run ends) |
| `battles.won` | any battle won |
| `battles.lost` | any battle lost |
| `events.seen` | an event encounter is completed |
| `captures.completed` | a wild Pokemon encounter is completed |
| `attacks.claimed` | an attack encounter is completed |
| `marts.visited` | a mart is left |

**Prefixed keys** (the suffix is data, so the set is open-ended)

| Pattern | Example |
|---|---|
| `runs.completed.starter.<starterId>` | `runs.completed.starter.fire` |
| `runs.completed.mono.<TYPE>` | `runs.completed.mono.FIRE` |
| `battles.won.rank.<Rank>` | `battles.won.rank.Boss` |
| `events.seen.<eventId>` | `events.seen.sitrus-berry-tree` |

`runs.completed.mono.<TYPE>` is bumped once per completed run, once for **each type shared
by every Pokemon the run owns at completion** (active + bench). A run holding a
Charizard (FIRE/FLYING) and a Talonflame (FIRE/FLYING) bumps both `…mono.FIRE` and
`…mono.FLYING`; a run with one Charizard and one Blastoise bumps neither.

### `achievements.json`

Root data file, array of records:

```json
{
  "id": "champion",
  "name": "Champion",
  "description": "Finish a full run.",
  "stat": "runs.completed",
  "atLeast": 1,
  "hidden": false,
  "enabled": true
}
```

- `id` — unique lowercase slug; the value event conditions reference.
- `stat` — an exact key, or a prefixed key with a concrete suffix.
- `atLeast` — integer ≥ 1. Unlock fires when `getStat(stat) >= atLeast`.
- `hidden` — the achievements page shows name and description as `???` until unlocked.
- `enabled` — `false` hides it from the page and stops it unlocking, without deleting it.

### Achievements as event conditions

The existing condition object (`map/event_effects.js` `normalizeConditions`, ~891) gains
one optional field:

```json
{ "subject": "achievement", "mode": "has", "name": "champion", "text": "Only for champions." }
```

- `subject` — `"card"` (default, and what every existing condition means) or
  `"achievement"`.
- For `subject: "achievement"`, `name` is an **achievement id** and `cardKind` is ignored.
  `mode: "has"` requires it unlocked; `"lacks"` requires it locked.
- Default messages: `Requires the "<achievement name>" achievement.` /
  `Only before earning "<achievement name>".` — falling back to the raw id when the
  achievement record is missing.
- Everything else is unchanged: conditions are pure gates, they select nothing and consume
  nothing, multiple conditions AND together, and the first unmet one supplies the message.

**Backward compatibility is binding.** A condition without `subject` must behave exactly as
it does today, and `normalizeConditions` must not add the key to conditions that lack it —
`events.json` must stay byte-identical through an editor round trip.

## Cross-phase architecture facts

Verified in the repo on 2026-08-05. Line numbers are drift-prone hints.

**The module to imitate** is `map/run_state.js` (785 lines): a `(function attachRunState(global) { … })(window)`
IIFE exporting `global.PokeRun`, with `canUseStorage()` guarding every localStorage touch
(`typeof localStorage !== 'undefined'`) and a `normalize*` function per shape. `map/profile.js`
follows the same skeleton. It must be **inert at load** apart from guarded storage reads, so
Node tests and `dev/editor/server.js` can require it.

**Where each stat is bumped** — every one of these already has an idempotency flag pattern
to copy (`rewardCollected`, `completed`):

| Stat | File | Function | Line |
|---|---|---|---|
| `runs.started` | `map/area.js` | `createFreshRunState` | ~722 |
| `runs.completed`, `…starter.<id>`, `…mono.<TYPE>` | `arena/game.js` | `finalizeRunVictory` | ~182 |
| `runs.lost`, `battles.won/lost`, `battles.won.rank.<Rank>` | `arena/game.js` | `handleBattleFinished` | ~156 |
| `events.seen`, `events.seen.<id>` | `map/event.js` | `completeEvent` | ~198 |
| `captures.completed` | `map/capture.js` | `completeCapture` | ~136 |
| `attacks.claimed` | `map/attack.js` | `completeAttackClaim` | ~126 |
| `marts.visited` | `map/mart.js` | `completeMartAndReturnToMap` | ~331 |

`handleBattleFinished` can run twice (a reload re-renders the saved result overlay), so
every bump there needs its own guard flag on the encounter, exactly like
`activeBattleEncounter.rewardCollected` (~162).

**Run Pokemon at completion:** `PokeLocations.getRunPokemonRecords(run)` (`map/locations.js`
~844) returns the species records for active + bench. Types come off `record.types` or
`[type1, type2, type3]` minus `'NONE'` — `getRecordTypes` (~95) in the same file already
does exactly that.

**Trainer rank at battle end:** `arena/game.js` holds `activeTrainer` (~10), whose `rank` is
one of `Standard` / `Ace` / `Special` / `Boss` / `Elite`.

**Script tags per page** — `map/profile.js` must be added to every page that bumps or reads:

| Page | Currently loads |
|---|---|
| `area.html` | trainer_sprites, arena_data, arena_model, arena_render, run_state, locations, event_effects, area |
| `game.html` | …, arena_controller, arena_drag, run_state, locations, event_effects, game |
| `event.html` | …, run_state, locations, event_effects, event |
| `capture.html` / `attack.html` / `mart.html` | arena_data, arena_model, arena_render, run_state, locations, `<page>.js` |
| `index.html` | main.js only |

`map/event_effects.js` reads the profile for achievement conditions, and `chooseEvent` runs
on **area.html**, so both `area.html` and `event.html` need it. Load `map/profile.js` before
`map/event_effects.js` everywhere.

**The condition engine** (`map/event_effects.js`, 970 lines):
`normalizeConditions` (~891), `getUnmetConditionReason` (~219), `getActionConditions`
(~213), `eventConditionsMet` (used only by `chooseEvent(gameData, run)` at ~57, so an
already-saved encounter always resolves), `global.PokeEvents` export list (~951,
alphabetical).

**The editor's conditions UI** is `dev/editor/tab_events.js` (1335 lines): `resolveAction`
(~295) with its `conditionsField`, `conditionRowHtml` / `conditionsEditorHtml` (~778–815),
the `cond` / `cond-mode` / `cond-cardkind` handler scopes, and `conditionsPreviewHtml`
(~403).

**A new data file needs, in `dev/editor/`:** `FILE_NAMES` in `server.js` (~85),
`PLAIN_FILES`/`SMART_FILES` in `format_json.js` (~64 — `formatDataFile` throws on unknown
names), `FILE_TO_TAB` in `app.js` (~30), a validator in `validate.js` wired into
`validateAll` (~769), and a `<script>` tag in `index.html`.

**Browser verification tooling:** `dev/verify/lib.py` `serving()` on 127.0.0.1:8931, venv at
`dev/verify/.cache/venv/bin/python`, editor drivers modeled on `dev/verify/drive_editor.py`.

## Phases

| File | What it does | Order |
|---|---|---|
| `93-achievement-profile-store.md` | `map/profile.js`: the profile, the stat namespace, unlock evaluation. Node tests. Nothing calls it yet. | **first** — every later phase uses this API |
| `94-achievement-tracking.md` | `achievements.json` + loader, and the seven bump sites across `map/**` and `arena/game.js`. | after 93 |
| `95-achievements-page.md` | `achievements.html` + `map/achievements.js`, the index link, the unlock toast. | after 94 |
| `96-achievement-event-conditions.md` | `subject: "achievement"` end to end: engine, event page, editor conditions UI, validation. | after 94; independent of 95 |
| `97-achievements-editor-tab.md` | The Achievements tab: server/formatter plumbing, validation rules, list + form. | after 94; independent of 95/96 |
