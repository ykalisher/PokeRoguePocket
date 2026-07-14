# Post-launch mobile-polish — batch overview (sessions 09–14)

The 00–07 development plan shipped. After play-testing (mostly on iPhone/Safari), the
owner filed a batch of feedback — a mix of tiny changes (remove a label, remove a
button) and larger UX problems (mobile hand shows only 4 cards, battle log grows
unbounded, event screens can't scroll, touch/drag unreliable).

This batch (`09`–`14`) breaks that feedback into **discrete, self-contained sessions**,
each completable on its own. Sessions 09–13 are scoped for less-powerful models;
session 14 is an investigation earmarked for a stronger model.

## Sessions

| File | What | For |
|------|------|-----|
| `09-game-flow-polish.md` | Remove starter titles; show location types; start-over runs full new-game | any model |
| `10-battle-chrome-removal.md` | Remove the battle "Back" button and the "Your Hand" label | any model |
| `11-mobile-hand-and-log.md` | Fit ~6 hand cards on a phone; give the battle log a fixed, scrollable height | any model (visual) |
| `12-event-and-page-scroll.md` | Fix event screens that can't scroll; audit the other page shells | any model |
| `13-tap-to-deselect.md` | Tapping a selected card deselects it (works for touch + mouse) | any model |
| `14-ios-drag-touch-reliability.md` | iOS drag not firing / input dead at turn start — investigation | **stronger model** |

**Order & dependencies:** 09 is independent. Do **10 before 11** (removing the hand
label frees the horizontal space 11 tunes). 11 and 12 are independent. 13 is
independent. Do **14 last**, once the layout is stable.

## Shared conventions (every session inherits these)

- **Line numbers are hints, not addresses.** Anchors in these docs were captured
  2026-07-14. Earlier sessions edit the same files (`static/styles.css`,
  `arena/arena_render.js`), so **find each edit by the quoted search string / CSS
  selector**, then confirm the surrounding code matches before editing.
- **Keep tests green.** Run `node tests/run_all.js` after every change (syntax-checks
  all tracked JS + runs the suite, ~3s). A PostToolUse hook also `node --check`s each
  edit automatically.
- **Visual / mobile sessions use the `verify` skill.** Serve with
  `python3 -m http.server 8931 --bind 127.0.0.1` from the repo root; drive battles with
  the committed drivers in `dev/verify/`; screenshot at phone sizes **390×844** and
  **375×667** (portrait). `window.CardArena.state` exposes live battle state for staging
  scenarios (long logs, full hands). Stop the server with
  `pkill -f "http.server 8931"`.
- **Keep the render architecture.** Each screen re-renders by overwriting `innerHTML`
  on a persistent container, with a **single delegated** event listener attached once
  (`arena/game.js`, `map/event.js`, `map/area.js`, …). This survives every re-render, so
  **do not** re-attach listeners per render or add stateful widgets that a full re-render
  would reset (focus/scroll are reset on render). Prefer CSS; keep renderer markup
  changes minimal.
- **Don't touch:** `scripts/manage_*` (owner-only interactive CLIs), `TODO.md` (owner's
  planning file), or the original `00`–`07` plan docs. Edit JSON data directly if
  needed and validate with `node tests/run_all.js`.
- **No new dependencies** — plain JS/HTML/CSS only. `tests/` may use Node built-ins;
  `dev/verify/` may use Python+Playwright (both dev-only, already approved). Nothing
  the browser loads may add a framework, CDN, or third-party runtime dependency.

## Definition of done (per session)

Each session ends with `node tests/run_all.js` green, the specific verification in its
doc completed, and — for the visual sessions — before/after screenshots saved to your
scratchpad. Do not commit unless the owner asks.
