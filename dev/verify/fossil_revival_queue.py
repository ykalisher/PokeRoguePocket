"""Verifies FOSSIL revival timing and queue order in a real battle.

Knockouts are forced with Poison at 1 HP so they land at a known end of turn
instead of depending on the rival AI's targeting; every other Pokemon on the
player board is walled to 5000 HP so only the intended one goes down.

  Run A (empty Pokemon deck): the Fossil goes down with an ally still standing
  and nothing to draw. Its slot must stay open for the rest of that turn and
  all of the next one, then the Fossil revives into it with 60% max HP and
  Fatigue - with no new knockout to ride back in on.
  Run B (deck left, two Fossils): both Fossils go down on the same turn and
  both slots draw replacements, so neither Fossil returns early. The next two
  knockouts hand the slots to the Fossils in the order they went down, oldest
  knockout first.

Usage: .cache/venv/bin/python fossil_revival_queue.py
"""

import sys
from pathlib import Path

from lib import end_turn, fresh_battle, state, wait_for_player_turn

HERE = Path(__file__).resolve().parent

# A Fossil and one ally, no Pokemon deck behind them. The ally is walled so the
# rival cannot make this the "nothing left" case, which revives immediately.
RIG_EMPTY_DECK = """
() => {
    const arena = window.CardArena;
    const player = arena.state.players.player;
    const fossilRecord = (arena.GameData.pokemon || [])
        .find(record => (record.types || []).includes('FOSSIL'));
    const fossilCard = player.board[0];
    const allyCard = player.board[1];

    if (!fossilRecord) return { error: 'no FOSSIL Pokemon in the card data' };
    if (!fossilCard || !allyCard) return { error: 'the player board is not full' };

    fossilCard.pokemon = { ...fossilRecord };
    fossilCard.currentHealth = 1;
    fossilCard.currentStatus = [];
    fossilCard.hasUsedFossilRevival = false;

    allyCard.pokemon = { ...allyCard.pokemon, baseHealth: 5000 };
    allyCard.currentHealth = 5000;
    allyCard.currentStatus = [];

    player.pokemonDeck = [];
    player.knockout = [];
    player.initialPokemonCount = 2;
    player.knockoutCount = 0;
    arena.Model.applyStatus(fossilCard, 'POISON');
    arena.Model.updatePokemonLeft(player);

    return {
        fossilId: fossilCard.id,
        fossilName: fossilCard.pokemon.name,
        maxHp: fossilCard.pokemon.baseHealth,
        allyId: allyCard.id
    };
}
"""

# Two different Fossils on the board with two Pokemon still in the deck.
RIG_TWO_FOSSILS = """
() => {
    const arena = window.CardArena;
    const player = arena.state.players.player;
    const fossilRecords = (arena.GameData.pokemon || [])
        .filter(record => (record.types || []).includes('FOSSIL'));
    const cards = player.board.filter(Boolean);

    if (fossilRecords.length < 2) return { error: 'fewer than two FOSSIL Pokemon in the card data' };
    if (cards.length < 2) return { error: 'the player board is not full' };

    cards.forEach((card, index) => {
        card.pokemon = { ...fossilRecords[index] };
        card.currentHealth = 1;
        card.currentStatus = [];
        card.hasUsedFossilRevival = false;
        arena.Model.applyStatus(card, 'POISON');
    });

    player.pokemonDeck = player.pokemonDeck.slice(0, 2);
    player.knockout = [];
    player.initialPokemonCount = 4;
    player.knockoutCount = 0;
    arena.Model.updatePokemonLeft(player);

    return {
        fossilIds: cards.map(card => card.id),
        fossilNames: cards.map(card => card.pokemon.name),
        maxHps: cards.map(card => card.pokemon.baseHealth),
        benchIds: player.pokemonDeck.map(card => card.id)
    };
}
"""

# Walls every Pokemon on the player board, then puts the one in slotIndex on the
# brink with Poison so it is the only knockout this turn.
RIG_NEXT_KNOCKOUT = """
(slotIndex) => {
    const arena = window.CardArena;
    const player = arena.state.players.player;

    player.board.forEach(card => {
        if (!card) return;
        card.pokemon = { ...card.pokemon, baseHealth: 5000 };
        card.currentHealth = 5000;
    });

    const victim = player.board[slotIndex];

    if (!victim) return { error: `slot ${slotIndex} is empty` };

    victim.currentHealth = 1;
    arena.Model.applyStatus(victim, 'POISON');

    return { id: victim.id, name: victim.pokemon.name };
}
"""

