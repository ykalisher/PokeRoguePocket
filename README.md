# Pocket Nuzlocke

Pocket Nuzlocke is a browser-based card arena prototype built with plain
JavaScript, HTML, and CSS. It runs directly from local files in a modern browser,
or from a simple static server.

## Running Locally

Open `index.html` in a browser, or serve the repository with a static server:

```sh
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.

## Arena Deck System

Arena battles use two separate decks per player:

- `pokemonDeck`: Pokemon cards only.
- `deck`: the main deck, containing attacks and items only.

At battle start, each player automatically draws two Pokemon from their Pokemon
deck and plays them into the two active slots. Pokemon are not held in the main
hand.

At the start of each player turn, that player draws from the main deck until
their hand reaches their current hand size. The default hand size is 6. If the
main deck is empty while drawing, the discard pile is shuffled back into the main
deck and drawing continues.

## Knockouts And Switching

When a Pokemon is knocked out:

- It moves to the knockout pile.
- The player's knockout count increases.
- The open slot is not filled immediately. Replacement waits until end of turn,
  after all queued attacks and end-of-turn status cleanup have resolved.
- At replacement time, if an eligible Fossil is already in that knockout pile,
  the Fossil revives into the open slot instead of drawing a new Pokemon.
- Otherwise, a new Pokemon is drawn from the Pokemon deck and played into the
  open slot.

The game ends when either player's whole team has been knocked out - that is,
their knockout count reaches the number of Pokemon they brought into the
battle.

When a Switch effect is played on a Pokemon:

- The switched Pokemon goes to the bottom of its owner's Pokemon deck.
- It keeps current HP and persistent status.
- It loses stat-stage changes.
- A new Pokemon is drawn and played immediately.
- Fossil revival does not apply to Switch effects.

## Main Deck Construction

Each Pokemon in a battle deck has two selected attacks it can learn. The main
deck gets two copies of each selected attack, plus up to ten item cards.

The current fallback/default arena deck uses these Pokemon and attacks:

| Pokemon | Attacks |
| --- | --- |
| Blastoise | Angered Roar, Crunch |
| Gyarados | Hydro Pump, Dragon Claw |
| Machamp | Mega Punch, Karate Smash |
| Gengar | Jumpscare, Ghastly Grip |
| Feraligatr | Murky Water, Waterfall |
| Suicune | Rain Dance, Great Flood |

Default items:

- Sitrus Berry
- Withdraw Wand
- Withdraw Wand
- Salac Berry
- Fire Gem
- Electric Gem
- Psychic Gem
- Dark Gem
- Grass Gem
- Poison Gem

## Player Discarding

During the player turn, unused hand cards can be discarded before ending the
turn. Select a hand card and click `Discard`, or drag a hand card onto the
discard pile.

Attacking and item usage otherwise work through the same targeting and
resolution flow as before.

## Dragon Gems

Dragon Gem item cards are played to a player's side instead of targeting a
Pokemon. A side can have one active Dragon Gem at a time. The active gem lasts
until the battle ends or another Dragon Gem replaces it, and that player's
damaging Dragon attacks can apply the active gem's paired status using the
normal status activation chance.

## Rival AI Discarding

After the rival draws, uses an item, and readies attacks, it discards unplayable
cards based on how many cards it expects it can play next turn:

- 3 playable next-turn cards: discard 0 cards.
- 2 playable next-turn cards: discard 1 unplayable card.
- 1 playable next-turn card: discard 2 unplayable cards.
- 0 playable next-turn cards: discard 3 unplayable cards.
