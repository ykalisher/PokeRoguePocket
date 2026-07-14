# Phase 24 — Backfill Ace/Elite with generic-class trainers

**Recommended agent:** Opus · high effort
**Prereqs:** **phase 23** (boss promotions) must be done first. **Read first:**
`18-mechanics-symbols-roster-overview.md`.
**Goal:** After phase 23 emptied the Ace rank of gym leaders, the Ace pool is refilled with
**generic, nameless-class** trainers and the Elite pool is healthy, so run variety is restored
and `node tests/run_all.js` is green. Ends green.

## Context you need

- Anchors are hints captured 2026-07-14; find by function name. Edit `trainers.json`
  **directly** — never run `scripts/manage_*`.
- **State after phase 23:** Ace = {Gamer, Rocker} (2) — **below the `≥6 Ace` test minimum**;
  Elite = {Lorelei, Caitlin, Grimsley, Sidney} (4) — exactly at the `≥4` minimum. Test:
  `tests/data_validation.test.js` (~`:143-148`) requires **≥6 Ace, ≥4 Elite**, each with a
  valid `typeSpecialization` (a `PokeType`).
- **Deck rule:** attacks = 4 × Pokémon count. **Ace = 4pk/16at/~5it, `cash` 300–320.**
  **Elite = 6pk/24at/6it, `cash` 750.** Decks are exact arrays; every attack must be usable by
  one of the trainer's Pokémon — check `pokemon.json` types + `full_type_requirements`. All
  pokemon/attack/item names must already exist in the data files. Trainer `name`s must be
  **unique** (the test asserts uniqueness).
- **No web search needed.** Sprites come from the in-repo manifest `arena/trainer_sprites.js`.
  Confirmed **unused generic-class sprites** for new Ace trainers: `Ace Trainer F`, `Ace Trainer M`,
  `Veteran F`, `Veteran M`, `Cooltrainer F`, `Cooltrainer M`, `Beauty`, `Hiker`, `Camper`,
  `Picnicker`, `Youngster`, `Swimmer F`, `Scientist`, `Worker`, `Black Belt`, `Lady`,
  `Gentleman`, `Rich Boy`, `Socialite`. Confirmed **unused Elite Four / champion sprites** (for
  Elite headroom, if desired): `Agatha`, `Lance`, `Bruno`, `Phoebe`, `Glacia`, `Drake`,
  `Shauntal`, `Marshal`.
- **Naming:** the `sprite` field must match a manifest `name`; the trainer `name` may add a
  personal flavor suffix for uniqueness, following existing prior art (`Lass Janice`,
  `Dancer Raymond`) — e.g. `sprite: "Veteran M"`, `name: "Veteran Karl"`.

## Steps

- [ ] 1. **`trainers.json`** — add **at least 4** new **Ace** trainers (recommend ~6 for a
  healthy pool) using generic-class sprites from the list above, so Ace totals **≥6**. Each:
  `rank: "Ace"`, `cash: 300` (or 320), a distinct valid `typeSpecialization`, **4 Pokémon / 16
  attacks / ~5 items**, all type-valid, unique `name`. Spread the `typeSpecialization`s across
  types not already well-covered at Ace.
- [ ] 2. **`trainers.json`** — (recommended) top up **Elite** to ~6 for variety: add 1–2 new
  Elite trainers using **real Elite Four names** from the unused list (they fit the Elite rank
  thematically; gym leaders do not). Each: `rank: "Elite"`, `cash: 750`, valid
  `typeSpecialization`, **6 Pokémon / 24 attacks / 6 items**, type-valid. (Skip if you prefer to
  leave Elite at the phase-23 count of 4 — the test still passes; note the choice.)
- [ ] 3. **`trainers.json` / `arena/trainer_sprites.js`** — fix the pre-existing gap: the
  Standard trainer `Skier` references a sprite name absent from the manifest. First check
  `assets/sprites/` for a matching Skier file; if one exists, add its `{name:"Skier", source, file}`
  entry to the manifest; if not, repoint that trainer's `sprite` to an existing generic sprite
  (e.g. `Worker`, `Hiker`, or `Ace Trainer M`). Keep the trainer's `name` as-is.
- [ ] 4. **Validate types** — for every new deck, confirm each attack is usable by one of the
  Pokémon per `pokemon.json`. Fix off-type pairings so no attack sits dead.

## Verification

- [ ] `node tests/run_all.js` green — including the `≥6 Ace` / `≥4 Elite` seeded-roster test
  and the well-formedness cross-reference test (all names resolve, unique, valid ranks &
  typeSpecializations).
- [ ] Counts: Ace ≥ 6, Elite ≥ 4; every new Ace = 4pk/16at, every new Elite = 6pk/24at.
- [ ] `verify` skill (serve on 8931) OR a scripted run through the `map/locations.js` selection:
  Ace-tier battles now surface generic-class trainers (no gym-leader names), and boss nodes
  surface the gym leaders promoted in phase 23. `Skier` renders a real sprite.

## Out of scope / do not touch

Do not edit `pokemon.json`/`attacks.json`/`items.json` (reference existing names only), do not
re-touch the phase-23 boss promotions, and do not add named gym leaders at Ace/Elite (Ace =
generic classes; Elite = Elite Four/champions only). Inherit all batch ground rules from
`18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`, no
`TODO.md`, run `node tests/run_all.js` after every change).
