"""Extra check: releasing the mart's only pokemon of an offer's wanted type
mid-visit re-rolls that offer instead of dead-ending it.

Setup: one pokemon carrying types nothing else owns, plus enough spare pokemon
to satisfy Release's >=4-owned requirement. Releasing the sole matching pokemon
should make repairMartTrades() reroll that offer's acceptedType (and the
pokemon it hands back) to something the remaining pokemon can actually trade.

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

        # Each offer's acceptedType is a uniform pick over 6 owned types (2
        # exclusive to Blastoise); retry fresh runs until some offer lands on
        # one so the release-orphan path is actually exercised.
        stale_index = None
        trades_before = None
        blastoise_types = None
        for attempt in range(30):
            start_run(page, base)
            page.reload()
            page.wait_for_selector("[data-node-id='shop-1']")
            page.click("[data-node-id='shop-1']")
            page.wait_for_function("() => location.pathname.endsWith('mart.html')", timeout=15000)
            page.wait_for_selector(".mart-trade-row")

            trades_before = get_encounter(page, "shop-1")["trades"]
            run = get_run(page)
            blastoise_types = record_types(next(c["pokemon"] for c in run["collections"]["pokemon"] if c["pokemon"]["name"] == "Blastoise"))
            stale_index = next(
                (index for index, trade in enumerate(trades_before) if trade["acceptedType"] in blastoise_types),
                None,
            )
            if stale_index is not None:
                break
            wanted = [trade["acceptedType"] for trade in trades_before]
            print(f"attempt {attempt}: offers want {wanted} (none exclusive to Blastoise, {blastoise_types}), retrying")
        else:
            ok = False
            print("FAIL: no offer wanted a Blastoise-exclusive type in 30 attempts")

        print(f"initial trades={trades_before}, Blastoise-only offer at index {stale_index}")

        # Release Blastoise, the pokemon that made that offer's wanted type ownable.
        page.click("[aria-label='Select Blastoise']")
        page.click("[data-mart-service='release']")
        page.wait_for_function(
            "() => JSON.parse(localStorage.getItem('%s')).martEncounters['shop-1'].releaseUsed === true"
            % RUN_KEY,
            timeout=5000,
        )

        trades_after = get_encounter(page, "shop-1")["trades"]
        print(f"after releasing Blastoise: trades={trades_after}")

        run_after = get_run(page)
        remaining_types = set()
        for card in run_after["collections"]["pokemon"] + run_after["collections"]["bench"]["pokemon"]:
            remaining_types.update(record_types(card["pokemon"]))

        accepted_after = trades_after[stale_index]["acceptedType"] if stale_index is not None else None
        if accepted_after not in remaining_types:
            ok = False
            print(f"FAIL: post-release wanted type {accepted_after!r} is not among remaining owned types {remaining_types}")
        else:
            print(f"PASS: offer {stale_index} re-rolled to {accepted_after!r}, which is still owned ({remaining_types})")

        if trades_after[stale_index]["offeredName"] is None:
            ok = False
            print("FAIL: a re-rolled offer should still name the pokemon it hands back")

        # Offers that were still valid must survive the release untouched.
        for index, (before, after) in enumerate(zip(trades_before, trades_after)):
            if index == stale_index:
                continue
            if before["acceptedType"] in remaining_types and before != after:
                ok = False
                print(f"FAIL: offer {index} was still valid but changed: {before} -> {after}")

        for index in range(len(trades_after)):
            button = page.query_selector(f"[data-trade-index='{index}']")
            print(f"offer {index} button after reroll: disabled={button.is_disabled()} text={button.text_content().strip()!r}")

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
