"""Phase 87 — the Undo button in the battle action bar.

Drives a real battle, clicks the Undo button in the DOM (rather than calling
the controller directly, which phase86_undo.py already covers), and checks
the button's disabled state tracks canUndoAction() through a commit and an
undo.

Run: .cache/venv/bin/python phase87_battle_undo.py [shot.png]
"""

import sys

from lib import discard_a_card, fresh_battle, play_item, wait_for_player_turn

SHOT = sys.argv[1] if len(sys.argv) > 1 else "phase87_battle_undo.png"

UNDO_SELECTOR = "[data-action='undo']"


def hand_size(page):
    return page.evaluate("CardArena.state.players.player.hand.length")


def top_log(page):
    return page.evaluate("CardArena.state.log[0]")


def is_undo_disabled(page):
    button = page.query_selector(UNDO_SELECTOR)
    if button is None:
        return None
    return button.get_attribute("disabled") is not None


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not condition:
        raise SystemExit(1)


with fresh_battle() as (page, errors):
    wait_for_player_turn(page)

    check("Undo button is present at the start of a fresh turn", is_undo_disabled(page) is not None)
    check("Undo is disabled at the start of a fresh turn", is_undo_disabled(page) is True)

    starting_hand_size = hand_size(page)

    played = play_item(page)
    kind = "item"

    if played is None:
        check("discarded a card as the fallback action", discard_a_card(page))
        kind = "discard"

    wait_for_player_turn(page)

    check(f"played a card ({kind})", hand_size(page) == starting_hand_size - 1, hand_size(page))
    check("Undo is enabled after a commit", is_undo_disabled(page) is False)

    reduced_hand_size = hand_size(page)

    page.click(UNDO_SELECTOR)
    page.wait_for_timeout(300)

    check("the hand size went back up", hand_size(page) == reduced_hand_size + 1, hand_size(page))
    check("the log records the undo", "Undid " in (top_log(page) or ""), top_log(page))
    check("Undo is disabled again", is_undo_disabled(page) is True)

    page.screenshot(path=SHOT)

    check("no page or console errors", not errors, "; ".join(errors))

print(f"\nphase 87 battle undo verification passed — screenshot: {SHOT}")
