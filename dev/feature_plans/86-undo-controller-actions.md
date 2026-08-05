# Phase 86 — Undo: snapshot every player action and add undoLastAction()

**Recommended agent:** Opus · high effort.
(High because it edits six commit paths inside a 3463-line file, three of which are shared
with the opponent AI and must stay untouched for the opponent. Getting a guard wrong makes
the rival's turn undoable, which corrupts the battle. Go slowly and re-read each function
before editing it.)
**Prereqs:** phase 85 (the model API is defined there). **Read first:** `84-undo-overview.md`.
**Goal:** Every player card commit of the current turn pushes an undo point, and
`arena.Controller.undoLastAction()` reverts them one at a time back to the start of the
turn. Ends green with controller-level tests. No button exists yet — that is phase 87.

## Context you need

Everything happens in **`arena/arena_controller.js`** (3463 lines), a `window`-namespace
IIFE exporting `arena.Controller`. It destructures `const model = arena.Model;` at the top
and repaints through `const render = () => { arena.Render.render(); model.saveBattleState(); };`
(~74).

**The API phase 85 added to `arena.Model`** (call these, do not reimplement):
`pushUndoSnapshot(label)`, `popUndoSnapshot()` → `{ label, snapshot }` or `null`,
`clearUndoStack()`, `canUndo()`, `applyBattleSnapshot(snapshot)`.

**The six commit sites**, with drift-prone line hints. Three shapes recur:

| Function | Line | Shape |
|---|---|---|
| `queuePlayerAttackForUser` | ~567 | validates fully, *then* removes from hand — the one clean site |
| `usePendingItem` | ~624 | removes from hand **before** its null check |
| `useDragonGemItemFromHand` | ~656 | `ownerId` param; looks the card up, validates, removes |
| `useEffectBoostItemFromHand` | ~717 | same as above |
| `useArtificialAttackFromHand` | ~766 | same as above |
| `discardHandCardFromHand` | ~867 | `ownerId` param; removes from hand **before** its null check. Two callers: `discardPlayerHandCard` (~861, player) and the rival AI (~1304, opponent) |

**The invariant to protect:** the last four take `ownerId` and are used by the rival AI.
Snapshotting an opponent action would let the player rewind the rival's turn. Every push
goes through one shared guard helper (step 1) that checks both `ownerId === 'player'`
**and** `state.currentPlayer === 'player'`.

**Existing helpers you reuse:** `clearPendingAction()` (~929 — nulls
`pendingActionCardId`, `pendingUserCardId`, `selectedCardId`), `logEvent(message)` (~3039),
`render()` (~74), `model.getCardName(card)`, `model.findHandCard(player, cardId)`.

**Turn boundaries to clear the stack at:** `startPlayerTurn()` (~151, the block of
`state.* = …` resets after `state.phase = 'turn';`), `endPlayerTurn()` (~1710, next to its
`clearPendingAction();`), and `resetPrototype()` (~85, next to `state.turnNumber = 0;`).
`restoreSavedBattleState()` already clears it (phase 85, step 3).

**Click routing:** `handleArenaClick` (~193) ends with an if/else chain over
`actionButton.dataset.action` — `'cancel-action'`, `'close-pile-window'`, `'close-menu'`,
`'close-rules'`, `'discard-selected'`, `'end-turn'`, `'reset'`, `'toggle-menu'`,
`'toggle-rules'`. You add `'undo'`.

**Testing note.** `tests/helpers/arena_env.js` loads only `arena_data.js` and
`arena_model.js` — **not** the controller, which references `document` and
`arena.Render`. Before writing controller tests, check how `tests/arena_controller.test.js`
already loads it (it does — read its first ~30 lines and copy that setup exactly rather
than inventing a new shim).

## Steps

- [ ] 1. **`arena/arena_controller.js`** — add the shared guard helper directly **above**
  `queuePlayerAttackForUser` (~567), so it sits next to its first caller:

  ```js
    /**
     * Records the state to return to if the player undoes the action about to be
     * committed. Opponent actions are never undoable, so this no-ops for them
     * and for anything happening outside the player's own turn. Returns whether
     * a snapshot was actually pushed, so a caller that bails out afterwards can
     * pop it again.
     */
    function recordUndoPoint(ownerId, card) {
        if (ownerId !== 'player' || state.currentPlayer !== 'player' || !card) return false;

        model.pushUndoSnapshot(model.getCardName(card));

        return true;
    }
  ```

