# Event-only pokemon + baby→mega integrity — batch overview

Two small, independent pokemon-data/editor features:

1. **Event-only pokemon** (Phase 68) — a new `eventOnly` boolean on pokemon records.
   Flagged pokemon never appear in wild-area/capture pools or random rewards, but stay
   obtainable via events that grant them by name. The data editor gets an "Event-only"
   checkbox; the validator warns when a flagged pokemon is granted by no event.
2. **Baby→mega editor issue** (Phase 69) — a save-blocking error when a BABY pokemon does
   not point (`evolvesInto`) to a Mega.

The phases share no code path (they append to different spots — Phase 68 also touches
`validatePokemon`, Phase 69 only touches `validatePokemon`) and may be done in either order;
each ends with the suite green.

## Ground rules (binding)

Inherited from `AGENTS.md` / `CLAUDE.md`, and they hold for every phase in this batch:

- **Never** `git commit` (or `git add`) unless the owner explicitly asks. Other read-only
  git is fine.
- **Never** run or extend `scripts/manage_*` (owner-only interactive CLIs). Edit files
  directly.
- **Do not** act on `TODO.md` or `dev/owner_tasks/`.
- **No** third-party libraries, frameworks, build tools, package managers, CDNs, or runtime
  deps. Plain JS/HTML/CSS + Node built-ins only. `dev/editor/` and `tests/` are approved
  dev-only tooling (Node built-ins only) that never ships in the browser game.
- **Run `node tests/run_all.js` after every change** (syntax-checks all tracked JS, then
  runs the suite in ~3s). Keep it green at every phase boundary.

## What is being built (context)

**Why Phase 68.** There is currently no way to mark a pokemon as obtainable only through
events. The owner wants a per-pokemon flag, editable via a checkbox in the data editor, so
that flagged pokemon are removed from every wild/random pool while remaining grantable by
events that name them. A safety warning surfaces any flagged pokemon that no event actually
grants (which would make it unobtainable).

**Why Phase 69.** The editor's issue checks verify an `evolvesInto` resolves to *some*
pokemon, but never require a **baby** to have one, nor that its target is a **Mega**. The
owner wants that gap closed as a save-blocking error so baby/mega links stay consistent.

## Locked spec

**Event-only (Phase 68) — exactly this behavior:**
- New optional field `eventOnly: true` on `pokemon.json` records. Stored **only when true**
  (the editor deletes the key when unchecked) — never write `"eventOnly": false` and never
  backfill existing records.
- Propagated through `arena/arena_data.js` `normalizePokemon` so `arena.GameData` records
  carry it.
- Excluded from every wild/random pool via a single guard in `map/locations.js`
  `isObtainablePokemon`, **and** from the legendary opt-in path in `map/capture.js` /
  `map/area.js` `getAvailableLegendaryPokemon`.
- Still obtainable via events that grant it **by name** (`gain-card`, `cardKind:'pokemon'`)
  — that path (`event_effects.js` `findRecord`) does not consult the obtainability filter.
- Editor: an "Event-only" checkbox on the Pokemon detail form, mirroring the
  `dev/editor/tab_locations.js` `enabled` checkbox pattern.
- Validator: a **warning** (`pokemon.event-only-unreachable`) when a flagged pokemon's name
  is granted by no event. Warning, **not** error — it must never block saving a pokemon
  flagged before its event is wired.
- **No real pokemon is flagged in this batch.** Mechanism only.

**Baby→mega (Phase 69) — exactly this behavior:**
- A **save-blocking error** (`pokemon.baby-missing-mega`) when a `BABY`-typed record either
  (a) has no `evolvesInto`, or (b) has an `evolvesInto` that resolves to a non-Mega.
- "Mega" = a record whose `id` parses to a number **> 9000** (the authoring convention;
  see `map/locations.js` `isMegaByConvention`). Reproduce this rule **inline** in the
  validator — do not import engine code (the validator runs in browser and Node).
- Scoped to `BABY` records only. A target that resolves to *nothing* is already reported by
  the existing `pokemon.bad-evolves-into`; do not double-report it.
- Verified precondition: all 31 current babies already point to a 9xxx Mega and no non-baby
  record uses `evolvesInto`, so this error blocks no existing data.

## Cross-phase architecture facts

- **`normalizePokemon` (`arena/arena_data.js` ~L358) drops unknown keys** — it copies an
  explicit field list. Any new pokemon field must be added there or it is invisible to the
  `map/` pool code (which runs on normalized `arena.GameData`).
- **`isObtainablePokemon` (`map/locations.js` ~L782) is the single wild/random choke
  point.** Consumers: `capture.js`, `area.js` (both `getAvailablePokemonForCurrentTerrain`
  → `getWildPokemonPool`), and `event_effects.js` `chooseRandomRecord` (random pokemon
  rewards). The one bypass is the legendary opt-in path
  (`getAvailableLegendaryPokemon`, `capture.js` ~L449 / `area.js` ~L1180), which filters
  mega/baby explicitly.
- **Named grants bypass the filter:** `event_effects.js` `gainNamedCards` → `findRecord`
  (~L636) is an exact name match against `gameData.pokemon` with no obtainability check.
- **Validator wiring:** `dev/editor/validate.js` — checks are hard-coded pushes into
  `issues` inside each `validate<Type>`; `validateAll` (~L636) aggregates them and has
  `events` + `collectAllEffectRefs(events)` (~L669) available. `err(...)`/`warn(...)`
  helpers (~L37-38). The server write-guard (`dev/editor/server.js` ~L315) blocks a PUT
  only on `severity === 'error'` in the written file or a new error elsewhere; warnings are
  advisory. No `server.js`/`format_json.js` changes are needed for a new pokemon field.
- **Editor render model** (`dev/editor/tab_pokemon.js`): `renderForm` sets `el.innerHTML`
  once and binds **one** delegated `input` listener to `el`. React to changes in place;
  **never** re-invoke `renderForm` (it would bind a second listener). Checkbox values must
  be read from `target.checked`, before the generic `Number(value)`/`value` write.

## Phases

| File | What it does | Order / dependency |
|------|--------------|--------------------|
| `68-event-only-pokemon.md` | Add the `eventOnly` flag: propagate in normalize, exclude from all wild/random/legendary pools, add the editor checkbox, add the orphan warning, add tests. | Independent; either order |
| `69-baby-mega-editor-issue.md` | Add a save-blocking editor error when a BABY pokemon doesn't point to a Mega (id>9000). | Independent; either order |
