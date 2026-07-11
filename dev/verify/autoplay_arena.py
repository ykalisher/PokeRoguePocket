"""Autoplays a battle to completion and reports winner, turns, and errors.

Usage: .cache/venv/bin/python autoplay_arena.py [max_turns]
Exits non-zero on page errors or if the battle does not finish.
"""

import sys

from lib import discard_a_card, end_turn, fresh_battle, play_attack, play_item, state, wait_for_player_turn

max_turns = int(sys.argv[1]) if len(sys.argv) > 1 else 40

with fresh_battle() as (page, errors):
    while True:
        current = wait_for_player_turn(page)
        if current["finished"]:
            break
        if current["turnNumber"] > max_turns:
            print(f"FAIL: battle still running after {max_turns} turns", file=sys.stderr)
            sys.exit(1)

        skipped = set()
        while True:
            card_id = play_attack(page, skip_card_ids=skipped)
            if not card_id:
                break
            skipped.add(card_id)
            current = wait_for_player_turn(page)
            if current["finished"]:
                break
        if current["finished"]:
            break

        play_item(page)

        # End the turn; the controller may demand discards first.
        while not end_turn(page, timeout=5):
            if not discard_a_card(page):
                print("FAIL: cannot end turn or discard", file=sys.stderr)
                sys.exit(1)

    final = state(page)
    winner = "player" if final["opponentKnockouts"] >= final["playerKnockouts"] else "opponent"
    print(
        f"battle finished on turn {final['turnNumber']}: "
        f"KOs player {final['playerKnockouts']} - opponent {final['opponentKnockouts']} "
        f"(likely winner: {winner})"
    )

    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        sys.exit(1)

print("OK: battle completed with no page errors")
