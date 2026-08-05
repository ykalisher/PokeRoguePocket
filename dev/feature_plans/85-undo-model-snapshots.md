# Phase 85 — Undo: battle snapshots and the undo stack in the model

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `84-undo-overview.md`.
**Goal:** `arena/arena_model.js` can snapshot the whole battle to a detached plain object
and restore it, and owns a per-turn undo stack. Ends green with a new
`tests/battle_undo.test.js`. Nothing changes in the browser yet — no controller or render
code is touched in this phase.

## Context you need

Everything happens in **`arena/arena_model.js`** (1861 lines), a `window`-namespace IIFE
exporting `arena.Model` and owning `arena.state`. Read the overview's "Locked spec" and
"Cross-phase architecture facts" first — in particular the table showing that every
undoable mutation lands inside the fields `serializeBattleState()` already writes.

The functions you touch, with drift-prone line hints:

- `const state = { … }` (~97) — the single mutable battle state object. Keys are roughly
  alphabetical after `currentPlayer`; you add one.
- `restoreSavedBattleState()` (~176) — currently does three things in one body: assign the
  saved payload onto `state`, reset transient UI/timer fields, and roll unsafe phases back
  to `'turn'`. You split the **first** part out.
- `serializeBattleState()` (~276) — the field picker. **Do not add `undoStack` to it.**
- `arena.Model = { … }` (~1837) — the export list. It is *roughly* alphabetical but not
  strictly; insert each new name near its alphabetical neighbours.

Helpers already in the file that `applyBattleSnapshot` calls (no changes needed):
`normalizeSavedLog`, `normalizeExtraAttacks`, `normalizeItemAllowance`,
`normalizeItemUsed`, `normalizePlannedActions`, `normalizeSavedPlayer`.

**The split rule that matters.** `restoreSavedBattleState()` currently also resets
`menuWindowOpen`, `rulesWindowOpen`, `pileWindow`, `flowTimer` and `popupTimer`. Those are
correct for a **page reload** but wrong for **undo** — an undo must not close the player's
open rules window, and nulling `popupTimer` without `clearTimeout` would orphan a live
timer. So those five stay in `restoreSavedBattleState()`; `applyBattleSnapshot()` handles
only the serialized fields plus the transient per-action fields (`arrivingCardIds`,
`drag`, `isResolving`, `pendingPokemonReplacements`, `suppressNextClick`) that are
meaningless once the state is replaced wholesale.

**Why `JSON.parse(JSON.stringify(...))` is the right clone.** `serializeBattleState()`
returns *live references* into `state`, so a snapshot must be deep-copied or it would
mutate along with the battle. The same payload already round-trips through
`JSON.stringify` for localStorage on every repaint, so every value in it is provably
JSON-safe: cards are plain objects, no DOM nodes or functions are stored on them.
`structuredClone` would also work but JSON matches what the storage path already proves.

## Steps

- [ ] 1. **`arena/arena_model.js`** — add the stack field to `state` (~97), directly after
  `turnNumber` so it reads as the last entry:

  ```js
        turnNumber: 0,
        // Per-turn undo history (phase 85). Newest last. Deliberately absent
        // from serializeBattleState(): undo dies on reload by design.
        undoStack: []
  ```

- [ ] 2. **`arena/arena_model.js`** — add `applyBattleSnapshot` immediately **above**
  `restoreSavedBattleState` (~176), with its doc comment:

  ```js
    /**
     * Assigns a serialized battle payload onto the live state. Shared by the
     * localStorage restore path and by undo, so it writes only the fields
     * serializeBattleState() produces plus the transient per-action fields that
     * are meaningless once the state is replaced. Window and timer fields
     * (menuWindowOpen, rulesWindowOpen, pileWindow, flowTimer, popupTimer) are
     * deliberately left alone: a reload resets them in restoreSavedBattleState(),
     * but an undo must not close the player's open windows or orphan a timer.
     */
    function applyBattleSnapshot(snapshot) {
        if (!snapshot) return false;

        state.arrivingCardIds = [];
        state.currentPlayer = snapshot.currentPlayer || 'player';
        state.drag = null;
        state.extraAttacks = normalizeExtraAttacks(snapshot.extraAttacks);
        state.finished = Boolean(snapshot.finished);
        state.isResolving = false;
        state.itemAllowance = normalizeItemAllowance(snapshot.itemAllowance);
        state.itemUsed = normalizeItemUsed(snapshot.itemUsed);
        state.log = normalizeSavedLog(snapshot.log);
        state.pendingActionCardId = snapshot.pendingActionCardId || null;
        state.pendingPokemonReplacements = [];
        state.pendingUserCardId = snapshot.pendingUserCardId || null;
        state.phase = snapshot.phase || 'turn';
        state.plannedActions = normalizePlannedActions(snapshot.plannedActions);
        state.players = {
            opponent: normalizeSavedPlayer(snapshot.players && snapshot.players.opponent, 'opponent', 'Rival'),
            player: normalizeSavedPlayer(snapshot.players && snapshot.players.player, 'player', 'You')
        };
        state.selectedCardId = snapshot.selectedCardId || null;
        state.suppressNextClick = false;
        state.turnNumber = Number.isFinite(snapshot.turnNumber) ? snapshot.turnNumber : 0;

        return true;
    }
  ```

- [ ] 2b. Keep `restoreSavedBattleState`'s existing doc comment ("Restores a saved battle
  during game.js boot…") on `restoreSavedBattleState`, not on the new function.

