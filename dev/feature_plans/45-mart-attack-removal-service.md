# Phase 45 — Mart service: attack removal (50 coins)

**Recommended agent:** Sonnet · low effort.
**Prereqs:** 44 (services panel exists). **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** A second mart service: pay 50 coins, once per mart, to permanently remove one
attack card chosen from the action deck or bench.

## Context you need

- The Services panel and its click plumbing come from phase 44 (`renderServicesPanel`,
  `data-mart-service` branches in `handleMartClick`).
- Cash: read via `getCash()` and deduct with `state.run.cash = getCash() - cost;`
  (pattern in `buyOffer`, `map/mart.js` ~296–319).
- Attack cards live in `state.run.collections.actions` and
  `state.run.collections.bench.actions`; identify attacks with
  `arena.Model.isAttackCard(card)` (pattern: `getBenchedAttackCards` /
  `renderActionCardSections`, `map/mart.js` ~562–605). Card names for display:
  `card.attack.name`.
- Overlay pattern for the picker: `renderCardWindow` (`map/mart.js` ~538–560) draws a
  card-list overlay; imitate its markup/close handling rather than inventing a new one.
- Removal: filter the card out of whichever collection holds it by `card.id`, then
  `runStore.rebuildActionDeckForActivePokemon(state.run)` and
  `runStore.saveRunState(state.run)`.
- Encounter field defaults live in `normalizeMartEncounters` (`map/run_state.js` ~491).
- Locked-spec assumption 5: removing the player's last attack card is allowed.

## Steps

- [ ] 1. **`map/run_state.js`** — `normalizeMartEncounters`: add
  `attackRemovalUsed: Boolean(encounter.attackRemovalUsed)`.
- [ ] 2. **`map/mart.js`** — add a "Remove an Attack — 50 coins" row to the Services
  section: button (`data-mart-service="remove-attack"`) disabled when
  `state.encounter.attackRemovalUsed`, `getCash() < 50`, or the player owns zero attack
  cards; disabled states show why ("Used" / "Need 50" / "No attacks").
- [ ] 3. **`map/mart.js`** — clicking it opens a picker overlay listing every owned
  attack card (active + bench) as selectable buttons (`data-remove-attack-id`);
  selecting one deducts 50 coins, removes that card from its collection,
  sets `state.encounter.attackRemovalUsed = true`, rebuilds the action deck, saves,
  closes the overlay, and shows `Removed <name>.` A cancel/close control backs out with
  no charge.
- [ ] 4. **`static/mart.css`** — minimal picker styles reusing the existing overlay and
  selection look (`.mart-pokemon-choice`-style highlighting).

## Verification

- [ ] `node tests/run_all.js` green.
- [ ] `verify` skill: with ≥50 coins, use the service — cash drops by exactly 50, the
  chosen attack disappears from the deck counters, the row shows used and stays used on
  re-entry; with <50 coins the button is disabled; cancelling the picker charges
  nothing.

## Out of scope / do not touch
Removing items or pokemon (Release covers pokemon); refunds; multi-removal; offer/stock
logic; `buyOffer`; the trade service (46).
