# Phase 23 — Trainer roster audit: gym leaders → Boss

**Recommended agent:** Opus · high effort
**Prereqs:** none, but **run before phase 24** (they must both land to keep the suite green).
**Read first:** `18-mechanics-symbols-roster-overview.md`.
**Goal:** Every real gym leader in `trainers.json` has rank `Boss` with a Boss-sized, type-valid
deck. Elite Four members sit at `Elite`. Generic trainer classes keep their ranks. (Phase 24
then backfills Ace/Elite so `node tests/run_all.js` is green again.)

## Context you need

- Anchors are hints captured 2026-07-14; find by function name. Edit `trainers.json`
  **directly** — never run `scripts/manage_*`.
- **No web search needed.** The sprite/name database is already in-repo:
  `arena/trainer_sprites.js` (247 `{name, source, file}` entries — gym leaders, Elite Four,
  champions, and generic classes). Classification of who is a gym leader vs Elite Four uses
  model knowledge + this manifest.
- **Deck rule (from the `data` skill):** trainer decks are the **exact** `pokemon`/`attacks`/
  `items` arrays (no copy multiplier). **attacks = 4 × Pokémon count.** Boss = **5 Pokémon /
  20 attacks / ~5 items**, `cash: 500`. Each attack must be usable by at least one of the
  trainer's Pokémon — **check each Pokémon's types in `pokemon.json`** (not the `arena_data.js`
  fallback, which can drift) and respect `full_type_requirements`. An off-type attack sits dead
  in an exact-card deck. `tests/data_validation.test.js` verifies every pokemon/attack/item name
  exists and that names are unique.
- **Current roster taxonomy (verified 2026-07-14):**
  - **Already Boss (keep):** Wallace, Misty, Brock, Lt. Surge, Erika, Koga, Sabrina, Blaine —
    all gym leaders, already 5pk/20at.
  - **Ace → Boss (gym leaders, promote):** Marlon, Chili, Cilan, Tate, Clair, Candice. (These
    are 4pk/16at today → grow to 5pk/20at.)
  - **Elite → Boss (gym leaders, promote):** Flannery, Gardenia, Iris. (These are 6pk/24at
    today → **shrink** to 5pk/20at — trim, don't grow.)
  - **Ace → Elite (Elite Four, not a gym leader):** Sidney (DARK). (4pk/16at → grow to
    6pk/24at, `cash: 750` — or hand off the growth to phase 24; either way it ends at Elite.)
  - **Keep as-is:** Gamer (HUMAN) & Rocker (ELECTRIC) are generic classes → stay Ace. Lorelei,
    Caitlin, Grimsley are Elite Four → stay Elite. Mecha Cop stays Special.
  - **Edge case — Giovanni** (Special, GROUND): a Viridian gym leader *and* the Rocket boss.
    **Recommend leaving him `Special`** (his distinct final-boss role), and state that decision
    in a one-line note. Do not silently move him.

## Steps

- [ ] 1. **`trainers.json`** — promote the six Ace gym leaders (Marlon, Chili, Cilan, Tate,
  Clair, Candice): set `rank: "Boss"`, `cash: 500`, and grow each to **5 Pokémon / 20 attacks**
  (add one on-type Pokémon from `pokemon.json` and four attacks it can use), keeping ~5 items.
  Preserve each trainer's `typeSpecialization`.
- [ ] 2. **`trainers.json`** — promote the three Elite gym leaders (Flannery, Gardenia, Iris):
  set `rank: "Boss"`, `cash: 500`, and **shrink** each to **5 Pokémon / 20 attacks** (remove one
  Pokémon and its four attacks; keep the deck type-valid and coherent), ~5 items.
- [ ] 3. **`trainers.json`** — move Sidney to `rank: "Elite"` (Elite Four, not a gym leader).
  Either grow to 6pk/24at/6it, `cash: 750` here, or leave the sizing to phase 24 — but its rank
  must end as `Elite`.
- [ ] 4. **`trainers.json`** — add a short comment/PR-note (in the phase, not the JSON) recording
  the Giovanni decision (stays Special). Leave the 8 existing Kanto bosses and the generic Ace
  pair (Gamer, Rocker) untouched.
- [ ] 5. **Validate types** — for every deck you changed, confirm each attack is usable by one of
  the trainer's Pokémon per `pokemon.json` types + `full_type_requirements`. Fix any off-type
  pairing.

## Verification

- [ ] `node tests/run_all.js` — the well-formedness test passes (valid ranks, all
  pokemon/attacks/items resolve, unique names). Note: the `≥6 Ace` minimum will still be RED
  until phase 24; that is expected mid-batch — do not "fix" it here by keeping gym leaders at
  Ace. Run 24 immediately after so the suite is green.
- [ ] Spot-check counts: every promoted Boss has exactly 5 Pokémon and 20 attacks; Sidney is
  `Elite`; no gym leader remains at `Ace` or `Elite`.

## Out of scope / do not touch

Do not edit `pokemon.json`/`attacks.json`/`items.json` (only reference existing names), do not
touch `map/locations.js` rank-weighting, and do not create the new generic Ace/Elite trainers
here (that is phase 24). Do not move Giovanni or the Kanto bosses. Inherit all batch ground
rules from `18-mechanics-symbols-roster-overview.md` (no `git commit`, no `scripts/manage_*`,
no `TODO.md`, run `node tests/run_all.js` after every change).
