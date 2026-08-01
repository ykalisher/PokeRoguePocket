"""Phase 79 verification: 11-node branching routes, boss rank, L4 shape, v3 save gate.

Usage: .cache/venv/bin/python phase79_map_layout.py [shot.png]
"""

import json
import sys

from lib import serving, sync_playwright

RUN_KEY = 'pokemon-rogue-pocket-run'
RUN_STATE_PROBE = f"() => JSON.parse(localStorage.getItem('{RUN_KEY}'))"

ADVANCE_TO_LEVEL_3 = """() => {
    const run = PokeRun.loadRunState();
    PokeLocations.advanceRunToNextLevel(run, CardArena.GameData, { includeEvents: true });
    PokeLocations.advanceRunToNextLevel(run, CardArena.GameData, { includeEvents: true });
    PokeRun.saveRunState(run);
    return run.level;
}"""

# Shaped like a pre-phase-79 v2 save: version 2, with the fields
# getSavedRunRoute()/loadSavedRunState() in main.js need to have accepted it.
STALE_V2_RUN = {
    "version": 2,
    "level": 2,
    "starterId": "water",
    "location": {"id": "tidepool-coast", "name": "Tidepool Coast", "terrain": "Waterfront",
                 "types": ["WATER", "ICE"], "theme": {}, "background": None},
    "visitedLocationIds": ["tidepool-coast"],
    "runCompleted": False,
    "runCompletedAt": None,
    "collections": {"pokemon": [], "actions": [], "items": [],
                     "bench": {"pokemon": [], "actions": [], "items": []}},
    "cash": 100,
    "nextCardId": 1,
    "area": {
        "activeBattleNodeId": None, "activeCaptureNodeId": None, "activeEventNodeId": None,
        "activeMartNodeId": None, "bossNodeId": "boss-12", "completed": False,
        "completedAt": None, "completedBossNodeId": None, "currentNodeId": "start",
        "graph": {"columns": [[{"id": "start", "lane": 2, "step": 0, "type": "start", "x": 5, "y": 50}]],
                  "edges": [],
                  "nodes": [{"id": "start", "lane": 2, "step": 0, "type": "start", "x": 5, "y": 50}]},
        "traveledPathKeys": [], "visitedNodeIds": ["start"]
    },
    "battleEncounters": {}, "captureEncounters": {}, "martEncounters": {}, "eventEncounters": {}
}


