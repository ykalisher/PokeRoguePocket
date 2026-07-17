# Phase 44 — Delete the Pokemon PC; add the Release service

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 43 (same-file ordering in `map/mart.js`). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** The mart's Pokemon-PC box is gone (feature and storage key), replaced by a
"Services" panel whose first service is **Release a Pokemon** — free, once per mart,
available only while the player owns ≥4 pokemon (active + bench).

## Context you need

- **PC surface to remove** in `map/mart.js`: `state.pcPokemon` (~23),
  `refreshPcPokemon` (~689), `handlePcAction` / `withdrawPcPokemon` (~337) /
  `depositSelectedPokemon` / `depositPokemonById` / `performDeposit` (~357–402),
  `renderPcPanel` (~488–526), the pointer-drag deposit machinery (~126–246; drag exists
  *only* for PC deposit — remove it and its `state.drag`/`suppressNextClick` support if
  nothing else uses them), the `data-pc-action` branches in `handleMartClick` (~66), and
  the header message `'Choose cards, manage the PC, then continue.'` (~418).
  **Keep**: the "Your Pokemon" selectable grid and the Continue button currently
  rendered inside `renderPcPanel`, plus `selectPokemon` (~321) / `getPokemonCardById`
  (selection is reused by Release now and Trade in phase 46). `createRunPokemonCard`
  (~679) becomes unused once the PC is gone — delete it if grep confirms no callers.
- **PC storage API to remove** in `map/run_state.js`: `PC_STORAGE_KEY =
  'pokemon-rogue-pocket-pc'` (~14), `PC_STORAGE_VERSION`, `loadPcPokemon` /
  `savePcPokemon` / `clearPcPokemon` (~121–175), `normalizePcPokemonCard` (~640), and
  their entries in the `global.PokeRun` export block (~671+).
- Owner decision (Locked spec): a pokemon stored in the PC by an old save is
  **discarded** — add a one-time guarded cleanup that removes the key.
- Removal precedent: filter the card out of `collections.pokemon` /
  `collections.bench.pokemon` by `card.id` (see the old deposit code ~382–386), then
  `runStore.balancePokemonCollections(run)` + `rebuildActionDeckForActivePokemon(run)` +
  `saveRunState(run)`.
- Mart encounter fields are normalized in `normalizeMartEncounters`
  (`map/run_state.js` ~491) — new fields need defaults there.

## Steps

- [ ] 1. **`map/run_state.js`** — delete the PC storage API and its exports; in the
  storage-availability-guarded module init (near `loadRunState`/storage helpers), add a
  one-time `try { localStorage.removeItem('pokemon-rogue-pocket-pc'); } catch {}`
  cleanup with a comment naming the owner decision. `normalizeMartEncounters`: add
  `releaseUsed: Boolean(encounter.releaseUsed)`.
- [ ] 2. **`map/mart.js`** — remove all PC state, handlers, drag machinery, and
  `data-pc-action` click branches; update the header message to services wording (e.g.
  `'Buy cards, use the services, then continue.'`).
- [ ] 3. **`map/mart.js`** — replace `renderPcPanel` with `renderServicesPanel`: keeps
  the "Your Pokemon" grid + Continue button; adds a "Services" section with a
  **Release** row — label "Release a Pokemon", requirement text ("Needs at least 4
  Pokemon"), a button (`data-mart-service="release"`) disabled unless
  `!state.encounter.releaseUsed`, a pokemon is selected, and active+bench pokemon count
  ≥ 4; shows "Used" styling once spent. New click branch: remove the selected card from
  whichever collection holds it, `balancePokemonCollections` +
  `rebuildActionDeckForActivePokemon`, set `state.encounter.releaseUsed = true`,
  `saveRunState`, message `Released <name>.`, clear the selection, re-render.
- [ ] 4. **`mart.html` / `static/mart.css`** — retitle "Pokemon PC" → "Services"
  wherever the markup/styles reference it; rename or repurpose `.mart-pc-*` styles for
  the services rows; drop deposit-drag affordance styles. Keep the visual language of
  the existing panel.

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `grep -rn "pokemon-rogue-pocket-pc" --include=*.js .` → exactly one hit: the
  cleanup line.
- [ ] `verify` skill: (a) run with 3 pokemon → Release button disabled with requirement
  text; (b) run with ≥4 → releasing removes the card (deck counter drops by 1), button
  flips to used, re-entering the same mart keeps it used, a different mart offers it
  fresh; (c) seed `localStorage['pokemon-rogue-pocket-pc']` with junk before load →
  key is gone afterwards and the page works.

## Out of scope / do not touch
The attack-removal and trade services (45/46); offer/stock logic (43); `buyOffer`;
event-driven card removal (`map/event_effects.js`); `ACTIVE_POKEMON_LIMIT` and deck
balancing rules themselves.
