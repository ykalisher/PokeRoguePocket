# Phase 6 — Theming: neutral restyle + per-location themes

**Prereqs:** phases 2–3 (4–5 recommended but not required). **Read first:**
`00-overview.md`.
**Goal:** kill the green grid look; a clean neutral default on every page; run
pages take the current location's palette and (future) background image, with
palette-derived gradients as the placeholder. Ends green + playable.

## Context you need

- `static/styles.css` (66KB — **Grep only, read targeted ranges**). CSS custom
  properties exist (49 declarations) but are scoped to `.menu-page, .game-page`
  (~87–102): `--felt: #17483d`, `--ink`, `--gold`, `--aqua`, `--muted`,
  `--page-bg` (~94–97: two radial glows over a dark teal-green diagonal
  `linear-gradient(145deg, #163633, #0b1e25 58%, #251b18)`), `--panel-bg` (~98–102:
  fine white grid-line gradients over `--felt` — **this is the "green boxy" look**,
  applied ~115–116 with `background-size: 24px 24px`). Card-sizing tokens on
  `.game-page` (~171–182, includes `--felt-dark`, `--paper`, `--coral`). There is
  NO `:root` block and no theme mechanism. Base body background for plain pages
  ~6–18.
- `area.html`/`capture.html`/`mart.html`/`event.html` bodies do NOT carry
  `.menu-page`/`.game-page` (check each) — they get tokens only after you move the
  token block to `body`.
- Per-page stylesheets layered on top: `static/area.css`, `capture.css`,
  `event.css`, `mart.css` — grep each for hardcoded colors that should become
  token references.
- `map/area.js` and `arena/arena_render.js` re-render by `innerHTML` on a single
  root — anything inside is wiped every state change. `<body>` inline styles and
  attributes survive. THE THEME MUST LIVE ON `<body>`.
- Run pages already load the run synchronously from localStorage early in their
  `init()` (`area.js` ~669, `capture.js` ~33, `mart.js` ~29, `event.js` ~27,
  `game.js` ~19/76) — apply the theme there, BEFORE any `await`, so there's no
  flash of the neutral theme.
- `run.location` (phase 2) snapshots `theme` {accent, glow, surface, bgDeep,
  bgMid} and `background` (path that may not exist yet — the owner adds images to
  `assets/backgrounds/` later; a URL that 404s simply paints nothing).

## Steps

- [ ] 1. **Token restructure (`static/styles.css`).** Move the token block to
  `body` with a neutral slate default and decompose the composites:

  ```css
  body {
      --loc-accent:  #e0b84f;
      --loc-glow:    #4ab0a5;
      --loc-surface: #232f3d;
      --loc-bg-deep: #10161f;
      --loc-bg-mid:  #1b2836;
      --page-bg-image: none;   /* JS sets url(...) when the location has one */

      --gold: var(--loc-accent);
      --aqua: var(--loc-glow);
      --felt: var(--loc-surface);
      --page-bg:
          radial-gradient(circle at 18% 20%,
              color-mix(in srgb, var(--loc-accent) 14%, transparent), transparent 30%),
          radial-gradient(circle at 82% 76%,
              color-mix(in srgb, var(--loc-glow) 13%, transparent), transparent 32%),
          linear-gradient(150deg, var(--loc-bg-mid), var(--loc-bg-deep) 62%);
      --panel-bg: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(0,0,0,0.16)),
                  var(--loc-surface);
  }
  ```

  Delete the grid-line layers and the `background-size: 24px 24px`. Page
  background becomes a 3-layer stack on the page container (or body — follow
  where `--page-bg` is applied today, ~107):
  `linear-gradient(rgba(8,12,18,0.55), rgba(8,12,18,0.72))` scrim,
  `var(--page-bg-image) center / cover no-repeat fixed`, then `var(--page-bg)` —
  a missing/404 image degrades invisibly to the gradient. Keep `--ink`/`--muted`
  and derived colors readable on the new neutral; audit `--felt-dark`, `--paper`,
  `--coral` usages for clashes (grep each). `color-mix()` is acceptable for this
  project's modern-browser target; if it misbehaves in verification, fall back to
  two extra pre-mixed rgba tokens set from JS alongside the others.
- [ ] 2. **`applyLocationTheme(run)` in `map/locations.js`:** no-op unless
  `run?.location?.theme` and `document` exist. Sets the six `--loc-*` /
  `--page-bg-image` inline props via `document.body.style.setProperty` and
  `document.body.dataset.location = id`. `--page-bg-image` gets
  `url("<background>")` only when `background` is set.
- [ ] 3. **Init hooks (one line each)** right after the run loads, before awaits:
  `map/area.js`, `map/capture.js`, `map/mart.js`, `map/event.js`,
  `arena/game.js`. No run / no location → untouched neutral default (index.html,
  overview.html, 404.html never call it).
- [ ] 4. **Per-page CSS token pass:** grep `area.css`/`capture.css`/`event.css`/
  `mart.css` for hardcoded hexes tied to the old green look; convert to token
  references where they should follow the location theme. Targeted — don't
  restyle layouts.
- [ ] 5. **Tests:** `node tests/run_all.js` (locations.js must still load in Node —
  the `document` guard in `applyLocationTheme` keeps arena_env happy; add a tiny
  test that calling it without `document` doesn't throw).

## Verification (verify skill — this phase is judged visually)

1. Screenshots: `index.html` (neutral — no green grid anywhere), then new runs
   until you've captured 3 distinct locations — area, capture, and mid-battle
   game.html for each: palettes visibly differ per location and pages of the same
   run match each other.
2. Battle: trigger several state changes (play cards) — theme survives re-renders.
3. No flash-of-neutral: screenshot immediately on navigation to area.html of an
   ongoing themed run (driver can screenshot early); acceptable = themed from
   first paint.
4. Drop any temporary image file into `assets/backgrounds/` matching one
   location's `background` path, reload → image shows under the scrim, text still
   readable; delete it again → gradient returns, no console error. Do not commit
   the temp image; remove it after the check.
5. Readability spot-check on the lightest palette (frostpeak-pass) and darkest
   (old-boneyard): body text, stat pills, buttons all legible in screenshots.

## Out of scope / do not touch
Layout/alignment fixes (phase 7), battle UI structure, adding real background
images, `arena/arena_render.js` markup.
