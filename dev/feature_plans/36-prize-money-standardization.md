# Phase 36 — Prize money standardization

**Recommended agent:** Haiku · low effort.
**Prereqs:** none. **Read first:** `35-mart-megas-ai-overview.md`.
**Goal:** Every trainer in `trainers.json` pays prize cash strictly by rank — Standard 50,
Ace 100, Special 150, Boss 200, Elite 250. Data-only change; ends green.

## Context you need

- `trainers.json` (repo root) is an array of 95 trainer records with fields
  `name, sprite, cash, rank, typeSpecialization, pokemon, attacks, items`. `rank` is one
  of `Standard` (19 records), `Ace` (22), `Special` (2), `Boss` (29), `Elite` (23).
- Cash is currently rank-correlated at 200/300/400/500/600. Only the `cash` values
  change; nothing reads specific amounts in code — the value flows from
  `rewardCash: trainer.cash` (`map/area.js` ~959) into `arena/game.js`
  `collectBattleRewards`, untouched here.
- No test asserts specific cash amounts (only `cash >= 0` in
  `tests/data_validation.test.js`).
- Query the JSON with `node -e` one-liners; do not read the whole file into context.

## Steps

- [x] 1. **`trainers.json`** — for all 95 records, set `cash` from `rank`:
  Standard→50, Ace→100, Special→150, Boss→200, Elite→250. Because the current values are
  also rank-uniform, this is five global substitutions — but verify with the snippet
  below rather than assuming. Change no other field.

## Verification

- [x] `node tests/run_all.js` green. (Fixed one pre-existing, unrelated failure found
  along the way: `tests/editor_validation.test.js` referenced the removed event id
  `berry-cache`, stale after the prior "Change events" commit renamed it to
  `sitrus-berry-tree`; updated the test id, no data files touched.)
- [x] Exact-map check prints `OK`:
  ```bash
  node -e "
  const t=require('./trainers.json');
  const want={Standard:50,Ace:100,Special:150,Boss:200,Elite:250};
  const bad=t.filter(x=>x.cash!==want[x.rank]);
  console.log(bad.length? 'BAD '+JSON.stringify(bad.map(x=>[x.name,x.rank,x.cash])) : 'OK '+t.length+' trainers');
  "
  ```

## Out of scope / do not touch
Any code file; `rank` values, decks, sprites, or any other trainer field;
`map/locations.js` rank weighting; event reward amounts (`events.json`). No browser
check needed.