- [ ] 2. **`arena/arena_controller.js`** — `queuePlayerAttackForUser` (~567). Insert one
  line between the bail-out guard and the removal:

  ```js
        if (!queuedCard || !userCard || !userCanQueue || !targetAllowed) {
            cancelActionSelection();
            return false;
        }

        recordUndoPoint('player', queuedCard);

        const attackCard = model.removeCardFromHand(player, cardId);
  ```

- [ ] 3. **`arena/arena_controller.js`** — `usePendingItem` (~624). It currently removes
  the card before checking it exists, so look the card up first. Replace the opening of
  the function body:

  ```js
        const player = state.players.player;
        const sourceCenter = getHandCardCenter('player', state.pendingActionCardId);
        const targets = model.getCardsForTargetSelection(selection);
        const pendingCard = model.findHandCard(player, state.pendingActionCardId);

        if (!pendingCard) {
            cancelActionSelection();
            return;
        }

        const recorded = recordUndoPoint('player', pendingCard);
        const itemCard = model.removeCardFromHand(player, state.pendingActionCardId);

        if (!itemCard) {
            if (recorded) model.popUndoSnapshot();
            cancelActionSelection();
            return;
        }
  ```

  Everything from `itemCard.faceUp = true;` down is unchanged.

- [ ] 4. **`arena/arena_controller.js`** — `useDragonGemItemFromHand` (~656). The card is
  already looked up as `itemCard` and validated, so only two edits are needed:

  ```js
        const sourceCenter = getHandCardCenter(ownerId, cardId);
        const recorded = recordUndoPoint(ownerId, itemCard);
        const removedCard = model.removeCardFromHand(owner, cardId);

        if (!removedCard) {
            if (recorded) model.popUndoSnapshot();
            return false;
        }
  ```

- [ ] 5. **`arena/arena_controller.js`** — `useEffectBoostItemFromHand` (~717). Same two
  edits as step 4, same variable names (`itemCard`, `removedCard`).

- [ ] 6. **`arena/arena_controller.js`** — `useArtificialAttackFromHand` (~766). Same two
  edits, but the looked-up card is named `attackCard`:

  ```js
        const sourceCenter = getHandCardCenter(ownerId, cardId);
        const recorded = recordUndoPoint(ownerId, attackCard);
        const removedCard = model.removeCardFromHand(owner, cardId);

        if (!removedCard) {
            if (recorded) model.popUndoSnapshot();
            return false;
        }
  ```

- [ ] 7. **`arena/arena_controller.js`** — `discardHandCardFromHand` (~867). Same
  look-up-first restructure as step 3. Replace the opening of the function body:

  ```js
        const owner = state.players[ownerId];
        const sourceCenter = getHandCardCenter(ownerId, cardId) || getArenaCenter();
        const pendingCard = model.findHandCard(owner, cardId);
        const recorded = recordUndoPoint(ownerId, pendingCard);
        const card = model.removeCardFromHand(owner, cardId);
        const shouldReleaseInput = options.releaseInput !== undefined
            ? options.releaseInput
            : ownerId === 'player';

        if (!card) {
            if (recorded) model.popUndoSnapshot();
            return false;
        }
  ```

  The rival AI's call at ~1304 passes `'opponent'`, so `recordUndoPoint` returns `false`
  there and nothing is pushed — verify that by reading the call site, do not assume it.

- [ ] 8. **`arena/arena_controller.js`** — add the two public functions directly **below**
  `cancelActionSelection` / `clearPendingAction` (~929):

  ```js
    /**
     * Reverts the most recent player action of this turn by restoring the
     * snapshot taken just before it. Repeatable: each press walks one action
     * further back, until the stack empties at the start of the turn. The
     * restored snapshot includes the log, so the undone action's log lines
     * disappear and one "Undid …" line replaces them.
     */
    function undoLastAction() {
        if (!canUndoAction()) return false;

        const entry = model.popUndoSnapshot();

        if (!entry) return false;

        model.applyBattleSnapshot(entry.snapshot);
        clearPendingAction();
        state.currentPlayer = 'player';
        state.phase = 'turn';
        logEvent(`Undid ${entry.label}.`);
        render();

        return true;
    }

    /**
     * Undo is offered only during the player's own unlocked turn, never while an
     * item or discard animation is in flight, and never after the battle ends.
     */
    function canUndoAction() {
        return (
            state.currentPlayer === 'player' &&
            !state.finished &&
            !state.isResolving &&
            model.canUndo()
        );
    }
  ```

  Note this deliberately forces `phase = 'turn'` and clears the pending action rather than
  restoring the snapshot's phase: the point of undo is "the card is back in my hand and
  nothing is selected", not "I am back in the middle of picking a target".