PROBE = """
() => {
    const S = window.CardArena.state;
    const player = S.players.player;
    const describe = card => card && {
        id: card.id,
        name: card.pokemon.name,
        hp: card.currentHealth,
        maxHp: card.pokemon.baseHealth,
        statuses: (card.currentStatus || []).map(entry => (entry && entry.status) || entry),
        usedRevival: card.hasUsedFossilRevival === true,
        knockoutTurn: card.knockoutTurn === undefined ? null : card.knockoutTurn
    };

    return {
        finished: S.finished,
        turnNumber: S.turnNumber,
        knockoutCount: player.knockoutCount,
        initialPokemonCount: player.initialPokemonCount,
        board: player.board.map(describe),
        knockout: player.knockout.map(describe),
        log: S.log.slice(0, 10)
    };
}
"""


# Why End Turn is unavailable, for the "turn never ended" failure path.
END_TURN_DEBUG = """
() => {
    const S = window.CardArena.state;
    const button = document.querySelector("[data-action='end-turn']");

    return {
        phase: S.phase,
        isResolving: S.isResolving,
        currentPlayer: S.currentPlayer,
        hand: S.players.player.hand.length,
        endTurnButton: button ? (button.disabled ? 'disabled' : 'enabled') : 'absent',
        canEndTurn: window.CardArena.Controller.canPlayerEndTurn()
    };
}
"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def take_turn(page):
    """Ends the player turn and waits for the next one to open.

    A board Pokemon still holding a usable attack keeps End Turn disabled, so
    the hand is dumped when the button will not take a click.
    """
    before = state(page)["turnNumber"]

    for _ in range(4):
        if end_turn(page, timeout=2):
            break
        # Discard Hand clears every card in one click, which never depends on
        # the current selection the way discarding card by card does.
        try:
            page.click("[data-action='discard-hand']", timeout=2000)
        except Exception:
            pass
        page.wait_for_timeout(800)

    snapshot = wait_for_player_turn(page)

    if not snapshot["finished"] and snapshot["turnNumber"] == before:
        raise RuntimeError(f"turn {before} never ended: {page.evaluate(END_TURN_DEBUG)}")

    return snapshot


def report(label, snapshot):
    board = [card and (card["name"], card["hp"]) for card in snapshot["board"]]
    pile = [card["name"] for card in snapshot["knockout"]]
    print(f"  {label}: turn={snapshot['turnNumber']} finished={snapshot['finished']} "
          f"knockouts={snapshot['knockoutCount']}/{snapshot['initialPokemonCount']} "
          f"board={board} pile={pile}")


def run_empty_deck(problems):
    print("\n=== Fossil down with an ally standing and an empty Pokemon deck ===")

    with fresh_battle() as (page, errors):
        rigged = page.evaluate(RIG_EMPTY_DECK)
        if rigged.get("error"):
            raise RuntimeError(rigged["error"])
        print(f"  rigged: {rigged['fossilName']} at 1/{rigged['maxHp']} HP with Poison, "
              f"one walled ally, empty Pokemon deck")

        take_turn(page)
        after_knockout = page.evaluate(PROBE)
        report("after its own turn", after_knockout)

        check(problems, not after_knockout["finished"], "the battle did not end")
        check(problems, after_knockout["board"][0] is None,
              "the Fossil's slot stayed open - nothing to draw and no early revival")
        check(problems, any(card["id"] == rigged["fossilId"] for card in after_knockout["knockout"]),
              "the Fossil is still in the knockout pile")
        check(problems, all(card["knockoutTurn"] is not None for card in after_knockout["knockout"]),
              "the knockout pile recorded the turn each Pokemon went down")

        take_turn(page)
        after_wait = page.evaluate(PROBE)
        report("one turn later", after_wait)
        for line in reversed(after_wait["log"]):
            print(f"    | {line}")

        revived = after_wait["board"][0]
        expected_hp = -(-rigged["maxHp"] * 6 // 10)  # ceil(60% max HP)

        check(problems, revived is not None and revived["id"] == rigged["fossilId"],
              "the Fossil revived into its open slot with no new knockout")
        check(problems, revived and revived["hp"] == expected_hp,
              f"it returned at 60% max HP ({expected_hp})")
        check(problems, revived and "FATIGUE" in revived["statuses"], "it returned with Fatigue")
        check(problems, revived and revived["usedRevival"], "its once-per-card revival is spent")
        check(problems, after_wait["knockoutCount"] == 0, "its knockout was refunded (0/2)")
        check(problems, after_wait["board"][1] is not None and
              after_wait["board"][1]["id"] == rigged["allyId"], "the ally held its slot throughout")
        check(problems, not errors, f"no page errors ({errors})")

        page.screenshot(path=str(HERE / "fossil_revival_empty_deck.png"))


def run_queue(problems):
    print("\n=== Two Fossils down on one turn, with Pokemon left to draw ===")

    with fresh_battle() as (page, errors):
        rigged = page.evaluate(RIG_TWO_FOSSILS)
        if rigged.get("error"):
            raise RuntimeError(rigged["error"])
        print(f"  rigged: {rigged['fossilNames']} at 1 HP with Poison, two Pokemon in the deck")

        take_turn(page)
        after_double = page.evaluate(PROBE)
        report("after their own turn", after_double)

        pile_ids = [card["id"] for card in after_double["knockout"]]
        board_ids = [card and card["id"] for card in after_double["board"]]

        check(problems, sorted(pile_ids) == sorted(rigged["fossilIds"]),
              "both Fossils are in the knockout pile")
        check(problems, sorted(filter(None, board_ids)) == sorted(rigged["benchIds"]),
              "both slots drew from the Pokemon deck - neither Fossil returned on its own turn")
        check(problems, after_double["knockoutCount"] == 2, "both knockouts counted (2/4)")

        # The pile is newest first, so its last entry went down first and owns
        # the front of the revival queue.
        first_out, second_out = pile_ids[-1], pile_ids[0]
        first_max_hp = rigged["maxHps"][rigged["fossilIds"].index(first_out)]

        victim = page.evaluate(RIG_NEXT_KNOCKOUT, 0)
        if victim.get("error"):
            raise RuntimeError(victim["error"])
        take_turn(page)
        after_first_revival = page.evaluate(PROBE)
        report("next knockout", after_first_revival)

        revived = after_first_revival["board"][0]
        expected_hp = -(-first_max_hp * 6 // 10)

        check(problems, revived is not None and revived["id"] == first_out,
              "the Fossil knocked out first is the one that revived")
        check(problems, revived and revived["hp"] == expected_hp,
              f"it returned at 60% max HP ({expected_hp})")
        check(problems, revived and "FATIGUE" in revived["statuses"], "it returned with Fatigue")
        check(problems, after_first_revival["board"][1] is not None and
              after_first_revival["board"][1]["id"] == board_ids[1],
              "the untouched slot kept the Pokemon it drew")
        check(problems, [card["id"] for card in after_first_revival["knockout"]].count(second_out) == 1,
              "the second Fossil is still waiting in the pile")
        check(problems, after_first_revival["knockoutCount"] == 2,
              "three knockouts, one refunded by the revival (2/4)")

        victim = page.evaluate(RIG_NEXT_KNOCKOUT, 1)
        if victim.get("error"):
            raise RuntimeError(victim["error"])
        take_turn(page)
        after_second_revival = page.evaluate(PROBE)
        report("last knockout", after_second_revival)
        for line in reversed(after_second_revival["log"]):
            print(f"    | {line}")

        check(problems, after_second_revival["board"][1] is not None and
              after_second_revival["board"][1]["id"] == second_out,
              "the second Fossil revived into the next open slot")
        check(problems, after_second_revival["knockoutCount"] == 2,
              "four knockouts, two refunded by revivals (2/4)")
        check(problems, not after_second_revival["finished"], "the battle is still going")
        check(problems, not errors, f"no page errors ({errors})")

        page.screenshot(path=str(HERE / "fossil_revival_queue.png"))


def main():
    problems = []

    run_empty_deck(problems)
    run_queue(problems)

    print("\nSCREENSHOTS: dev/verify/fossil_revival_empty_deck.png, dev/verify/fossil_revival_queue.png")
    if problems:
        print(f"\n{len(problems)} PROBLEM(S)")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