def main():
    shot_path = sys.argv[1] if len(sys.argv) > 1 else "phase79_map_layout.png"
    ok = True
    errors = []

    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        # assets/backgrounds/ is empty in this checkout (pre-existing, unrelated
        # to phase 79 - every location's background 404s regardless of map shape).
        page.on("console", lambda m: errors.append(f"console.error: {m.text} ({m.location.get('url')})")
                 if m.type == "error" and "backgrounds/" not in m.location.get("url", "") else None)

        # --- Check 1: fresh L1 map shape + screenshot -----------------------
        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        page.wait_for_selector(".area-node", timeout=15000)
        page.wait_for_timeout(300)

        run = page.evaluate(RUN_STATE_PROBE)
        graph = run["area"]["graph"]
        columns = graph["columns"]
        print(f"L1 columns: {len(columns)}, nodes: {len(graph['nodes'])}, edges: {len(graph['edges'])}")

        multi = [c for c in columns if len(c) > 1]
        boss_nodes = [n for n in graph["nodes"] if n["type"] == "boss"]
        attack_nodes = [n for n in graph["nodes"] if n["type"] == "attack"]

        if len(columns) != 12:
            ok = False
            print(f"  FAIL expected 12 columns (11 steps + start), got {len(columns)}")
        else:
            print("  OK   12 columns (start + 11 steps)")

        if len(multi) != 1:
            ok = False
            print(f"  FAIL expected exactly 1 branch column, got {len(multi)}")
        else:
            lane_types = {n["type"] for n in multi[0]}
            print(f"  OK   1 branch column at step {multi[0][0]['step']} with lanes {sorted(lane_types)}")

        if len(boss_nodes) != 1 or boss_nodes[0]["id"] != "boss-11":
            ok = False
            print(f"  FAIL boss node: {boss_nodes}")
        else:
            print("  OK   single boss-11 node")

        if not attack_nodes:
            ok = False
            print("  FAIL no attack node on this L1 map (should be guaranteed by quota)")
        else:
            print(f"  OK   {len(attack_nodes)} attack node(s) present: {[n['id'] for n in attack_nodes]}")

        page.screenshot(path=shot_path, full_page=True)
        print(f"screenshot saved to {shot_path}")

        canvas = page.query_selector(".area-canvas") or page.query_selector(".area-map")
        if canvas:
            box = canvas.bounding_box()
            print(f"area canvas box: {box}")
        boss_dom = page.query_selector(".area-node[data-node-id='boss-11']")
        if boss_dom:
            bbox = boss_dom.bounding_box()
            print(f"boss-11 DOM position: {bbox}")

        # --- Check 2: advance to level 3, confirm Elite boss --------------
        new_level = page.evaluate(ADVANCE_TO_LEVEL_3)
        print(f"advanced run to level {new_level}")
        page.reload()
        page.wait_for_selector(".area-node", timeout=15000)
        page.wait_for_timeout(300)

        run3 = page.evaluate(RUN_STATE_PROBE)
        boss_id3 = run3["area"]["bossNodeId"]
        boss_encounter = run3["battleEncounters"].get(boss_id3)
        print(f"L3 bossNodeId={boss_id3} boss encounter={boss_encounter}")
        if not boss_encounter or boss_encounter.get("rank") != "Elite":
            ok = False
            print(f"  FAIL L3 boss rank is {boss_encounter and boss_encounter.get('rank')}, want Elite")
        else:
            print("  OK   L3 boss is Elite rank")

        # --- Check 3: level 4 shape ------------------------------------------
        level4_seq = page.evaluate("""() => {
            const run = PokeRun.loadRunState();
            PokeLocations.advanceRunToNextLevel(run, CardArena.GameData, { includeEvents: true });
            PokeRun.saveRunState(run);
            const byStep = {};
            run.area.graph.nodes.forEach(n => { byStep[n.step] = n.type; });
            return byStep;
        }""")
        print(f"L4 node types by step: {level4_seq}")
        expected_l4 = {'0': 'start', '1': 'shop', '2': 'battle', '3': 'battle', '4': 'shop', '5': 'battle', '6': 'boss'}
        # JS object keys serialize as strings over the JSON bridge.
        if {str(k): v for k, v in level4_seq.items()} != expected_l4:
            ok = False
            print(f"  FAIL L4 sequence mismatch: got {level4_seq}, want {expected_l4}")
        else:
            print("  OK   L4 sequence is shop, battle, battle, shop, battle, boss")

        page.evaluate("localStorage.clear()")

        # --- Check 4: stale v2 save is rejected by the v3 gate ---------------
        page.goto(f"{base}/index.html")
        page.evaluate(f"localStorage.setItem('{RUN_KEY}', {json.dumps(json.dumps(STALE_V2_RUN))})")
        page.reload()
        page.wait_for_selector("#btn-load-game", timeout=15000)
        load_btn = page.query_selector("#btn-load-game")
        disabled = load_btn.is_disabled()
        print(f"Continue button disabled with stale v2 save: {disabled}")
        if not disabled:
            ok = False
            print("  FAIL Continue button should be disabled for a v2 (pre-bump) save")
        else:
            print("  OK   Continue button disabled for stale v2 save")

        page.click("#btn-new-game")
        page.wait_for_function("() => location.pathname.endsWith('starter.html')", timeout=15000)
        page.click(".starter-card[data-starter='water']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        new_run = page.evaluate(RUN_STATE_PROBE)
        print(f"new run after stale save: version={new_run['version']} level={new_run['level']}")
        if new_run["version"] != 3 or new_run["level"] != 1:
            ok = False
            print("  FAIL starting a new run after a stale save did not produce a clean v3 level-1 run")
        else:
            print("  OK   new run starts cleanly at v3 level 1")

        if errors:
            ok = False
            print("Page/console errors:")
            for e in errors:
                print(f"  {e}")

        page.evaluate("localStorage.clear()")
        browser.close()

    print("RESULT:", "OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
