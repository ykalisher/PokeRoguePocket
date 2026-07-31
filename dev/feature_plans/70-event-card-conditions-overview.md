# Event card conditions (has / lacks a named card) — batch overview

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
- Run `node tests/run_all.js` after every change. A phase is complete only when it is green
  **and** its verification boxes are ticked. (The suite was **red** when this batch was
  written — two stale tests, unrelated to this feature. Phase 71 fixes them, so from phase
  72 on a red suite means *you* broke something.)
- **Do not author game content.** This batch ships the *mechanism*; the owner writes the
  actual gated events in `events.json`. Any fixture event added for verification must be
  removed before the phase ends (`git status` must show `events.json` unchanged).
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names
  (`'boss'`, `'capture'`, `bossNodeId`). Never rename internals to match UI.

## What is being built (context)

An event action (a choice, the gift claim, the trainer payment) can already carry
`requires` — a list of **card pickers**. A picker shows the player a grid of their own
cards of one kind and stores the pick under the requirement's `id`; a selection-aware
effect (`remove-selected-card`, `duplicate-selected-card`, `replace-selected-card`,
`trade-selected-pokemon`) then acts on it. The player always chooses, and the choice is
never restricted to one particular card.

There is no way to say **"this option needs *Rotom* specifically"** or **"this option is
only offered if you do *not* already own Rotom Wash"**. That is what this batch adds, under
a new, separate key: **`conditions`**.

A condition is a pure *gate*: it selects nothing, renders no picker, and consumes nothing.
It only answers "is this available, and if not, why?" — the button grays out with the
reason underneath. Two granularities are supported, and the author picks either or both:

- **Event-level** (`event.conditions`) — the whole event is skipped by the random picker
  unless the run satisfies it.
- **Action-level** (`choices[].conditions`, `payment.conditions`) — the event still
  appears; that one button is grayed out.

Explicit non-goal (owner-confirmed, 2026-07-31): a `has` condition **never consumes** the
named card. There is deliberately no "remove this exact card" effect in this batch.

## Locked spec

A condition object, wherever it appears:

```json
{
  "mode": "has" | "lacks",
  "cardKind": "pokemon" | "attack" | "item",
  "name": "Rotom",
  "text": "optional message shown when this condition blocks the action"
}
```

- `mode` — `"has"` blocks unless the run owns a card named `name`; `"lacks"` blocks when it
  does. Any value other than `"lacks"` normalizes to `"has"`.
- `cardKind` — which collection to search. **Always write it explicitly**: the shared
  `normalizeCardKind` helper defaults an absent/unknown kind to `'attack'`, which is
  almost never what an author means.
- `name` — matched **exactly** (case-sensitive, trimmed) against the card's current name.
  A condition with no non-empty `name` is silently dropped.
- `text` — optional. Overrides the generated message. Defaults: `Requires <name>.` for
  `has`, `You already have <name>.` for `lacks`.
- Multiple conditions on one owner are **AND**-ed; the first unmet one supplies the message.

Where conditions are read:

| Location | Effect |
|---|---|
| `event.conditions` (top level, any event type) | Event is filtered out of `chooseEvent`'s pool while unmet. For a **gift** event these *also* gate the single claim button (see below). |
| `event.choices[].conditions` | That choice's button grays out. |
| `event.payment.conditions` (trainer events) | The pay-and-leave button grays out. |

Deliberately **not** supported: conditions on the trainer battle reward (`rewardEffects`) —
it is not a player choice. A gift event gets no separate action-level list because its
claim button *is* the event; it inherits `event.conditions` so that a restored encounter
which no longer qualifies shows a grayed button instead of silently granting the reward.

Event-level gating is applied **only** in `chooseEvent`, exactly like the existing
`poolSatisfied` baby-pool gate. `getEventById` and `getAvailableEvents` stay ungated so an
already-saved encounter always resolves.

## Cross-phase architecture facts

Verified in the repo on 2026-07-31 (line numbers are drift-prone hints, not gospel).

**Files this batch touches**

