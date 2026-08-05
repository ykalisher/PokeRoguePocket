# Battle undo button — batch overview

## Ground rules (binding)

- **Never** `git add` / `git commit` / `git push`. Read-only git (`log`, `diff`, `status`,
  `checkout --` to undo a *temporary* fixture) is fine.
- Plain JavaScript / HTML / CSS only. No third-party libraries, frameworks, build tools,
  package managers, CDNs, or runtime dependencies. `tests/` (Node built-ins), `dev/verify/`
  (Python + Playwright) and `dev/editor/` (Node built-ins) are the already-approved dev-only
  exemptions — do not add new dependencies to them either.
- Never run or extend `scripts/manage_*.js` (owner-only interactive CLIs).
- `TODO.md` and `dev/owner_tasks/` belong to the owner — never act on their contents.
- Run `node tests/run_all.js` after every change. The suite was **green** when this batch
  was written (2026-08-05, 275 tests), so a red suite from phase 85 on means *you* broke
  something.
- UI text says "Gym Leader" / "Wild Pokemon Encounter" while internals keep the old names
  (`'boss'`, `'capture'`, `bossNodeId`). Never rename internals to match UI.

## What is being built (context)

During the player's turn a card leaves the hand the moment it is committed, and there is no
way back. Four different commit paths exist and they behave differently:

- **Attacks** are *queued*: the card moves into `state.plannedActions.player` and nothing
  else happens until the whole turn resolves.
- **Items** (including dragon gems and the effect-boost item) resolve **immediately** —
  they heal, cure, change stat stages, mark the item use spent, and the physical card is
  removed from play for the rest of the battle.
- **Artificial attacks** resolve **immediately** and permanently change the player's own
  side: `INCREASE_CAPACITY` raises hand size for the rest of the battle, `EXTRA_ITEM` raises
  the item allowance, `EXTRA_ATTACK` grants an ally another attack, `REFRESH_DECK` shuffles
  the discard pile back into the deck.
- **Discards** move the card to the discard pile.

This batch adds one **Undo** button that takes back the most recent of *any* of those, with
every side effect reverted.

The naive approach — writing an inverse for each effect — is a trap: `REFRESH_DECK` alone
destroys deck order irrecoverably, and every future item effect would need a matching
inverse. Instead this batch reuses the engine's **existing full-battle serializer**, which
already round-trips every mutable field through JSON for the localStorage save. Undo takes
a snapshot before an action and restores it afterwards.

## Locked spec

- **Repeatable.** Undo is a *stack*, not a single slot. Pressing it repeatedly walks back
  action by action to the start of the current turn, then the button disables.
- **Covers every player commit path**, including **discards**: queued attacks, targeted
  items, dragon gems, the effect-boost item, artificial attacks, and discarded cards.
- **Current turn only.** The stack is cleared in `startPlayerTurn()` and in
  `endPlayerTurn()`. Nothing from a previous turn is ever undoable, and undo can never
  reach back into attack resolution.
- **Player only.** Opponent actions are never snapshotted and never undoable. The five
  `use*FromHand` helpers are shared by both sides, so every push site must be guarded by
  `ownerId === 'player'`.
- **Not persisted.** `state.undoStack` is deliberately absent from
  `serializeBattleState()`, so a page reload loses undo history (the battle itself still
  restores normally). This keeps the localStorage payload small and leaves the save/restore
  contract byte-identical.
- **Disabled while busy.** Undo is unavailable when `state.isResolving` is true (an item or
  discard animation is mid-flight), when `state.finished` is true, when it is not the
  player's turn, and when the stack is empty.
- **Log behavior.** The log is part of the snapshot, so restoring rewinds the log lines the
  undone action wrote. Immediately after restoring, one new line is appended:
  `Undid <card name>.`

**Accepted consequence (owner-confirmed, 2026-08-05):** undo lets a player re-roll in-turn
randomness — undoing a `REFRESH_DECK` and re-using it reshuffles differently, and the same
holds for any random item effect. This is inherent to snapshot undo and is *not* a bug to
engineer around. Attack damage rolls are unaffected because attacks resolve after the turn
ends, past the point where undo is available.

## Cross-phase architecture facts

Verified in the repo on 2026-08-05. Line numbers are drift-prone hints, not gospel — grep
for the function name.

**The machinery being reused** — all in `arena/arena_model.js` (1861 lines):

