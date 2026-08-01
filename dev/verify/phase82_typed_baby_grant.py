"""Phase 82 verification: the Nursery Surprise event's gain-random-baby effect
carries locationTypes:true, so the hatched baby's types overlap the run's
current location. Uses the real events.json/pokemon.json (no fixture swap) --
only forces the run's active event node to point at the real nursery-egg
event, mirroring how phase73_event_conditions.py forces an event node.

Usage: .cache/venv/bin/python phase82_typed_baby_grant.py
"""

import json
import sys
from pathlib import Path

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"

REPO_ROOT = Path(__file__).resolve().parents[2]
POKEMON = json.loads((REPO_ROOT / "pokemon.json").read_text())
POKEMON_BY_NAME = {record["name"]: record for record in POKEMON}


def main():
    ok = True
    errors = []
    with serving() as base, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text} [{m.location.get('url', '')}]")
            if m.type == "error"
            else None,
        )

        page.goto(f"{base}/starter.html")
        page.wait_for_selector(".starter-card[data-starter='fire']", timeout=15000)
        page.evaluate("localStorage.clear()")
        page.click(".starter-card[data-starter='fire']")
        page.wait_for_function(
            "() => location.pathname.endsWith('area.html') && localStorage.getItem('pokemon-rogue-pocket-run')",
            timeout=15000,
        )
        run = page.evaluate(RUN_STATE_PROBE)
        location = run.get("location") or {}
        location_types = location.get("types", [])
        print(f"location={location.get('name')!r} types={location_types}")

        page.evaluate("""() => {
            const key = 'pokemon-rogue-pocket-run';
            const run = JSON.parse(localStorage.getItem(key));
            run.area.activeEventNodeId = 'verify-node';
            run.area.activeBattleNodeId = null;
            run.area.activeCaptureNodeId = null;
            run.area.activeMartNodeId = null;
            run.eventEncounters = { 'verify-node': {
                battleCompleted: false, completed: false, completedAt: null,
                createdAt: new Date().toISOString(), eventId: 'nursery-egg',
                nodeId: 'verify-node', resultSummary: [], selectedActionId: null,
                startedBattle: false
            } };
            localStorage.setItem(key, JSON.stringify(run));
        }""")
        page.goto(f"{base}/event.html")
        page.wait_for_selector(".event-choice-card", timeout=15000)

        body_text = page.text_content("body") or ""
        if "Nursery Surprise" not in body_text:
            ok = False
            print("  FAIL heading 'Nursery Surprise' not found on page")
        else:
            print("  OK   nursery-egg event rendered")

        checkbox_note = page.query_selector("button[data-event-action-id='claim']")
        if checkbox_note is None:
            ok = False
            print("  FAIL no claim button found")
        else:
            page.click("button[data-event-action-id='claim']")
            page.wait_for_selector("[data-event-continue]", timeout=15000)
            print("  OK   claimed the egg")

        page.screenshot(path="phase82_typed_baby_grant.png")

        summary_items = [el.text_content() for el in page.query_selector_all(".event-result-list li")]
        print(f"summary={summary_items}")

        granted_name = None
        for text in summary_items:
            if text and text.startswith("Gained ") and text.endswith("."):
                granted_name = text[len("Gained "):-1]

        if not granted_name:
            ok = False
            print("  FAIL could not parse a granted baby name out of the result summary")
        else:
            record = POKEMON_BY_NAME.get(granted_name)
            if record is None:
                ok = False
                print(f"  FAIL granted name {granted_name!r} is not in pokemon.json")
            else:
                record_types = [record.get("type1"), record.get("type2"), record.get("type3")]
                non_baby_types = [t for t in record_types if t and t != "BABY" and t != "NONE"]
                overlaps = any(t in location_types for t in non_baby_types)
                if "BABY" not in record_types:
                    ok = False
                    print(f"  FAIL {granted_name} is not BABY-typed: {record_types}")
                elif not overlaps:
                    ok = False
                    print(f"  FAIL {granted_name} types {non_baby_types} do not overlap location types {location_types}")
                else:
                    print(f"  OK   {granted_name} types {non_baby_types} overlap location types {location_types}")

        real_errors = [e for e in errors if "assets/backgrounds/" not in e]
        ignored = len(errors) - len(real_errors)
        if ignored:
            print(f"(ignored {ignored} expected 404s for assets/backgrounds/)")
        if real_errors:
            ok = False
            print("Page/console errors:")
            for e in real_errors:
                print(f"  {e}")

        browser.close()

    print("RESULT:", "OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
