---
name: data
description: Edit or validate the card-data JSON files (pokemon.json, attacks.json, items.json, trainers.json, events.json) — schemas, canonical enums, deck-construction rules, validation commands.
---

# Editing PokeRoguePocket card data

The five root JSON files are the game's card database. Edit them directly with
Edit/Write — the `scripts/manage_*.js` CLIs are interactive tools for the
project owner only. After any edit run `node tests/run_all.js`
(`tests/data_validation.test.js` checks enums, uniqueness, and cross-references;
a PostToolUse hook already JSON.parse-checks on save).

Canonical enums live in `scripts/data_options.js` (CommonJS — `require` it,
never retype values): `PokeType`, `Status`, `StatChange`, `AttackTarget`,
`ItemTarget`, `Rank`.

## Schemas

`pokemon.json` (188): `name`, `type1..type3` (PokeType; `type1 !== NONE`),
`id` (4-digit string, matches `assets/portraits/<name>.png` numbering),
`baseHealth/baseAttack/baseDefense/baseSpeed` (positive numbers).

`attacks.json` (115): `name`, `type1/type2` (PokeType), `basePower` (>= 0;
0 = pure effect), `status` (Status, or an artificial effect — below),
`statChanges` (StatChange[], one entry per stage step), `target`
(AttackTarget or `TRAINER`), `full_type_requirements` (bool — `true` means the
user needs EVERY listed type; default is any shared type).

`items.json`: `name`, `target` (ItemTarget), `status` (Status[]),
`statChanges` (StatChange[]; legacy files may hold Status values here — the
engine moves non-stat entries into `status` at load).

`trainers.json` (31): `name`, `sprite`, `cash`, `rank` (Rank),
`typeSpecialization` (PokeType), `pokemon`/`attacks`/`items` (names that must
exist in the other files — validated by the tests).

## Engine extensions beyond the enums

- Attack target `TRAINER` + statuses `INCREASE_CAPACITY`, `EXTRA_ITEM`,
  `EXTRA_ATTACK`, `REFRESH_DECK` are the ARTIFICIAL-type trainer-effect
  attacks (`arena_controller.js` `useArtificialAttackFromHand`). This set is
  intentionally very small — do not add artificial attacks unless asked.
- Dragon Gem items pair `DRAGON_GEM` with the status the gem applies.

## Deck construction rules (arena_data.js `arena.Constants`)

- Each battle-deck Pokemon lists 2 attacks; the main deck gets
  `ATTACK_COPIES_PER_MAIN_DECK` (2) copies of each, plus up to
  `ITEM_CARDS_PER_MAIN_DECK` (10) items. Hand size 6, knockout limit 4.
- A selected attack silently drops out of the deck if its paired Pokemon
  cannot use it (type mismatch, see `full_type_requirements`). When pairing
  attacks in `DEFAULT_BATTLE_DECK` or `trainers.json`, check the Pokemon's
  types in `pokemon.json` — not the fallback data in `arena_data.js`, which
  can drift out of sync. `tests/data_validation.test.js` guards the default
  deck's pairings; a bulk import once retyped Feraligatr and silently
  shrank the deck.
