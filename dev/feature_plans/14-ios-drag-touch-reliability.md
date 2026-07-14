# Session 14 — iOS drag & touch-input reliability  (INVESTIGATION)

**Read `08-post-launch-overview.md` first.** **This is not a known one-line fix, and it
is not for a less-powerful model.** It is an open investigation into intermittent
touch/drag failure on iOS Safari. Do it **last**, after sessions 09–13 have stabilised
the layout.

**Reproduce before you change anything.** Confirm the failure on a **real iOS Safari
device** if at all possible, or best-effort via the `verify` skill's Playwright touch
emulation. Expect several iterations and on-device re-confirmation — do not assume a
candidate fix worked without seeing it work on a touch device.

---

## Symptoms to reproduce

1. **Drag-and-drop of a hand card does not work** on iPhone Safari (the arena drag uses
   Pointer Events, which *should* be iOS-compatible — so there is a real defect here, not
   just an API-choice problem).
2. **Touch/scroll interactions are inconsistent** — sometimes completely dead right when
   a battle starts or a new turn begins, then start working again later.

---

## Candidate root causes (investigate each; confirm with evidence before fixing)

1. **No pointer capture.** `arena/arena_drag.js`, `handlePointerDown` (search it) never
   calls `setPointerCapture`. On iOS the pointer stream can be lost mid-gesture without
   it. Try `el.setPointerCapture(e.pointerId)` on drag start (and release on end).

2. **Missing touch-callout / user-select suppression.** In `static/styles.css`,
   `.hand-card` has `touch-action: none` (search `touch-action`) but there is **no**
   `-webkit-touch-callout: none` / `-webkit-user-select: none` anywhere (grep the repo to
   confirm). Without them, iOS long-press callout/text-selection can hijack the drag.
   Add both to `.hand-card`, and confirm no ancestor re-enables panning that would steal
   the gesture.

3. **Stuck state gates at turn/battle start.** In `arena/arena_controller.js`,
   `canPlayerAct()` / `canPlayerSelectCard()` (search them) gate on `state.isResolving`
   and `state.phase`. If a resolve/animation promise never settles on mobile — e.g. a
   `transitionend`/`animationend` that never fires because the animation was interrupted
   or the tab was backgrounded — `state.isResolving` stays `true` and **all input goes
   dead** until something else clears it. Audit the resolve/animation flow for any path
   that can hang on mobile and guard it (a timeout/fallback that always clears
   `isResolving`). This is the most likely cause of "dead at turn start".

4. **Stuck `suppressNextClick`.** In `arena/arena_drag.js` it is set on drag end (search
   `suppressNextClick`) and consumed in the controller's click handler. An aborted or
   `pointercancel`-terminated drag could leave it set and swallow the *next* legitimate
   tap. Ensure every drag termination path (including `pointercancel`) resets it
   correctly.

5. **The mart still uses HTML5 drag.** `map/mart.js` (search `dragstart`, `dataTransfer`,
   `draggable`) uses the HTML5 drag API, which iOS Safari **ignores entirely** — so
   shop drag is broken on iPhone regardless of the above. Migrate it onto the existing
   pointer-based drag engine (`arena.Drag` in `arena/arena_drag.js` — search its public
   surface / how `arena/game.js` wires `pointerdown`/`pointermove`/`pointerup`) so drag is
   iOS-safe and consistent everywhere. This is the largest sub-task; it can be split into
   its own follow-up if needed.

---

## Deliverable

- Written reproduction notes (device/emulator, exact steps, which symptom).
- The actual fixes for whichever causes are confirmed.
- Re-verification on a touch device (or emulation) showing the symptom gone.
- Keep the delegated-listener + `innerHTML` re-render architecture intact.

## Verify

- [ ] Reproduce each symptom first; record how.
- [ ] After fixes: on a real iPhone Safari if available (else `verify` touch emulation),
      drag a hand card to a valid target successfully; play several turns with **zero**
      dead-input; drag in the mart works.
- [ ] `node tests/run_all.js` green. Full driver battle to a result with no console
      errors.

## Out of scope
Layout/CSS changes owned by sessions 10–12; tap-to-deselect (session 13); a rewrite of
the drag engine beyond what's needed to make it reliable and to bring the mart onto it.
