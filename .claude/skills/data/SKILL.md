---
name: data
description: Edit or validate the card-data JSON files (pokemon.json, attacks.json, items.json, trainers.json, events.json) — schemas, canonical enums, deck-construction rules, validation commands.
---

# Editing Pocket Nuzlocke card data

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
`evolvesInto` (optional string, name or id) names a BABY-typed pokemon's mega
evolution target — there is no mega type; a "mega" is simply any record some
baby's `evolvesInto` resolves to (`map/locations.js` `isMegaPokemon`,
`getMegaTargetKeys`). Rules: every BABY-typed pokemon needs >=1 non-BABY type;
no attack may use `BABY` in `type1`/`type2`; `evolvesInto` stays optional even
on babies (runtime code guards its absence) but when present must resolve to
a real pokemon by name or id. Babies and megas are excluded from every
generic pokemon pool — wild encounters, legendary captures, and event random
grants (`isObtainablePokemon`/`getObtainablePokemonPool` in
`map/locations.js`). Owner authors baby/mega data later; zero exists today.

`attacks.json` (115): `name`, `type1/type2` (PokeType), `basePower` (>= 0;
0 = pure effect), `status` (Status, or an artificial effect — below),
`statChanges` (StatChange[], one entry per stage step), `target`
(AttackTarget or `TRAINER`), `full_type_requirements` (bool — `true` means the
user needs EVERY listed type; default is any shared type).

`items.json`: `name`, `target` (ItemTarget), `status` (Status[]),
`statChanges` (StatChange[]; legacy files may hold Status values here — the
engine moves non-stat entries into `status` at load).

`starter_decks.json`: `id` (slug), `name`, `type` (PokeType), `pokemon` (flat name
array), `attacks`/`items` (`{ name, count }`), `enabled`, plus optional
`requiresAchievement` — an achievement id from `achievements.json` that must be
unlocked before the deck can be picked. Omit the key for an always-available deck
(never write `""`); at least one enabled deck must stay always available, or a fresh
profile has nothing to start with. Both validators error on an unknown id
(`starterDecks.unknown-achievement`) and on an all-gated file
(`starterDecks.none-unlocked`).

`trainers.json` (31): `name`, `sprite`, `cash`, `rank` (Rank),
`typeSpecialization` (PokeType), `pokemon`/`attacks`/`items` (names that must
exist in the other files — validated by the tests).

## Event effects (`events.json`)

Effects live in `event.effects`/`rewardEffects`/`payment.effects`/`choices[].effects`
and are dispatched by `map/event_effects.js` `applyEffect`. `gain-random-card` and
`replace-random-card`/`replace-selected-card` (via their `replacement` object) accept
an optional `types` field — an array of uppercase `PokeType` names — to restrict the
random draw to attacks (or pokemon) whose `type1`/`type2`/`type3` intersect the set.
No match in the pool means the grant is skipped (no off-type fallback), not a random
draw from the full pool. `tests/data_validation.test.js` validates `types` values
against the `PokeType` enum.

`gain-random-card`, `gain-random-baby`, and the `replacement` object of `replace-*`/
`trade-*` also accept a boolean `locationTypes: true`, honored by `map/event_effects.js`.
When set it swaps in the run's current `run.location.types` and **wins over** an
authored `types` list on the same object (both may be present; `locationTypes` takes
priority and validation flags the combination). Unlike the authored `types` filter, an
empty on-type pool **falls back to the unfiltered pool and still grants** — the
location is an environment accident, not authoring intent, so the grant always
happens. Like `replacement.types`, `replacement.locationTypes` is inert on a named
replacement (`replacement.name` set skips the random path entirely).

