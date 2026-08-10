"""Discard Hand + the Withdraw Wand undo reset under mobile touch input.

Same flow as discard_hand_undo.py, but in a touch-only mobile context (no
mouse, iPhone-sized viewport, device pixel ratio 3) driven with page.tap()
instead of page.click(). The battle's pointer/drag layer sets
state.suppressNextClick for taps that never crossed the drag threshold, so a
tap reaching the command buttons at all is worth proving separately.

Run: .cache/venv/bin/python discard_hand_mobile.py
"""

from lib import BASE_URL, serving, sync_playwright, wait_for_player_turn

VIEWPORT = {"width": 390, "height": 844}

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


def tap(page, selector):
    """Taps by selector, scrolling it into the viewport first: the phone layout
    stacks the board above the turn-control box, so commands can sit off-screen."""
    page.locator(selector).first.scroll_into_view_if_needed()
    page.tap(selector)


def is_selected(page, card_id):
    return page.evaluate(
        "cardId => CardArena.state.selectedCardId === cardId"
        " || CardArena.state.pendingActionCardId === cardId",
        card_id,
    )


def selectable_hand_ids(page):
    """Hand card ids, attacks first.

    Order matters: tapping a Dragon Gem or an effect-boost item plays it on the
    spot rather than selecting it, which both leaves Discard disabled and burns
    the turn's single item use that the wand needs later. Attacks always select.
    """
    cards = page.query_selector_all(".hand-row--player [data-card-id]")
    ranked = sorted(
        cards,
        key=lambda card: 0 if "card-kind-attack" in (card.get_attribute("class") or "") else 1,
    )

    return [card.get_attribute("data-card-id") for card in ranked]


def tap_discard_one_card(page):
    """Discards a single hand card by tap, returning its id. Skips any card that
    plays itself on tap instead of landing in the selection."""
    card_ids = selectable_hand_ids(page)

    check("the hand holds a card to discard", bool(card_ids), hand_ids(page))

    for card_id in card_ids:
        tap(page, f'.hand-row--player [data-card-id="{card_id}"]')
        page.wait_for_timeout(250)

        if not is_selected(page, card_id):
            wait_for_player_turn(page)
            continue

        tap(page, "[data-action='discard-selected']")
        wait_for_player_turn(page)
        return card_id

    raise SystemExit("no hand card could be selected for discard")


def check(label, condition, detail=""):
    print(f"{'ok  ' if condition else 'FAIL'} {label}{f' — {detail}' if detail else ''}")
    if not condition:
        raise SystemExit(1)


errors = []

with serving(), sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        device_scale_factor=3,
        has_touch=True,
        is_mobile=True,
        viewport=VIEWPORT,
    )
    page = context.new_page()
    page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
    page.on(
        "console",
        lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
    )
    page.goto(f"{BASE_URL}/game.html")
    page.evaluate("localStorage.clear()")
    page.reload()
    wait_for_player_turn(page)

    check("touch-only context (no mouse)", page.evaluate("navigator.maxTouchPoints > 0"))

    # --- Part 1: tap Discard Hand, then tap Undo. --------------------------
    check("Discard Hand is enabled with cards in hand", is_disabled(page, DISCARD_HAND) is False)

    starting_hand = hand_ids(page)
    starting_discard = discard_ids(page)

    check("the fresh hand has cards to sweep", len(starting_hand) > 1, len(starting_hand))

    tap(page, DISCARD_HAND)
    wait_for_player_turn(page)

    check("a tap emptied the hand", hand_ids(page) == [], hand_ids(page))
    check(
        "every hand card landed in the discard pile",
        sorted(discard_ids(page)) == sorted(starting_hand + starting_discard),
    )
    check("Discard Hand disables itself on an empty hand", is_disabled(page, DISCARD_HAND) is True)
    check("the sweep is a single undo step", undo_depth(page) == 1, undo_depth(page))

    page.screenshot(path="discard_hand_mobile_swept.png")

    tap(page, UNDO)
    page.wait_for_timeout(400)

    check("one Undo tap restores the whole hand", sorted(hand_ids(page)) == sorted(starting_hand))
    check("the discard pile is back to its old contents", discard_ids(page) == starting_discard)
    check("the log names the undone sweep", "Undid discarding your hand." in top_log(page), top_log(page))
    check("Undo is disabled again", is_disabled(page, UNDO) is True)

    page.screenshot(path="discard_hand_mobile_restored.png")

    # --- Part 2: the wand is not undoable and resets the stack. ------------
    wand_id = page.evaluate(MOVE_SWITCH_ITEM_TO_HAND)

    check("a SWITCH item is available in hand", wand_id is not None)

    discarded_before = tap_discard_one_card(page)

    check("an ordinary tap-action before the wand is undoable", is_disabled(page, UNDO) is False)

    board_before = board_ids(page)

    tap(page, f'.hand-row--player [data-card-id="{wand_id}"]')
    page.wait_for_timeout(250)
    tap(page, ".playing-card.is-targetable")
    wait_for_player_turn(page)

    check("the wand left the player's hand", wand_id not in hand_ids(page))
    check("the wand swapped a Pokemon on the board", board_ids(page) != board_before,
          f"{board_before} -> {board_ids(page)}")
    check("the wand wiped the undo stack", undo_depth(page) == 0)
    check("Undo is disabled right after the wand", is_disabled(page, UNDO) is True)

    discarded_after = tap_discard_one_card(page)

    check("Undo is enabled again for the next action", is_disabled(page, UNDO) is False)

    tap(page, UNDO)
    page.wait_for_timeout(400)

    check("the post-wand discard came back", discarded_after in hand_ids(page))
    check("the wand's switch was not walked back", board_ids(page) != board_before,
          f"{board_before} -> {board_ids(page)}")
    check("the pre-wand discard stays discarded", discarded_before not in hand_ids(page))

    check("no page or console errors", not errors, "; ".join(errors))

    browser.close()

print("\nmobile discard-hand / withdraw-wand verification passed")
