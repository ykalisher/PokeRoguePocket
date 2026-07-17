"""Phase 44 verification: Pokemon PC removed, Release-a-Pokemon service added.

(a) with fewer than 4 pokemon: Release button stays disabled, requirement
    text shown.
(b) with >=4 pokemon: releasing removes the selected card (total pokemon
    count drops by 1), the button flips to "Used" and disabled, re-entering
    the same mart keeps it used, a different mart node offers it fresh.
(c) a junk 'pokemon-rogue-pocket-pc' localStorage key set before load is gone
    after the page runs, and the page still works.

Usage: .cache/venv/bin/python phase44_mart_release.py [shot_prefix]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"
PC_KEY = "pokemon-rogue-pocket-pc"

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


def total_pokemon(page):
    run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
    return len(run["collections"]["pokemon"]) + len(run["collections"]["bench"]["pokemon"])


def trim_pokemon_to(page, count):
    page.evaluate(
        """(count) => {
            const run = JSON.parse(localStorage.getItem('%s'));
            const all = run.collections.pokemon.concat(run.collections.bench.pokemon);
            const kept = all.slice(0, count);
            const keptIds = new Set(kept.map(c => c.id));
            run.collections.pokemon = run.collections.pokemon.filter(c => keptIds.has(c.id));
            run.collections.bench.pokemon = run.collections.bench.pokemon.filter(c => keptIds.has(c.id));
            localStorage.setItem('%s', JSON.stringify(run));
        }"""
        % (RUN_KEY, RUN_KEY),
        count,
    )


def ensure_pokemon_total(page, count):
    """Clones the run's first pokemon card (new ids) into the bench until the
    active+bench pokemon total reaches `count`. The starter deck alone is too
    small to exercise the >=4 release gate."""
    page.evaluate(
        """(count) => {
            const run = JSON.parse(localStorage.getItem('%s'));
            const template = run.collections.pokemon[0] || run.collections.bench.pokemon[0];
            let total = run.collections.pokemon.length + run.collections.bench.pokemon.length;
            let n = 0;
            while (total < count) {
                const clone = JSON.parse(JSON.stringify(template));
                clone.id = `verify-clone-${n}`;
                run.collections.bench.pokemon.push(clone);
                total += 1;
                n += 1;
            }
            localStorage.setItem('%s', JSON.stringify(run));
        }"""
        % (RUN_KEY, RUN_KEY),
        count,
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


def release_button(page):
    return page.query_selector("[data-mart-service='release']")


def main():
    shot_prefix = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # (a) fewer than 4 pokemon -> disabled with requirement text.
        start_run(page, base)
        trim_pokemon_to(page, 3)
        enter_shop(page, "shop-1")

        button = release_button(page)
        requirement = page.text_content(".mart-service-requirement")
        print(f"(a) 3 pokemon: button_disabled={button.is_disabled()} requirement={requirement!r}")
        if not button.is_disabled():
            ok = False
            print("FAIL: release button should be disabled with only 3 pokemon")
        if "4" not in (requirement or ""):
            ok = False
            print("FAIL: requirement text should mention needing 4 pokemon")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_disabled.png")

        # (b) >=4 pokemon -> release works, persists as used, fresh per node.
        start_run(page, base)
        ensure_pokemon_total(page, 5)
        before_count = total_pokemon(page)
        print(f"(b) starting pokemon total: {before_count}")
        if before_count < 4:
            ok = False
            print("FAIL: expected starter roster to have >=4 pokemon for this check")

        enter_shop(page, "shop-1")
        card = page.query_selector(".mart-pokemon-choice[data-pokemon-card-id]")
        released_name = card.get_attribute("aria-label")
        card.click()

        button = release_button(page)
        if button.is_disabled():
            ok = False
            print("FAIL: release button should be enabled once a pokemon is selected (>=4 total)")

        button.click()
        page.wait_for_function(
            "(expected) => JSON.parse(localStorage.getItem('%s')).collections.pokemon"
            ".concat(JSON.parse(localStorage.getItem('%s')).collections.bench.pokemon).length === expected"
            % (RUN_KEY, RUN_KEY),
            arg=before_count - 1,
            timeout=5000,
        )
        after_count = total_pokemon(page)
        print(f"(b) after release ({released_name}): total={after_count}")
        if after_count != before_count - 1:
            ok = False
            print(f"FAIL: expected total pokemon to drop by 1, got {before_count} -> {after_count}")

        button = release_button(page)
        used_text = button.text_content().strip()
        print(f"(b) button after release: disabled={button.is_disabled()} text={used_text!r}")
        if not button.is_disabled() or used_text != "Used":
            ok = False
            print("FAIL: release button should read Used and be disabled after releasing")
        if shot_prefix:
            page.screenshot(path=f"{shot_prefix}_used.png")

        # Re-entering the same mart node keeps it used.
        page.reload()
        page.wait_for_selector(".mart-service-row")
        button = release_button(page)
        print(f"(b) re-entry same node: disabled={button.is_disabled()} text={button.text_content().strip()!r}")
        if not button.is_disabled() or button.text_content().strip() != "Used":
            ok = False
            print("FAIL: re-entering the same mart node should keep Release used")

        # Leave via Continue, then a different mart node offers it fresh.
        page.click("[data-mart-action='continue']")
        page.wait_for_function("() => location.pathname.endsWith('area.html')", timeout=15000)
        enter_shop(page, "shop-2")
        button = release_button(page)
        print(f"(b) different node (shop-2): disabled={button.is_disabled()} text={button.text_content().strip()!r}")
        if button.text_content().strip() != "Release":
            ok = False
            print("FAIL: a different mart node should offer Release fresh (not Used)")

        # (c) junk PC key is cleaned up on load, page still works.
        page.add_init_script(f"localStorage.setItem('{PC_KEY}', 'not json {{{{');")
        page.goto(f"{base}/mart.html")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') || location.pathname.endsWith('mart.html')",
            timeout=15000,
        )
        pc_value = page.evaluate(f"localStorage.getItem('{PC_KEY}')")
        print(f"(c) pc key after load: {pc_value!r}")
        if pc_value is not None:
            ok = False
            print("FAIL: junk PC localStorage key should be removed on load")

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
