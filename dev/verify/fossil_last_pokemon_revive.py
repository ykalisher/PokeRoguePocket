"""Verifies the FOSSIL last-Pokemon revival in a real battle.

Rigs the default game.html battle so the player's only remaining Pokemon is a
FOSSIL at 1 HP with an empty Pokemon deck and the knockout count one short of
the team size, then lets the rival knock it out for real.

  Run A (revival unused): the battle must NOT finish - the Fossil returns to
  the board at end of turn with 60% max HP and Fatigue, and its knockout is
  refunded.
  Run B (revival already spent, the control): the same knockout must finish
  the battle as a loss, so the fix cannot be "the battle never ends".

Usage: .cache/venv/bin/python fossil_last_pokemon_revive.py
"""

import sys
import time
from pathlib import Path

from lib import discard_a_card, end_turn, fresh_battle, state, wait_for_player_turn

HERE = Path(__file__).resolve().parent

# One Pokemon left and it is a Fossil at 1 HP: the next hit is the team's last
# knockout. initialPokemonCount/knockoutCount stand in for the earlier losses.
RIG_LAST_FOSSIL = """
(alreadyUsedRevival) => {
    const S = window.CardArena.state;
    const player = S.players.player;
    const fossil = (window.CardArena.GameData.pokemon || [])
        .find(record => (record.types || []).includes('FOSSIL'));
    const card = player.board.find(Boolean);

    if (!fossil) return { error: 'no FOSSIL Pokemon in the card data' };
    if (!card) return { error: 'no Pokemon on the player board' };

    card.pokemon = fossil;
    card.currentHealth = 1;
    card.currentStatus = [];
    card.hasUsedFossilRevival = alreadyUsedRevival;

    player.board = player.board.map(() => null);
    player.board[0] = card;
    player.pokemonDeck = [];
    player.knockout = [];
    player.initialPokemonCount = 3;
    player.knockoutCount = 2;
    window.CardArena.Model.updatePokemonLeft(player);

    return { name: fossil.name, types: fossil.types, maxHp: fossil.baseHealth, cardId: card.id };
}
"""

PROBE = """
() => {
    const S = window.CardArena.state;
    const player = S.players.player;
    const describe = card => card && {
        name: card.pokemon.name,
        hp: card.currentHealth,
        maxHp: card.pokemon.baseHealth,
        statuses: (card.currentStatus || []).map(entry => (entry && entry.status) || entry),
        usedRevival: card.hasUsedFossilRevival === true
    };

    return {
        finished: S.finished,
        turnNumber: S.turnNumber,
        knockoutCount: player.knockoutCount,
        initialPokemonCount: player.initialPokemonCount,
        pokemonLeft: player.pokemonLeft,
        board: player.board.map(describe),
        knockout: player.knockout.map(card => card.pokemon && card.pokemon.name),
        popupHidden: S.elements && S.elements.popup ? S.elements.popup.hidden : null,
        log: S.log.slice(0, 12)
    };
}
"""


def check(problems, ok, message):
    print(("  OK   " if ok else "  FAIL ") + message)
    if not ok:
        problems.append(message)


def run_scenario(already_used_revival, shot_name):
    """Rigs the battle, then ends turns until the Fossil goes down."""
    label = "spent revival (control)" if already_used_revival else "unused revival"
    print(f"\n=== Fossil as the last Pokemon, {label} ===")

    with fresh_battle() as (page, errors):
        rigged = page.evaluate(RIG_LAST_FOSSIL, already_used_revival)
        if rigged.get("error"):
            raise RuntimeError(rigged["error"])
        print(f"  rigged: {rigged['name']} {rigged['types']} at 1/{rigged['maxHp']} HP, "
              f"knockouts 2/3, empty Pokemon deck")

        # The player has nothing worth doing; hand the turn to the rival and
        # let its AI land the real knockout. A revival refunds the knockout, so
        # stop on the spent revival (or the battle ending), never on the count.
        for _ in range(6):
            if not end_turn(page):
                discard_a_card(page)
                end_turn(page)
            wait_for_player_turn(page)
            snapshot = page.evaluate(PROBE)
            revived = snapshot["board"][0]
            if snapshot["finished"] or (revived and revived["usedRevival"]):
                break
            if revived and revived["hp"] > 1:
                # A rival heal/miss left it standing; put it back on the brink.
                page.evaluate("() => { CardArena.state.players.player.board[0].currentHealth = 1; }")
            time.sleep(0.2)

        snapshot = page.evaluate(PROBE)
        page.screenshot(path=str(HERE / shot_name))
        print(f"  final: finished={snapshot['finished']} turn={snapshot['turnNumber']} "
              f"knockouts={snapshot['knockoutCount']}/{snapshot['initialPokemonCount']} "
              f"board={[card and (card['name'], card['hp'], card['statuses']) for card in snapshot['board']]}")
        for line in reversed(snapshot["log"]):
            print(f"    | {line}")

        return snapshot, errors, rigged


def main():
    problems = []

    snapshot, errors, rigged = run_scenario(False, "fossil_last_revive.png")
    revived = snapshot["board"][0]
    expected_hp = -(-rigged["maxHp"] * 6 // 10)  # ceil(60% max HP)

    check(problems, not snapshot["finished"], "battle did not end when the last Pokemon was knocked out")
    check(problems, revived is not None, "a Pokemon is back on the board")
    check(problems, revived and revived["name"] == rigged["name"],
          f"the revived Pokemon is the Fossil ({rigged['name']})")
    check(problems, revived and revived["hp"] == expected_hp,
          f"it returned at 60% max HP ({expected_hp})")
    check(problems, revived and "FATIGUE" in revived["statuses"], "it returned with Fatigue")
    check(problems, revived and revived["usedRevival"], "its once-per-card revival is now spent")
    check(problems, snapshot["knockoutCount"] == 2, "its knockout was refunded (2/3, not 3/3)")
    check(problems, any("revived from the knockout pile" in line for line in snapshot["log"]),
          "the battle log reports the revival")
    check(problems, not errors, f"no page errors ({errors})")

    control, control_errors, _ = run_scenario(True, "fossil_last_no_revive.png")

    check(problems, control["finished"], "control: a spent revival still loses the battle")
    check(problems, control["knockoutCount"] == 3, "control: the knockout counted (3/3)")
    check(problems, all(card is None for card in control["board"]), "control: nothing came back")
    check(problems, not control_errors, f"control: no page errors ({control_errors})")

    print("\nSCREENSHOTS: dev/verify/fossil_last_revive.png, dev/verify/fossil_last_no_revive.png")
    if problems:
        print(f"\n{len(problems)} PROBLEM(S)")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
