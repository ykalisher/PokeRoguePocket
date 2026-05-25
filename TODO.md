# Tasks
This file is for humans only! Agents should not act on this file unless explicitly requested to mark something as complete or add a  new item.
## Data
- [x] Decide on type specializations for attacks
	ARTIFICIAL: Interacts with the deck and hand; Attacks to increase the number of cards in your hand or prevent the next card you play from being discarded or replay a discarded card etc.
	BABY: Evolves into strong pokemon, but otherwise very weak
	BUG: Gambling with multi-attack moves (a la fury attack)
	DARK: flinching
	DRAGON: "dragon" status effects on dragon attacks that can be changed with items
	ELECTRIC: paralysis
	FAIRY: teammate support
	FIGHTING: gains power from status effects
	FIRE: burn
	FLYING: improving speeds and altering turn order,
	FOSSIL: if knocked out and another pokemon knocked out, then fossil comes back with 50% hp.
	GHOST: fatigue
	GOURMET: self-support
	GRASS: sleep
	GROUND: multi-target damage
	HUMAN: double stat effects
	ICE: ignoring stat effects
	LEGENDARY: excessive moves
	MONSTER: extreme stat tradeoffs (i.e. double attack, halve defense)
	NORMAL: stat changes can only be +/- 1
	POISON: poisoning
	PSYCHIC: protecting team
	ROCK: increasing defense
	STEEL: uses defense instead of attack
	WATER: neutralizing/healing off effects
- [x] Redo pokemon given the new type specializations
	- [x] Add 3 pokemon for each type, and add 2 move for each type that pokemon has that synergize with it (If I add water/monster, that counts as 1 water, then need to add 3 more monster still)
	- Currently on Mamoswine
- [ ] Add more pokemon with better overlapping types
- [ ] Add more items
## Overworld Mechanics
- [ ] Decide on how you capture more pokemon.
- [ ] Decide on how you get more attacks
- [ ] Come up with algorithm for locations and selection.
- [ ] Come up with algorithm or presets for opposing trainers.
- [ ] Create system for shopkeeper and costs.
- [ ] Decide on progression system.
## Battle Mechanics
- [x] Implement statuses and stat changes in battles.
- [x] Implement new statuses or effects from types (~healing status away~, ~multi-attack moves~, ~fighting types~, ~fossil types~, ~normal types~, ~human type~, ~ice types~, ~steel types~)
- [ ] Implement dragon types
- [x] Reorganize decks
	- two decks, one for pokemon and one for moves/items. 
	- Draw two pokemon to start with, and switch to shuffle it back into the deck and draw a new one out (drawing should occur before shuffling). When a pokemon is knocked out, if there's no fossil in the knockout pile then you draw a new pokemon and play it.
	- Battle ends when someone either has no more pokemon on the field or has had three (maybe four?) pokemon knocked out. Can bring up to 6 pokemon (is that too many, diluting the movepool too much? Or it forces monotype/dual type decks)
	- Each pokemon should have moves equipped for battle, and a deck gets generated from that. Draw up so you have 5 cards (attacks + items) in your hand at the start of the turn. Can discard unused moves at the end of the turn, or keep them.
- [x] Decide on damage calculations
## Misc
- [ ] Sort out the disgusting ui.
- [ ] Icons for the website
- [ ] Make it a progressive web app (or at least have the option to be).
