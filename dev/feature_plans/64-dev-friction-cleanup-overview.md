# Dev-friction cleanup — batch overview

Two small, independent quality-of-life fixes that reduce friction while the owner is
actively adding/renaming card data:

1. **De-brittle the JSON-coupled unit tests** so ordinary data edits stop turning the
   suite red for no real reason (Phase 65).
2. **Baby-gate the editor's "Evolves into" dropdown** so it only appears when a type slot
   is `BABY`, updating live as types are edited (Phase 66).

The phases share no code and may be done in either order; each ends with the suite green.

## Ground rules (binding)

Inherited from `AGENTS.md` / `CLAUDE.md`, and they hold for every phase in this batch:

- **Never** `git commit` (or `git add`) unless the owner explicitly asks. Other read-only
  git is fine.
- **Never** run or extend `scripts/manage_*` (owner-only interactive CLIs). Edit files
  directly.
- **Do not** act on `TODO.md` or `dev/owner_tasks/`.
- **No** third-party libraries, frameworks, build tools, package managers, CDNs, or
  runtime deps. Plain JS/HTML/CSS + Node built-ins only. `dev/editor/` is approved
  dev-only tooling (Node built-ins only) that never ships in the browser game.
- **Run `node tests/run_all.js` after every change** (syntax-checks all tracked JS, then
  runs the suite in ~3s). The suite is currently **green (189 pass / 0 fail)** — keep it
  that way at every phase boundary.

## What is being built (context)

**Why Phase 65.** The owner constantly adds and renames pokemon/attacks/items. A few
tests hard-code frozen-data assumptions (exact derived counts, one specific species
name), so they break on content edits even when the engine is correct. The suite is
otherwise healthy and uses good data-proof patterns (enum-driven iteration,
recompute-the-expected-set, lower-bound guards) — the fix is narrow and surgical.

**Why Phase 66.** Phase 63 added the editor's `evolvesInto` control but deliberately
showed it on every pokemon, explicitly deferring BABY-only visibility as out of scope
("the form does not re-render on type change, and that rework is out of scope"). The
owner now wants that deferred reactive rework: the control is only meaningful on a baby
(BABY-typed) pokemon, so it should appear only then and update live as types change.

## Locked spec

**Phase 65 — exactly these edits, nothing else:**
- `tests/mart_stock.test.js`: replace the hard-coded `99` / `9` legal-count assertions
  with a **relative** form (`total − gatedCount`); replace the `findRecord('<Name>')`
  exemplar lookups with **trait/predicate** selection.
- `tests/pokemon_pools.test.js`: drop the single `record.name === 'Numel'` assertion;
  keep the `>= 1` guard and the per-record BABY-type check.
- **Kept strict, do not touch:** `data_validation.test.js`, `editor_validation.test.js`,
  `effect_boost.test.js`, `baby_event.test.js`, the byte-exact format snapshots in
  `editor_format.test.js`, the `LEVEL_CONFIG` snapshot in `run_progression.test.js`, and
  the `editor_api` `effectTypes` count. These encode real invariants or specific-feature
  behavior and are intentionally frozen.

**Phase 66 — exactly this behavior:**
- The "Evolves into (baby → mega target)" row is visible **iff** one of
  `type1/type2/type3` is `BABY`, recomputed live on every type change.
- When the last `BABY` type is removed, **clear** `draft.evolvesInto` (delete the key and
  reset the `<select>` to `(none)`) — matching the existing "(none) deletes the key"
  idiom. This is runtime-safe (see architecture facts below).
- Use the native HTML `hidden` attribute for visibility. **No new CSS.** Do **not**
  re-render the whole form on a type change.

## Cross-phase architecture facts

- **Mart gating is intrinsic** (`map/locations.js` `isMartOfferAllowed`, ~838-847): an
  attack is gated iff its types include `LEGENDARY`; an item is gated iff `item.status`
  includes `'DRAGON_GEM'`; dragon-gem prereqs need both a `DRAGON`-typed attack and a
  `DRAGON`-typed pokemon owned. `getRecordTypes` (~84) returns `record.types` if present
  else `[type1,type2,type3]` filtered of falsy/`'NONE'`.
- **`evolvesInto` is safe to strand/clear on a non-baby:** mega detection
  (`map/locations.js` `computeMegaTargetKeys`, ~748) only reads `evolvesInto` on
  `isBabyPokemon` records, and `dev/editor/validate.js:123` only flags `evolvesInto` when
  it is present *and* does not resolve. So clearing it when a pokemon stops being a baby
  changes nothing at runtime and cannot introduce a validation error.
- **Editor render model** (`dev/editor/tab_pokemon.js`): `renderForm` sets `el.innerHTML`
  once and binds **one** delegated `input` listener to `el`. Because the listener is on
  `el` (not inner nodes), re-`innerHTML`-ing `el` would keep it valid but calling
  `renderForm` again would bind a *second* listener — so react by toggling the row
  in place, never by re-invoking `renderForm`.

## Phases

| File | What it does | Order / dependency |
|------|--------------|--------------------|
| `65-de-brittle-json-tests.md` | Make `mart_stock` counts relative + its lookups rename-resilient; drop the pinned `Numel` name in `pokemon_pools`. | Independent; either order |
| `66-editor-baby-mega-visibility.md` | Show the editor's Evolves-into row only when a type is `BABY`; clear the link when it stops being a baby. | Independent; either order |
