"""Phase 46 verification: mart typed 1:1 pokemon trade service.

(a) Both the wanted and offered types are shown before any commitment, and the
    button is disabled with nothing selected.
(b) Selecting a pokemon whose types don't include the accepted type keeps the
    button disabled.
(c) Selecting a matching pokemon enables the button; confirming swaps exactly
    one pokemon (count unchanged), the received pokemon's types include the
    offered type, and the button flips to "Used".
(d) Re-entering the same mart node keeps it used; a different mart node rolls
    fresh types (not "Used").

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

# Two disjoint-type owned pokemon (WATER/MONSTER, FIRE/FLYING) so whichever
# type the trade rolls as "accepted", exactly one of the two ever matches.
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


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def get_encounter(page, node_id):
    return get_run(page)["martEncounters"][node_id]


def total_pokemon(page):
    run = get_run(page)
    return len(run["collections"]["pokemon"]) + len(run["collections"]["bench"]["pokemon"])


def record_types(record):
    return [t for t in (record.get("type1"), record.get("type2"), record.get("type3")) if t and t != "NONE"]


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
    page.evaluate(SET_POKEMON_JS, ["Blastoise", "Charizard"])


def enter_shop(page, node_id):
    page.reload()
    page.wait_for_selector(f"[data-node-id='{node_id}']")
    page.click(f"[data-node-id='{node_id}']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-service-row")


def trade_button(page):
    return page.query_selector("[data-mart-service='trade']")


def trade_row_text(page):
    return page.eval_on_selector(
        "[data-mart-service='trade']", "btn => btn.closest('.mart-service-row').textContent"
    )


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

        encounter = get_encounter(page, "shop-1")
        accepted_type = encounter["tradeAcceptedType"]
        offered_type = encounter["tradeOfferedType"]
        print(f"(a) rolled tradeAcceptedType={accepted_type!r} tradeOfferedType={offered_type!r}")

        run = get_run(page)
        cards_by_name = {c["pokemon"]["name"]: c for c in run["collections"]["pokemon"]}
        blastoise_types = record_types(cards_by_name["Blastoise"]["pokemon"])
        charizard_types = record_types(cards_by_name["Charizard"]["pokemon"])
        if accepted_type in blastoise_types:
            matching_name, non_matching_name = "Blastoise", "Charizard"
        elif accepted_type in charizard_types:
            matching_name, non_matching_name = "Charizard", "Blastoise"
        else:
            ok = False
            matching_name, non_matching_name = None, None
            print(f"FAIL: rolled acceptedType {accepted_type!r} matches neither owned pokemon")

        # (a) Both types shown up front, button disabled with nothing selected.
        row_text = trade_row_text(page)
        print(f"(a) trade row text: {row_text!r}")
        if accepted_type not in row_text or offered_type not in row_text:
            ok = False
            print("FAIL: trade row should show both the wanted and offered types before any selection")
        if not trade_button(page).is_disabled():
            ok = False
            print("FAIL: trade button should be disabled with nothing selected")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_offer.png")

        if matching_name:
            # (b) Selecting the non-matching pokemon keeps it disabled.
            select_pokemon(page, non_matching_name)
            disabled_non_match = trade_button(page).is_disabled()
            row_text = trade_row_text(page)
            print(f"(b) selected non-matching {non_matching_name}: disabled={disabled_non_match} text={row_text!r}")
            if not disabled_non_match:
                ok = False
                print(f"FAIL: selecting non-matching {non_matching_name} should keep the trade button disabled")
            if "must be" not in row_text:
                ok = False
                print("FAIL: helper text should explain the type mismatch")

            # (c) Selecting the matching pokemon enables it.
            select_pokemon(page, non_matching_name)  # deselect
            select_pokemon(page, matching_name)
            enabled_match = not trade_button(page).is_disabled()
            print(f"(c) selected matching {matching_name}: enabled={enabled_match}")
            if not enabled_match:
                ok = False
                print(f"FAIL: selecting matching {matching_name} should enable the trade button")

            before_count = total_pokemon(page)
            before_cash = get_run(page)["cash"]
            trade_button(page).click()
            page.wait_for_function(
                "() => JSON.parse(localStorage.getItem('%s')).martEncounters['shop-1'].tradeUsed === true"
                % RUN_KEY,
                timeout=5000,
            )
            after_count = total_pokemon(page)
            after_cash = get_run(page)["cash"]
            run_after = get_run(page)
            traded_gone = matching_name not in [c["pokemon"]["name"] for c in run_after["collections"]["pokemon"]]
            new_cards = [
                c for c in run_after["collections"]["pokemon"]
                if c["pokemon"]["name"] not in ("Blastoise", "Charizard")
            ]
            print(f"(c) count before={before_count} after={after_count}, traded_gone={traded_gone}, new_cards={[c['pokemon']['name'] for c in new_cards]}")
            if after_count != before_count:
                ok = False
                print(f"FAIL: pokemon count should stay {before_count}, got {after_count}")
            if after_cash != before_cash:
                ok = False
                print("FAIL: trade should be free (cash unchanged)")
            if not traded_gone:
                ok = False
                print(f"FAIL: {matching_name} should have been traded away")
            if len(new_cards) != 1:
                ok = False
                print(f"FAIL: expected exactly one new pokemon card, got {len(new_cards)}")
            else:
                received_types = record_types(new_cards[0]["pokemon"])
                print(f"(c) received {new_cards[0]['pokemon']['name']} types={received_types}")
                if offered_type not in received_types:
                    ok = False
                    print(f"FAIL: received pokemon's types should include {offered_type}")

            button = trade_button(page)
            print(f"(c) button after trade: disabled={button.is_disabled()} text={button.text_content().strip()!r}")
            if not button.is_disabled() or button.text_content().strip() != "Used":
                ok = False
                print("FAIL: trade button should read Used and be disabled after trading")
            if shot_prefix:
                page.screenshot(path=f"{shot_prefix}_used.png")

            # (d) Re-entering the same node keeps it used.
            page.reload()
            page.wait_for_selector(".mart-service-row")
            button = trade_button(page)
            print(f"(d) re-entry same node: disabled={button.is_disabled()} text={button.text_content().strip()!r}")
            if not button.is_disabled() or button.text_content().strip() != "Used":
                ok = False
                print("FAIL: re-entering the same mart node should keep the trade service used")

            # A different mart node rolls fresh (not Used).
            page.click("[data-mart-action='continue']")
            page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
            enter_shop(page, "shop-2")
            button = trade_button(page)
            text = button.text_content().strip()
            print(f"(d) different node (shop-2): disabled={button.is_disabled()} text={text!r}")
            if text == "Used":
                ok = False
                print("FAIL: a different mart node should offer the trade service fresh (not Used)")

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