| File | Role |
|---|---|
| `map/event_effects.js` (804 lines) | shared event engine; `global.PokeEvents`. Owns `getEventActions`, `getBlockedReason`, `chooseEvent`, `normalizeRequirements`. Phase 72. |
| `map/event.js` (695 lines) | the event page; `getActionAvailabilityReason` (~line 606) decides whether a choice button is disabled. Phase 73. |
| `dev/editor/tab_events.js` (1200 lines) | data-editor Events tab: preview LEFT, structured form RIGHT. Phase 74. |
| `dev/editor/validate.js` (773 lines) | `validateEvents` (~line 327), `findReferences` (~line 720). Phase 75. |
| `tests/data_validation.test.js` | mirrors validate.js's event rules against live data (~line 200). Phase 75. |
| `.claude/skills/data/SKILL.md` | the card-data schema doc agents read. Phase 75. |

**How card ownership is read.** `getCardsByKind(run, kind)` (private to
`event_effects.js`, ~line 566) returns `{card, collectionKey, index, zone}` entries:

- `'pokemon'` → `collections.pokemon` (active) + `collections.bench.pokemon`
- `'attack'` → attack cards in `collections.actions` + `collections.bench.actions`
- `'item'` → item cards in `collections.actions` only — and that is complete, because
  `normalizeCollections` in `map/run_state.js` promotes every non-attack bench card back
  into `collections.actions`. Items are never on the bench.

`getCardName(card)` (~line 547) reads `card.pokemon.name` / `card.attack.name` /
`card.item.name`, which is the same string as the `name` field in the JSON data files.

**Mega evolution renames cards.** `map/run_state.js` (~line 345) *replaces* an evolving
baby card with a brand-new card built from the mega record, so its name changes. A
condition matches the card's **current** name — a `has: "Numel"` condition stops matching
once that Numel becomes its mega. This is intended behavior, not a bug to work around.

**An empty event pool is already handled.** If `chooseEvent` returns `null`,
`map/area.js` (~line 256) restores the previous node, un-visits it and pops up
"No events are available." So over-gating degrades safely — it never breaks a run.

**Editor round-trip fidelity is a hard requirement** (`tab_events.js` header comment):
the form mutates a `structuredClone` draft **in place**, sets only the fields the user
edits, deletes a field only when the user clears it, and never rebuilds an existing
record / effect / choice / requirement. Saving an untouched event must produce an empty
diff — so do not add `conditions: []` to events that have no conditions.

**Browser verification tooling.** `dev/verify/lib.py` has `serving()` (python http.server
on 127.0.0.1:8931) and the Playwright venv lives at `dev/verify/.cache/venv/bin/python`.
`dev/verify/drive_editor.py` spawns `node dev/editor/server.js --port 8933` itself and is
the model for editor drivers.

**Verified prototype.** The exact engine diff in phase 72 was applied to a scratch copy of
`event_effects.js` and exercised in Node during planning: has/lacks gating, custom `text`,
item ownership via the action deck, malformed conditions dropped, unconditioned events
untouched, `chooseEvent` filtering, and `getEventById` still resolving a gated event. Trust
the snippets; they are transcribed from a run that passed.

## Phases

| File | What it does | Order |
|---|---|---|
| `71-restore-green-baseline.md` | Fixes the two tests that went stale against the owner's `eventOnly` data commit. | **first** — every later phase gates on a green suite |
| `72-event-card-conditions-engine.md` | `map/event_effects.js`: normalize/evaluate conditions, gate `getBlockedReason` + `chooseEvent`, export the helpers. New `tests/event_conditions.test.js`. | first — everything else depends on the exported API |
| `73-event-card-conditions-page.md` | `map/event.js`: gray out conditioned buttons on the event page. Browser proof with a new Playwright driver. | after 72 |
| `74-event-card-conditions-editor.md` | `dev/editor/tab_events.js`: author conditions from the GUI (event-level + per choice + payment) and show them in the preview. | after 72; independent of 73 |
| `75-event-card-conditions-validation.md` | `dev/editor/validate.js` + both test mirrors + `findReferences` + the `data` skill doc. | last — validates the shape 74 writes |
