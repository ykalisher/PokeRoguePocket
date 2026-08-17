"""Final-level mart stock: deeper shelves and two attack removals.

Compares the same run entering the same shop node on level 1 and on the final
level (PokeLocations.TOTAL_LEVELS):

(a) level 1 shop stocks the base counts (8 attacks / 4 items) and offers a
    single removal, which flips to "Used" after one purchase.
(b) final-level shop stocks 5 more attacks and 2 more items, and sells two
    removals: the service stays enabled after the first and only reads "Used"
    after the second. (The attack shelf is capped by how many attacks match the
    run's owned types, so it can come up short on a narrow team - the check
    below allows that and reports it.)

Usage: .cache/venv/bin/python final_level_mart_stock.py [shot_prefix]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"
REMOVAL_COST = 50

SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [{ from: 'start', to: 'shop-1' }],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 30 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 30 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    run.cash = 999;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def set_level(page, level):
    page.evaluate(
        """(level) => {
            const run = JSON.parse(localStorage.getItem('%s'));
            run.level = level;
            run.martEncounters = {};
            localStorage.setItem('%s', JSON.stringify(run));
        }"""
        % (RUN_KEY, RUN_KEY),
        level,
    )


def start_run(page, base):
    page.goto(f"{base}/starter.html")
    page.wait_for_selector(".starter-card[data-starter='water']")
    page.evaluate("localStorage.clear()")
    page.click(".starter-card[data-starter='water']")
    page.wait_for_function(
        "() => location.pathname.endsWith('area.html') && localStorage.getItem('%s')" % RUN_KEY,
        timeout=15000,
    )
    page.evaluate(SHOP_GRAPH_JS)


def enter_shop(page):
    page.reload()
    page.wait_for_selector("[data-node-id='shop-1']")
    page.click("[data-node-id='shop-1']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-service-row")


def offer_count(page, kind):
    return len(page.query_selector_all(f"[data-offer-kind='{kind}']"))


def removal_button(page):
    return page.query_selector("[data-mart-service='remove-attack']")


def remove_one_attack(page):
    """Buys one removal; returns the cash delta the run actually took."""
    before = get_run(page)["cash"]
    removal_button(page).click()
    page.wait_for_selector("[data-attack-removal-overlay]")
    page.query_selector("[data-remove-attack-id]").click()
    page.wait_for_selector("[data-mart-confirm-overlay]")
    page.click("[data-resolve-mart-confirm]")
    page.wait_for_function(
        "(expected) => JSON.parse(localStorage.getItem('%s')).cash === expected" % RUN_KEY,
        arg=before - REMOVAL_COST,
        timeout=5000,
    )
    return before - get_run(page)["cash"]


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # Read the counts the engine itself claims, so this driver never
        # hardcodes numbers the code owns.
        page.goto(f"{base}/area.html")
        page.wait_for_function("() => window.PokeLocations")
        total_levels = page.evaluate("() => PokeLocations.TOTAL_LEVELS")
        base_stock = page.evaluate("() => PokeLocations.getMartStock(1)")
        final_stock = page.evaluate("() => PokeLocations.getMartStock(PokeLocations.TOTAL_LEVELS)")
        print(f"stock: base={base_stock} final={final_stock} total_levels={total_levels}")

        if (final_stock["attacks"] - base_stock["attacks"], final_stock["items"] - base_stock["items"],
                final_stock["attackRemovals"]) != (5, 2, 2):
            ok = False
            print("FAIL: final-level stock should add 5 attacks, 2 items, and sell 2 removals")

        # (a) level 1: base shelves, one removal.
        start_run(page, base)
        set_level(page, 1)
        enter_shop(page)
        attacks_l1, items_l1 = offer_count(page, "attack"), offer_count(page, "item")
        print(f"(a) level 1 shop: attacks={attacks_l1} items={items_l1}")
        if items_l1 != base_stock["items"]:
            ok = False
            print(f"FAIL: level 1 shop should stock {base_stock['items']} items")
        if attacks_l1 > base_stock["attacks"]:
            ok = False
            print(f"FAIL: level 1 shop should stock at most {base_stock['attacks']} attacks")

        print(f"(a) removal charged {remove_one_attack(page)} coins")
        text = removal_button(page).text_content().strip()
        print(f"(a) after 1 removal: disabled={removal_button(page).is_disabled()} text={text!r}")
        if not removal_button(page).is_disabled() or text != "Used":
            ok = False
            print("FAIL: a level 1 shop should sell only one removal")

        # (b) final level: deeper shelves, two removals.
        start_run(page, base)
        set_level(page, total_levels)
        enter_shop(page)
        attacks_final, items_final = offer_count(page, "attack"), offer_count(page, "item")
        print(f"(b) final-level shop: attacks={attacks_final} items={items_final}")
        if items_final != final_stock["items"]:
            ok = False
            print(f"FAIL: final-level shop should stock {final_stock['items']} items")
        if attacks_final <= attacks_l1:
            ok = False
            print("FAIL: final-level shop should stock more attacks than a level 1 shop")
        if attacks_final < final_stock["attacks"]:
            print(f"note: only {attacks_final} attacks matched this run's types "
                  f"(shelf holds {final_stock['attacks']})")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_final_shop.png", full_page=True)

        print(f"(b) first removal charged {remove_one_attack(page)} coins")
        button = removal_button(page)
        text = button.text_content().strip()
        requirement = page.query_selector(
            "[data-mart-service='remove-attack']"
        ).evaluate("node => node.closest('.mart-service-row').querySelector('.mart-service-requirement').textContent.trim()")
        print(f"(b) after 1 removal: disabled={button.is_disabled()} text={text!r} requirement={requirement!r}")
        if button.is_disabled():
            ok = False
            print("FAIL: the final-level shop should still offer a second removal")

        print(f"(b) second removal charged {remove_one_attack(page)} coins")
        button = removal_button(page)
        text = button.text_content().strip()
        print(f"(b) after 2 removals: disabled={button.is_disabled()} text={text!r}")
        if not button.is_disabled() or text != "Used":
            ok = False
            print("FAIL: the final-level shop should stop after two removals")
        if get_run(page)["martEncounters"]["shop-1"]["attackRemovalsUsed"] != 2:
            ok = False
            print("FAIL: the run should persist attackRemovalsUsed = 2")

        # Re-entry keeps both removals spent.
        page.goto(f"{base}/mart.html")
        page.wait_for_selector(".mart-service-row")
        if not removal_button(page).is_disabled():
            ok = False
            print("FAIL: spent removals should persist across a reload")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_removals_used.png", full_page=True)

        browser.close()

    for error in errors:
        ok = False
        print(error)

    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
