# Phase 87 — Undo: the button in the battle action bar

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 86 (`canUndoAction` / `undoLastAction` must exist and be exported).
**Read first:** `84-undo-overview.md`.
**Goal:** An **Undo** button sits in the battle action bar, enabled exactly when
`arena.Controller.canUndoAction()` is true, and clicking it takes back the last card
action. Proven in a real browser with a committed Playwright driver and a screenshot.

## Context you need

Two files: **`arena/arena_render.js`** (1123 lines) and **`static/styles.css`** (66 KB —
Grep it, never read it whole).

**`renderStatus(pendingAction)`** (~853) computes the button predicates and drops them into
the action bar:

```js
        const canEnd = arena.Controller.canPlayerEndTurn();
        const canDiscard = arena.Controller.canDiscardSelectedCard();
        …
                <div class="action-bar">
                    ${renderActionButtons(canEnd, canDiscard)}
                </div>
```

**`renderActionButtons(canEnd, canDiscard)`** (~900) returns one of four rows:

1. `state.finished` → Restart + Rules + Menu
2. a `selecting-*` phase → Cancel + Discard + Rules + Menu
3. not the player's turn → disabled Discard + disabled End Turn + Rules + Menu
4. the normal player turn → Discard + End Turn + Rules + Menu

Undo belongs in rows **2, 3 and 4** — not row 1 (the battle is over; `canUndoAction()` is
false anyway, but a dead button in the result row is noise). In row 3 it renders
permanently disabled like the neighbouring buttons, with no `data-action`.

Button markup convention (copy it exactly — `data-action` is what `handleArenaClick`
routes on):

```html
<button class="arena-button arena-button--discard" type="button" data-action="discard-selected" ${canDiscard ? '' : 'disabled'}>Discard</button>
```

**CSS to imitate**, all in `static/styles.css` around line 2002: `.arena-button` (base),
`.arena-button:disabled` (`opacity: 0.45`), `.arena-button--danger`
(`color-mix(in srgb, var(--coral) 32%, transparent)`), `.arena-button--discard`
(`color-mix(in srgb, var(--gold) 24%, transparent)`). Add `.arena-button--undo` in the same
block, immediately after `--discard`, using an existing theme token — `var(--teal)` /
`var(--glow)` if one exists, otherwise a lower-opacity gold so Undo reads as secondary to
Discard. Grep `:root` in `static/styles.css` for the available custom properties before
picking; **do not invent a hard-coded hex.**

There are two `.arena-button` blocks (~166 and ~2002) plus responsive overrides at ~2626
and ~2875. The one at ~2002 is the live battle-page block — the modifiers live there.
Check the responsive blocks: the action bar wraps on narrow screens, and a fifth button
must not overflow. If the row needs `flex-wrap: wrap` it almost certainly already has it on
`.action-bar` — grep and confirm rather than adding a duplicate rule.

**Ordering in the bar:** Undo goes immediately **before** Discard, so the destructive
End Turn stays rightmost and the two "take it back" affordances sit together.

**Browser verification tooling.** `dev/verify/lib.py` exposes `serving()` (python
http.server on 127.0.0.1:8931) and the Playwright venv is at
`dev/verify/.cache/venv/bin/python` (run `dev/verify/setup.sh` first if `.cache` is
absent). `dev/verify/autoplay_arena.py` and `dev/verify/drive_arena.py` are the existing
battle drivers — copy their structure, do not rebuild one from scratch. The `verify` skill
documents the whole flow.

## Steps

- [ ] 1. **`arena/arena_render.js`** — in `renderStatus` (~853), add the predicate next to
  the other two:

  ```js
        const canUndo = arena.Controller.canUndoAction();
  ```

  and pass it through: `${renderActionButtons(canEnd, canDiscard, canUndo)}`.

- [ ] 2. **`arena/arena_render.js`** — change the signature to
  `renderActionButtons(canEnd, canDiscard, canUndo)` and add the button to the three rows
  that need it, each time immediately before the Discard button:

  ```js
            <button class="arena-button arena-button--undo" type="button" data-action="undo" ${canUndo ? '' : 'disabled'}>Undo</button>
  ```

  In the "not the player's turn" row (~921) render it permanently disabled with no
  `data-action`, matching its neighbours:

  ```js
            <button class="arena-button arena-button--undo" type="button" disabled>Undo</button>
  ```

  Leave the `state.finished` row unchanged.

- [ ] 3. **`static/styles.css`** — add the modifier right after `.arena-button--discard`
  (~2030):

  ```css
  /* Undo command variant: secondary to Discard in the same command group. */
  .arena-button--undo {
      background-color: color-mix(in srgb, var(--gold) 14%, transparent);
  }
  ```

  Swap the token/percentage if grepping `:root` turns up a better-fitting one; the
  requirement is only that Undo is visually distinct from Discard and clearly part of the
  same group.

- [ ] 4. **`static/styles.css`** — check the two responsive `.arena-button` blocks (~2626,
  ~2875) and the `.action-bar` rule. Confirm five buttons still fit at 390px wide without
  the row overflowing horizontally. Only add a rule if it genuinely does not fit.

- [ ] 5. **`tests/arena_render.test.js`** — add a case asserting the markup. The file
  already loads `arena/arena_render.js` over `tests/helpers/arena_env.js`. If
  `renderActionButtons` is not reachable from the test (it is a private function inside the
  IIFE), assert through whatever the file already uses to reach render internals — read the
  existing cases first and follow the same route; if there is no route, skip this step and
  say so in the phase notes rather than exporting new internals just for a test.

- [ ] 6. **`node tests/run_all.js`** — green.

- [ ] 7. **`dev/verify/phase87_battle_undo.py`** — new Playwright driver, modeled on
  `dev/verify/drive_arena.py`. It must:
  - serve the repo via `lib.serving()` and open `game.html`;
  - wait for the player's turn (`lib.STATE_PROBE` reports `phase === 'turn'` and
    `isResolving === false`);
  - assert the Undo button is present and **disabled** at the start of a fresh turn;
  - use an item from hand (or discard a card if no item is in hand — either is a valid
    undoable action), wait for `isResolving` to go false;
  - assert Undo is now **enabled**, record the hand size, click Undo;
  - assert the hand size went back up, the log's newest line starts with `Undid `, and
    Undo is disabled again;
  - screenshot to `dev/verify/phase87_battle_undo.png`.

- [ ] 8. Run the driver: `dev/verify/.cache/venv/bin/python dev/verify/phase87_battle_undo.py`
  and confirm it passes. Leave both the driver and the screenshot committed to the working
  tree (do not `git add`).

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `dev/verify/phase87_battle_undo.py` runs clean and
  `dev/verify/phase87_battle_undo.png` shows the battle with the Undo button in the action
  bar.
- [ ] Manual pass at three viewport widths (390, 720, 1440) — the action bar holds five
  buttons without horizontal overflow, matching how `dev/verify/phase7_battle_*.png` framed
  the earlier responsive audit.
- [ ] Undo is disabled during the rival's turn, during an item animation, and after the
  battle finishes; enabled only after the player commits a card on their own turn.
- [ ] Repeat-undo works end to end in the browser: queue an attack, use an item, discard a
  card, then press Undo three times and confirm the hand and log return to the turn's
  opening state and the button greys out.

## Out of scope / do not touch

`arena/arena_controller.js` and `arena/arena_model.js` (phases 85–86 own the behavior; this
phase only renders and styles). Do not restyle the existing buttons, the action bar layout,
the turn pill, the selected pill, or the event log. Do not add Undo to the post-battle
result row or the pause menu. No data files.
