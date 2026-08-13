"""Mart pokemon trade service: two offers, each naming the pokemon it hands back.

(a) Every offer shows its wanted type, the exact pokemon on offer (name + card
    preview), and no two offers name the same pokemon. Buttons start disabled.
(b) Selecting a pokemon whose types don't include an offer's wanted type keeps
    that offer's button disabled.
(c) Selecting a matching pokemon enables that offer; confirming swaps exactly
    one pokemon (count unchanged, no cash spent) and hands back precisely the
    pictured species. That offer flips to "Used"; the other stays available.
(d) Re-entering the same mart node keeps the used offer used and the untouched
    offer unchanged; a different mart node rolls both fresh (not "Used").

Usage: .cache/venv/bin/python phase46_mart_trade.py [shot_prefix]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"

TWO_SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [
            { from: 'start', to: 'shop-1' },
            { from: 'shop-1', to: 'shop-2' }
        ],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 30 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 30 },
            { id: 'shop-2', lane: 2, step: 2, type: 'shop', x: 80, y: 30 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

# Two disjoint-type owned pokemon (WATER/MONSTER, FIRE/FLYING) so for any one
# offer's wanted type, exactly one of the two ever matches.
SET_POKEMON_JS = """(names) => {
    const gameData = window.CardArena.GameData;
    const records = names.map(name => gameData.pokemon.find(p => p.name === name));
    const run = JSON.parse(localStorage.getItem('%s'));
    run.collections.pokemon = records.map((record, index) => ({
        currentHealth: record.baseHealth,
        currentStatus: [],
        faceUp: true,
        hasUsedFossilRevival: false,
        id: `test-pkmn-${record.name}-${index}`,
        kind: 'pokemon',
        owner: 'player',
        pokemon: record,
        statStages: { attack: 0, defense: 0, speed: 0 }
    }));
    run.collections.bench.pokemon = [];
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

STARTING_NAMES = ("Blastoise", "Charizard")


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def get_trades(page, node_id):
    return get_run(page)["martEncounters"][node_id]["trades"]


def total_pokemon(page):
    run = get_run(page)
    return len(run["collections"]["pokemon"]) + len(run["collections"]["bench"]["pokemon"])


def record_types(record):
    return [t for t in (record.get("type1"), record.get("type2"), record.get("type3")) if t and t != "NONE"]


def owned_types(page, name):
    run = get_run(page)
    cards = run["collections"]["pokemon"] + run["collections"]["bench"]["pokemon"]
    card = next(c for c in cards if c["pokemon"]["name"] == name)
    return record_types(card["pokemon"])


def start_run(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='water']")
    page.evaluate("localStorage.clear()")
    page.click(".starter-card[data-starter='water']")
    page.wait_for_function(
        "() => location.pathname.endsWith('area.html') && localStorage.getItem('%s')" % RUN_KEY,
        timeout=15000,
    )
    page.evaluate(TWO_SHOP_GRAPH_JS)
    page.evaluate(SET_POKEMON_JS, list(STARTING_NAMES))


def enter_shop(page, node_id):
    page.reload()
    page.wait_for_selector(f"[data-node-id='{node_id}']")
    page.click(f"[data-node-id='{node_id}']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-trade-row")


def trade_button(page, index):
    return page.query_selector(f"[data-mart-service='trade'][data-trade-index='{index}']")


def trade_row_text(page, index):
    return page.eval_on_selector(
        f"[data-trade-index='{index}']", "btn => btn.closest('.mart-service-row').textContent"
    )


def trade_card_name(page, index):
    return page.eval_on_selector(
        f"[data-trade-index='{index}']",
        "btn => { const card = btn.closest('.mart-service-row').querySelector('.mart-trade-card');"
        "  return card ? card.getAttribute('aria-label') : null; }",
    )


def button_state(page, index):
    button = trade_button(page, index)
    return button.is_disabled(), button.text_content().strip()


def select_pokemon(page, name):
    page.click(f"[aria-label='Select {name}']")


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        start_run(page, base)
        enter_shop(page, "shop-1")

        trades = get_trades(page, "shop-1")
        print(f"(a) rolled trades={trades}")

        rendered = page.query_selector_all("[data-mart-service='trade']")
        if len(trades) < 2 or len(rendered) != len(trades):
            ok = False
            print(f"FAIL: expected 2+ offers rendered one row each, got {len(trades)} trades / {len(rendered)} rows")

        offered_names = [trade["offeredName"] for trade in trades]
        if len(set(offered_names)) != len(offered_names):
            ok = False
            print(f"FAIL: offers should name different pokemon, got {offered_names}")

        # (a) Each row names its wanted type and the exact pokemon on offer,
        #     shows that pokemon's card, and starts disabled.
        for index, trade in enumerate(trades):
            row_text = trade_row_text(page, index)
            card_name = trade_card_name(page, index)
            disabled, _ = button_state(page, index)
            print(f"(a) offer {index}: card={card_name!r} disabled={disabled} text={row_text!r}")
            if trade["acceptedType"] not in row_text or trade["offeredName"] not in row_text:
                ok = False
                print(f"FAIL: offer {index} should show wanted type and the offered pokemon's name up front")
            if card_name != trade["offeredName"]:
                ok = False
                print(f"FAIL: offer {index} should preview {trade['offeredName']!r}, previewed {card_name!r}")
            if not disabled:
                ok = False
                print(f"FAIL: offer {index} button should be disabled with nothing selected")

        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_offer.png")

        # Trade against offer 0, whose wanted type one of the two owned pokemon has.
        types_by_name = {name: owned_types(page, name) for name in STARTING_NAMES}
        accepted_type = trades[0]["acceptedType"]
        matching_name = next((name for name, types in types_by_name.items() if accepted_type in types), None)
        non_matching_name = next((name for name in STARTING_NAMES if name != matching_name), None)

        if not matching_name:
            ok = False
            print(f"FAIL: offer 0 wants {accepted_type!r}, which matches neither owned pokemon {types_by_name}")
        else:
            # (b) The non-matching pokemon keeps offer 0 disabled.
            select_pokemon(page, non_matching_name)
            disabled, _ = button_state(page, 0)
            row_text = trade_row_text(page, 0)
            print(f"(b) selected non-matching {non_matching_name}: disabled={disabled} text={row_text!r}")
            if not disabled:
                ok = False
                print(f"FAIL: selecting non-matching {non_matching_name} should keep offer 0 disabled")
            if "must be" not in row_text:
                ok = False
                print("FAIL: helper text should explain the type mismatch")

            # (c) The matching pokemon enables it.
            select_pokemon(page, non_matching_name)  # deselect
            select_pokemon(page, matching_name)
            disabled, _ = button_state(page, 0)
            print(f"(c) selected matching {matching_name}: enabled={not disabled}")
            if disabled:
                ok = False
                print(f"FAIL: selecting matching {matching_name} should enable offer 0")

            promised_name = trades[0]["offeredName"]
            other_offer_before = trades[1]
            before_count = total_pokemon(page)
            before_cash = get_run(page)["cash"]
            trade_button(page, 0).click()
            # Trading now goes through a confirmation dialog showing both cards.
            page.wait_for_selector("[data-mart-confirm-overlay]")
            page.click("[data-resolve-mart-confirm]")
            page.wait_for_function(
                "() => JSON.parse(localStorage.getItem('%s')).martEncounters['shop-1'].trades[0].used === true"
                % RUN_KEY,
                timeout=5000,
            )

            after_count = total_pokemon(page)
            after_cash = get_run(page)["cash"]
            run_after = get_run(page)
            names_after = [c["pokemon"]["name"] for c in run_after["collections"]["pokemon"]]
            new_cards = [c for c in run_after["collections"]["pokemon"] if c["pokemon"]["name"] not in STARTING_NAMES]
            print(f"(c) count before={before_count} after={after_count}, collection={names_after}")
            if after_count != before_count:
                ok = False
                print(f"FAIL: pokemon count should stay {before_count}, got {after_count}")
            if after_cash != before_cash:
                ok = False
                print("FAIL: trade should be free (cash unchanged)")
            if matching_name in names_after:
                ok = False
                print(f"FAIL: {matching_name} should have been traded away")
            if len(new_cards) != 1:
                ok = False
                print(f"FAIL: expected exactly one new pokemon card, got {len(new_cards)}")
            else:
                received_name = new_cards[0]["pokemon"]["name"]
                print(f"(c) promised {promised_name!r}, received {received_name!r}")
                if received_name != promised_name:
                    ok = False
                    print(f"FAIL: received {received_name!r} but the offer pictured {promised_name!r}")

            disabled, text = button_state(page, 0)
            print(f"(c) offer 0 after trading: disabled={disabled} text={text!r}")
            if not disabled or text != "Used":
                ok = False
                print("FAIL: the taken offer should read Used and be disabled")

            other_disabled, other_text = button_state(page, 1)
            trades_after = get_trades(page, "shop-1")
            print(f"(c) offer 1 after trading: text={other_text!r} trade={trades_after[1]}")
            if other_text == "Used" or trades_after[1]["used"]:
                ok = False
                print("FAIL: taking one offer should leave the other available")
            if trades_after[1]["offeredName"] != other_offer_before["offeredName"] and \
                    other_offer_before["acceptedType"] in types_by_name[matching_name]:
                print("(c) offer 1 re-rolled because its wanted type left with the traded pokemon (expected)")
            elif trades_after[1] != other_offer_before:
                ok = False
                print(f"FAIL: offer 1 should be untouched, was {other_offer_before} now {trades_after[1]}")

            if shot_prefix:
                page.screenshot(path=f"{shot_prefix}_used.png")

            # (d) Re-entering the same node keeps the used offer used.
            trades_before_reload = get_trades(page, "shop-1")
            page.reload()
            page.wait_for_selector(".mart-trade-row")
            disabled, text = button_state(page, 0)
            print(f"(d) re-entry same node, offer 0: disabled={disabled} text={text!r}")
            if not disabled or text != "Used":
                ok = False
                print("FAIL: re-entering the same mart node should keep the taken offer used")
            if get_trades(page, "shop-1") != trades_before_reload:
                ok = False
                print("FAIL: re-entering the same mart node should not change the offers")

            # A different mart node rolls both fresh (not Used).
            page.click("[data-mart-action='continue']")
            page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
            enter_shop(page, "shop-2")
            fresh_trades = get_trades(page, "shop-2")
            fresh_texts = [button_state(page, index)[1] for index in range(len(fresh_trades))]
            print(f"(d) different node (shop-2): trades={fresh_trades} buttons={fresh_texts}")
            if any(text == "Used" for text in fresh_texts) or any(trade["used"] for trade in fresh_trades):
                ok = False
                print("FAIL: a different mart node should offer both trades fresh (not Used)")

        browser.close()

    if errors:
        ok = False
        print("PAGE ERRORS:")
        for e in errors:
            print(" ", e)

    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
