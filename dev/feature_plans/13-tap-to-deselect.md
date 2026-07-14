# Session 13 — Tap-to-deselect (touch + mouse)

**Read `08-post-launch-overview.md` first.** A small, well-scoped controller change. No
touch-specific code is needed — selection already runs through a delegated `click`
handler, which fires for both mouse and touch.

**Goal:** tapping/clicking a card that is already selected **deselects** it (same as the
Cancel button), including while an attack is mid-selection.

---

## Root cause

Today, deselect only works via the explicit **Cancel** button
(`data-action="cancel-action"`, handled in `arena/arena_controller.js` →
`cancelActionSelection()` — search both). Tapping the same card again does nothing:

- `selectPlayerCard()` / `beginAttackUserSelection()` (search them in
  `arena/arena_controller.js`) have no "already selected?" toggle, and
- once an attack is picked, `state.phase` leaves `'turn'`, so `canPlayerSelectCard()`
  (search `function canPlayerSelectCard`) returns false and blocks the re-tap entirely.

So the fix has two requirements: add the toggle, **and** let the toggle run even when
phase is `'selecting-attack-user'` / `'selecting-attack-target'`.

---

## Fix

In `arena/arena_controller.js`, in the card-tap path (search `handleArenaClick` — the
delegated click handler — and the branch that leads to `selectPlayerCard`):

1. Before the normal selection logic and **before** the `canPlayerSelectCard()` gate,
   add a toggle check: if the tapped card's id equals the currently
   selected/pending card, cancel instead of re-selecting.
   ```js
   const tappedId = /* the data-card-id from the clicked element */;
   if (tappedId && (tappedId === state.selectedCardId || tappedId === state.pendingActionCardId)) {
       cancelActionSelection();
       return;
   }
   ```
   Placement matters: the existing Cancel button handler already works in the
   attack-selection phases — mirror where that branch sits relative to the phase gate so
   the toggle is reachable in those phases too.
2. **Reuse `cancelActionSelection()`** — do not write new cancel/reset logic. It already
   clears `state.selectedCardId` / `state.pendingActionCardId` and returns phase to
   `'turn'`.
3. **Do not disturb** the `suppressNextClick` handling (search `suppressNextClick` in
   `handleArenaClick`) — it prevents a completed drag from being read as a tap; the
   toggle must sit after that guard so a drag-drop isn't misread as a deselect.

Because this is on the delegated `click` handler, it works for touch and mouse with no
extra code.

---

## Verify

**Node test** — extend the suite (`tests/helpers/arena_env.js` boots the engine in Node;
follow an existing controller test for the pattern):

- [ ] Select an attack card; assert something is selected and phase is not `'turn'`.
- [ ] Trigger selection on the **same** card id again; assert selection is cleared and
      phase is back to `'turn'`.

**Interactive** — `verify` skill:

- [ ] Click a card to select, click it again to deselect (desktop).
- [ ] Repeat on a touch-emulated viewport (tap to select, tap again to deselect).
- [ ] Selecting a *different* card still switches selection normally; the Cancel button
      still works; a drag-and-drop is not misread as a deselect.

- [ ] `node tests/run_all.js` green.

## Out of scope
Any change to how attacks resolve or target; drag reliability (that is session 14);
adding touch-specific listeners (the delegated click already covers touch).