- [ ] 9. **`arena/arena_controller.js`** — route the click in `handleArenaClick` (~193).
  Add to the if/else chain, keeping its existing alphabetical-ish order (after
  `'toggle-rules'` is fine):

  ```js
        } else if (action === 'undo') {
            undoLastAction();
        }
  ```

- [ ] 10. **`arena/arena_controller.js`** — clear the stack at all three turn boundaries:
  - `startPlayerTurn()` (~151): add `model.clearUndoStack();` immediately after
    `state.turnNumber += 1;`.
  - `endPlayerTurn()` (~1710): add `model.clearUndoStack();` immediately after the
    existing `clearPendingAction();`.
  - `resetPrototype()` (~85): add `model.clearUndoStack();` immediately after
    `state.turnNumber = 0;`.

- [ ] 11. **`arena/arena_controller.js`** — export both new functions in `arena.Controller`
  (~3430). Put them with the other `can*` / action entries: `canUndoAction` after
  `canDiscardSelectedCard`, and `undoLastAction` after `usePendingItem`.

- [ ] 12. **`tests/battle_undo.test.js`** — extend phase 85's file with controller-level
  cases (or add `tests/battle_undo_controller.test.js` if the controller setup shim makes
  one file awkward). Each case: set up a player turn, perform the action, assert the
  effect, call `arena.Controller.undoLastAction()`, assert the world is back:
  - **item**: card returns to `players.player.hand`, leaves `players.player.removed`,
    `state.itemUsed.player` back to `0`, target health restored.
  - **queued attack**: `state.plannedActions.player` empty again, card back in hand.
  - **`INCREASE_CAPACITY`**: `players.player.handSize` back to its prior value.
  - **`EXTRA_ITEM`**: `state.itemAllowance.player` back to `1`.
  - **`EXTRA_ATTACK`**: `state.extraAttacks.player` empty again.
  - **`REFRESH_DECK`**: deck and discard card-id arrays identical to before, in order.
  - **discard**: card back in hand, out of `players.player.discard`.
  - **repeatability**: three actions then three undos returns the state to the turn start;
    a fourth `undoLastAction()` returns `false`.
  - **turn boundary**: after `endPlayerTurn()`, `canUndoAction()` is `false` and
    `model.canUndo()` is `false`.
  - **opponent guard**: driving an opponent discard or item leaves the undo stack empty.

- [ ] 13. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green, with every case from step 12 passing.
- [ ] `grep -n "recordUndoPoint" arena/arena_controller.js` shows exactly **seven** hits:
  the definition plus the six commit sites.
- [ ] Manual browser sanity pass (the button does not exist yet, so drive it from the
  console): serve with `python3 -m http.server 8931 --bind 127.0.0.1`, open
  `http://127.0.0.1:8931/game.html`, use an item, then run
  `CardArena.Controller.undoLastAction()` in the devtools console and confirm the card
  reappears in hand and the log shows `Undid <name>.`. Then end the turn and confirm
  `CardArena.Controller.canUndoAction()` is `false`. Stop the server with
  `pkill -f "http.server 8931"`.
- [ ] Rival regression: let the rival take a full turn (attacks, and a discard if it makes
  one) and confirm `CardArena.state.undoStack.length` is `0` at the start of your next turn.

## Out of scope / do not touch

`arena/arena_render.js` and `static/styles.css` (phase 87 — no button in this phase).
`arena/arena_model.js` (phase 85 finished it; if you find the API insufficient, extend it
minimally and say so, do not redesign it). Do not touch attack resolution
(`resolveQueuedAttacks`, `resolveQueuedAttack`, `createResolutionActions`), the rival AI
(`chooseOpponentAttacks`, `chooseOpponentItem`, and everything they call), the drag module
`arena/arena_drag.js`, or `arena/game.js`. Do not make opponent actions undoable. Do not
add undo to the save payload.
