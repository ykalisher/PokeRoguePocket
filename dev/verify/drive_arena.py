"""Plays one full player turn (attacks, item, end turn) with state probes.

Usage: .cache/venv/bin/python drive_arena.py [screenshot.png]
Exits non-zero if the page raised errors or the turn could not be driven.
"""

import sys

from lib import end_turn, fresh_battle, play_attack, play_item, state, wait_for_player_turn

screenshot_path = sys.argv[1] if len(sys.argv) > 1 else None

with fresh_battle() as (page, errors):
    start = state(page)
    print(f"battle up: turn {start['turnNumber']}, hand {start['handSize']}")

    played = []
    skipped = set()
    while True:
        card_id = play_attack(page, skip_card_ids=skipped)
        if not card_id:
            break
        played.append(card_id)
        skipped.add(card_id)
        wait_for_player_turn(page)

    item_id = play_item(page)
    print(f"attacks queued: {played or 'none'}; item played: {item_id or 'none'}")

    if screenshot_path:
        page.screenshot(path=screenshot_path)
        print(f"screenshot: {screenshot_path}")

    if not end_turn(page):
        print("FAIL: could not end turn", file=sys.stderr)
        sys.exit(1)

    final = wait_for_player_turn(page)
    print(
        f"after resolution: turn {final['turnNumber']}, finished {final['finished']}, "
        f"KOs {final['playerKnockouts']}-{final['opponentKnockouts']}"
    )

    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        sys.exit(1)

print("OK: one full turn, no page errors")
