"""Discard Hand button + the Withdraw Wand undo reset.

Part 1 drives the new "Discard Hand" command in the battle action bar: the
whole hand goes to the discard pile and a single Undo press brings all of it
back.

Part 2 checks that a SWITCH item (Withdraw Wand) is not undoable and wipes the
undo stack, while anything played after it is undoable again. The wand is
pulled out of the player's action deck by its SWITCH status rather than by
name, since a fresh hand only sometimes contains it.

Run: .cache/venv/bin/python discard_hand_undo.py [shot.png]
"""

import sys

from lib import fresh_battle, wait_for_player_turn

SHOT = sys.argv[1] if len(sys.argv) > 1 else "discard_hand_undo.png"

DISCARD_HAND = "[data-action='discard-hand']"
UNDO = "[data-action='undo']"

MOVE_SWITCH_ITEM_TO_HAND = """(() => {
    const player = CardArena.state.players.player;
    const isSwitchItem = card => card.item && (card.item.status || []).includes('SWITCH');
    const held = player.hand.find(isSwitchItem);

    if (held) return held.id;

    const index = player.deck.findIndex(isSwitchItem);

    if (index === -1) return null;

    const [card] = player.deck.splice(index, 1);

    card.faceUp = true;
    player.hand.push(card);
    CardArena.Render.render();

    return card.id;
})()"""


def hand_ids(page):
    return page.evaluate("CardArena.state.players.player.hand.map(card => card.id)")


def discard_ids(page):
    return page.evaluate("CardArena.state.players.player.discard.map(card => card.id)")


def board_ids(page):
    return page.evaluate(
        "CardArena.state.players.player.board.filter(Boolean).map(card => card.id)"
    )


def undo_depth(page):
    return page.evaluate("CardArena.state.undoStack.length")


def top_log(page):
    return page.evaluate("CardArena.state.log[0]") or ""


def is_disabled(page, selector):
    button = page.query_selector(selector)
    if button is None:
        return None
    return button.get_attribute("disabled") is not None


def is_selected(page, card_id):
    return page.evaluate(
        "cardId => CardArena.state.selectedCardId === cardId"
        " || CardArena.state.pendingActionCardId === cardId",
        card_id,
    )


def selectable_hand_ids(page):
    """Hand card ids, attacks first.

    Order matters: clicking a Dragon Gem or an effect-boost item plays it on the
    spot rather than selecting it, which both leaves Discard disabled and burns
    the turn's single item use that the wand needs later. Attacks always select.
    """
    cards = page.query_selector_all(".hand-row--player [data-card-id]")
    ranked = sorted(
        cards,
        key=lambda card: 0 if "card-kind-attack" in (card.get_attribute("class") or "") else 1,
    )

    return [card.get_attribute("data-card-id") for card in ranked]


def discard_one_card(page):
    """Discards a single hand card by clicking it, returning its id. Skips any
    card that plays itself on click instead of landing in the selection."""
    card_ids = selectable_hand_ids(page)

    check("the hand holds a card to discard", bool(card_ids), hand_ids(page))

    for card_id in card_ids:
        page.click(f'.hand-row--player [data-card-id="{card_id}"]')
        page.wait_for_timeout(200)

        if not is_selected(page, card_id):
            wait_for_player_turn(page)
            continue

        page.click("[data-action='discard-selected']")
        wait_for_player_turn(page)
        return card_id

    raise SystemExit("no hand card could be selected for discard")


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not condition:
        raise SystemExit(1)


with fresh_battle() as (page, errors):
    wait_for_player_turn(page)

    # --- Part 1: Discard Hand, then undo it in one press. -------------------
    check("Discard Hand button is present", is_disabled(page, DISCARD_HAND) is not None)
    check("Discard Hand is enabled with cards in hand", is_disabled(page, DISCARD_HAND) is False)

    starting_hand = hand_ids(page)
    starting_discard = discard_ids(page)

    check("the fresh hand has cards to sweep", len(starting_hand) > 1, len(starting_hand))

    page.click(DISCARD_HAND)
    wait_for_player_turn(page)

    check("the hand is empty after Discard Hand", hand_ids(page) == [], hand_ids(page))
    check(
        "every hand card landed in the discard pile",
        sorted(discard_ids(page)) == sorted(starting_hand + starting_discard),
    )
    check("Discard Hand disables itself on an empty hand", is_disabled(page, DISCARD_HAND) is True)
    check("the sweep is a single undo step", undo_depth(page) == 1, undo_depth(page))

    page.screenshot(path=SHOT)

    page.click(UNDO)
    page.wait_for_timeout(300)

    check("one Undo restores the whole hand", sorted(hand_ids(page)) == sorted(starting_hand))
    check("the discard pile is back to its old contents", discard_ids(page) == starting_discard)
    check("the log names the undone sweep", "Undid discarding your hand." in top_log(page), top_log(page))
    check("Undo is disabled again", is_disabled(page, UNDO) is True)

    # --- Part 2: Withdraw Wand is not undoable and resets the stack. --------
    wand_id = page.evaluate(MOVE_SWITCH_ITEM_TO_HAND)

    check("a SWITCH item is available in hand", wand_id is not None)

    discarded_before = discard_one_card(page)

    check("an ordinary action before the wand is undoable", is_disabled(page, UNDO) is False)

    board_before = board_ids(page)

    page.click(f'.hand-row--player [data-card-id="{wand_id}"]')
    page.wait_for_timeout(200)
    page.click(".playing-card.is-targetable")
    wait_for_player_turn(page)

    check("the wand left the player's hand", wand_id not in hand_ids(page))
    check("the wand swapped a Pokemon on the board", board_ids(page) != board_before,
          f"{board_before} -> {board_ids(page)}")
    check("the wand wiped the undo stack", undo_depth(page) == 0)
    check("Undo is disabled right after the wand", is_disabled(page, UNDO) is True)

    # --- Part 2b: a later action is undoable again. -------------------------
    discarded_after = discard_one_card(page)

    check("Undo is enabled again for the next action", is_disabled(page, UNDO) is False)

    page.click(UNDO)
    page.wait_for_timeout(300)

    check("the post-wand discard came back", discarded_after in hand_ids(page))
    check("the wand's switch was not walked back", board_ids(page) != board_before,
          f"{board_before} -> {board_ids(page)}")
    check("the pre-wand discard stays discarded", discarded_before not in hand_ids(page))

    check("no page or console errors", not errors, "; ".join(errors))

print(f"\ndiscard-hand / withdraw-wand undo verification passed — screenshot: {SHOT}")
