"""Phase 73 verification: event card conditions gray out the action buttons on the
real event page.

Builds a real run via starter.html, serves a fixture events.json (via page.route,
so the tracked events.json stays untouched) with a choice event whose three choices
probe has-unmet, has-met, and lacks-unmet conditions, points the run's active event
node at that fixture event, and asserts the disabled attribute plus the
.event-action-note reason text match getUnmetConditionReason's contract. Also
confirms clicking the one open choice still resolves the event.

Usage: .cache/venv/bin/python phase73_event_conditions.py
"""

import json
import sys

from lib import serving, sync_playwright

RUN_STATE_PROBE = "() => JSON.parse(localStorage.getItem('pokemon-rogue-pocket-run'))"


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
        owned = run["collections"]["pokemon"][0]["pokemon"]["name"]
        missing = "Nonexistent Probe Mon"
        print(f"owned={owned!r} missing={missing!r}")

        fixture = [{
            "type": "choice", "id": "verify-conditions", "enabled": True,
            "title": "Condition Probe", "body": "A humming appliance rattles on the roadside.",
            "choices": [
                {"id": "locked-has", "title": "Needs a card you lack", "buttonText": "Locked",
                 "conditions": [{"mode": "has", "cardKind": "pokemon", "name": missing}],
                 "effects": [{"type": "gain-cash", "amount": 10}]},
                {"id": "open-has", "title": "Needs a card you own", "buttonText": "Open",
                 "conditions": [{"mode": "has", "cardKind": "pokemon", "name": owned}],
                 "effects": [{"type": "gain-cash", "amount": 10}]},
                {"id": "locked-lacks", "title": "Blocked because you own it", "buttonText": "Locked",
                 "conditions": [{"mode": "lacks", "cardKind": "pokemon", "name": owned}],
                 "effects": [{"type": "gain-cash", "amount": 10}]},
            ],
        }]
        page.route("**/events.json", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(fixture)))

        page.evaluate("""() => {
            const key = 'pokemon-rogue-pocket-run';
            const run = JSON.parse(localStorage.getItem(key));
            run.area.activeEventNodeId = 'verify-node';
            run.area.activeBattleNodeId = null;
            run.area.activeCaptureNodeId = null;
            run.area.activeMartNodeId = null;
            run.eventEncounters = { 'verify-node': {
                battleCompleted: false, completed: false, completedAt: null,
                createdAt: new Date().toISOString(), eventId: 'verify-conditions',
                nodeId: 'verify-node', resultSummary: [], selectedActionId: null,
                startedBattle: false
            } };
            localStorage.setItem(key, JSON.stringify(run));
        }""")
        page.goto(f"{base}/event.html")
        page.wait_for_selector(".event-choice-card", timeout=15000)

        page.screenshot(path="phase73_event_conditions.png")

        heading = page.text_content("body") or ""
        if "Condition Probe" not in heading:
            ok = False
            print("  FAIL heading 'Condition Probe' not found on page (fixture may not have loaded)")
        else:
            print("  OK   fixture event rendered (heading present)")

        def note_for(action_id):
            card = page.query_selector(f"article.event-choice-card:has(button[data-event-action-id='{action_id}'])")
            if card is None:
                return None
            note = card.query_selector(".event-action-note")
            return note.text_content() if note else None

        def is_disabled(action_id):
            btn = page.query_selector(f"button[data-event-action-id='{action_id}']")
            return btn is not None and btn.get_attribute("disabled") is not None

        checks = [
            ("locked-has", True, f"Requires {missing}."),
            ("open-has", False, None),
            ("locked-lacks", True, f"You already have {owned}."),
        ]
        for action_id, expect_disabled, expect_note in checks:
            disabled = is_disabled(action_id)
            note = note_for(action_id)
            if disabled != expect_disabled:
                ok = False
                print(f"  FAIL {action_id}: disabled={disabled}, want {expect_disabled}")
            elif note != expect_note:
                ok = False
                print(f"  FAIL {action_id}: note={note!r}, want {expect_note!r}")
            else:
                print(f"  OK   {action_id}: disabled={disabled} note={note!r}")

        page.click("button[data-event-action-id='open-has']")
        page.wait_for_selector("[data-event-continue]", timeout=15000)
        print("  OK   clicking open-has resolved the event ([data-event-continue] appeared)")

        # Missing background images 404 by design (see data_validation.test.js
        # "asset warnings include the missing backgrounds") -- unrelated to this
        # phase, so filtered out here rather than failing the run.
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
