# Phase 7 — Screenshot-driven UI audit + targeted fixes

**Prereqs:** phase 6 (audit the new look, not the old). **Read first:**
`00-overview.md`.
**Goal:** systematically find and fix layout/clarity defects across the game.
**Targeted fixes only — no layout redesign.** The owner's complaints: misaligned
text, "janky" battle interactions, and information displayed in unclear /
hard-to-see ways. Ends green + playable.

## Known defects (verified against code — start here)

| # | Defect | Where |
|---|--------|-------|
| 1 | `.btn-back` is `position: fixed; top:14px; left:14px; z-index:20` and overlaps the opponent panel's counters on small screens | `static/styles.css` ~188–198 |
| 2 | `.arena-popup` toast is fixed at `top:18px` and overlaps the opponent hand on short viewports | `styles.css` ~1849–1854 |
| 3 | `.event-log` is cramped (`width: min(28vw,360px); max-height: min(24dvh,180px)`) — battle info scrolls out of view almost immediately | `styles.css` ~1827–1843 |
| 4 | `.side-title` / `.stat-pill` have no truncation — long player/trainer names overflow the header row | grep the classes |
| 5 | `.game-board` rows (`1fr auto 1fr` under `min-height:100dvh`) compress and clip cards on short viewports | `styles.css` ~203–208 |
| 6 | Status tokens / HP tracks on cards are small and low-contrast (owner: "hard to see") | `arena/arena_render.js` `renderBoardSlot`/`.health-row`/`.status-token-row` + their CSS |

## Facts you need

- Battle markup is built entirely in `arena/arena_render.js` `render()` (~103) —
  one `innerHTML` per state change; DOM structure documented by grepping the class
  names (`.side-panel`, `.side-status`, `.stat-pill`, `.battle-row`,
  `.played-slots`, `.board-slot`, `.hand-row`, `.arena-status`, `.event-log`).
  Fixes should prefer CSS; renderer markup changes are allowed when CSS alone
  can't fix clarity (e.g. adding a title attribute or an aria/label span), but
  keep them minimal — the full re-render resets focus/scroll, so don't introduce
  stateful widgets.
- The drivers in `dev/verify/` can start battles, play cards, and screenshot;
  `window.CardArena.state` exposes battle state for setting up specific scenarios
  (statuses, long logs, full hands).
- `node tests/run_all.js` after every change, as always.

## Process (follow in order)

- [ ] 1. **Audit sweep.** Serve on 8931. Screenshot every page — index, starter,
  area, capture, mart, event, game (idle + mid-battle with statuses and a
  several-entry log) — at three viewports: 1440×900, 1280×720, and short
  1024×600. Save to your scratchpad. Build a written defect list: the 6 knowns
  above (confirm each) + anything new (misaligned labels, overflowing text,
  inconsistent spacing, unreadable contrast). For each: symptom, page/viewport,
  suspected selector.
- [ ] 2. **Fix pass.** Work the list, most-visible first. Guidance for the knowns:
  1. Reserve space for the back button (e.g. padding on the opponent panel) or
     move it into the page flow at small sizes — must never cover counters.
  2. Reposition/re-anchor the toast (e.g. bottom-center on short viewports) so it
     never covers interactive cards.
  3. Give the log more room and/or a clearer visual hierarchy (recent entry
     emphasized); keep it scrollable, `overflow-wrap` intact.
  4. `text-overflow: ellipsis` + `min-width: 0` in the right flex/grid spots;
     add `title` attributes in the renderer if truncation hides info.
  5. Let card tokens clamp further on short viewports (they already use
     vw/dvh clamps — extend the clamp floor) instead of clipping.
  6. Increase status-token/HP contrast and size within the existing card design
     (tokens already have per-status classes — grep `.status-token--`).
- [ ] 3. **Re-verify.** Re-screenshot the full matrix from step 1; every fixed
  defect gets a before/after pair. Play one full battle by driver at 1280×720 —
  no overlap, all info readable, no console errors. `node tests/run_all.js`
  green.
- [ ] 4. **Report.** End your session by writing the defect list with
  fixed/deferred status into this file (below), so the owner sees what changed
  and what was judged out of scope.

## Audit results (fill in during the phase)

_pending_

## Out of scope / do not touch
Layout redesigns, new UI features, renderer architecture (the innerHTML pattern
stays), theming tokens (phase 6 owns them — reuse, don't rework), gameplay logic.
