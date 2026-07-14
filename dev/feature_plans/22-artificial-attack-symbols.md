# Phase 22 — Artificial-attack effect symbols

**Recommended agent:** Opus · medium effort
**Prereqs:** none. **Read first:** `18-mechanics-symbols-roster-overview.md`.
**Goal:** The four artificial-attack effects render a proper icon on their action card instead
of the current 2-letter text fallback. Ends green + visibly iconed.

## Context you need

- Anchors are hints captured 2026-07-14; find by function name.
- **The four effects with no icon:** statuses `EXTRA_ATTACK`, `EXTRA_ITEM`,
  `INCREASE_CAPACITY`, `REFRESH_DECK` (the ARTIFICIAL trainer-effect attacks — "Energize",
  "Recycle", "Increase Capacity", "Refresh" in `attacks.json` ~`:1260-1299`). They are the
  only statuses truly rendered as text (`FULL_HEAL` looks iconless but is aliased to existing
  icons via `ACTION_STATUS_ICON_ALIASES`, so leave it alone).
- **Why they show as text.** `renderActionStatusIcons(...)` (`arena/arena_render.js` ~`:629-670`)
  asks `arena.Model.getStatusIconPath(status)` (`arena/arena_model.js` ~`:1168`), which returns
  `''` for any status missing from `STATUS_DEFINITIONS` (~`:58-82`). On `''` the renderer falls
  into the text-badge branch (~`:657-659`, `getStatusInitials` → e.g. `EA`, `EI`, `IC`, `RD`).
  **Once a status has both an icon file and a `STATUS_DEFINITIONS` entry, the renderer
  auto-switches to `<img>` — no render-code change is needed.**
- **Icon convention.** `assets/status-icons/<STATUS_TOKEN>.svg` (or `.png`; the folder mixes
  both), filename = the exact uppercase status token. Existing effect-only reference:
  `MULTI_ATTACK` → `arena/arena_model.js:74` (`assets/status-icons/MULTI_ATTACK.png`,
  `label:'Multi Attack'`, `showsToken:false`). Style reference for a clean hand-authored SVG:
  `assets/status-icons/BURN.svg` (small viewBox, monochrome, simple paths).
- **Label source.** The `label` in the `STATUS_DEFINITIONS` entry feeds the badge tooltip/alt
  text. Match the wording in the on-screen glossary `ACTION_EFFECT_REFERENCE`
  (`arena/arena_render.js` ~`:74-77`) so the icon's tooltip and the reference agree.
- Data validation enumerates these four in `tests/data_validation.test.js` (~`:14`,
  `ARTIFICIAL_ATTACK_STATUSES`) — do not rename the tokens.

## Steps

- [ ] 1. **`assets/status-icons/`** — hand-author four SVG icons, filenames exactly:
  `EXTRA_ATTACK.svg`, `EXTRA_ITEM.svg`, `INCREASE_CAPACITY.svg`, `REFRESH_DECK.svg`. Keep them
  simple, monochrome, and sized like `BURN.svg` (consistent viewBox / visual weight). Pick
  legible metaphors, e.g.: Extra Attack → a "＋" over a fist/burst; Extra Item → a "＋" over a
  bag/potion; Increase Capacity → up-arrow into a hand/box; Refresh Deck → a recycle/refresh
  arrow-loop over a card stack. Author the SVG markup directly (no external image tool).
- [ ] 2. **`arena/arena_model.js`** — add one `STATUS_DEFINITIONS` entry per token in the
  `:58-82` block, mirroring `MULTI_ATTACK`:
  ```js
  EXTRA_ATTACK:      { iconPath: 'assets/status-icons/EXTRA_ATTACK.svg',      label: 'Extra Attack',      showsToken: false },
  EXTRA_ITEM:        { iconPath: 'assets/status-icons/EXTRA_ITEM.svg',        label: 'Extra Item',        showsToken: false },
  INCREASE_CAPACITY: { iconPath: 'assets/status-icons/INCREASE_CAPACITY.svg', label: 'Increase Capacity', showsToken: false },
  REFRESH_DECK:      { iconPath: 'assets/status-icons/REFRESH_DECK.svg',      label: 'Refresh Deck',      showsToken: false }
  ```
  `showsToken:false` keeps them off the on-Pokémon persistent-token row (they are action-card
  effect badges, like `MULTI_ATTACK`).
- [ ] 3. **Sanity** — confirm no other code special-cased these tokens' text badge; the badge
  now becomes an `<img>` automatically through `renderActionStatusIcons`.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill (serve on 8931): view the four artificial attacks (Energize, Recycle,
  Increase Capacity, Refresh) in hand / card detail → each shows its new icon, not the
  `EA`/`EI`/`IC`/`RD` text badge. Icons read clearly at the small badge size (screenshot to
  scratchpad). The on-Pokémon status row is unchanged.

## Out of scope / do not touch

Do not touch `FULL_HEAL`/`ACTION_STATUS_ICON_ALIASES` or existing icons, do not rename the
status tokens, and do not change `renderActionStatusIcons` logic (the auto-switch already
handles it). No new item/effect behavior. Inherit all batch ground rules from
`18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`, no
`TODO.md`, run `node tests/run_all.js` after every change).
