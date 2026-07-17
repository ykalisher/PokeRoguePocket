"""Phase 43 verification: mart stock never offers a LEGENDARY-typed attack or a
dragon-gem item for a run without the prerequisites (water starter: no legendary,
no DRAGON attack/pokemon).

Forces a trivial 2-node graph (start -> shop) after starter selection so the
shop node is reachable without playing through battles/captures/events first.

Usage: .cache/venv/bin/python phase43_mart_stock_filters.py [shot.png]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"

LEGENDARY_ATTACKS = {
    "Blizzard", "Great Storm", "Thunder Storm", "Eruption", "Shatter Reality",
    "Great Flood", "Healing River", "Ancient Power", "Lovecraftian Horror",
    "Hyper Beam", "Divine Power", "Divine Wrath", "Ancient Force", "Sacred Sword",
    "Dazzling Aura", "Dreadful Atmosphere", "Roaring Swarm",
}
DRAGON_GEM_ITEMS = {
    "Fire Gem", "Electric Gem", "Psychic Gem", "Dark Gem", "Grass Gem", "Poison Gem",
}

FORCE_SHOP_GRAPH_JS = """() => {
    const run = JSON.parse(localStorage.getItem('%s'));
    run.area.graph = {
        columns: [],
        edges: [{ from: 'start', to: 'shop-1' }],
        nodes: [
            { id: 'start', lane: 2, step: 0, type: 'start', x: 5, y: 50 },
            { id: 'shop-1', lane: 2, step: 1, type: 'shop', x: 50, y: 50 }
        ]
    };
    run.area.currentNodeId = 'start';
    run.area.visitedNodeIds = ['start'];
    run.area.traveledPathKeys = [];
    run.area.activeMartNodeId = null;
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)


def offer_names(page):
    labels = page.eval_on_selector_all(
        ".mart-offer-card .playing-card", "els => els.map(el => el.getAttribute('aria-label'))"
    )
    return labels


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else None
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # console 404s are a known pre-existing gap (missing location background
        # images on disk, see data_validation.test.js "asset warnings include
        # missing backgrounds") -- unrelated to this phase's JS logic, so only
        # real page (JS) errors fail the run.
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='water']")
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='water']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )

        run = json.loads(page.evaluate(f"localStorage.getItem('{RUN_KEY}')"))
        pokemon_names = sorted(
            c["pokemon"]["name"] for c in run["collections"]["pokemon"] + run["collections"]["bench"]["pokemon"]
        )
        attack_names = sorted(
            c["attack"]["name"] for c in run["collections"]["actions"] + run["collections"]["bench"]["actions"]
            if c.get("kind") == "attack"
        )
        print(f"starter deck pokemon={pokemon_names} attacks={attack_names} (expect no LEGENDARY/DRAGON)")

        page.evaluate(FORCE_SHOP_GRAPH_JS)
        page.reload()
        page.wait_for_selector("[data-node-id='shop-1']")
        page.click("[data-node-id='shop-1']")
        page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
        page.wait_for_selector(".mart-offer-card")

        names = offer_names(page)
        print(f"mart offer names (first visit): {names}")
        if shot:
            page.screenshot(path=shot)

        offending = [n for n in names if n in LEGENDARY_ATTACKS or n in DRAGON_GEM_ITEMS]
        if offending:
            ok = False
            print(f"FAIL: forbidden names in stock: {offending}")
        if len(names) != 12:
            ok = False
            print(f"FAIL: expected 12 offer names (8 attacks + 4 items), got {len(names)}")

        # Re-entering: once visited, the map node itself is no longer
        # selectable, so "re-enter" means revisiting mart.html directly
        # (e.g. browser refresh) while the encounter is still uncompleted.
        # That exercises repairMartEncounter()/repairOfferNames() -- the
        # repair path this phase must also filter.
        page.reload()
        page.wait_for_selector(".mart-offer-card")

        names_again = offer_names(page)
        print(f"mart offer names (re-entry): {names_again}")
        if names_again != names:
            ok = False
            print(f"FAIL: stock changed on re-entry: {names} != {names_again}")

        offending_again = [n for n in names_again if n in LEGENDARY_ATTACKS or n in DRAGON_GEM_ITEMS]
        if offending_again:
            ok = False
            print(f"FAIL: forbidden names in stock on re-entry: {offending_again}")

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