| Function | Line | What it does |
|---|---|---|
| `serializeBattleState()` | ~276 | Returns the plain-object battle state: `currentPlayer`, `extraAttacks`, `finished`, `itemAllowance`, `itemUsed`, `log`, `pendingActionCardId`, `pendingUserCardId`, `phase`, `plannedActions`, `players`, `selectedCardId`, `turnNumber`. **Returns live references, not copies.** |
| `restoreSavedBattleState()` | ~176 | Reads localStorage, assigns all of the above onto `state`, resets transient UI fields, then rolls `resolving` / `opponent-planning` back to `'turn'`. Phase 85 splits the middle out. |
| `normalizeSavedPlayer()` | ~350 | Rebuilds one player defensively from plain data (board slots, deck/discard/hand/removed filtering, `dragonGems`, `effectBoost`, `handSize`, `initialPokemonCount`, `knockoutCount`, `pokemonLeft`). |
| `saveBattleState()` | ~155 | Called from the controller's `render()` on every repaint. |

**Why the serialized field list is sufficient.** Every mutation an undoable player action
can make lands in one of those fields:

| Action | What it changes | Serialized field |
|---|---|---|
| Queue attack | card leaves hand, planned action pushed | `players.player.hand`, `plannedActions.player` |
| Item (targeted) | target health/statuses/stat stages, item marked used, card → `removed` | `players.*`, `itemUsed` |
| Dragon gem | `player.dragonGems`, item marked used, card → `removed` | `players.player`, `itemUsed` |
| Effect boost | `player.effectBoost`, item marked used, card → `removed` | `players.player`, `itemUsed` |
| `INCREASE_CAPACITY` | `player.handSize` | `players.player.handSize` |
| `EXTRA_ITEM` | `state.itemAllowance.player` | `itemAllowance` |
| `EXTRA_ATTACK` | `state.extraAttacks.player[cardId]` | `extraAttacks` |
| `REFRESH_DECK` | discard emptied into deck, reshuffled | `players.player.deck` / `.discard` |
| Discard | card hand → discard | `players.player` |

Cards are plain JSON-safe objects (they already survive the localStorage round trip), so
`JSON.parse(JSON.stringify(...))` is a valid deep clone. No DOM nodes are stored on cards;
`arena_render.js` looks elements up by `data-` attributes on every repaint.

**The six commit sites** in `arena/arena_controller.js` (3463 lines):

| Function | Line | Point of no return |
|---|---|---|
| `queuePlayerAttackForUser` | ~567 | `const attackCard = model.removeCardFromHand(player, cardId);` — everything above it is validation that can still bail out via `cancelActionSelection()` |
| `usePendingItem` | ~624 | `model.removeCardFromHand(player, state.pendingActionCardId)` |
| `useDragonGemItemFromHand` | ~656 | `model.removeCardFromHand(owner, cardId)` |
| `useEffectBoostItemFromHand` | ~717 | `model.removeCardFromHand(owner, cardId)` |
| `useArtificialAttackFromHand` | ~766 | `model.removeCardFromHand(owner, cardId)` |
| `discardHandCardFromHand` | ~867 | `model.removeCardFromHand(owner, cardId)` — reached from `discardPlayerHandCard` (~861) for the player |

The last five are shared with the opponent AI and take an `ownerId` parameter.

**Turn boundaries:** `startPlayerTurn()` (~151) resets `extraAttacks` / `itemAllowance` /
`itemUsed` / `plannedActions` and draws cards; `endPlayerTurn()` (~1710) hands off to the
opponent. Both must clear the undo stack.

**The repaint helper** is `const render = () => { arena.Render.render(); model.saveBattleState(); };`
at `arena/arena_controller.js:74`. Every state change in the controller ends with
`render()`.

**Where buttons live:** `arena/arena_render.js` `renderActionButtons(canEnd, canDiscard)`
(~900) returns four different button rows depending on `state.finished`, the targeting
phases, whose turn it is, and the normal turn. `handleArenaClick` (~193) routes
`[data-action]` values through an if/else chain. Button styling lives in
`static/styles.css` at `.arena-button` (~2002) with `--danger` (~2025), `--discard`
(~2030) and `--reference` (~2035) modifiers.

**Node testing.** `tests/helpers/arena_env.js` loads `arena_data.js` + `arena_model.js`
into Node with an in-memory `localStorage`. It does **not** load `arena_controller.js`
(which touches `document` at load time is a risk to check — see phase 86 step 1, which
tells you how to handle it).

## Phases

| File | What it does | Order |
|---|---|---|
| `85-undo-model-snapshots.md` | `arena/arena_model.js`: split `applyBattleSnapshot` out of the restore path, add `createBattleSnapshot` and the undo-stack API. New `tests/battle_undo.test.js`. | first — everything depends on this API |
| `86-undo-controller-actions.md` | `arena/arena_controller.js`: push snapshots at the six commit sites, add `undoLastAction` / `canUndoAction`, clear the stack at turn boundaries. | after 85 |
| `87-undo-button-ui.md` | `arena/arena_render.js` + `static/styles.css`: the Undo button, plus a browser proof. | after 86 |
