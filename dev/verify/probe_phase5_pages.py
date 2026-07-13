"""Phase 5 probe: force each seed event onto a node and confirm event.html renders it."""
import sys
from lib import serving
from playwright.sync_api import sync_playwright

CASES = [
    ("berry-cache", "Berry Cache", None),
    ("wandering-trader", "Wandering Trader", None),
    ("team-rocket-ambush", "Team Rocket Ambush", "[data-trainer-event-action='battle']"),
]

SETUP = """(eventId) => {
    const run = window.PokeRun.loadRunState();
    const nodes = run.area.graph.nodes;
    let node = nodes.find(n => n.type === 'event') || nodes[1];
    node.type = 'event';
    run.eventEncounters = run.eventEncounters || {};
    run.eventEncounters[node.id] = {
        battleCompleted: false, completed: false, completedAt: null,
        createdAt: new Date().toISOString(), eventId, nodeId: node.id,
        resultSummary: [], selectedActionId: null, startedBattle: false
    };
    run.area.activeEventNodeId = node.id;
    run.area.activeBattleNodeId = null;
    run.area.activeCaptureNodeId = null;
    run.area.activeMartNodeId = null;
    window.PokeRun.saveRunState(run);
    return node.id;
}"""


def run():
    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        ok = True
        for event_id, title, extra_selector in CASES:
            page.goto(f"{base_url}/area.html")
            page.evaluate("localStorage.clear()")
            page.goto(f"{base_url}/area.html?newRun=1&starter=water")
            page.wait_for_function(
                "window.CardArena && window.CardArena.GameData && window.PokeRun && "
                "localStorage.getItem('pokemon-rogue-pocket-run')",
                timeout=15000,
            )
            page.evaluate(SETUP, event_id)
            page.goto(f"{base_url}/event.html")
            page.wait_for_selector("h1", timeout=15000)
            body = page.inner_text("body").lower()
            has_title = title.lower() in body
            has_extra = True
            if extra_selector:
                has_extra = page.query_selector(extra_selector) is not None
            passed = has_title and has_extra
            ok = ok and passed
            print(f"{event_id}: title={has_title} extra={has_extra} -> {'OK' if passed else 'FAIL'}")

        browser.close()
        print("Page errors:", errors)
        ok = ok and not errors
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    run()
