"""Phase 5 probe: event nodes spawn per-location and gating holds in-page."""
import sys
from lib import serving
from playwright.sync_api import sync_playwright


def run():
    with serving() as base_url, sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        results = {}
        for starter in ("water", "fire"):
            event_node_runs = 0
            saw_leak = False
            location_types = None
            samples = 8
            for _ in range(samples):
                page.goto(f"{base_url}/area.html")
                page.evaluate("localStorage.clear()")
                page.goto(f"{base_url}/area.html?newRun=1&starter={starter}")
                page.wait_for_function(
                    "window.CardArena && window.CardArena.GameData && "
                    "window.AreaMap && localStorage.getItem('pokemon-rogue-pocket-run')",
                    timeout=15000,
                )
                info = page.evaluate(
                    """() => {
                        const run = JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'));
                        const nodes = (run.area && run.area.graph && run.area.graph.nodes) || [];
                        const eventNodes = nodes.filter(n => n.type === 'event').length;
                        const types = run.location ? run.location.types : [];
                        // What event ids CAN this location roll?
                        const avail = window.PokeEvents
                            .getAvailableEvents(window.CardArena.GameData, types)
                            .map(e => e.id);
                        return { eventNodes, types, avail };
                    }"""
                )
                location_types = info["types"]
                if info["eventNodes"] > 0:
                    event_node_runs += 1
                # FIRE/non-water locations must never expose the water-only gift.
                if "message-in-a-bottle" in info["avail"] and "WATER" not in info["types"] and "ICE" not in info["types"]:
                    saw_leak = True
            results[starter] = {
                "event_node_runs": f"{event_node_runs}/{samples}",
                "last_location_types": location_types,
                "water_gift_leak": saw_leak,
            }

        browser.close()

        print("Page errors:", errors)
        for starter, r in results.items():
            print(starter, "->", r)

        ok = not errors and not any(r["water_gift_leak"] for r in results.values())
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    run()
