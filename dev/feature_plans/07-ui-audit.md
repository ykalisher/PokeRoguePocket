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

- [x] 1. **Audit sweep.** Serve on 8931. Screenshot every page — index, starter,
  area, capture, mart, event, game (idle + mid-battle with statuses and a
  several-entry log) — at three viewports: 1440×900, 1280×720, and short
  1024×600. Save to your scratchpad. Build a written defect list: the 6 knowns
  above (confirm each) + anything new (misaligned labels, overflowing text,
  inconsistent spacing, unreadable contrast). For each: symptom, page/viewport,
  suspected selector.
- [x] 2. **Fix pass.** Work the list, most-visible first. Guidance for the knowns:
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
- [x] 3. **Re-verify.** Re-screenshot the full matrix from step 1; every fixed
  defect gets a before/after pair. Play one full battle by driver at 1280×720 —
  no overlap, all info readable, no console errors. `node tests/run_all.js`
  green.
- [x] 4. **Report.** End your session by writing the defect list with
  fixed/deferred status into this file (below), so the owner sees what changed
  and what was judged out of scope.

## Audit results (completed 2026-07-14)

Audited 9 pages (index, starter, area, capture, mart, event, game idle,
game mid-battle with 4 staged statuses + long log + long trainer name,
overview) × 3 viewports (1440×900, 1280×720, 1024×600), plus a 1280×560
wide-short probe. Before/after evidence pairs for the battle screen (1440/720/
560/stacked-600) and the mart are committed as `dev/verify/phase7_*.png`.
Verified end-to-end: full driver battle at 1280×720 to victory with zero
console errors; `node tests/run_all.js` green.

### Known defects — all 6 fixed

