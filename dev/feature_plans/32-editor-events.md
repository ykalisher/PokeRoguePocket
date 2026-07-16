# Phase 32 — Structured Event editors

**Recommended agent:** Opus · medium effort.
**Prereqs:** phase 29 (editor framework; 30/31 not required). **Read first:**
`25-data-editor-overview.md`.
**Goal:** The Events tab is fully editable with **structured forms only** (no raw JSON):
type-switching sections for gift/choice/trainer, add/remove/reorder for choices, a
requirements editor, and a per-type effect editor covering all 13 effect types. Unknown
keys and key order survive every round-trip. Ends green; saving every existing event
unedited produces an empty diff.

## Context you need

- The overview's **"Event vocabulary"** section is the contract: the common/gift/choice/
  trainer field maps, the requirement shape `{ id, cardKind, prompt?, label?, emptyText? }`,
  the alias rules (read `amount|count` and `cardKind|kind`; **write** `amount` for cash,
  `count` for cards, always explicit ≥ 1; always write a valid explicit `cardKind` —
  `normalizeCardKind` silently falls back to `'attack'`), and the 13-row effect-fields
  table. Cross-check against `map/event_effects.js` (`getEventActions` ~`:46`,
  `applyEffect` ~`:231`, `getEffectBlockedReason` ~`:181`) before building — the engine is
  the truth, the table is the map.
- **The hard requirement is round-trip fidelity.** Live data contains keys the engine
  ignores or aliases (`events.json` has `"source": "random"` inside a `replacement`;
  `rogue-mecha-cop` carries `battleTitle`/`battleText`/etc.). The editor must mutate the
  `structuredClone` draft **in place**: set fields the form edits, `delete` a field only
  when the user explicitly clears an optional field, and never construct a fresh object
  for an existing record/effect/choice. Reordering choices reorders the existing objects
  in the array. This — plus the phase-26 formatter — is what makes the no-op-save diff
  empty; treat any non-empty diff during verification as a bug in the editor, not the data.
- Layout: LEFT preview pane shows the event as the player meets it — type badge, gate-type
  icons (`types[]`), title/kicker/subtitle/body text block; then per action (gift claim /
  each choice / trainer battle + payment): its effects summarized one line each, with a
  **mini rendered card** (`--card-w: 48px`, `EditorPreview.renderCardInto`) for any
  `gain-card` / `replace-*`-with-`name` effect, and for trainer events the trainer's
  sprite + `rewardCash`. Unknown `trainerName` → red placeholder. Re-render on every edit.
- RIGHT form, three zones:
  1. **Common**: `id` (slug, unique), `type` select (gift/choice/trainer — switching
     reveals the matching conditional zone; keep the other zones' fields in the draft
     untouched so switching back loses nothing), `title`, `kicker`, `subtitle`, `body`
     (textarea), `resultTitle`, `enabled` toggle, `types[]` gate chip-picker (PokeType
     minus NONE/LEGENDARY, icons on chips).
  2. **Conditional per type** — gift: `actionTitle`, `buttonText`, `rewardText`, one
     requirements editor, one effects editor. choice: a reorderable list of choice blocks
     (add/remove/`↑`/`↓`), each with `id`, `title`, `description`, `buttonText`,
     requirements, effects. trainer: `trainerName` (searchable picker over trainers, with
     sprite thumbnail), `battleTitle`, `battleText`, `battleButtonText`, `rewardCash`
     (number), a `rewardEffects` editor, and an optional `payment` block (add/remove;
     `title`, `description`, `buttonText`, requirements, effects).
  3. **Effects editor** (one reusable component, used by all zones): a list of effect rows;
     each row = `type` select (the 13) + the fields for that type per the overview table.
     Changing an effect's `type` keeps shared fields (`count`, `cardKind`,
     `replacement`, …) in the draft object and only shows/edits the relevant ones. `name`
     fields are searchable pickers over the file matching `cardKind`; `types[]` filters are
     the chip-picker; `selectionId` is a select over the **sibling requirements' ids** of
     the same action (empty + warned when the action has no requirements). **Requirements
     editor**: list of `{ id, cardKind, prompt, label, emptyText }` rows (id required,
     unique within the action); removing a requirement that an effect's `selectionId`
     points at flags that effect.
- Add-new: three templates (one per event type), minimal canonical fields per the
  overview's field maps, `enabled: true`, one empty effects list, ids slugified from the
  title with uniqueness suffix. New events append at the end of the array.
- Draft-level validation hints (same pattern as phase 29): run `validateAll` with the draft
  applied; surface `events.*` issues next to Save. The server guard remains the backstop
  (`events.unknown-effect-type`, `events.unknown-trainer`, `events.no-trainer-event` when
  deleting the last trainer event, …).
- Good test subjects: `wandering-trader` (choice; `trade-random-pokemon` with `replacement`
  carrying the unknown `"source"` key; a `lose-cash` + `gain-random-card` choice),
  `rogue-mecha-cop` (trainer; `rewardEffects` gain-card Porygon2; the full battle-text
  field set), `berry-cache` (gift).

## Steps

- [ ] 1. **`dev/editor/tab_events.js`** — the full editor per the context: preview pane,
  the three form zones, the reusable effects + requirements editors, choice reordering,
  add-new templates, delete via `requestDelete('event', …)` (events are never referenced —
  deletes only confirm; the guard still blocks deleting the last trainer event).
- [ ] 2. **`dev/editor/editor.css`** — event-editor styling: choice blocks (card-like
  panels with reorder/remove controls), effect rows, requirement rows, the flagged-state
  (dangling `selectionId`) highlight, preview text block. Reuse existing chip/picker styles
  from earlier phases.
- [ ] 3. **Round-trip check** (part of the work, before any real edits): open **each of the
  6 events** and Save with zero edits → `git diff events.json` stays **empty** after all
  six. This proves unknown-key + key-order + alias preservation end to end. Any diff =
  stop and fix the mutation discipline.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] The step-3 six-event no-op round-trip leaves `git diff events.json` empty.
- [ ] Browser, `wandering-trader`: the choice blocks render with their effects; the
  `trade-random-pokemon` row shows its `replacement` types editor; swapping the two
  choices with `↓`/`↑` then Save → diff shows only the reordered blocks; restore via
  `git checkout -- events.json`.
- [ ] `rogue-mecha-cop`: preview shows the Mecha Cop sprite, `rewardCash` 400, and a mini
  Porygon2 card; changing `trainerName` via the picker updates the sprite live; an invalid
  (cleared) trainer flags the field and Save surfaces the 409.
- [ ] Create a new choice event end-to-end: one choice with a `requires` entry
  (`cardKind: pokemon`) + a `trade-selected-pokemon` effect whose `selectionId` select
  offers exactly that requirement id; save it (guard passes), confirm it appears in the
  list, then delete it. End with `git status` clean of data files; kill the server.

## Out of scope / do not touch

No changes to `map/event_effects.js`, `map/event.js`, or any game code — the editor adapts
to the engine, never the reverse. No locations editor (33), no uploads (34), no raw-JSON
fallback UI (owner decision), no server/shared-module edits beyond a strictly-required bug
fix with tests green. Inherit all batch ground rules from `25-data-editor-overview.md` (no
`git commit`, no `scripts/manage_*`, no `TODO.md`, no third-party deps, run
`node tests/run_all.js` after every change).
