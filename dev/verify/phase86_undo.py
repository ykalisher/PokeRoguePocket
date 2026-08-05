"""Phase 86 — undo snapshots in the controller.

Drives a real battle and checks that undoLastAction() takes back the most
recent player commit (item if the opening hand has one, otherwise a discard),
that repeated undo walks back to the start of the turn, and that nothing the
rival does during its own turn is undoable.

Run: .cache/venv/bin/python phase86_undo.py [shot.png]
"""

import sys

from lib import discard_a_card, end_turn, fresh_battle, play_attack, play_item, state, wait_for_player_turn

SHOT = sys.argv[1] if len(sys.argv) > 1 else "phase86_undo.png"


def hand_ids(page):
    return page.evaluate("CardArena.state.players.player.hand.map(card => card.id)")


def undo(page):
    return page.evaluate("CardArena.Controller.undoLastAction()")


def can_undo(page):
    return page.evaluate("CardArena.Controller.canUndoAction()")


def undo_depth(page):
    return page.evaluate("CardArena.state.undoStack.length")


def top_log(page):
    return page.evaluate("CardArena.state.log[0]")


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not condition:
        raise SystemExit(1)


with fresh_battle() as (page, errors):
    before = hand_ids(page)
    check("battle started with cards in hand", len(before) > 0, f"{len(before)} cards")
    check("undo stack starts empty", undo_depth(page) == 0)
    check("undo unavailable with an empty stack", can_undo(page) is False)

    played = play_item(page)
    kind = "item"

    if played is None:
        played = play_attack(page)
        kind = "attack"

    if played is None:
        check("discarded a card as the fallback action", discard_a_card(page))
        played = next(card_id for card_id in before if card_id not in hand_ids(page))
        kind = "discard"

    # Item and discard commits animate before releasing input; undo is
    # deliberately unavailable until they finish.
    wait_for_player_turn(page)

    check(f"played a card ({kind})", played not in hand_ids(page), played)
    check("the commit pushed one undo point", undo_depth(page) == 1)
    check("undo is offered", can_undo(page) is True)

    check("undoLastAction() reported success", undo(page) is True)
    check("the card is back in hand", played in hand_ids(page))
    check("the log records the undo", "Undid" in (top_log(page) or ""), top_log(page))
    check("the stack is empty again", undo_depth(page) == 0)
    check("a second undo is refused", undo(page) is False)

    # Second pass: two commits, then two undos back to the start of the turn.
    turn_start = sorted(hand_ids(page))
    first = play_attack(page)

    if first:
        second = play_attack(page, skip_card_ids=(first,)) or (
            discard_a_card(page) and next(
                card_id for card_id in turn_start
                if card_id != first and card_id not in hand_ids(page)
            )
        )

        if second:
            wait_for_player_turn(page)
            check("two commits stacked two undo points", undo_depth(page) == 2)
            check("first undo succeeded", undo(page) is True)
            check("second undo succeeded", undo(page) is True)
            check("the hand is back to the start of the turn", sorted(hand_ids(page)) == turn_start)
            check("no queued attacks remain",
                  page.evaluate("CardArena.state.plannedActions.player.length") == 0)
            check("undo is exhausted", can_undo(page) is False)

    page.screenshot(path=SHOT)

    # Rival regression: nothing the opponent does during its turn is undoable.
    while play_attack(page):
        pass

    check("ended the turn", end_turn(page))
    wait_for_player_turn(page)

    current = state(page)
    check("back on the player's turn", current["currentPlayer"] == "player" or current["finished"],
          str(current))
    check("the rival's turn left the undo stack empty", undo_depth(page) == 0)
    check("undo is unavailable at the start of the new turn", can_undo(page) is False)

    check("no page or console errors", not errors, "; ".join(errors))

print(f"\nphase 86 undo verification passed — screenshot: {SHOT}")
