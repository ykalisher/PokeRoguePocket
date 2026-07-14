# Session 16 — Active-attack deck highlight

**Recommended agent:** Sonnet · medium effort

**Standalone feature** (not part of the 08–14 mobile-polish batch). Overworld deck-viewing UI only; plain JS + CSS. Validate with `node tests/run_all.js` and the `verify` skill.

## Context / why
In the overworld the player opens the **Action Deck** window (deck button in the HUD) to review cards. The game auto-sorts attack cards into two buckets: the **active deck** (`collections.actions`) — attacks a non-bench Pokémon can use, which enter your battle draw pile — and the **attack bench** (`collections.bench.actions`) — attacks no active Pokémon can currently use. Today the window shows ONLY the active bucket; benched attacks are invisible, and there is no cue for which attacks are active.

**Goal:** In the Action Deck window, (a) give active attack cards a highlight, and (b) add a separate "Benched" subsection listing benched attacks. Ends green + playable.

## Context you need
- All required edits are in `map/area.js` (the overworld page) + one CSS rule in `static/area.css`. Line numbers below are hints captured 2026-07-14 and WILL drift — relocate by the named function / search string.
- Render path: `renderCardWindow()` (~area.js:458) → `renderActionCardSections(cards)` (~area.js:608) → `renderCardSection(title, cards)` (~area.js:618) → `renderCardGrid(cards)` (~area.js:630). Cards render through `arena.Render.renderCardPreview(card, { className, attributes })` (arena/arena_render.js:762); the `className` option is how you add a highlight class.
- `cards` passed to `renderActionCardSections` comes from `getCardWindowCards()` (~area.js:638) = ONLY `state.collections.actions` (active deck + items). Benched attacks live in `state.collections.bench.actions` and are NOT in that list.
- `state.collections` is `state.run.collections` (set ~area.js:202). Shape: `{ actions:[...], bench:{ actions:[...], pokemon:[...] }, pokemon:[...] }`. `bench.actions` holds attack cards only (items are promoted back to `actions` by run_state).
- Already available: `arena.Model.isAttackCard`, `arena.Model.isItemCard`, `arena.Model.getCardName`, and the local `compareCardsByName`.
- "Active" = **deck membership**: attacks in `collections.actions` are active; attacks in `collections.bench.actions` are benched. (Matches the battle draw pile and what the auto-bench mechanic enforces — no per-Pokémon recompute needed.)
- Highlight styling reference: `.overview-card.is-type-match` (gold outline, static/styles.css:1725). Prior art for a class-toggle highlight: `arena/card_overview.js:103-125`.

## Steps

### 16a. Helper to fetch benched attack cards
In `map/area.js`, near `getBenchPokemon()` (~area.js:644), add:
```js
function getBenchedAttackCards() {
    const bench = state.collections.bench;
    const cards = bench && Array.isArray(bench.actions) ? bench.actions : [];
    return cards.filter(arena.Model.isAttackCard);
}
```

### 16b. Highlight active attacks + add a "Benched" section
Replace `renderActionCardSections` (~area.js:608):
```js
function renderActionCardSections(cards) {
    const attacks = cards.filter(arena.Model.isAttackCard).sort(compareCardsByName);
    const items = cards.filter(arena.Model.isItemCard).sort(compareCardsByName);
    const benched = getBenchedAttackCards().slice().sort(compareCardsByName);

    return [
        renderCardSection('Attacks', attacks, { highlight: true }),
        benched.length > 0 ? renderCardSection('Benched', benched) : '',
        renderCardSection('Items', items)
    ].join('');
}
```
Thread an `options` arg through `renderCardSection` (~area.js:618) and `renderCardGrid` (~area.js:630) so active attacks get a highlight class:
```js
function renderCardSection(title, cards, options = {}) {
    return `
        <section class="area-card-section">
            <header class="area-card-section-header">
                <h3>${title}</h3>
                <span>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</span>
            </header>
            ${renderCardGrid(cards, options)}
        </section>
    `;
}

function renderCardGrid(cards, options = {}) {
    const extraClass = options.highlight ? ' is-active-attack' : '';
    return `
        <div class="area-card-grid">
            ${cards.map(card => arena.Render.renderCardPreview(card, { className: `area-card-preview${extraClass}` })).join('')}
        </div>
    `;
}
```
`renderCardGrid` is also called by the Pokémon window (`renderCardWindow` → `renderCardGrid(cards)`) with no second arg, so `options` defaults to `{}` and those cards are unaffected. Only the "Attacks" (active) section passes `{ highlight: true }`; the "Benched" section does not.

### 16c. Highlight CSS
In `static/area.css`, near `.area-card-grid .playing-card` (~area.css:659), add a gold outline that does NOT shift layout:
```css
.area-card-grid .area-card-preview.is-active-attack {
    outline: 3px solid color-mix(in srgb, var(--gold) 86%, transparent);
    outline-offset: 2px;
    border-radius: 8px;
}
```
(Same `--gold` accent as `.overview-card.is-type-match`; no `transform`, so the grid does not reflow.)

### 16d. (Recommended) Mirror to the encounter deck windows
The same deck-window overlay is duplicated in `map/capture.js`, `map/event.js`, `map/mart.js` — each has its own `renderActionCardSections`/`renderCardGrid`-style copy (grep each for `area-card-grid` / `renderCardGrid`). Apply the SAME change (benched "Benched" section from `state.collections.bench.actions` + `is-active-attack` on active attacks; the 16c CSS is global so it already applies). If a file renders a flat grid with no Attacks/Items split, adapt: still append a "Benched" section and highlight the active attacks. Do `area.js` first, verify it, then repeat. Skip any of these three only if its deck window does not render attack cards.

## Verify
- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill (serve on 8931): open `area.html` in a run that has benched attacks (start a run, capture until the active roster hits 6 and you own an attack no active Pokémon can use → it gets benched). Open the Action deck: active attacks show a gold outline; a "Benched" section lists benched attacks. Screenshot to scratchpad.
- [ ] With no benched attacks, the "Benched" section is absent (no empty header).
- [ ] Pokémon Cards window is visually unchanged (no stray highlight).

## Out of scope
Don't change the auto-bench logic (`run_state.js` `rebuildActionDeckForActivePokemon` / `shouldBenchNewAttack`), the battle engine, or the Pokémon bench UI. Display-only — no benched-attack management/moving. Never run `scripts/manage_*`, never act on `TODO.md`, never git commit unless asked.
