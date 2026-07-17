"""Phase 45 verification: Remove-an-Attack mart service (50 coins).

(a) with < 50 coins: button disabled, text "Need 50".
(b) with zero owned attack cards: button disabled, text "No attacks".
(c) with >=50 coins and >=1 attack: opening the picker lists every owned
    attack (active + bench); cancelling charges nothing; picking one deducts
    exactly 50 coins, removes that card from the deck counters, flips the
    button to "Used" and disabled, persists as used on re-entry, and a
    different mart node offers it fresh.

Usage: .cache/venv/bin/python phase45_mart_attack_removal.py [shot_prefix]
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


def get_run(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))


def get_cash(page):
    return get_run(page)["cash"]


def total_attacks(page):
    run = get_run(page)
    actions = run["collections"]["actions"]
    bench_actions = run["collections"]["bench"]["actions"]
    return sum(1 for c in actions + bench_actions if c.get("kind") == "attack")


def set_cash(page, amount):
    page.evaluate(
        """(amount) => {
            const run = JSON.parse(localStorage.getItem('%s'));
            run.cash = amount;
            localStorage.setItem('%s', JSON.stringify(run));
        }"""
        % (RUN_KEY, RUN_KEY),
        amount,
    )


def strip_all_attacks(page):
    page.evaluate(
        """() => {
            const run = JSON.parse(localStorage.getItem('%s'));
            run.collections.actions = run.collections.actions.filter(c => c.kind !== 'attack');
            run.collections.bench.actions = run.collections.bench.actions.filter(c => c.kind !== 'attack');
            localStorage.setItem('%s', JSON.stringify(run));
        }"""
        % (RUN_KEY, RUN_KEY)
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
    page.evaluate(TWO_SHOP_GRAPH_JS)


def enter_shop(page, node_id):
    page.reload()
    page.wait_for_selector(f"[data-node-id='{node_id}']")
    page.click(f"[data-node-id='{node_id}']")
    page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
    page.wait_for_selector(".mart-service-row")


def removal_button(page):
    return page.query_selector("[data-mart-service='remove-attack']")


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # (a) < 50 coins -> disabled with "Need 50".
        start_run(page, base)
        set_cash(page, 20)
        enter_shop(page, "shop-1")

        button = removal_button(page)
        text = button.text_content().strip()
        print(f"(a) 20 coins: button_disabled={button.is_disabled()} text={text!r}")
        if not button.is_disabled() or text != "Need 50":
            ok = False
            print("FAIL: removal button should be disabled and read 'Need 50' with 20 coins")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_need_coins.png")

        # (b) zero owned attacks -> disabled with "No attacks".
        start_run(page, base)
        strip_all_attacks(page)
        enter_shop(page, "shop-1")

        button = removal_button(page)
        text = button.text_content().strip()
        attacks_owned = total_attacks(page)
        print(f"(b) {attacks_owned} attacks owned: button_disabled={button.is_disabled()} text={text!r}")
        if attacks_owned != 0:
            ok = False
            print("FAIL: expected zero owned attacks for this check")
        if not button.is_disabled() or text != "No attacks":
            ok = False
            print("FAIL: removal button should be disabled and read 'No attacks' with zero owned attacks")

        # (c) full flow: cancel charges nothing, then remove deducts 50 and persists.
        start_run(page, base)
        before_cash = get_cash(page)
        before_attacks = total_attacks(page)
        print(f"(c) starting cash={before_cash} attacks={before_attacks}")
        if before_cash < 50 or before_attacks < 1:
            ok = False
            print("FAIL: expected starter run to have >=50 cash and >=1 attack for this check")

        enter_shop(page, "shop-1")
        button = removal_button(page)
        if button.is_disabled():
            ok = False
            print("FAIL: removal button should be enabled with sufficient cash/attacks")
        button.click()
        page.wait_for_selector("[data-attack-removal-overlay]")

        choices = page.query_selector_all("[data-remove-attack-id]")
        print(f"(c) picker lists {len(choices)} attack choices")
        if len(choices) != before_attacks:
            ok = False
            print(f"FAIL: picker should list all {before_attacks} owned attacks, got {len(choices)}")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_picker.png")

        # Cancel: overlay closes, no charge.
        page.click("[data-close-attack-removal]")
        page.wait_for_selector("[data-attack-removal-overlay]", state="detached")
        cash_after_cancel = get_cash(page)
        print(f"(c) cash after cancel: {cash_after_cancel}")
        if cash_after_cancel != before_cash:
            ok = False
            print("FAIL: cancelling the picker should not charge any coins")

        # Reopen and actually remove one.
        button = removal_button(page)
        button.click()
        page.wait_for_selector("[data-attack-removal-overlay]")
        choice = page.query_selector("[data-remove-attack-id]")
        removed_name = choice.get_attribute("aria-label")
        choice.click()

        page.wait_for_function(
            "(expected) => JSON.parse(localStorage.getItem('%s')).cash === expected"
            % RUN_KEY,
            arg=before_cash - 50,
            timeout=5000,
        )
        after_cash = get_cash(page)
        after_attacks = total_attacks(page)
        print(f"(c) after removal ({removed_name}): cash={after_cash} attacks={after_attacks}")
        if after_cash != before_cash - 50:
            ok = False
            print(f"FAIL: expected cash to drop by exactly 50, got {before_cash} -> {after_cash}")
        if after_attacks != before_attacks - 1:
            ok = False
            print(f"FAIL: expected owned attacks to drop by 1, got {before_attacks} -> {after_attacks}")

        overlay = page.query_selector("[data-attack-removal-overlay]")
        if overlay is not None:
            ok = False
            print("FAIL: picker overlay should close after removing a card")

        button = removal_button(page)
        used_text = button.text_content().strip()
        print(f"(c) button after removal: disabled={button.is_disabled()} text={used_text!r}")
        if not button.is_disabled() or used_text != "Used":
            ok = False
            print("FAIL: removal button should read Used and be disabled after removing")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_used.png")

        # Re-entering the same mart node keeps it used.
        page.reload()
        page.wait_for_selector(".mart-service-row")
        button = removal_button(page)
        print(f"(c) re-entry same node: disabled={button.is_disabled()} text={button.text_content().strip()!r}")
        if not button.is_disabled() or button.text_content().strip() != "Used":
            ok = False
            print("FAIL: re-entering the same mart node should keep the removal service used")

        # Leave via Continue, then a different mart node offers it fresh.
        page.click("[data-mart-action='continue']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
        enter_shop(page, "shop-2")
        button = removal_button(page)
        text = button.text_content().strip()
        print(f"(c) different node (shop-2): disabled={button.is_disabled()} text={text!r}")
        if text == "Used":
            ok = False
            print("FAIL: a different mart node should offer the removal service fresh (not Used)")

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