- [ ] 3. **`arena/arena_model.js`** — replace the **body** of `restoreSavedBattleState`
  (everything between `function restoreSavedBattleState() {` and its closing brace) with:

  ```js
        const savedBattle = loadSavedBattleState();

        if (!applyBattleSnapshot(savedBattle)) return false;

        // Page-reload-only resets: a fresh page has no open windows and no
        // live timers, and undo history never survives a reload.
        state.flowTimer = null;
        state.menuWindowOpen = false;
        state.pileWindow = null;
        state.popupTimer = null;
        state.rulesWindowOpen = false;
        state.undoStack = [];

        if (state.phase === 'resolving' || state.phase === 'opponent-planning') {
            state.currentPlayer = 'player';
            state.phase = 'turn';
            state.plannedActions = { opponent: [], player: [] };
        }

        return true;
  ```

  Note the guard changed shape: it used to be `if (!savedBattle) return false;` before the
  assignments — `applyBattleSnapshot` now returns `false` for a null payload, so the single
  call covers both.

- [ ] 4. **`arena/arena_model.js`** — add the undo-stack API directly **below**
  `serializeBattleState` (~294, above `normalizeSavedLog`):

  ```js
    /**
     * Deep-copies the current battle into a detached plain object. The payload
     * is the same one localStorage round-trips on every repaint, so every value
     * in it is provably JSON-safe.
     */
    function createBattleSnapshot() {
        return JSON.parse(JSON.stringify(serializeBattleState()));
    }

    /**
     * Records the state to return to if the player undoes the action they are
     * about to commit. `label` is the card name shown in the undo log line.
     * Callers push BEFORE the action mutates anything.
     */
    function pushUndoSnapshot(label) {
        state.undoStack.push({
            label: String(label || 'the last action'),
            snapshot: createBattleSnapshot()
        });

        return state.undoStack.length;
    }

    function popUndoSnapshot() {
        return state.undoStack.pop() || null;
    }

    function clearUndoStack() {
        state.undoStack = [];
    }

    function canUndo() {
        return state.undoStack.length > 0;
    }
  ```

- [ ] 5. **`arena/arena_model.js`** — export the five new names plus
  `applyBattleSnapshot` in `arena.Model` (~1837). Insert near their alphabetical
  neighbours, e.g. `applyBattleSnapshot` after `applyStatChange`, `canUndo` after
  `canQueueAnotherAttack`, `clearUndoStack` after `clearSavedBattleState`,
  `createBattleSnapshot` after `createPlayer` (rename order does not matter — the list is
  only roughly sorted), and `popUndoSnapshot` / `pushUndoSnapshot` near
  `putPokemonOnBottomOfDeck`.

- [ ] 6. **`arena/arena_model.js`** — confirm by reading that `serializeBattleState()` still
  returns exactly its original 13 fields and **no** `undoStack`. This is the one regression
  that would silently bloat every localStorage write.

- [ ] 7. **`tests/battle_undo.test.js`** — new file. Follow the style of
  `tests/arena_model.test.js`: `require('./helpers/arena_env')` for `{ arena }`, `node:test`
  + `node:assert/strict`. Cover:
  - `createBattleSnapshot()` is detached — snapshot a state, mutate
    `arena.state.players.player.hand` (push a fake card) and
    `arena.state.players.player.handSize`, and assert the snapshot is unchanged.
  - `applyBattleSnapshot(snapshot)` restores hand length, `handSize`, `itemUsed`,
    `itemAllowance`, `extraAttacks` and deck order (compare the array of card ids).
  - `applyBattleSnapshot(null)` returns `false` and leaves state alone.
  - `applyBattleSnapshot` does **not** touch `state.rulesWindowOpen` — set it `true`,
    restore, assert still `true`.
  - `pushUndoSnapshot('Sitrus Berry')` / `canUndo()` / `popUndoSnapshot()` /
    `clearUndoStack()` behave as a LIFO stack, and `popUndoSnapshot()` on an empty stack
    returns `null`.
  - `serializeBattleState()` output has no `undoStack` key (guard for step 6).

  Build a battle to snapshot with `arena.Model.createPlayer('player', 'You')` +
  `createPlayer('opponent', 'Rival')` assigned onto `arena.state.players`, the same way the
  existing model tests set one up — read `tests/arena_model.test.js` for the exact
  incantation rather than inventing one.

- [ ] 8. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green, with the new `battle_undo` tests appearing in the
  output and the pre-existing count (275) unchanged apart from the additions.
- [ ] `grep -n "undoStack" arena/arena_model.js` shows it in `state`, in the four stack
  functions, and in `restoreSavedBattleState` — but **not** inside `serializeBattleState`.
- [ ] Save/restore still works in the real game: serve with
  `python3 -m http.server 8931 --bind 127.0.0.1`, start a battle at
  `http://127.0.0.1:8931/game.html`, queue an attack, reload the page, and confirm the
  battle resumes with the attack still queued (this is the regression the
  `restoreSavedBattleState` refactor could break). Stop the server afterwards with
  `pkill -f "http.server 8931"`.

## Out of scope / do not touch

`arena/arena_controller.js` and `arena/arena_render.js` (phases 86 and 87 — nothing calls
the new API yet, and that is correct for this phase). Do not add a button, do not change
`saveBattleState`/`shouldSaveBattleState`, do not change the storage version or the
`BATTLE_STORAGE_KEY`, and do not "improve" `normalizeSavedPlayer` while you are in there.
No data files, no CSS.
