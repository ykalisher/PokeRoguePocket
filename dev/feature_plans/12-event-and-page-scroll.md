# Session 12 — Event & page scroll fix

**Recommended agent:** Sonnet · low effort

**Read `08-post-launch-overview.md` first.** A focused CSS fix plus a short audit of the
other page shells.

**Goal:** tall event screens (notably the "wandering trainer") scroll so every choice
button is reachable on a phone; confirm no other page has the same "can't scroll" trap.

---

## Root cause

The global `body` is locked to the viewport in `static/styles.css` (search
`overflow: hidden` near the top `body` rule — it sets `height: 100vh; overflow: hidden`).
That lock is only lifted for `.menu-page, .game-page` (search `.menu-page, .game-page`).

The event page's body class is **`.event-page`** (see `event.html`), and
`static/event.css` (search `.event-page`) sets `min-height: 100dvh` but **never restores
`overflow`/`height`**. So on a tall event the content is clipped at viewport height with
no way to scroll. This is worst on the trainer event: below ~860px the two-column stage
collapses to one column, stacking the sprite + paragraphs + the "Battle" choice card +
the "Pay" choice card, which overruns a phone screen — and the buttons at the bottom
become unreachable.

---

## Fix

- File: `static/event.css`. Give the event page a real scroll. On `.event-page` (or, if
  cleaner, on the inner `.event-shell` container), set:
  ```css
  height: auto;
  overflow-y: auto;
  ```
  Keep `min-height: 100dvh` so the background still fills the screen. If you scroll the
  inner `.event-shell` instead of the body, make sure that element is allowed to grow and
  scroll (it must not be height-capped by an ancestor).

**Check:** open a trainer event at 390×844 (see staging below) — the whole event scrolls
and the **Battle**/**Pay** buttons are reachable.

---

## Audit the other page shells (report findings in this doc)

The same body-lock exists for any page shell that doesn't restore overflow and has no
inner scroller. Check each and fix any that clip on a phone:

- `.area-page` (`static/area.css`, search `.area-page`) — uses `overflow: hidden`
  **by design** with inner scroll containers (the map pans). **Leave it.**
- `.capture-page`, `.mart-page`, `.starter-page`, `.overview-page` — for each, confirm it
  either restores `overflow: auto; height: auto` **or** has an inner scroll container.
  Fix any that clip; note "OK — inner scroller" or "fixed" for each below.

Findings (fill in when done):

| Page shell | Verdict |
|------------|---------|
| `.event-page`  | fixed (this session) — added `height: auto; display: block; overflow: auto;`, matching `.capture-page`/`.mart-page` |
| `.area-page`   | OK by design (inner scrollers) |
| `.capture-page`   | OK — already has `min-height: 100dvh; height: auto; display: block; overflow: auto;` |
| `.mart-page`   | OK — already has `min-height: 100dvh; height: auto; display: block; overflow: auto;` |
| `.starter-page`   | OK — inherits `.menu-page`'s `height: auto; overflow: auto` (body class is `menu-page starter-page`) |
| `.overview-page`   | OK — actual class is `.card-overview-page`, body is `game-page card-overview-page`; inherits `.game-page`'s `height: auto; overflow: auto` |

---

## Verify

Use the `verify` skill. To force a tall trainer event, drive to an event node in the
overworld, or open `event.html` for a run whose active event is a trainer event
(inspect / stage via the run state the drivers expose). At 390×844:

- [x] The trainer event scrolls; **Battle** and **Pay** are both reachable. Verified with
  `team-rocket-ambush` (type `trainer`) at 375×667 and 390×844: before the fix a real wheel
  gesture left `scrollTop` at 0 and the Battle button sat below the viewport; after the fix
  the same gesture scrolls the page and the button lands fully on-screen. Note: no event in
  `events.json` currently defines a `payment` block, so `renderTrainerActions` never emits a
  **Pay** card today (`map/event.js:386`, conditional on `paymentAction`) — the fix makes the
  page scrollable regardless of how many choice cards render, so Pay will be reachable too
  whenever an event adds one.
- [x] No horizontal page overflow. Confirmed `scrollWidth === clientWidth` (390/375) on the
  event page in both before/after checks.
- [x] Re-check area / capture / mart / starter / overview at 390×844 — none clip content.
  Confirmed via headless probe: `.capture-page`, `.mart-page`, `.starter-page` (via
  `.menu-page`), and `.card-overview-page` (via `.game-page`) all report
  `overflowY: auto` with `scrollHeight > clientHeight` and no horizontal overflow;
  `.area-page` intentionally keeps `overflow: hidden` with inner scroll containers.
- [x] `node tests/run_all.js` green (64/64 pass). Before/after screenshots of the trainer
  event saved to the session scratchpad (`before_wheel_top.png`, `after_wheel_scrolled.png`).

## Out of scope
Redesigning the event layout or the trainer event's two-column stage; changing which
events exist; battle-screen scrolling (that is sessions 10–11).
