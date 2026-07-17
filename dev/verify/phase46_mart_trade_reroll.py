"""Phase 46 extra check: releasing the mart's only pokemon of the trade's
tradeAcceptedType mid-visit re-rolls the trade instead of dead-ending it.

Setup: one pokemon (forces tradeAcceptedType to that pokemon's only owned
type), plus enough spare pokemon to satisfy Release's >=4-owned requirement.
Releasing the sole matching pokemon should make repairMartTradeTypes() reroll
tradeAcceptedType to something the remaining pokemon actually have.

Usage: .cache/venv/bin/python phase46_mart_trade_reroll.py
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = "pokemon-rogue-pocket-run"

ONE_SHOP_GRAPH_JS = """() => {
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
    localStorage.setItem('%s', JSON.stringify(run));
}""" % (RUN_KEY, RUN_KEY)

# Blastoise is the only WATER/MONSTER-typed owned pokemon; the other three are
# plain FIRE-types so releasing Blastoise leaves zero owned MONSTER/WATER.
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
    page.evaluate(ONE_SHOP_GRAPH_JS)
    page.evaluate(SET_POKEMON_JS, ["Blastoise", "Charizard", "Typhlosion", "Arcanine"])


def main():
    errors = []
    ok = True

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # tradeAcceptedType is a uniform pick over 6 owned types (2 exclusive
        # to Blastoise); retry fresh runs until the roll lands on one so the
        # release-orphan path is actually exercised.
        accepted_before = None
        blastoise_types = None
        for attempt in range(30):
            start_run(page, base)
            page.reload()
            page.wait_for_selector("[data-node-id='shop-1']")
            page.click("[data-node-id='shop-1']")
            page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
            page.wait_for_selector(".mart-service-row")

            encounter = get_encounter(page, "shop-1")
            accepted_before = encounter["tradeAcceptedType"]
            run = get_run(page)
            blastoise_types = record_types(next(c["pokemon"] for c in run["collections"]["pokemon"] if c["pokemon"]["name"] == "Blastoise"))
            if accepted_before in blastoise_types:
                break
            print(f"attempt {attempt}: rolled {accepted_before!r} (not exclusive to Blastoise, {blastoise_types}), retrying")
        else:
            ok = False
            print("FAIL: never rolled a Blastoise-exclusive tradeAcceptedType in 30 attempts")

        print(f"initial tradeAcceptedType={accepted_before!r} tradeOfferedType={encounter['tradeOfferedType']!r}")

        # Release Blastoise, the pokemon that made tradeAcceptedType ownable.
        page.click("[aria-label='Select Blastoise']")
        page.click("[data-mart-service='release']")
        page.wait_for_function(
            "() => JSON.parse(localStorage.getItem('%s')).martEncounters['shop-1'].releaseUsed === true"
            % RUN_KEY,
            timeout=5000,
        )

        encounter_after = get_encounter(page, "shop-1")
        accepted_after = encounter_after["tradeAcceptedType"]
        print(f"after releasing Blastoise: tradeAcceptedType={accepted_after!r}")

        run_after = get_run(page)
        remaining_types = set()
        for card in run_after["collections"]["pokemon"] + run_after["collections"]["bench"]["pokemon"]:
            remaining_types.update(record_types(card["pokemon"]))

        if accepted_after not in remaining_types:
            ok = False
            print(f"FAIL: post-release tradeAcceptedType {accepted_after!r} is not among remaining owned types {remaining_types}")
        else:
            print(f"PASS: tradeAcceptedType re-rolled to {accepted_after!r}, which is still owned ({remaining_types})")

        button = page.query_selector("[data-mart-service='trade']")
        print(f"trade button after reroll: disabled={button.is_disabled()} text={button.text_content().strip()!r}")

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