| # | Defect | Status / fix |
|---|--------|--------------|
| 1 | Back button covered the opponent name ("Rival"/long names hidden) at every wide viewport | **Fixed.** Wide mode reserves 70px (`.side-panel--opponent .side-status { padding-left }`); stacked mode already had 62px top padding. |
| 2 | `.arena-popup` toast at top-center covered the opponent hand/pills | **Fixed.** Wide mode re-anchors it bottom-right over the log tail (never over interactive cards); stacked keeps top-center, which sits in the reserved top padding. |
| 3 | Battle log cramped (~8 lines) while half the controls column sat empty | **Fixed.** `.arena-status` now spans both grid rows (`grid-row: 1 / -1`, rows `auto auto auto minmax(0,1fr)`) and the log fills all leftover height (~24 lines at 900px). Newest entry is emphasized (`li:first-child` bright + bold). Stacked log window raised 120px→190px. |
| 4 | Long player/trainer names wrapped and collided instead of truncating | **Fixed.** `.side-title` truncates with ellipsis (`min-width:0` + nowrap), counters no longer shrink (`.side-stats { flex-shrink:0 }`), and the renderer adds `title="…"` for hover recovery. |
| 5 | Wide layout broke at short heights: controls panel (z-25) bled over player pills, board/pile rows overflowed onto headers and hands, 4th hand card clipped (1280×560; pile-over-pill overlap visible even at 1280×720) | **Fixed.** Three parts: (a) full-height controls column can no longer bleed (see #3) and the player panel is `grid-column: 1`; (b) wide token dvh terms retuned (`--card-w` 15.2→11.8dvh etc.) so panels fit 100dvh down to ~720px; (c) new `@media (min-width:1100px) and (max-height:720px)` block clamps cards/piles/hands further and scales card interior text with them. `.side-status` is also lifted (`position:relative; z-index:3`) so any residual overflow can never hide the counters. |
| 6 | Status tokens tiny (12–16px) low-contrast cream dots; HP/stat text ~7px | **Fixed.** Base tokens 15–20px (wide 20–28px), near-opaque background, stronger border, and per-status color tints (`.status-token--burn/poison/sleep/paralysis/confusion/flinch`). Health/stat text raised 0.46→0.56/0.54rem (stacked 0.4→0.46rem) with darker ink; health track 5→6px. |

### New defects found in the sweep

| ID | Defect | Status / fix |
|----|--------|--------------|
| A | Stacked battle (1024×600): full-width stretched "Round"/"selected" pill bars | **Fixed.** `justify-items: center` on the stacked `.arena-status`; pills keep natural width. |
| B | Mart "Your Pokemon" mini-cards: name printed over clipped stat text | **Fixed.** The 72px picker cards re-scope `--card-w`/`--card-h` so portrait/name/stats scale with the card, plus compact interior text sizes (`static/mart.css`); same token scoping applied to `.mart-pc-card`. |
| C | Starter page "Menu" button rendered as a full-width bar (`.menu-page .btn { width:100% }` beat `.btn-back`) | **Fixed.** `.menu-page .btn-back { width: auto }`. |
| D | Index title overflowed the menu panel's content box, skewing the whole column ~22px right | **Fixed.** Title font capped at 3.75rem so "POKEMON" fits the content box; column centering verified by element measurement. |

### Deferred / accepted

- **Stacked mode at ≤600px heights still scrolls vertically** to reach the
  player hand (opponent panel + controls fill the fold). The stacked flow is
  a scrolling layout by design; compressing it enough for 600px would mean a
  layout redesign, which is out of scope. Desktop wide mode (≥1100px) now fits
  every tested height without scrolling.
- **3-digit stats on the smallest stacked cards** (e.g. "ATK 125" at 46–68px
  card width) can touch the card edge. Text was raised from unreadably small;
  further growth would overlap columns. Acceptable at phone sizes.
- Pile discard previews on very short wide viewports clip long attack names
  mid-word; the pile now carries a `title` tooltip with the full pile label.

### Mobile follow-up sweep (owner request, same session)

Re-ran the full page matrix at phone sizes — 390×844, 375×667 portrait and
844×390 landscape — after the desktop fixes landed. Evidence:
`dev/verify/phase7_phone_390_before/after.png`.

| ID | Defect | Status / fix |
|----|--------|--------------|
| M1 | Counter pills ran off the right edge on phones — a regression from fix #4's `flex-shrink:0` on `.side-stats`, which stopped the pill group wrapping | **Fixed.** The no-shrink rule is now scoped to the wide (≥1100px) block; narrow layouts wrap the pills again. |
| M2 | A long trainer name forced ~150px of horizontal page overflow in the stacked battle layout (nowrap title min-content propagated through the grid) | **Fixed.** `min-width: 0` on `.side-panel` and `.side-status`; verified zero horizontal scroll at 390px through idle → attacks → long-name staging. |
| M3 | With pills crowding the header, the short player title squeezed to "Y…" | **Fixed.** `.side-title` gets a 3.5em floor before truncation kicks in. |
| M4 | ≤380px block dropped card HP/stat text to 0.32rem (~5px, unreadable) and action-card meta to 0.3rem | **Fixed.** Raised to 0.44rem / 0.36rem, in line with the other text bumps. |

Non-defects confirmed by design: the area map pans horizontally on narrow
screens (`overflow-x: auto` viewport), and the stacked battle page scrolls
vertically on phones (same accepted residual as 1024×600). Mart, starter,
capture, event, index, and overview all lay out cleanly at both portrait
sizes. Verified end-to-end with a full driver battle at 390×844: victory,
zero console errors, zero horizontal overflow.

### Files touched

- `static/styles.css` — all layout/token/status/log/menu changes.
- `static/mart.css` — mini-card and PC-card token scoping + compact text.
- `arena/arena_render.js` — two attribute-only changes (`title` on
  `.side-title` and on pile cards); no markup structure changed.

## Out of scope / do not touch
Layout redesigns, new UI features, renderer architecture (the innerHTML pattern
stays), theming tokens (phase 6 owns them — reuse, don't rework), gameplay logic.