Events gate by location via optional top-level `types` (PokeType overlap with the
location's types). Two optional override lists: `locations` (location ids) and
`terrains` (terrain labels, matched trimmed/case-insensitive). If either is
non-empty it replaces the type gate — the event appears only where the location id
is in `locations` OR the terrain is in `terrains`. Both are validated against
locations.json.

## Event card conditions (`events.json`)

A condition gates an action on whether the run owns a named card:

```json
{ "mode": "has", "cardKind": "pokemon", "name": "Rotom", "text": "optional blocked message" }
```

`mode` is `has` (blocked unless the run owns the card) or `lacks` (blocked when it
does). A condition is a pure **gate** — it renders no picker and consumes nothing.
Do not confuse it with `requires`, which shows the player a card grid and pairs with
the `*-selected-card` effects; conditions are also not a cost. Three places may carry
a `conditions` array: `event.conditions` filters the whole event out of `chooseEvent`'s
pool while unmet (and, on a gift event, also grays the claim button),
`choices[].conditions` grays one choice button, and `payment.conditions` grays a
trainer event's pay-and-leave button. Multiple conditions on one owner are AND-ed.

`name` is matched exactly against the card's current name, so renaming a card breaks
any condition on it — the editor's "where is this used?" lists conditions for exactly
that reason. Always write `cardKind` explicitly (`pokemon`/`attack`/`item`); the
engine defaults an absent kind to `attack`, which is almost never intended.
`text` overrides the generated message (`Requires <name>.` / `You already have
<name>.`). Both validators — the editor's Issues tab and
`tests/data_validation.test.js` — treat a bad `mode`/`cardKind`, a missing `name`, a
non-string `text`, or a `name` that does not exist in the matching data file as an
error.

An optional `subject` widens the gate from cards to achievements:

```json
{ "subject": "achievement", "mode": "has", "name": "champion", "text": "optional message" }
```

With `subject: "achievement"`, `name` is an **achievement id** from
`achievements.json` (not a card name) and `cardKind` is ignored; satisfaction reads
`window.PokeProfile.isUnlocked(id)` and fails closed when the profile module is
absent. Omitting `subject` (or `"card"`) keeps the card behavior above. The default
message becomes `Requires the "<achievement name>" achievement.`. An id that does not
exist in `achievements.json` is an error (`events.unknown-condition-achievement`).

## Event card requirements (`events.json`)

A requirement renders the card grid the `*-selected-card` effects consume. It lives in
a `requires` array on the event (gift), a choice, or `payment`, and pairs with an
effect by id:

```json
"requires": [
  { "id": "rotom", "cardKind": "pokemon", "name": "Rotom",
    "label": "Choose your Rotom", "emptyText": "You have no Rotom to send in." }
],
"effects": [
  { "type": "replace-selected-card", "selectionId": "rotom",
    "replacement": { "cardKind": "pokemon", "name": "Rotom-Heat" } }
]
```

`id` is the key `selectionId` points at — it is not a filter. **Without `name`/`names`
the picker offers every card of `cardKind` the run owns**, so a plain
`{ "id": "rotom", "cardKind": "pokemon" }` lets the player replace *any* Pokemon.
Add `name` (one card) or `names` (a list) to narrow the grid; `getBlockedReason`
re-checks the confirmed selection against the same filtered list, so a stale
selection cannot slip through. Names match exactly and are validated against the data
file by both validators, and the editor's "where is this used?" lists them.
`label`/`prompt` head the grid, `emptyText` shows when the filter matches nothing.

Pair a filter with an `event.conditions` gate when the event only makes sense with
that card (`rotom-appliances` is the worked example: a `has Rotom` condition keeps
the event out of the pool, and each choice's `name: "Rotom"` requirement keeps the
picker to that one card).

Note `replacement.types` is only used when `replacement.name` is absent (the random
path) — on a named replacement it is inert.

## Engine extensions beyond the enums

- Attack target `TRAINER` + statuses `INCREASE_CAPACITY`, `EXTRA_ITEM`,
  `EXTRA_ATTACK`, `REFRESH_DECK` are the ARTIFICIAL-type trainer-effect
  attacks (`arena_controller.js` `useArtificialAttackFromHand`). This set is
  intentionally very small — do not add artificial attacks unless asked.
- Dragon Gem items pair `DRAGON_GEM` with the status the gem applies.

## Deck construction rules

Two deck paths exist (`arena_model.js`); hand size 6 applies to both, and the
knockout limit is the team's Pokemon count (a side loses once every Pokemon it
brought is knocked out):

- **Run battles (the real game) use exact cards.** `game.js` builds both
  sides with `exactCards: true` — the player deck is the run's collected
  card list 1:1 (`run_state.js`, grows unbounded as attacks are collected;
  attacks no active Pokemon can use are benched, not lost), and trainer
  decks are exactly the `pokemon`/`attacks`/`items` lists in
  `trainers.json`. No copy multiplier or item cap applies here.
- **Definition-style decks (demo/fallback only)** — `DEFAULT_BATTLE_DECK`,
  used when `game.html` loads without an active run, and by the tests —
  list Pokemon with 2 attacks each; the main deck gets
  `ATTACK_COPIES_PER_MAIN_DECK` (2) copies of each, plus up to
  `ITEM_CARDS_PER_MAIN_DECK` (10) items (`arena_data.js` `arena.Constants`).
- An attack a Pokemon cannot use (type mismatch, see
  `full_type_requirements`) silently drops out of definition-style decks
  and sits dead in exact-card decks. Either way, when pairing attacks in
  `DEFAULT_BATTLE_DECK` or `trainers.json`, check the Pokemon's types in
  `pokemon.json` — not the fallback data in `arena_data.js`, which can
  drift out of sync. `tests/data_validation.test.js` guards the default
  deck's pairings; a bulk import once retyped Feraligatr and silently
  shrank the deck.
- Record names (pokemon/attacks/items/trainers) and location name/terrain must not
  contain `"`, `<`, or `>` — the battle renderer interpolates them into double-quoted
  HTML attributes unescaped (validated as `data.unsafe-name-chars`). Apostrophes are fine.
