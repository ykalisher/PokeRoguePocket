"""Repro probe 2: knock the player's Pokemon out one at a time through the
real controller path (Controller.knockOutPokemon + end-of-turn replacement)
and report which knockout ends the battle.

Runs against the default game.html battle (both sides get the 6-Pokemon
default deck), so no run/map seeding is needed.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import discard_a_card, fresh_battle, state, wait_for_player_turn  # noqa: E402

HERE = Path(__file__).resolve().parent

KO_ONE = """
() => {
    const S = CardArena.state;
    const C = CardArena.Controller;
    const p = S.players.player;
    const alive = p.board.filter(Boolean);
    if (alive.length === 0) return { skipped: true };
    C.knockOutPokemon('player', alive[0]);
    return {
        name: alive[0].pokemon.name,
        knockoutCount: p.knockoutCount,
        initialPokemonCount: p.initialPokemonCount,
        boardAlive: p.board.filter(Boolean).length,
        deckLeft: p.pokemonDeck.length,
        defeated: CardArena.Model.isPlayerDefeated(p)
    };
}
"""


def click_end_turn(page):
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            page.click("[data-action='end-turn']", timeout=1000)
            return True
        except Exception:
            if not discard_a_card(page):
                time.sleep(0.3)
    return False


def main():
    with fresh_battle() as (page, errors):
        info = page.evaluate("""() => {
            const p = CardArena.state.players.player;
            return { initial: p.initialPokemonCount, deck: p.pokemonDeck.length,
                     board: p.board.filter(Boolean).length,
                     pill: document.querySelector('.side-panel--player .stat-pill').textContent };
        }""")
        print("start:", info)

        for i in range(1, 9):
            result = page.evaluate(KO_ONE)
            if result.get("skipped"):
                print(f"KO {i}: no Pokemon on the board to knock out")
            else:
                print(f"KO {i}: {result}")
            finished = state(page)["finished"]
            print(f"      state.finished right after KO: {finished}")
            if finished:
                pill = page.inner_text(".side-panel--player .stat-pill")
                print(f"      BATTLE ENDED at knockout #{i}; player pill {pill!r}")
                page.screenshot(path=str(HERE / "repro_ko_sequence.png"))
                break
            # End the turn so queued replacements resolve, then come back.
            click_end_turn(page)
            after = state(page)
            print(f"      after End Turn: finished={after['finished']}")
            if after["finished"]:
                print(f"      BATTLE ENDED after end-of-turn following knockout #{i}")
                page.screenshot(path=str(HERE / "repro_ko_sequence.png"))
                break
            wait_for_player_turn(page)

        for err in errors:
            print("ERR", err)


if __name__ == "__main__":
    main()
